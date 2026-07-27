'use strict';

/**
 * Terminal restoration for the production Ink 7 fullscreen TUI shell.
 * Tracks raw-mode / cursor / alternate-screen mutations for deterministic tests.
 */

const RESTORE_SEQUENCE = '\u001b[?1049l\u001b[?25h\u001b[0m';

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
     * Restore terminal after normal quit, Ctrl+C, renderer exception, action/child failure.
     * Idempotent.
     */
    restore(reason = 'normal') {
      if (restored) {
        mutations.push({ kind: 'restore_skipped', value: reason });
        return { ok: true, already: true, reason };
      }
      restored = true;
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
      const writer = typeof options.writeRestore === 'function'
        ? options.writeRestore
        : (seq) => {
          if (stdout && typeof stdout.write === 'function') stdout.write(seq);
        };
      try {
        writer(RESTORE_SEQUENCE);
        mutations.push({ kind: 'restore_sequence', value: reason });
      } catch (err) {
        mutations.push({
          kind: 'restore_write_error',
          value: String(err && err.message ? err.message : err),
        });
      }
      if (originalSetRawMode) {
        stdin.setRawMode = originalSetRawMode;
      }
      return { ok: true, already: false, reason };
    },
  };
}

/**
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
    if (!guard.restored) guard.restore(reason);
  }
}

module.exports = {
  RESTORE_SEQUENCE,
  createTerminalGuard,
  withTerminalGuard,
};
