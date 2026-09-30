'use strict';

/**
 * Single owner of TUI terminal acquire/release, restoration classification,
 * process ownership, and diagnostic intervals.
 *
 * Navigation does not acquire or release the terminal. External/nested work
 * uses the lease suspend/resume API. A dead PTY cannot prove the screen was
 * restored: callers must read `outcome`, and `ok` is true only for `completed`.
 *
 * Stock Ink 7 `render()` settles when the app exits. A React commit is not
 * evidence the terminal displayed a frame. `first_paint_ms` and
 * `render_frame_ms` close only after stdout accepts the write. A throw or
 * `EPIPE` is a failed attempt: `measured` stays false.
 * `surface_transition_ms` starts when the surface change is requested and
 * ends on that accepted write, so the interval can span real work.
 * No Ink fork: the gap is observation, covered by the write hook.
 *
 * When no operator request is in flight, frames and surface transitions use
 * `IDLE_FRAME_REQUEST_ID` (`tui-shell-idle`) so the accepted write still
 * correlates to the transition. Callers must not substitute null while a
 * request id exists.
 */

const fs = require('node:fs');
const { Writable } = require('node:stream');

const RESTORATION_OUTCOME = Object.freeze({
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  IMPOSSIBLE: 'impossible',
});

/** What each interval measures. Missing samples stay null, never a fake zero. */
const METRIC_DEFINITIONS = Object.freeze({
  tui_boot_ms: Object.freeze({
    start: 'session_enter',
    end: 'first_paint_model_built',
    observes: 'clock_between_marks',
  }),
  first_paint_ms: Object.freeze({
    start: 'paint_window_open',
    end: 'first_stdout_write',
    observes: 'stdout_write',
    not_observes: 'react_commit',
  }),
  surface_transition_ms: Object.freeze({
    start: 'surface_change_begin',
    end: 'accepted_stdout_write',
    observes: 'accepted_stdout_write',
  }),
  operator_action_ms: Object.freeze({
    start: 'operator_action_begin',
    end: 'operator_action_end',
    observes: 'operator_action_handler',
  }),
  runtime_action_ms: Object.freeze({
    start: 'runtime_read_begin',
    end: 'runtime_read_end',
    observes: 'runtime_or_adapter_read',
  }),
  render_frame_ms: Object.freeze({
    start: 'frame_armed',
    end: 'stdout_write',
    observes: 'stdout_write',
    not_observes: 'react_commit',
  }),
});

const METRIC_NAMES = Object.freeze(Object.keys(METRIC_DEFINITIONS));
const METRIC_RETENTION_LIMIT = 64;
const RESIZE_COALESCE_DEFAULT_MS = 32;
const RESIZE_BURST_LIMIT = 64;
/**
 * Correlation id for a frame or surface transition when the shell has no
 * in-flight operator request. The accepted write keeps this id so the frame
 * and the transition stay correlated. It is not a successful paint by itself.
 */
const IDLE_FRAME_REQUEST_ID = 'tui-shell-idle';

const DEAD_STREAM_CODES = new Set([
  'EIO',
  'EPIPE',
  'ENXIO',
  'EBADF',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
]);

const SECRET_PATTERNS = [
  /(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
];

/**
 * @param {unknown} value
 * @returns {string}
 */
function redactDiagnostic(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '[redacted]');
  }
  if (text.length > 180) text = `${text.slice(0, 180)}…`;
  return text;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDeadStreamError(err) {
  if (!err) return false;
  const code = err.code != null ? String(err.code) : '';
  if (DEAD_STREAM_CODES.has(code)) return true;
  const message = String(err.message || err);
  return /\b(EIO|EPIPE|ENXIO|EBADF)\b/.test(message);
}

/**
 * @param {{
 *   writeOk?: boolean,
 *   writeError?: Error | null,
 *   rawAttempted?: boolean,
 *   rawOk?: boolean,
 *   rawError?: Error | null,
 *   streamWritable?: boolean | null,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   outcome: 'completed' | 'partial' | 'impossible',
 *   restoration_reason: string,
 * }}
 */
function classifyRestoration(input = {}) {
  const writeOk = input.writeOk === true;
  const writeError = input.writeError || null;
  const rawAttempted = input.rawAttempted === true;
  const rawOk = input.rawOk !== false;
  const rawFailed = rawAttempted && !rawOk;
  const deadWrite = !writeOk && (isDeadStreamError(writeError) || input.streamWritable === false);
  const rawErrorCode = input.rawError && input.rawError.code ? String(input.rawError.code) : '';
  const writeCode = writeError && writeError.code ? String(writeError.code) : '';

  if (writeOk && !rawFailed) {
    return {
      ok: true,
      outcome: RESTORATION_OUTCOME.COMPLETED,
      restoration_reason: 'owned_modes_restored',
    };
  }

  if (!writeOk && rawFailed) {
    const why = deadWrite ? 'dead_pty' : 'restore_write_and_raw_failed';
    return {
      ok: false,
      outcome: RESTORATION_OUTCOME.IMPOSSIBLE,
      restoration_reason: writeCode
        ? `${why}:${writeCode}${rawErrorCode ? `+${rawErrorCode}` : ''}`
        : why,
    };
  }

  if (!writeOk && !rawAttempted && (deadWrite || input.streamWritable === false)) {
    return {
      ok: false,
      outcome: RESTORATION_OUTCOME.IMPOSSIBLE,
      restoration_reason: writeCode ? `dead_pty:${writeCode}` : 'dead_pty_not_writable',
    };
  }

  if (!writeOk) {
    return {
      ok: false,
      outcome: RESTORATION_OUTCOME.PARTIAL,
      restoration_reason: writeCode
        ? `restore_sequence_write_failed:${writeCode}`
        : 'restore_sequence_write_failed',
    };
  }

  return {
    ok: false,
    outcome: RESTORATION_OUTCOME.PARTIAL,
    restoration_reason: rawErrorCode
      ? `raw_mode_disable_failed:${rawErrorCode}`
      : 'raw_mode_disable_failed',
  };
}

/**
 * Write the session-end sequence. Injected writers are used as-is (tests).
 * A real TTY fd uses writeSync so EIO/EPIPE fail the call instead of being
 * reported as a queued stream write.
 * @param {{
 *   stdout?: { fd?: number, isTTY?: boolean, write?: Function, destroyed?: boolean, writable?: boolean, writableErrored?: Error | null, errored?: Error | null, on?: Function, off?: Function, removeListener?: Function },
 *   writeRestore?: (seq: string) => void,
 *   sequence: string,
 * }} input
 * @returns {{ ok: boolean, error: Error | null, streamWritable: boolean | null }}
 */
function writeTerminalSequence(input) {
  const sequence = input.sequence;
  if (typeof input.writeRestore === 'function') {
    try {
      input.writeRestore(sequence);
      return { ok: true, error: null, streamWritable: null };
    } catch (err) {
      return { ok: false, error: err, streamWritable: null };
    }
  }

  const stdout = input.stdout;
  if (!stdout) {
    const error = new Error('no stdout for terminal restore');
    error.code = 'ENXIO';
    return { ok: false, error, streamWritable: false };
  }
  if (stdout.destroyed === true || stdout.writable === false) {
    const error = stdout.writableErrored || stdout.errored || new Error('stdout not writable');
    if (error && !error.code) error.code = 'EIO';
    return { ok: false, error, streamWritable: false };
  }
  if (stdout.isTTY === true && typeof stdout.fd === 'number') {
    try {
      fs.writeSync(stdout.fd, sequence);
      return { ok: true, error: null, streamWritable: true };
    } catch (err) {
      return { ok: false, error: err, streamWritable: false };
    }
  }
  if (typeof stdout.write !== 'function') {
    const error = new Error('stdout has no write');
    error.code = 'ENXIO';
    return { ok: false, error, streamWritable: false };
  }

  let hooked = null;
  const onError = (err) => {
    hooked = err;
  };
  if (typeof stdout.on === 'function') stdout.on('error', onError);
  try {
    const returned = stdout.write(sequence);
    const errored = hooked || stdout.writableErrored || stdout.errored || null;
    if (errored) {
      return { ok: false, error: errored, streamWritable: stdout.writable !== false };
    }
    if (returned === false && (stdout.destroyed === true || stdout.writable === false)) {
      const error = new Error('terminal restore write failed');
      error.code = 'EIO';
      return { ok: false, error, streamWritable: false };
    }
    return { ok: true, error: null, streamWritable: stdout.writable !== false };
  } catch (err) {
    return { ok: false, error: err, streamWritable: stdout.writable !== false };
  } finally {
    if (typeof stdout.off === 'function') stdout.off('error', onError);
    else if (typeof stdout.removeListener === 'function') stdout.removeListener('error', onError);
  }
}

/**
 * Exclusive terminal lease.
 * Overlap while open or suspended is rejected.
 * release() is definitive: a later resume is rejected.
 * suspend/resume returns the lease on the success, error, and cancellation paths
 * via withSuspended().
 */
function createTerminalLease() {
  let state = 'closed';
  let generation = 0;
  let holder = null;
  let definitiveClose = false;

  function acquire(holderId) {
    if (definitiveClose || state === 'closed' && definitiveClose) {
      return {
        ok: false,
        reason_code: 'TERMINAL_LEASE_CLOSED',
        generation: null,
        holder: null,
      };
    }
    if (state === 'open' || state === 'suspended') {
      return {
        ok: false,
        reason_code: 'TERMINAL_LEASE_OVERLAP',
        generation: null,
        holder,
      };
    }
    generation += 1;
    state = 'open';
    holder = holderId == null ? 'tui-session' : String(holderId);
    return { ok: true, reason_code: 'TERMINAL_LEASE_ACQUIRED', generation, holder };
  }

  function release(gen) {
    if (gen !== generation || (state !== 'open' && state !== 'suspended')) {
      return {
        ok: false,
        reason_code: definitiveClose ? 'TERMINAL_LEASE_CLOSED' : 'TERMINAL_LEASE_STALE',
        definitive: definitiveClose,
      };
    }
    state = 'closed';
    holder = null;
    definitiveClose = true;
    return { ok: true, reason_code: 'TERMINAL_LEASE_RELEASED', definitive: true };
  }

  function suspend(gen) {
    if (definitiveClose || state === 'closed') {
      return { ok: false, reason_code: 'TERMINAL_LEASE_LATE_RESUME', definitive: definitiveClose };
    }
    if (gen !== generation || state !== 'open') {
      return {
        ok: false,
        reason_code: state === 'suspended' ? 'TERMINAL_LEASE_OVERLAP' : 'TERMINAL_LEASE_NOT_HELD',
      };
    }
    state = 'suspended';
    return { ok: true, reason_code: 'TERMINAL_LEASE_SUSPENDED', generation: gen };
  }

  function resume(gen) {
    if (definitiveClose || state === 'closed') {
      return {
        ok: false,
        reason_code: 'TERMINAL_LEASE_LATE_RESUME',
        definitive: true,
      };
    }
    if (gen !== generation || state !== 'suspended') {
      return { ok: false, reason_code: 'TERMINAL_LEASE_NOT_SUSPENDED' };
    }
    state = 'open';
    return { ok: true, reason_code: 'TERMINAL_LEASE_RESUMED', generation: gen };
  }

  /**
   * Runs fn while the lease is suspended and always attempts resume,
   * including throw and AbortError cancellation.
   * @param {number} gen
   * @param {() => Promise<unknown> | unknown} fn
   */
  async function withSuspended(gen, fn) {
    const suspended = suspend(gen);
    if (!suspended.ok) return { ok: false, suspend: suspended, resume: null, value: undefined };
    let error = null;
    let value;
    try {
      value = await fn();
    } catch (err) {
      error = err;
    }
    const resumed = resume(gen);
    return {
      ok: error == null && resumed.ok,
      suspend: suspended,
      resume: resumed,
      cancelled: Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')),
      value,
      error,
    };
  }

  return {
    acquire,
    release,
    suspend,
    resume,
    withSuspended,
    snapshot() {
      return { state, generation, holder, definitiveClose };
    },
  };
}

/**
 * Tracks listeners, timers, and auxiliary processes the TUI itself created.
 * shutdown() does not cancel or kill a persistent execution, and it does not
 * announce that execution's termination.
 */
function createOwnedProcessSet() {
  /** @type {{ emitter: NodeJS.EventEmitter, event: string, handler: Function }[]} */
  const listeners = [];
  /** @type {Array<ReturnType<typeof setTimeout>>} */
  const timers = [];
  /** @type {{ kill: Function, pid?: number }[]} */
  const auxiliary = [];
  let persistentRefused = false;

  return {
    trackListener(emitter, event, handler) {
      emitter.on(event, handler);
      listeners.push({ emitter, event, handler });
    },
    trackTimer(id) {
      timers.push(id);
      return id;
    },
    trackAuxiliary(proc) {
      if (!proc || typeof proc.kill !== 'function') {
        throw new TypeError('auxiliary process must expose kill');
      }
      auxiliary.push(proc);
      return proc;
    },
    /**
     * Record that a persistent execution is outside this shutdown.
     * Does not call cancel/kill and does not set a termination announcement.
     * @param {unknown} execution
     */
    refusePersistent(execution) {
      persistentRefused = execution != null;
      return {
        cancelled: false,
        killed: false,
        announced_termination: false,
        reason_code: 'OUTSIDE_TUI_OWNERSHIP',
        execution_present: execution != null,
      };
    },
    shutdown(options = {}) {
      const refusal = this.refusePersistent(options.persistentExecution);
      let removed = 0;
      while (listeners.length > 0) {
        const item = listeners.pop();
        try {
          if (item.emitter && typeof item.emitter.removeListener === 'function') {
            item.emitter.removeListener(item.event, item.handler);
          } else if (item.emitter && typeof item.emitter.off === 'function') {
            item.emitter.off(item.event, item.handler);
          }
        } catch {
          // listener already gone
        }
        removed += 1;
      }
      while (timers.length > 0) {
        clearTimeout(timers.pop());
      }
      const auxiliaryStopped = [];
      while (auxiliary.length > 0) {
        const proc = auxiliary.pop();
        try {
          proc.kill('SIGTERM');
          auxiliaryStopped.push(proc.pid ?? null);
        } catch (err) {
          auxiliaryStopped.push({ error: err && err.code ? String(err.code) : 'kill_failed' });
        }
      }
      return {
        listeners_removed: removed,
        timers_cleared: true,
        auxiliary_stopped: auxiliaryStopped,
        persistent_cancelled: false,
        announced_termination: false,
        persistent_refused: refusal.execution_present || persistentRefused,
        reason_code: 'TUI_OWNED_CLEANUP_ONLY',
      };
    },
  };
}

const OWNED_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);

/**
 * Bind cleanup to SIGINT/SIGTERM/SIGHUP and, on a real process target,
 * uncaughtException. The handler restores via callback and shuts down only
 * the owned set. It does not cancel `persistentExecution`.
 * Re-raises the signal on the real process after cleanup so the TUI process
 * still terminates. A non-process emitter never re-raises.
 * @param {NodeJS.EventEmitter | null | undefined} target
 * @param {{
 *   ownership: ReturnType<typeof createOwnedProcessSet>,
 *   onCleanup: (reason: string) => void,
 *   persistentExecution?: unknown,
 *   reRaise?: boolean,
 * }} options
 * @returns {() => void}
 */
function attachOwnedSignalCleanup(target, options) {
  if (!target || typeof target.on !== 'function') return () => {};
  const ownership = options.ownership;
  const onCleanup = options.onCleanup;
  let closed = false;

  const detachFns = [];
  const detach = () => {
    if (closed) return;
    closed = true;
    while (detachFns.length > 0) {
      const fn = detachFns.pop();
      try {
        fn();
      } catch {
        // already removed
      }
    }
  };

  const run = (reason) => {
    if (closed) return;
    try {
      ownership.refusePersistent(options.persistentExecution);
      if (typeof onCleanup === 'function') onCleanup(reason);
      ownership.shutdown();
    } finally {
      detach();
    }
  };

  for (const sig of OWNED_SIGNALS) {
    const handler = () => {
      run(`signal_${sig}`);
      const shouldRaise = options.reRaise !== false && target === process;
      if (shouldRaise) {
        try {
          process.kill(process.pid, sig);
        } catch {
          // signal unavailable
        }
      }
    };
    try {
      ownership.trackListener(target, sig, handler);
      detachFns.push(() => {
        if (typeof target.removeListener === 'function') target.removeListener(sig, handler);
      });
    } catch {
      // platform has no such signal
    }
  }

  if (target === process) {
    const onFatal = () => {
      run('uncaught_exception');
      process.exit(1);
    };
    try {
      ownership.trackListener(target, 'uncaughtException', onFatal);
      detachFns.push(() => {
        process.removeListener('uncaughtException', onFatal);
      });
    } catch {
      // ignore
    }
  }

  return detach;
}

/**
 * Bounded diagnostic intervals. `ms === null` means not measured.
 * A React commit does not close `first_paint_ms` or `render_frame_ms`.
 */
function createTuiMetrics(options = {}) {
  const limit = Number.isInteger(options.retentionLimit) && options.retentionLimit > 0
    ? options.retentionLimit
    : METRIC_RETENTION_LIMIT;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  /** @type {object[]} */
  const samples = [];
  /** @type {Map<string, object>} */
  const latest = new Map();
  let renderCount = 0;
  let remountCount = 0;
  let reactCommits = 0;
  let paintOpenedAt = null;
  /** @type {{ request_id: string | null, surface: string | null } | null} */
  let paintMeta = null;
  let firstPaintClosed = false;
  /** @type {object | null} */
  let openFrame = null;
  /** @type {object | null} */
  let openTransition = null;
  let seq = 0;
  let writeAttempts = 0;
  let writeAccepted = 0;
  let writeFailed = 0;
  /** @type {string | null} */
  let lastWriteFailure = null;
  /** @type {string | null} */
  let paintFailureReason = null;
  /** @type {string | null} */
  let frameFailureReason = null;
  /** @type {string | null} */
  let transitionFailureReason = null;

  function push(sample) {
    const stored = {
      ...sample,
      request_id: sample.request_id == null ? null : redactDiagnostic(sample.request_id),
      surface: sample.surface == null ? null : redactDiagnostic(sample.surface),
      restoration_reason: sample.restoration_reason == null
        ? null
        : redactDiagnostic(sample.restoration_reason),
    };
    samples.push(stored);
    while (samples.length > limit) samples.shift();
    if (stored.name) latest.set(stored.name, stored);
    return stored;
  }

  function beginInterval(name, meta = {}) {
    const definition = METRIC_DEFINITIONS[name];
    if (!definition) {
      throw new TypeError(`unknown tui metric ${name}`);
    }
    seq += 1;
    return {
      id: seq,
      name,
      startedAt: now(),
      request_id: meta.request_id == null ? null : String(meta.request_id),
      surface: meta.surface == null ? null : String(meta.surface),
      closed: false,
    };
  }

  function endInterval(handle, extra = {}) {
    if (!handle || handle.closed) return null;
    handle.closed = true;
    const definition = METRIC_DEFINITIONS[handle.name];
    const endedAt = now();
    const ms = Math.max(0, endedAt - handle.startedAt);
    return push({
      name: handle.name,
      ms,
      measured: true,
      start: definition.start,
      end: definition.end,
      observes: definition.observes,
      not_observes: definition.not_observes || null,
      request_id: extra.request_id != null ? extra.request_id : handle.request_id,
      surface: extra.surface != null ? extra.surface : handle.surface,
      started_at: handle.startedAt,
      ended_at: endedAt,
    });
  }

  return {
    definitions: METRIC_DEFINITIONS,
    retentionLimit: limit,
    beginInterval,
    endInterval,
    markBootStart(meta = {}) {
      this._boot = beginInterval('tui_boot_ms', meta);
      return this._boot;
    },
    markBootEnd(extra = {}) {
      return endInterval(this._boot, extra);
    },
    openPaintWindow(meta = {}) {
      if (firstPaintClosed || paintOpenedAt != null) return;
      paintOpenedAt = now();
      paintMeta = {
        request_id: meta.request_id == null ? null : String(meta.request_id),
        surface: meta.surface == null ? null : String(meta.surface),
      };
    },
    /**
     * React committed a tree. This is intentionally not first paint and not a frame.
     */
    noteReactCommit() {
      reactCommits += 1;
      return { react_commits: reactCommits, first_paint_closed: firstPaintClosed };
    },
    /**
     * A write was attempted. Does not close paint, frame, or transition.
     */
    noteTerminalWriteAttempt() {
      writeAttempts += 1;
      return { attempts: writeAttempts };
    },
    /**
     * The writer rejected the bytes (throw or EPIPE). Not a paint.
     * @param {unknown} err
     */
    noteTerminalWriteFailure(err) {
      writeFailed += 1;
      const reason = err && err.code ? String(err.code) : 'write_failed';
      lastWriteFailure = reason;
      if (paintOpenedAt != null && !firstPaintClosed) paintFailureReason = reason;
      if (openFrame && !openFrame.closed) frameFailureReason = reason;
      if (openTransition && !openTransition.closed) transitionFailureReason = reason;
      return { failed: writeFailed, failure_reason: reason };
    },
    /**
     * Terminal bytes were accepted by the writer. Closes first paint, any
     * armed frame, and any open surface transition. Does not store the payload.
     * A failed attempt must not call this.
     * @param {unknown} [_chunk]
     */
    noteTerminalWrite(_chunk) {
      writeAccepted += 1;
      lastWriteFailure = null;
      paintFailureReason = null;
      frameFailureReason = null;
      transitionFailureReason = null;
      const closed = [];
      if (paintOpenedAt != null && !firstPaintClosed) {
        const endedAt = now();
        firstPaintClosed = true;
        closed.push(push({
          name: 'first_paint_ms',
          ms: Math.max(0, endedAt - paintOpenedAt),
          measured: true,
          start: METRIC_DEFINITIONS.first_paint_ms.start,
          end: METRIC_DEFINITIONS.first_paint_ms.end,
          observes: 'stdout_write',
          not_observes: 'react_commit',
          request_id: paintMeta && paintMeta.request_id,
          surface: paintMeta && paintMeta.surface,
          started_at: paintOpenedAt,
          ended_at: endedAt,
        }));
      }
      if (openFrame) {
        const frame = openFrame;
        openFrame = null;
        closed.push(endInterval(frame));
      }
      if (openTransition) {
        const transition = openTransition;
        openTransition = null;
        closed.push(endInterval(transition));
      }
      return closed;
    },
    armRenderFrame(meta = {}) {
      if (openFrame && !openFrame.closed) {
        if (meta.request_id != null) openFrame.request_id = String(meta.request_id);
        if (meta.surface != null) openFrame.surface = String(meta.surface);
        return openFrame;
      }
      openFrame = beginInterval('render_frame_ms', meta);
      return openFrame;
    },
    noteInkMount() {
      remountCount += 1;
      return remountCount;
    },
    noteLocalNavigation(meta = {}) {
      return {
        remount_count: remountCount,
        surface: meta.surface == null ? null : redactDiagnostic(meta.surface),
        lease_touched: false,
      };
    },
    noteRender() {
      renderCount += 1;
      return renderCount;
    },
    /**
     * Open a surface transition. The interval stays open until the
     * corresponding stdout write is accepted — it is not closed in this call.
     * A later begin before that write keeps the original start and refreshes
     * correlation ids.
     * @param {{ request_id?: string | null, surface?: string | null }} [meta]
     */
    recordSurfaceTransition(meta = {}) {
      if (openTransition && !openTransition.closed) {
        if (meta.request_id != null) openTransition.request_id = String(meta.request_id);
        if (meta.surface != null) openTransition.surface = String(meta.surface);
        return openTransition;
      }
      openTransition = beginInterval('surface_transition_ms', meta);
      return openTransition;
    },
    beginSurfaceTransition(meta = {}) {
      return this.recordSurfaceTransition(meta);
    },
    snapshot() {
      /** @type {Record<string, object | null>} */
      const failureFor = (name) => {
        if (name === 'first_paint_ms') return paintFailureReason;
        if (name === 'render_frame_ms') return frameFailureReason;
        if (name === 'surface_transition_ms') return transitionFailureReason;
        return null;
      };
      const intervals = {};
      for (const name of METRIC_NAMES) {
        const sample = latest.get(name);
        intervals[name] = sample
          ? {
            ms: sample.ms,
            measured: true,
            observes: sample.observes,
            not_observes: sample.not_observes,
            start: sample.start,
            end: sample.end,
            request_id: sample.request_id,
            surface: sample.surface,
            failure_reason: null,
          }
          : {
            ms: null,
            measured: false,
            observes: METRIC_DEFINITIONS[name].observes,
            not_observes: METRIC_DEFINITIONS[name].not_observes || null,
            start: METRIC_DEFINITIONS[name].start,
            end: METRIC_DEFINITIONS[name].end,
            request_id: null,
            surface: null,
            failure_reason: failureFor(name),
          };
      }
      return {
        intervals,
        render_count: renderCount,
        remount_count: remountCount,
        react_commits: reactCommits,
        retained: samples.length,
        retention_limit: limit,
        samples: samples.slice(),
        terminal_writes: {
          attempts: writeAttempts,
          accepted: writeAccepted,
          failed: writeFailed,
          last_failure_reason: lastWriteFailure,
        },
      };
    },
  };
}

/**
 * Coalesce resize bursts into one flush.
 * The wait starts on the first event of a batch and is not reset by later
 * events, so a continuous stream cannot postpone the commit past `waitMs`
 * (default 32). Hitting `maxBurst` (default 64) commits immediately.
 * @param {{ waitMs?: number, maxBurst?: number, onFlush?: Function, setTimer?: Function, clearTimer?: Function }} [options]
 */
function createResizeCoalescer(options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : RESIZE_COALESCE_DEFAULT_MS;
  const maxBurst = Number.isInteger(options.maxBurst) && options.maxBurst > 0
    ? options.maxBurst
    : RESIZE_BURST_LIMIT;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let timer = null;
  let pending = 0;
  let dropped = 0;
  let flushes = 0;
  let last = null;

  function flushNow() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
    if (pending === 0) return;
    const count = pending;
    pending = 0;
    flushes += 1;
    if (typeof options.onFlush === 'function') {
      options.onFlush({ count, dropped, sample: last });
    }
  }

  function push(sample) {
    if (pending >= maxBurst) dropped += 1;
    else pending += 1;
    last = sample;
    if (pending >= maxBurst) {
      flushNow();
      return { pending, dropped };
    }
    if (timer == null) {
      timer = setTimer(() => {
        timer = null;
        flushNow();
      }, waitMs);
    }
    return { pending, dropped };
  }

  function dispose() {
    if (timer != null) clearTimer(timer);
    timer = null;
    pending = 0;
  }

  return {
    push,
    dispose,
    stats() {
      return { pending, dropped, flushes };
    },
  };
}

/**
 * @param {unknown} stream
 * @returns {boolean}
 */
function isNodeWritable(stream) {
  if (!stream || typeof stream !== 'object') return false;
  if (stream instanceof Writable) return true;
  return typeof stream._writableState === 'object' && stream._writableState !== null;
}

/**
 * Observe stdout writes without retaining payload bytes.
 * Paint and frame intervals close only after the original writer accepts
 * the write. On a Node Writable that means the write callback reported
 * success, with or without a caller callback. A throw, a stream error, or a
 * callback error — including one delivered on a later turn — is a failed
 * attempt.
 * @param {{ write?: Function, on?: Function, off?: Function, removeListener?: Function }} stdout
 * @param {{
 *   noteTerminalWrite: (chunk: unknown) => void,
 *   noteTerminalWriteAttempt?: () => void,
 *   noteTerminalWriteFailure?: (err: unknown) => void,
 * }} metrics
 * @returns {() => void}
 */
function observeTerminalWrites(stdout, metrics) {
  if (!stdout || typeof stdout.write !== 'function' || typeof metrics.noteTerminalWrite !== 'function') {
    return () => {};
  }
  if (stdout.__aimTerminalWriteObserved === true) return () => {};
  const original = stdout.write;

  const safeAttempt = () => {
    if (typeof metrics.noteTerminalWriteAttempt !== 'function') return;
    try {
      metrics.noteTerminalWriteAttempt();
    } catch {
      // diagnostics must not break the write
    }
  };
  const safeAccepted = (chunk) => {
    try {
      metrics.noteTerminalWrite(chunk);
    } catch {
      // diagnostics must not break the write
    }
  };
  const safeFailed = (err) => {
    if (typeof metrics.noteTerminalWriteFailure !== 'function') return;
    try {
      metrics.noteTerminalWriteFailure(err);
    } catch {
      // diagnostics must not break the write
    }
  };

  // A Node Writable reports the real outcome through the write callback, which
  // can arrive on a later turn (EPIPE/EIO after return). A plain writer object
  // has no such contract: only a throw or a synchronous 'error' is observable.
  const reportsCompletion = isNodeWritable(stdout);

  function wrapped(chunk, encoding, cb) {
    let enc = encoding;
    let callback = cb;
    if (typeof enc === 'function') {
      callback = enc;
      enc = undefined;
    }
    safeAttempt();
    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (err) safeFailed(err);
      else safeAccepted(chunk);
    };
    let syncError = null;
    const onError = (err) => {
      syncError = err;
    };
    if (typeof stdout.on === 'function') stdout.on('error', onError);
    try {
      if (reportsCompletion || typeof callback === 'function') {
        const done = (err) => {
          settle(err || null);
          if (typeof callback === 'function') callback(err);
        };
        const returned = enc === undefined
          ? original.call(stdout, chunk, done)
          : original.call(stdout, chunk, enc, done);
        if (syncError) settle(syncError);
        return returned;
      }
      const returned = enc === undefined
        ? original.call(stdout, chunk)
        : original.call(stdout, chunk, enc);
      settle(syncError);
      return returned;
    } catch (err) {
      settle(err);
      throw err;
    } finally {
      if (typeof stdout.off === 'function') stdout.off('error', onError);
      else if (typeof stdout.removeListener === 'function') stdout.removeListener('error', onError);
    }
  }
  stdout.write = wrapped;
  stdout.__aimTerminalWriteObserved = true;
  return () => {
    if (stdout.write === wrapped) stdout.write = original;
    delete stdout.__aimTerminalWriteObserved;
  };
}

module.exports = {
  RESTORATION_OUTCOME,
  METRIC_DEFINITIONS,
  METRIC_NAMES,
  METRIC_RETENTION_LIMIT,
  RESIZE_COALESCE_DEFAULT_MS,
  RESIZE_BURST_LIMIT,
  IDLE_FRAME_REQUEST_ID,
  DEAD_STREAM_CODES,
  redactDiagnostic,
  isDeadStreamError,
  classifyRestoration,
  writeTerminalSequence,
  createTerminalLease,
  createOwnedProcessSet,
  OWNED_SIGNALS,
  attachOwnedSignalCleanup,
  createTuiMetrics,
  createResizeCoalescer,
  observeTerminalWrites,
};
