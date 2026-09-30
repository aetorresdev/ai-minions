'use strict';

/**
 * Child process for real-PTY evidence. Stdio is the slave side of a PTY.
 * Reports JSON to a filesystem path so a dead master can still be observed.
 */

const fs = require('node:fs');
const { createTerminalGuard } = require('../../../modules/operator/operator-tui-terminal-guard');
const {
  createOwnedProcessSet,
  attachOwnedSignalCleanup,
} = require('../../../modules/operator/operator-tui-terminal-lifecycle');

const mode = process.argv[2];
const resultPath = process.argv[3];

function report(payload) {
  fs.writeFileSync(resultPath, JSON.stringify({
    ...payload,
    platform: process.platform,
    stdout_is_tty: process.stdout.isTTY === true,
    stdin_is_tty: process.stdin.isTTY === true,
  }));
}

const guard = createTerminalGuard({
  stdin: process.stdin,
  stdout: process.stdout,
  holderId: 'pty-session',
});

if (process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function') {
  process.stdin.setRawMode(true);
}

const navigation = guard.noteLocalNavigation({
  from: 'home',
  to: 'overview',
  request_id: 'pty-nav',
});

if (mode === 'quit' || mode === 'failure') {
  let restored;
  if (mode === 'failure') {
    try {
      throw new Error('forced terminal failure');
    } catch {
      restored = guard.restore('fatal_error');
    }
  } else {
    restored = guard.restore('quit');
  }
  report({
    mode,
    navigation,
    restored,
    lease_state: guard.lease.snapshot().state,
  });
  process.exit(restored && restored.ok ? 0 : 1);
}

if (mode === 'interrupt') {
  const ownership = createOwnedProcessSet();
  const persistent = {
    killed: false,
    announced: false,
    kill() {
      this.killed = true;
    },
    pid: 424242,
  };
  attachOwnedSignalCleanup(process, {
    ownership,
    persistentExecution: persistent,
    reRaise: false,
    onCleanup: (reason) => {
      const restored = guard.restored ? guard.restoration : guard.restore(reason);
      report({
        mode,
        navigation,
        reason,
        restored,
        persistent_killed: persistent.killed,
        announced_termination: persistent.announced,
        lease_state: guard.lease.snapshot().state,
      });
      process.exit(0);
    },
  });
  const stayAlive = () => {
    setTimeout(stayAlive, 1000);
  };
  stayAlive();
  return;
}

if (mode === 'dead') {
  if (typeof process.stdout.on === 'function') {
    process.stdout.on('error', () => {});
  }
  let reported = false;
  const finish = (triggerCode) => {
    if (reported) return;
    reported = true;
    const restored = guard.restored ? guard.restoration : guard.restore('dead_pty');
    report({
      mode,
      navigation,
      trigger_code: triggerCode,
      restored,
      lease_state: guard.lease.snapshot().state,
    });
    process.exit(0);
  };
  // Closing the PTY master delivers SIGHUP to the session. Ignore the default
  // terminate so the write failure can be classified instead of killing the child.
  process.on('SIGHUP', () => finish('SIGHUP'));
  const started = Date.now();
  const probe = () => {
    if (reported) return;
    if (Date.now() - started > 4000) {
      report({
        mode,
        navigation,
        restored: { ok: false, outcome: 'timeout', restoration_reason: 'dead_pty_probe_timeout' },
      });
      process.exit(1);
    }
    try {
      fs.writeSync(process.stdout.fd, 'ping\n');
    } catch (err) {
      finish(err && err.code ? String(err.code) : 'write_failed');
      return;
    }
    setTimeout(probe, 20);
  };
  probe();
  return;
}

report({ mode, error: 'unknown mode' });
process.exit(2);
