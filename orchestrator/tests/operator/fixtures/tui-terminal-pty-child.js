'use strict';

/**
 * Child process for real-PTY evidence. Stdio is the slave side of a PTY.
 * quit / ctrl-c / SIGINT / SIGTERM / SIGHUP / fatal / master-close go through
 * runOperatorTuiShell (real Ink).
 * handoff-close / handoff-failure reproduce soften → resumeInkSession → restore
 * on that same PTY. The shell's nested path resumes before soften, so this
 * sequence is the one that leaves raw mode on if restore trusts the wrapper.
 */

const fs = require('node:fs');
const guardModule = require('../../../modules/operator/operator-tui-terminal-guard');

const mode = process.argv[2];
const resultPath = process.argv[3];

// macOS revokes a PTY when its session leader exits, and the master then
// fails writes with EIO. Block here, after restore, until the parent has
// echoed a byte. A closed master (hangup) makes the read fail and we move on.
let probeHeld = false;
function holdForParentProbe() {
  if (probeHeld) return;
  probeHeld = true;
  try {
    if (process.stdin.isRaw === true && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  } catch {
    // slave already hung up
  }
  // Ink leaves the TTY non-blocking. readSync then returns EAGAIN and the
  // process exits before the parent can echo a byte. macOS revokes the PTY
  // on that exit, so the probe has to be a real blocking read.
  try {
    if (process.stdin._handle && typeof process.stdin._handle.setBlocking === 'function') {
      process.stdin._handle.setBlocking(true);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof process.stdin.pause === 'function') process.stdin.pause();
  } catch {
    // ignore
  }
  try {
    fs.readSync(0, Buffer.alloc(8), 0, 1);
  } catch {
    // EAGAIN/EIO: master closed or still non-blocking. Do not block hangup.
  }
}

const realExit = process.exit.bind(process);
process.exit = (code) => {
  holdForParentProbe();
  realExit(code);
};
const realKill = process.kill.bind(process);
const HELD_SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGHUP']);
process.kill = (pid, sig) => {
  if (pid === process.pid && HELD_SIGNALS.has(String(sig))) holdForParentProbe();
  return realKill(pid, sig);
};

// A signal handler re-raises after restore, so the process dies before main()
// can report. Persist every restore outcome synchronously as it happens.
// Patched before the shell entry is required so the entry binds this wrapper.
const restorations = [];
const baseCreateTerminalGuard = guardModule.createTerminalGuard;
guardModule.createTerminalGuard = (options) => {
  const guard = baseCreateTerminalGuard(options);
  const baseRestore = guard.restore.bind(guard);
  guard.restore = (reason) => {
    const outcome = baseRestore(reason);
    restorations.push({
      reason: outcome && outcome.reason,
      ok: outcome ? outcome.ok : null,
      outcome: outcome ? outcome.outcome : null,
      restoration_reason: outcome ? outcome.restoration_reason : null,
    });
    fs.writeFileSync(`${resultPath}.restore.json`, JSON.stringify(restorations));
    return outcome;
  };
  return guard;
};

const { runOperatorTuiShell } = require('../../../modules/operator/operator-tui-shell-entry');
const { createTerminalGuard, resumeInkSession } = guardModule;

function report(payload) {
  fs.writeFileSync(resultPath, JSON.stringify({
    ...payload,
    platform: process.platform,
    stdout_is_tty: process.stdout.isTTY === true,
    stdin_is_tty: process.stdin.isTTY === true,
    stdin_is_raw: process.stdin.isRaw === true,
  }));
}

function shellOptions() {
  return {
    isTTY: true,
    skipSplash: true,
    useColor: false,
    buildAbout: () => ({
      version: '0.0.0-pty',
      model_policy: 'local_only',
      git_commit: 'pty',
    }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    loadRuns: () => ({
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_EMPTY',
      next_safe_action: 'none',
      json: { result_code: 'RUNS_EMPTY', runs: [], next_safe_action: 'none' },
    }),
    // Ink (is-in-ci) defaults to non-interactive when CI is set, even on a TTY:
    // it writes no frames until unmount, so the PTY driver never sees output and
    // never sends keys. This fixture runs on a real PTY, so it forces interactive
    // for its own mounts only; product and the rest of the CI env keep defaults.
    importRenderer: async () => {
      const mod = await import('../../../modules/operator/operator-tui-shell-render.mjs');
      return {
        renderOperatorTuiShell: (opts) => mod.renderOperatorTuiShell({ ...opts, interactive: true }),
      };
    },
  };
}

function runHandoff(failure) {
  if (process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  const guard = createTerminalGuard({
    stdin: process.stdin,
    stdout: process.stdout,
    holderId: 'pty-handoff',
  });
  if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
  guard.soften('handoff');
  resumeInkSession({ stdin: process.stdin, stdout: process.stdout });
  let restored;
  if (failure) {
    try {
      throw new Error('handoff failure');
    } catch {
      restored = guard.restore('fatal_error');
    }
  } else {
    restored = guard.restore('quit');
  }
  report({
    mode,
    integrated_shell: false,
    handoff: true,
    restored,
    guard_raw_mode: guard.rawMode,
    lease_state: guard.lease.snapshot().state,
  });
  const cooked = process.stdin.isRaw !== true && restored && restored.ok === true && restored.outcome === 'completed';
  process.exit(cooked ? 0 : 1);
}

async function main() {
  if (mode === 'handoff-close') {
    runHandoff(false);
    return;
  }
  if (mode === 'handoff-failure') {
    runHandoff(true);
    return;
  }

  if (mode === 'fatal') {
    setTimeout(() => {
      throw new Error('integrated pty fatal');
    }, 800);
  }

  const result = await runOperatorTuiShell(shellOptions());
  report({
    mode,
    integrated_shell: true,
    ink_loaded: result.ink_loaded === true,
    react_loaded: result.react_loaded === true,
    reason_code: result.reason_code,
    content_surface: result.model ? result.model.contentSurface : null,
    restored: result.guard ? result.guard.restoration : null,
    guard_raw_mode: result.guard ? result.guard.rawMode : null,
    lease_state: result.guard && result.guard.lease ? result.guard.lease.snapshot().state : null,
  });
  const restoredOk = Boolean(result.guard && result.guard.restoration && result.guard.restoration.ok === true);
  process.exit(restoredOk && process.stdin.isRaw !== true ? 0 : 1);
}

main().catch((err) => {
  report({
    mode,
    integrated_shell: true,
    error: String(err && err.message ? err.message : err),
  });
  process.exit(1);
});
