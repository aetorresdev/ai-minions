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
/** Clear screen + cursor home — erase leftover Ink frames before nested readline panes. */
const CLEAR_SEQUENCE = '\u001b[2J\u001b[H';

/**
 * Discard bytes already buffered on stdin (e.g. Enter that dispatched the pane).
 * Prevents readline from auto-answering the first prompt and racing the remount loop.
 * @param {NodeJS.ReadStream | { read?: Function, readableLength?: number } | null | undefined} stdin
 * @returns {number} bytes drained
 */
function drainStdin(stdin) {
  if (!stdin || typeof stdin.read !== 'function') return 0;
  let drained = 0;
  try {
    // readableLength is available on Node streams; fall back to non-blocking read loop.
    let safety = 0;
    while (safety < 64) {
      safety += 1;
      const pending = typeof stdin.readableLength === 'number' ? stdin.readableLength : 1;
      if (pending <= 0) break;
      const chunk = stdin.read(pending > 0 ? pending : undefined);
      if (chunk == null) break;
      drained += Buffer.isBuffer(chunk) ? chunk.length : String(chunk).length;
    }
  } catch {
    // non-fatal
  }
  return drained;
}

/**
 * Wipe leftover Ink frames, drain pending keystrokes, force cooked mode, resume stdin.
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
     * Full restore after normal quit, Ctrl+C, renderer exception, action/child failure.
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
  CLEAR_SEQUENCE,
  drainStdin,
  prepareNestedPaneIo,
  prepareInkRemount,
  createTerminalGuard,
  withTerminalGuard,
};
