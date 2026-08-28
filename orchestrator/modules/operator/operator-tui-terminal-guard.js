'use strict';

/**
 * Terminal restoration for the production Ink 7 fullscreen TUI shell.
 * Tracks raw-mode / cursor / alternate-screen mutations for deterministic tests.
 */

/** Full session-end restore: leave alt-screen (if any), show cursor, reset attrs. */
const RESTORE_SEQUENCE = '\u001b[?1049l\u001b[?25h\u001b[0m';
/**
 * Soft handoff before nested readline — keep session visually "inside" the TUI.
 * Must NOT emit CSI ?1049l (alt-screen exit); that blank primary buffer looks like a quit.
 */
const SOFT_HANDOFF_SEQUENCE = '\u001b[?25h\u001b[0m';
/** Ink interactive mount: hide cursor (paired with prepareNestedPaneIo soft handoff). */
const INK_HIDE_CURSOR_SEQUENCE = '\u001b[?25l';
/** Clear screen + cursor home — erase leftover Ink frames before nested readline panes. */
const CLEAR_SEQUENCE = '\u001b[2J\u001b[H';

/**
 * Discard only residual dispatch CR/LF left after Ink hotkey/Enter (at most one
 * newline: `\n`, `\r`, or `\r\n`). The buffered remainder is requeued via a
 * **single** `unshift` so a typed answer already buffered after Enter keeps its
 * bytes and order for the nested readline prompt. (Byte-wise `read(1)` +
 * `unshift(byte)` is not portable: Node ≥26 `read()` after `unshift` returns
 * only the requeued chunk, so consumers draining the buffer in one `read()`
 * would lose the answer's trailing newline.)
 * @param {NodeJS.ReadStream | { read?: Function, unshift?: Function, readableLength?: number } | null | undefined} stdin
 * @returns {number} residue bytes discarded (0–2)
 */
function drainStdin(stdin) {
  if (!stdin || typeof stdin.read !== 'function') return 0;
  if (typeof stdin.readableLength === 'number' && stdin.readableLength === 0) return 0;

  const toBuffer = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));

  try {
    if (typeof stdin.unshift !== 'function') {
      // No way to requeue — consume a byte only when it is certain residue.
      const first = stdin.read(1);
      if (first == null) return 0;
      const buf = toBuffer(first);
      if (buf.length === 0) return 0;
      if (buf[0] === 0x0a || buf[0] === 0x0d) return 1;
      return 0;
    }

    let buffered = null;
    for (;;) {
      const chunk = stdin.read();
      if (chunk == null) break;
      const buf = toBuffer(chunk);
      if (buf.length === 0) continue;
      buffered = buffered === null ? buf : Buffer.concat([buffered, buf]);
    }
    if (buffered === null || buffered.length === 0) return 0;

    let stripped = 0;
    if (buffered[0] === 0x0a) {
      stripped = 1;
    } else if (buffered[0] === 0x0d) {
      stripped = buffered.length > 1 && buffered[1] === 0x0a ? 2 : 1;
    }
    const rest = buffered.subarray(stripped);
    if (rest.length > 0) stdin.unshift(rest);
    return stripped;
  } catch {
    return 0;
  }
}

/** Safety ceiling for cold-start drain — runaway pipes fail closed instead of hanging. */
const COLD_START_DRAIN_SAFETY_MAX = 1_048_576;

/**
 * Cold-start only: discard the **entire** existing stdin buffer before the first
 * Ink mount (brand splash or shell) so a prior session's Enter/`1` cannot
 * auto-dismiss the splash or auto-open Start New Run.
 * Drains until empty. A safety ceiling aborts with `COLD_START_STDIN_DRAIN_TRUNCATED`
 * when more data remains (fail closed — do not mount with leftovers).
 * @param {NodeJS.ReadStream | { read?: Function, readableLength?: number } | null | undefined} stdin
 * @param {{ maxBytes?: number }} [options]
 * @returns {number} bytes discarded
 */
function drainStdinColdStart(stdin, options = {}) {
  if (!stdin || typeof stdin.read !== 'function') return 0;
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : COLD_START_DRAIN_SAFETY_MAX;
  let discarded = 0;
  try {
    while (discarded < maxBytes) {
      if (typeof stdin.readableLength === 'number' && stdin.readableLength === 0) break;
      const want = typeof stdin.readableLength === 'number' && stdin.readableLength > 0
        ? Math.min(stdin.readableLength, maxBytes - discarded)
        : Math.min(4096, maxBytes - discarded);
      const chunk = stdin.read(want);
      if (chunk == null) break;
      const n = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk), 'utf8');
      if (n === 0) break;
      discarded += n;
      if (typeof stdin.readableLength === 'number') {
        // keep readableLength in sync for fake/test streams that only update on read(1)
      }
    }
    const stillBuffered = typeof stdin.readableLength === 'number'
      ? stdin.readableLength > 0
      : false;
    if (discarded >= maxBytes && stillBuffered) {
      const err = new Error('cold start stdin drain truncated — refusing mount with leftover buffer');
      err.code = 'COLD_START_STDIN_DRAIN_TRUNCATED';
      throw err;
    }
    // Streams without readableLength: if we hit the ceiling on the last full read,
    // probe one more byte — leftover means fail closed.
    if (discarded >= maxBytes && typeof stdin.readableLength !== 'number') {
      const probe = stdin.read(1);
      if (probe != null) {
        if (typeof stdin.unshift === 'function') {
          stdin.unshift(Buffer.isBuffer(probe) ? probe : Buffer.from(String(probe), 'utf8'));
        }
        const err = new Error('cold start stdin drain truncated — refusing mount with leftover buffer');
        err.code = 'COLD_START_STDIN_DRAIN_TRUNCATED';
        throw err;
      }
    }
  } catch (err) {
    if (err && err.code === 'COLD_START_STDIN_DRAIN_TRUNCATED') throw err;
    // other read errors are non-fatal — shell still boots to landing
  }
  return discarded;
}

/**
 * Wipe leftover Ink frames, drain residual dispatch CR/LF only, force cooked mode, resume stdin.
 * Soft handoff only — does not leave alternate screen (session stays in-process).
 * @param {{
 *   stdin?: NodeJS.ReadStream | { resume?: Function, setRawMode?: Function, read?: Function },
 *   stdout?: NodeJS.WriteStream | { write?: Function },
 *   writeClear?: (seq: string) => void,
 *   drain?: boolean,
 *   clear?: boolean,
 *   banner?: string | null,
 * }} [options]
 * @returns {{ ok: boolean, wrote: boolean, drained: number }}
 */
function prepareNestedPaneIo(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const writer = typeof options.writeClear === 'function'
    ? options.writeClear
    : (seq) => {
      if (stdout && typeof stdout.write === 'function') stdout.write(seq);
    };
  const shouldDrain = options.drain !== false;
  const shouldClear = options.clear !== false;
  let drained = 0;
  if (shouldDrain) {
    drained = drainStdin(stdin);
  }
  try {
    writer(SOFT_HANDOFF_SEQUENCE);
    if (shouldClear) writer(CLEAR_SEQUENCE);
    if (options.banner) {
      const banner = String(options.banner);
      writer(banner.endsWith('\n') ? banner : `${banner}\n`);
    }
  } catch {
    return { ok: false, wrote: false, drained };
  }
  // Ink may leave raw mode on briefly after unmount — readline needs cooked mode.
  if (stdin && typeof stdin.setRawMode === 'function') {
    try {
      stdin.setRawMode(false);
    } catch {
      // non-fatal
    }
  }
  if (stdin && typeof stdin.resume === 'function') {
    try {
      stdin.resume();
    } catch {
      // non-fatal — prompt may still work
    }
  }
  return { ok: true, wrote: true, drained };
}

/**
 * After nested readline closes (which pauses stdin), resume for the next Ink mount.
 * @param {{
 *   stdin?: NodeJS.ReadStream | { resume?: Function, isPaused?: Function },
 * }} [options]
 * @returns {{ ok: boolean, resumed: boolean }}
 */
function prepareInkRemount(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  if (!stdin || typeof stdin.resume !== 'function') {
    return { ok: true, resumed: false };
  }
  try {
    const paused = typeof stdin.isPaused === 'function' ? stdin.isPaused() : true;
    if (paused) stdin.resume();
    return { ok: true, resumed: true };
  } catch {
    return { ok: false, resumed: false };
  }
}

/**
 * Restore stdin/terminal for an Ink mount that stayed in-process after nested I/O.
 * Re-enables raw mode, resumes paused stdin, and hides the cursor.
 * Does not leave alternate screen — session continues inside the active mount.
 * @param {{
 *   stdin?: NodeJS.ReadStream | { resume?: Function, isPaused?: Function, setRawMode?: Function, isRaw?: boolean },
 *   stdout?: NodeJS.WriteStream | { write?: Function },
 *   writeHideCursor?: (seq: string) => void,
 * }} [options]
 * @returns {{ ok: boolean, raw: boolean, resumed: boolean, hidCursor: boolean }}
 */
function resumeInkSession(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let raw = false;
  let resumed = false;
  let hidCursor = false;

  if (stdin && typeof stdin.resume === 'function') {
    try {
      const paused = typeof stdin.isPaused === 'function' ? stdin.isPaused() : false;
      if (paused) {
        stdin.resume();
        resumed = true;
      }
    } catch {
      // non-fatal
    }
  }
  if (stdin && typeof stdin.setRawMode === 'function') {
    try {
      stdin.setRawMode(true);
      raw = true;
    } catch {
      // non-fatal
    }
  }
  const writer = typeof options.writeHideCursor === 'function'
    ? options.writeHideCursor
    : (seq) => {
      if (stdout && typeof stdout.write === 'function') stdout.write(seq);
    };
  try {
    writer(INK_HIDE_CURSOR_SEQUENCE);
    hidCursor = true;
  } catch {
    // non-fatal
  }
  return { ok: true, raw, resumed, hidCursor };
}

/**
 * @param {{
 *   stdin?: NodeJS.ReadStream | { isTTY?: boolean, isRaw?: boolean, setRawMode?: Function },
 *   stdout?: NodeJS.WriteStream | { isTTY?: boolean, write?: Function },
 *   writeRestore?: (seq: string) => void,
 * }} [options]
 */
function createTerminalGuard(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  /** @type {{ kind: string, value?: unknown }[]} */
  const mutations = [];
  let rawMode = Boolean(stdin.isRaw);
  let restored = false;
  const originalSetRawMode = typeof stdin.setRawMode === 'function'
    ? stdin.setRawMode.bind(stdin)
    : null;

  if (originalSetRawMode) {
    stdin.setRawMode = (mode) => {
      const next = Boolean(mode);
      mutations.push({ kind: 'setRawMode', value: next });
      rawMode = next;
      return originalSetRawMode(next);
    };
  }

  const writeSeq = (seq) => {
    const writer = typeof options.writeRestore === 'function'
      ? options.writeRestore
      : (s) => {
        if (stdout && typeof stdout.write === 'function') stdout.write(s);
      };
    writer(seq);
  };

  const disableRawAndUnwrap = () => {
    if (originalSetRawMode && rawMode) {
      try {
        originalSetRawMode(false);
        rawMode = false;
        mutations.push({ kind: 'setRawMode', value: false });
      } catch (err) {
        mutations.push({
          kind: 'setRawMode_error',
          value: String(err && err.message ? err.message : err),
        });
      }
    }
    if (originalSetRawMode && stdin.setRawMode !== originalSetRawMode) {
      stdin.setRawMode = originalSetRawMode;
    }
  };

  return {
    stdin,
    stdout,
    mutations,
    get rawMode() {
      return rawMode;
    },
    get restored() {
      return restored;
    },
    markMounted() {
      mutations.push({ kind: 'mounted' });
    },
    /**
     * Soft handoff after Ink unmount when a nested pane / remount will follow.
     * Disables raw mode and shows the cursor — does NOT leave alt-screen / mark restored.
     * @param {string} [reason]
     */
    soften(reason = 'action_dispatch') {
      if (restored) {
        mutations.push({ kind: 'soften_skipped', value: reason });
        return { ok: true, already: true, reason, soft: true };
      }
      disableRawAndUnwrap();
      try {
        writeSeq(SOFT_HANDOFF_SEQUENCE);
        mutations.push({ kind: 'soften_sequence', value: reason });
      } catch (err) {
        mutations.push({
          kind: 'soften_write_error',
          value: String(err && err.message ? err.message : err),
        });
      }
      return { ok: true, already: false, reason, soft: true };
    },
    /**
     * Full restore after session end: quit, Ctrl+C, renderer exception,
     * or thrown/fatal action exception.
     * Non-throwing failed action results (including caught launch errors that
     * return ok:false) remount via soft handoff — not this path.
     * Idempotent. Emits alt-screen exit — session-end only.
     * @param {string} [reason]
     */
    restore(reason = 'normal') {
      if (restored) {
        mutations.push({ kind: 'restore_skipped', value: reason });
        return { ok: true, already: true, reason };
      }
      restored = true;
      disableRawAndUnwrap();
      try {
        writeSeq(RESTORE_SEQUENCE);
        mutations.push({ kind: 'restore_sequence', value: reason });
      } catch (err) {
        mutations.push({
          kind: 'restore_write_error',
          value: String(err && err.message ? err.message : err),
        });
      }
      return { ok: true, already: false, reason };
    },
  };
}

/**
 * Run fn under a mount mark. On success: soft handoff (remount/pane may follow).
 * On exception: full restore. Session-end callers must still call guard.restore().
 * @param {ReturnType<typeof createTerminalGuard>} guard
 * @param {() => Promise<unknown> | unknown} fn
 * @param {string} [reason]
 */
async function withTerminalGuard(guard, fn, reason = 'normal') {
  guard.markMounted();
  try {
    return await fn();
  } catch (err) {
    guard.restore(reason === 'normal' ? 'renderer_exception' : reason);
    throw err;
  } finally {
    if (!guard.restored) {
      if (typeof guard.soften === 'function') guard.soften(reason);
      else guard.restore(reason);
    }
  }
}

module.exports = {
  RESTORE_SEQUENCE,
  SOFT_HANDOFF_SEQUENCE,
  INK_HIDE_CURSOR_SEQUENCE,
  CLEAR_SEQUENCE,
  COLD_START_DRAIN_SAFETY_MAX,
  drainStdin,
  drainStdinColdStart,
  prepareNestedPaneIo,
  prepareInkRemount,
  resumeInkSession,
  createTerminalGuard,
  withTerminalGuard,
};
