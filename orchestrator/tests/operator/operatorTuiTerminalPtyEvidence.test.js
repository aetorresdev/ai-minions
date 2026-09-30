'use strict';

/**
 * Real PTY evidence for terminal restore.
 *
 * Linux runs this against a pseudoterminal allocated by python3's pty.fork.
 * macOS cannot be executed on a Linux host. The macOS test is skipped here
 * with an explicit reason. A skip is not a pass and must not be reported as
 * macOS evidence.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RESTORE_SEQUENCE } = require('../../modules/operator/operator-tui-terminal-guard');

const CHILD = path.join(__dirname, 'fixtures', 'tui-terminal-pty-child.js');
const MODES = ['quit', 'failure', 'interrupt', 'dead'];

const PTY_DRIVER = String.raw`
import os, pty, select, signal, sys, time

node, fixture, mode, result_path, transcript_path = sys.argv[1:6]
pid, fd = pty.fork()
if pid == 0:
    os.execv(node, [node, fixture, mode, result_path])
else:
    if mode == 'dead':
        time.sleep(0.25)
        os.close(fd)
        fd = -1
    elif mode == 'interrupt':
        time.sleep(0.25)
        os.kill(pid, signal.SIGINT)
    deadline = time.time() + 5
    transcript = b''
    while fd >= 0 and time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if not ready:
            wpid, _status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                break
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        transcript += chunk
    if fd >= 0:
        try:
            os.close(fd)
        except OSError:
            pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    with open(transcript_path, 'wb') as handle:
        handle.write(transcript)
`;

function runPtyMode(mode, dir) {
  const resultPath = path.join(dir, `${mode}-result.json`);
  const transcriptPath = path.join(dir, `${mode}-transcript.bin`);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [
      '-c',
      PTY_DRIVER,
      process.execPath,
      CHILD,
      mode,
      resultPath,
      transcriptPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!fs.existsSync(resultPath)) {
        reject(new Error(`PTY mode ${mode} produced no result (python exit ${code}): ${stderr}`));
        return;
      }
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      const transcript = fs.existsSync(transcriptPath)
        ? fs.readFileSync(transcriptPath)
        : Buffer.alloc(0);
      resolve({ code, stderr, result, transcript });
    });
  });
}

async function assertRealPtyEvidence() {
  const python = spawn('python3', ['-c', 'import pty']);
  const pythonOk = await new Promise((resolve) => {
    python.on('error', () => resolve(false));
    python.on('close', (code) => resolve(code === 0));
  });
  assert.equal(pythonOk, true, 'python3 pty module is required for real PTY evidence');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-pty-'));
  try {
    const runs = {};
    for (const mode of MODES) {
      runs[mode] = await runPtyMode(mode, dir);
    }

    for (const mode of MODES) {
      assert.equal(runs[mode].result.stdout_is_tty, true, `${mode} stdout was not a TTY`);
      assert.equal(runs[mode].result.navigation.lease_unchanged, true, `${mode} navigation touched the lease`);
      assert.equal(runs[mode].result.navigation.lease_touched, false);
    }

    const quit = runs.quit.result;
    assert.equal(quit.restored.ok, true);
    assert.equal(quit.restored.outcome, 'completed');
    assert.equal(quit.lease_state, 'closed');
    assert.ok(
      runs.quit.transcript.includes(Buffer.from(RESTORE_SEQUENCE, 'utf8')),
      'quit transcript missing restore sequence',
    );

    const failure = runs.failure.result;
    assert.equal(failure.restored.ok, true);
    assert.equal(failure.restored.outcome, 'completed');
    assert.equal(failure.restored.reason, 'fatal_error');

    const interrupt = runs.interrupt.result;
    assert.equal(interrupt.restored.ok, true);
    assert.equal(interrupt.restored.outcome, 'completed');
    assert.match(interrupt.reason, /^signal_SIGINT$/);
    assert.equal(interrupt.persistent_killed, false);
    assert.equal(interrupt.announced_termination, false);
    assert.equal(interrupt.lease_state, 'closed');

    const dead = runs.dead.result;
    assert.equal(dead.restored.ok, false);
    assert.notEqual(dead.restored.outcome, 'completed');
    assert.ok(
      dead.restored.outcome === 'partial' || dead.restored.outcome === 'impossible',
      `dead PTY outcome was ${dead.restored.outcome}`,
    );
    assert.notEqual(dead.restored.outcome, 'timeout');

    const probe = path.join(dir, 'parent-shell-usable.txt');
    fs.writeFileSync(probe, 'parent-shell-ok');
    assert.equal(fs.readFileSync(probe, 'utf8'), 'parent-shell-ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Linux real PTY covers launch, navigation, quit, interrupt, failure, and dead-write classification', {
  skip: process.platform === 'linux'
    ? false
    : `real Linux PTY evidence is not this host (${process.platform}); skip is not a pass`,
}, async () => {
  await assertRealPtyEvidence();
});

test('macOS real PTY covers launch, navigation, quit, interrupt, failure, and dead-write classification', {
  skip: process.platform === 'darwin'
    ? false
    : 'macOS real PTY cannot run on this host; skip is not a macOS pass',
}, async () => {
  await assertRealPtyEvidence();
});
