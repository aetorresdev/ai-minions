'use strict';

/**
 * Child process for real-PTY evidence. Stdio is the slave side of a PTY.
 * quit / SIGTERM / SIGHUP / fatal go through runOperatorTuiShell (real Ink).
 * handoff-close / handoff-failure reproduce soften → resumeInkSession → restore
 * on that same PTY. The shell's nested path resumes before soften, so this
 * sequence is the one that leaves raw mode on if restore trusts the wrapper.
 */

const fs = require('node:fs');
const { runOperatorTuiShell } = require('../../../modules/operator/operator-tui-shell-entry');
const {
  createTerminalGuard,
  resumeInkSession,
} = require('../../../modules/operator/operator-tui-terminal-guard');

const mode = process.argv[2];
const resultPath = process.argv[3];

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
