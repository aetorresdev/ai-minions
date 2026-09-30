'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  createTerminalGuard,
  RESTORE_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');
const {
  createTerminalLease,
  createOwnedProcessSet,
  createTuiMetrics,
  createResizeCoalescer,
  attachOwnedSignalCleanup,
  METRIC_DEFINITIONS,
} = require('../../modules/operator/operator-tui-terminal-lifecycle');

function rawStdin() {
  return {
    isTTY: true,
    isRaw: true,
    setRawMode(mode) {
      this.isRaw = Boolean(mode);
      return this;
    },
  };
}

test('failed restoration write is not ok:true and stays failed on the idempotent retry', () => {
  let writes = 0;
  const stdin = rawStdin();
  const guard = createTerminalGuard({
    stdin,
    writeRestore() {
      writes += 1;
      const err = new Error('restore write failed');
      err.code = 'EIO';
      throw err;
    },
  });
  const first = guard.restore('quit');
  assert.equal(first.ok, false);
  assert.notEqual(first.outcome, 'completed');
  assert.equal(first.outcome, 'partial');
  assert.match(first.restoration_reason, /EIO/);
  assert.equal(stdin.isRaw, false);
  assert.equal(writes, 1);

  const second = guard.restore('again');
  assert.equal(second.already, true);
  assert.equal(second.ok, false);
  assert.equal(second.outcome, 'partial');
  assert.equal(writes, 1, 'idempotent restore must not write twice');
  assert.equal(
    guard.mutations.filter((item) => item.kind === 'restore_write_error').length,
    1,
  );
});

test('dead stdout with no owned raw-mode change is impossible, not ok', () => {
  const guard = createTerminalGuard({
    stdin: { isTTY: true, isRaw: false },
    stdout: { isTTY: false, writable: false, destroyed: true },
  });
  const result = guard.restore('dead_pty');
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'impossible');
  assert.match(result.restoration_reason, /dead_pty/);
});

test('raw-mode disable failure plus dead write is impossible', () => {
  const stdin = rawStdin();
  stdin.setRawMode = () => {
    const err = new Error('raw ioctl failed');
    err.code = 'EIO';
    throw err;
  };
  const guard = createTerminalGuard({
    stdin,
    writeRestore() {
      const err = new Error('pty closed');
      err.code = 'EPIPE';
      throw err;
    },
  });
  stdin.isRaw = true;
  const result = guard.restore('quit');
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'impossible');
  assert.match(result.restoration_reason, /EPIPE/);
});

test('successful restore is completed exactly once', () => {
  const writes = [];
  const guard = createTerminalGuard({
    stdin: rawStdin(),
    writeRestore: (seq) => writes.push(seq),
  });
  const first = guard.restore('normal');
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'completed');
  assert.equal(first.restoration_reason, 'owned_modes_restored');
  assert.deepEqual(writes, [RESTORE_SEQUENCE]);
  const second = guard.restore('normal');
  assert.equal(second.ok, true);
  assert.equal(second.already, true);
  assert.equal(writes.length, 1);
  assert.equal(guard.lease.snapshot().definitiveClose, true);
});

test('terminal lease rejects overlap and late resume after definitive close', async () => {
  const lease = createTerminalLease();
  const first = lease.acquire('session');
  assert.equal(first.ok, true);
  const overlap = lease.acquire('other');
  assert.equal(overlap.ok, false);
  assert.equal(overlap.reason_code, 'TERMINAL_LEASE_OVERLAP');

  const cancelled = await lease.withSuspended(first.generation, async () => {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    throw err;
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.resume.ok, true);
  assert.equal(cancelled.resume.reason_code, 'TERMINAL_LEASE_RESUMED');
  assert.equal(lease.snapshot().state, 'open');

  const failed = await lease.withSuspended(first.generation, async () => {
    throw new Error('nested failed');
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.resume.reason_code, 'TERMINAL_LEASE_RESUMED');
  assert.equal(lease.snapshot().state, 'open');

  const released = lease.release(first.generation);
  assert.equal(released.ok, true);
  const late = lease.resume(first.generation);
  assert.equal(late.ok, false);
  assert.equal(late.reason_code, 'TERMINAL_LEASE_LATE_RESUME');
  const again = lease.acquire('late');
  assert.equal(again.reason_code, 'TERMINAL_LEASE_CLOSED');
});

test('local navigation does not release or reacquire the lease and does not remount', () => {
  const guard = createTerminalGuard({
    stdin: rawStdin(),
    writeRestore() {},
  });
  guard.markMounted();
  const remounts = guard.metrics.snapshot().remount_count;
  const nav = guard.noteLocalNavigation({
    from: 'runs',
    to: 'overview',
    request_id: 'nav-1',
  });
  assert.equal(nav.lease_unchanged, true);
  assert.equal(nav.lease_touched, false);
  assert.equal(nav.lease_state, 'open');
  assert.equal(guard.metrics.snapshot().remount_count, remounts);
  assert.equal(guard.lease.snapshot().state, 'open');
  const interval = guard.metrics.snapshot().intervals.surface_transition_ms;
  assert.equal(interval.measured, true);
  assert.equal(interval.surface, 'overview');
  assert.equal(interval.request_id, 'nav-1');
  assert.equal(interval.observes, 'shell_state_transition');
});

test('shutdown stops owned listeners, timers, and auxiliary processes only', () => {
  const emitter = new EventEmitter();
  const ownership = createOwnedProcessSet();
  let heard = 0;
  ownership.trackListener(emitter, 'ping', () => {
    heard += 1;
  });
  let timerFired = false;
  ownership.trackTimer(setTimeout(() => {
    timerFired = true;
  }, 50));
  const auxiliary = { pid: 7, killed: false, kill() { this.killed = true; } };
  ownership.trackAuxiliary(auxiliary);
  const persistent = {
    pid: 99,
    killed: false,
    announced: false,
    kill() { this.killed = true; },
  };

  const result = ownership.shutdown({ persistentExecution: persistent });
  emitter.emit('ping');

  assert.equal(heard, 0);
  assert.equal(auxiliary.killed, true);
  assert.equal(persistent.killed, false);
  assert.equal(persistent.announced, false);
  assert.equal(result.persistent_cancelled, false);
  assert.equal(result.announced_termination, false);
  assert.equal(result.reason_code, 'TUI_OWNED_CLEANUP_ONLY');
  assert.deepEqual(result.auxiliary_stopped, [7]);
  assert.equal(timerFired, false);
});

test('signal cleanup restores the terminal and does not kill a persistent execution', () => {
  const emitter = new EventEmitter();
  const ownership = createOwnedProcessSet();
  const persistent = { killed: false, kill() { this.killed = true; } };
  const writes = [];
  const guard = createTerminalGuard({
    stdin: rawStdin(),
    writeRestore: (seq) => writes.push(seq),
  });
  const detach = attachOwnedSignalCleanup(emitter, {
    ownership,
    persistentExecution: persistent,
    reRaise: false,
    onCleanup: (reason) => {
      ownership.refusePersistent(persistent);
      guard.restore(reason);
    },
  });
  emitter.emit('SIGTERM');
  assert.equal(guard.restored, true);
  assert.equal(guard.restoration.ok, true);
  assert.equal(guard.restoration.outcome, 'completed');
  assert.equal(writes.includes(RESTORE_SEQUENCE), true);
  assert.equal(persistent.killed, false);
  assert.equal(guard.resumeExternal().reason_code, 'TERMINAL_LEASE_LATE_RESUME');
  detach();
  emitter.emit('SIGINT');
  assert.equal(writes.length, 1);
});

test('first_paint_ms observes stdout write, not a React commit, and unmeasured stays null', () => {
  let clock = 5000;
  const metrics = createTuiMetrics({ now: () => clock });
  metrics.openPaintWindow({ surface: 'home', request_id: 'paint-1' });
  metrics.noteReactCommit();
  metrics.noteReactCommit();
  const before = metrics.snapshot().intervals.first_paint_ms;
  assert.equal(before.ms, null);
  assert.equal(before.measured, false);
  assert.equal(before.observes, 'stdout_write');
  assert.equal(before.not_observes, 'react_commit');
  assert.equal(METRIC_DEFINITIONS.first_paint_ms.not_observes, 'react_commit');

  metrics.armRenderFrame({ surface: 'home', request_id: 'paint-1' });
  metrics.noteReactCommit();
  assert.equal(metrics.snapshot().intervals.render_frame_ms.measured, false);

  clock = 5040;
  metrics.noteTerminalWrite('frame-bytes-not-stored');
  const paint = metrics.snapshot().intervals.first_paint_ms;
  assert.equal(paint.measured, true);
  assert.equal(paint.ms, 40);
  assert.equal(paint.observes, 'stdout_write');
  assert.equal(paint.not_observes, 'react_commit');
  assert.equal(paint.request_id, 'paint-1');
  assert.equal(paint.surface, 'home');
  const frame = metrics.snapshot().intervals.render_frame_ms;
  assert.equal(frame.measured, true);
  assert.equal(frame.observes, 'stdout_write');
  assert.equal(frame.not_observes, 'react_commit');

  const boot = metrics.beginInterval('tui_boot_ms', { surface: 'home', request_id: 'boot' });
  const closed = metrics.endInterval(boot);
  assert.equal(closed.ms, 0);
  assert.equal(closed.measured, true);
  assert.equal(metrics.snapshot().intervals.operator_action_ms.ms, null);
  assert.equal(metrics.snapshot().intervals.operator_action_ms.measured, false);
});

test('metric samples redact secrets and honor the retention limit', () => {
  const metrics = createTuiMetrics({ retentionLimit: 3, now: () => 10 });
  metrics.recordSurfaceTransition({ surface: 'home', request_id: 'r1' });
  metrics.recordSurfaceTransition({ surface: 'runs', request_id: 'r2' });
  metrics.recordSurfaceTransition({ surface: 'overview', request_id: 'r3' });
  metrics.recordSurfaceTransition({
    surface: 'help',
    request_id: 'sk-supersecretvalue123456',
  });
  const snap = metrics.snapshot();
  assert.equal(snap.retained, 3);
  assert.equal(snap.retention_limit, 3);
  assert.equal(snap.samples.some((sample) => sample.request_id === 'r1'), false);
  assert.equal(snap.samples.some((sample) => String(sample.request_id).includes('supersecret')), false);
  assert.match(snap.intervals.surface_transition_ms.request_id, /redacted/);
  assert.equal(snap.intervals.surface_transition_ms.start, 'surface_change_begin');
  assert.equal(snap.intervals.surface_transition_ms.end, 'surface_change_end');
});

test('resize bursts flush once and drop events past the burst ceiling', async () => {
  let flushes = 0;
  let lastCount = 0;
  const coalescer = createResizeCoalescer({
    waitMs: 15,
    maxBurst: 4,
    onFlush: (info) => {
      flushes += 1;
      lastCount = info.count;
    },
  });
  for (let i = 0; i < 10; i += 1) coalescer.push({ columns: 80 + i });
  assert.equal(flushes, 0);
  assert.equal(coalescer.stats().dropped, 6);
  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
  assert.equal(flushes, 1);
  assert.equal(lastCount, 4);
  coalescer.dispose();
});
