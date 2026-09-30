'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  createTerminalGuard,
  resumeInkSession,
  withTerminalGuard,
  RESTORE_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');
const {
  createTerminalLease,
  createOwnedProcessSet,
  createTuiMetrics,
  createResizeCoalescer,
  attachOwnedSignalCleanup,
  observeTerminalWrites,
  METRIC_DEFINITIONS,
  IDLE_FRAME_REQUEST_ID,
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
  const opened = guard.metrics.snapshot().intervals.surface_transition_ms;
  assert.equal(opened.measured, false, 'transition must stay open until the frame write');
  assert.equal(opened.ms, null);
  guard.metrics.noteTerminalWrite('frame');
  const interval = guard.metrics.snapshot().intervals.surface_transition_ms;
  assert.equal(interval.measured, true);
  assert.equal(interval.surface, 'overview');
  assert.equal(interval.request_id, 'nav-1');
  assert.equal(interval.observes, 'accepted_stdout_write');
  assert.equal(interval.end, 'accepted_stdout_write');
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
  let clock = 10;
  const metrics = createTuiMetrics({ retentionLimit: 3, now: () => clock });
  const closeTransition = (surface, requestId) => {
    const handle = metrics.recordSurfaceTransition({ surface, request_id: requestId });
    assert.equal(handle.closed, false);
    clock += 5;
    metrics.noteTerminalWrite('frame');
    assert.equal(handle.closed, true);
  };
  closeTransition('home', 'r1');
  closeTransition('runs', 'r2');
  closeTransition('overview', 'r3');
  closeTransition('help', 'sk-supersecretvalue123456');
  const snap = metrics.snapshot();
  assert.equal(snap.retained, 3);
  assert.equal(snap.retention_limit, 3);
  assert.equal(snap.samples.some((sample) => sample.request_id === 'r1'), false);
  assert.equal(snap.samples.some((sample) => String(sample.request_id).includes('supersecret')), false);
  assert.match(snap.intervals.surface_transition_ms.request_id, /redacted/);
  assert.equal(snap.intervals.surface_transition_ms.start, 'surface_change_begin');
  assert.equal(snap.intervals.surface_transition_ms.end, 'accepted_stdout_write');
  assert.ok(snap.intervals.surface_transition_ms.ms >= 5);
});

test('surface transition stays open until the accepted write and keeps request_id', () => {
  let clock = 1000;
  const metrics = createTuiMetrics({ now: () => clock });
  const handle = metrics.beginSurfaceTransition({ surface: 'runs', request_id: 'req-9' });
  assert.equal(handle.closed, false);
  const mid = metrics.snapshot().intervals.surface_transition_ms;
  assert.equal(mid.measured, false);
  assert.equal(mid.ms, null);
  clock = 1030;
  metrics.noteTerminalWrite('frame-bytes');
  assert.equal(handle.closed, true);
  const done = metrics.snapshot().intervals.surface_transition_ms;
  assert.equal(done.measured, true);
  assert.equal(done.ms, 30);
  assert.equal(done.request_id, 'req-9');
  assert.equal(done.surface, 'runs');
  assert.equal(done.end, 'accepted_stdout_write');
  assert.equal(IDLE_FRAME_REQUEST_ID, 'tui-shell-idle');
});

test('failed stdout write is not first paint', () => {
  let clock = 2000;
  const metrics = createTuiMetrics({ now: () => clock });
  metrics.openPaintWindow({ surface: 'home', request_id: 'paint-fail' });
  metrics.armRenderFrame({ surface: 'home', request_id: 'paint-fail' });
  const stdout = {
    write() {
      const err = new Error('broken pipe');
      err.code = 'EPIPE';
      throw err;
    },
  };
  observeTerminalWrites(stdout, metrics);
  assert.throws(() => stdout.write('frame'), (err) => err && err.code === 'EPIPE');
  const paint = metrics.snapshot().intervals.first_paint_ms;
  assert.equal(paint.measured, false);
  assert.equal(paint.ms, null);
  assert.equal(paint.failure_reason, 'EPIPE');
  const frame = metrics.snapshot().intervals.render_frame_ms;
  assert.equal(frame.measured, false);
  assert.equal(frame.failure_reason, 'EPIPE');
  const writes = metrics.snapshot().terminal_writes;
  assert.equal(writes.attempts, 1);
  assert.equal(writes.accepted, 0);
  assert.equal(writes.failed, 1);
  assert.equal(writes.last_failure_reason, 'EPIPE');

  clock = 2040;
  metrics.noteTerminalWrite('accepted-later');
  const painted = metrics.snapshot().intervals.first_paint_ms;
  assert.equal(painted.measured, true);
  assert.equal(painted.ms, 40);
  assert.equal(painted.failure_reason, null);
});

test('handoff then resume then close does not report completed while stdin stays raw', () => {
  const stdin = rawStdin();
  const guard = createTerminalGuard({
    stdin,
    writeRestore() {},
  });
  stdin.setRawMode(true);
  guard.soften('handoff');
  resumeInkSession({ stdin, stdout: { write() {} } });
  assert.equal(stdin.isRaw, true);
  const result = guard.restore('quit');
  assert.equal(stdin.isRaw, false);
  assert.equal(guard.rawMode, false);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'completed');
});

test('handoff then resume then failure does not report completed while stdin stays raw', async () => {
  const stdin = rawStdin();
  const guard = createTerminalGuard({
    stdin,
    writeRestore() {},
  });
  stdin.setRawMode(true);
  guard.soften('handoff');
  resumeInkSession({ stdin, stdout: { write() {} } });
  await assert.rejects(
    () => withTerminalGuard(guard, async () => {
      throw new Error('fatal after handoff');
    }, 'fatal_error'),
    /fatal after handoff/,
  );
  assert.equal(stdin.isRaw, false);
  assert.equal(guard.rawMode, false);
  assert.equal(guard.restoration.ok, true);
  assert.equal(guard.restoration.outcome, 'completed');
  assert.equal(guard.restoration.reason, 'fatal_error');
});

test('restore is not completed when observed raw mode cannot be cleared', () => {
  const stdin = {
    isTTY: true,
    isRaw: true,
    setRawMode(mode) {
      if (mode) this.isRaw = true;
    },
  };
  const guard = createTerminalGuard({
    stdin,
    writeRestore() {},
  });
  const result = guard.restore('quit');
  assert.equal(stdin.isRaw, true);
  assert.equal(result.ok, false);
  assert.notEqual(result.outcome, 'completed');
  assert.match(result.restoration_reason, /raw_mode|RAW_MODE/);
});

test('lease overlap on the shared terminal does not mutate it', () => {
  const stdin = rawStdin();
  let writes = 0;
  const first = createTerminalGuard({
    stdin,
    writeRestore() {},
  });
  const wrapped = stdin.setRawMode;
  stdin.setRawMode(true);
  const second = createTerminalGuard({
    stdin,
    writeRestore() {
      writes += 1;
    },
  });
  assert.equal(
    second.mutations.some((item) => item.kind === 'lease_rejected' && item.value === 'TERMINAL_LEASE_OVERLAP'),
    true,
  );
  assert.equal(stdin.setRawMode, wrapped);
  const rawBefore = stdin.isRaw;
  const rejected = second.restore('quit');
  assert.equal(writes, 0);
  assert.equal(stdin.isRaw, rawBefore);
  assert.equal(stdin.setRawMode, wrapped);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.restoration_reason, 'TERMINAL_LEASE_OVERLAP');

  const lease = createTerminalLease();
  const sharedStdin = rawStdin();
  const owner = createTerminalGuard({
    stdin: sharedStdin,
    lease,
    writeRestore() {},
  });
  const ownerWrapped = sharedStdin.setRawMode;
  let sharedWrites = 0;
  const other = createTerminalGuard({
    stdin: sharedStdin,
    lease,
    writeRestore() {
      sharedWrites += 1;
    },
  });
  assert.equal(sharedStdin.setRawMode, ownerWrapped);
  other.restore('quit');
  assert.equal(sharedWrites, 0);
  assert.equal(other.restoration, null);
  owner.restore('quit');
  assert.equal(sharedStdin.isRaw, false);
});

test('sustained resize burst commits at the ceiling without a quiet gap', () => {
  let flushes = 0;
  let lastCount = 0;
  const coalescer = createResizeCoalescer({
    waitMs: 1000,
    maxBurst: 64,
    setTimer() {
      return 1;
    },
    clearTimer() {},
    onFlush: (info) => {
      flushes += 1;
      lastCount = info.count;
    },
  });
  for (let i = 0; i < 200; i += 1) coalescer.push({ columns: i });
  assert.ok(flushes >= 1, 'a sustained burst must commit at the ceiling');
  assert.equal(lastCount, 64);
  coalescer.dispose();
});

test('resize events do not postpone the commit past the max wait', async () => {
  let flushes = 0;
  const timers = [];
  const coalescer = createResizeCoalescer({
    waitMs: 32,
    maxBurst: 100,
    setTimer(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimer(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    onFlush: () => {
      flushes += 1;
    },
  });
  for (let i = 0; i < 30; i += 1) coalescer.push({ columns: i });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cleared, false);
  assert.equal(timers[0].ms, 32);
  assert.equal(flushes, 0);
  timers[0].fn();
  assert.equal(flushes, 1);

  let trailed = 0;
  const trailing = createResizeCoalescer({
    waitMs: 30,
    maxBurst: 50,
    onFlush: () => {
      trailed += 1;
    },
  });
  trailing.push({ columns: 1 });
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  trailing.push({ columns: 2 });
  await new Promise((resolve) => { setTimeout(resolve, 40); });
  assert.equal(trailed, 1);
  trailing.dispose();
  coalescer.dispose();
});
