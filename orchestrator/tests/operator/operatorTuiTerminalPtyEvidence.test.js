'use strict';

/**
 * Real PTY evidence for terminal restore.
 *
 * The child runs runOperatorTuiShell (production Ink shell) for quit,
 * Ctrl+C (0x03 in raw mode), SIGINT, SIGTERM, SIGHUP, fatal, and a real
 * master close. Handoff modes run soften → resumeInkSession → restore on the
 * same PTY. Parent usability is termios (cooked) plus an echoed byte on the
 * PTY master — not a temp-file probe. After a master close there is no
 * terminal left to probe: that mode instead requires the restore attempt to
 * report a non-completed outcome caused by the dead PTY.
 *
 * Linux runs this against a pseudoterminal allocated by python3's pty.fork.
 * macOS cannot be executed on a Linux host. The macOS test is skipped here
 * with an explicit reason. A skip is not a pass and must not be reported as
 * macOS evidence. The same scenario function runs on darwin when that host
 * executes this file.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RESTORE_SEQUENCE } = require('../../modules/operator/operator-tui-terminal-guard');

const CHILD = path.join(__dirname, 'fixtures', 'tui-terminal-pty-child.js');
const MODES = [
  'quit',
  'ctrl-c',
  'sigint',
  'sigterm',
  'sighup',
  'fatal',
  'master-close',
  'handoff-close',
  'handoff-failure',
];

const PTY_DRIVER = String.raw`
import json, os, pty, select, signal, sys, termios, time

node, fixture, mode, result_path, transcript_path = sys.argv[1:6]
pid, fd = pty.fork()
if pid == 0:
    os.execv(node, [node, fixture, mode, result_path])

transcript = b''
deadline = time.time() + 8
nav_sent = False
quit_sent = False
signaled = False
nav_at = None
child_status = None
timed_out = False

def pump():
    global transcript
    ready, _, _ = select.select([fd], [], [], 0.15)
    if not ready:
        return
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        return
    if chunk:
        transcript += chunk

SIGNAL_MODES = {'sigint': signal.SIGINT, 'sigterm': signal.SIGTERM, 'sighup': signal.SIGHUP}

while time.time() < deadline:
    alive = True
    try:
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid != 0:
            alive = False
            child_status = status
    except ChildProcessError:
        alive = False
    if fd >= 0:
        pump()
    if not alive:
        break
    if mode == 'quit' and (not nav_sent) and len(transcript) > 0:
        os.write(fd, b'5')
        nav_sent = True
        nav_at = time.time()
    elif mode == 'quit' and nav_sent and (not quit_sent) and nav_at is not None and (time.time() - nav_at) > 0.35:
        os.write(fd, b'q')
        quit_sent = True
    elif mode == 'ctrl-c' and (not signaled) and len(transcript) > 0 and nav_at is None:
        nav_at = time.time()
    elif mode == 'ctrl-c' and (not signaled) and nav_at is not None and (time.time() - nav_at) > 0.5:
        # Once Ink holds raw mode, Ctrl+C arrives as the 0x03 byte, not as SIGINT.
        os.write(fd, b'\x03')
        signaled = True
    elif mode in SIGNAL_MODES and (not signaled) and len(transcript) > 0:
        os.kill(pid, SIGNAL_MODES[mode])
        signaled = True
    elif mode == 'master-close' and (not signaled) and len(transcript) > 0:
        # Real hangup: the slave side now fails writes with EIO.
        os.close(fd)
        fd = -1
        signaled = True

if child_status is None:
    try:
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == 0:
            timed_out = True
            os.kill(pid, signal.SIGKILL)
            _wpid, status = os.waitpid(pid, 0)
        child_status = status
    except ChildProcessError:
        pass

# Drain bytes the child already wrote so the echo probe is not leftover output.
if fd >= 0:
    while True:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            break
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        transcript += chunk

parent = {'icanon': False, 'echo': False, 'stdin_usable': False, 'echo_byte': None, 'io_error': None,
          'timed_out': timed_out, 'exit_code': None, 'exit_signal': None}
if child_status is not None:
    if os.WIFEXITED(child_status):
        parent['exit_code'] = os.WEXITSTATUS(child_status)
    elif os.WIFSIGNALED(child_status):
        parent['exit_signal'] = os.WTERMSIG(child_status)
try:
    if fd < 0:
        raise OSError(9, 'master closed by driver')
    attr = termios.tcgetattr(fd)
    parent['icanon'] = bool(attr[3] & termios.ICANON)
    parent['echo'] = bool(attr[3] & termios.ECHO)
except OSError as exc:
    parent['io_error'] = exc.errno
else:
    for _attempt in range(4):
        try:
            os.write(fd, b'Z')
            ready, _, _ = select.select([fd], [], [], 0.3)
            if not ready:
                continue
            data = os.read(fd, 64)
            parent['echo_byte'] = data.decode('utf-8', 'replace')
            if b'Z' in data:
                parent['stdin_usable'] = True
                break
        except OSError as exc:
            parent['io_error'] = exc.errno
            time.sleep(0.05)

with open(result_path + '.parent.json', 'w', encoding='utf-8') as handle:
    json.dump(parent, handle)
with open(transcript_path, 'wb') as handle:
    handle.write(transcript)
if fd >= 0:
    try:
        os.close(fd)
    except OSError:
        pass
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
      const parentPath = `${resultPath}.parent.json`;
      if (!fs.existsSync(parentPath)) {
        reject(new Error(`PTY mode ${mode} produced no parent probe (python exit ${code}): ${stderr}`));
        return;
      }
      const parent = JSON.parse(fs.readFileSync(parentPath, 'utf8'));
      const result = fs.existsSync(resultPath)
        ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
        : null;
      const transcript = fs.existsSync(transcriptPath)
        ? fs.readFileSync(transcriptPath)
        : Buffer.alloc(0);
      const restorePath = `${resultPath}.restore.json`;
      const restorations = fs.existsSync(restorePath)
        ? JSON.parse(fs.readFileSync(restorePath, 'utf8'))
        : [];
      resolve({ code, stderr, result, transcript, parent, restorations });
    });
  });
}

function assertParentTerminalUsable(parent, mode) {
  assert.equal(parent.icanon, true, `${mode} left the terminal without ICANON`);
  assert.equal(parent.echo, true, `${mode} left the terminal without ECHO`);
  assert.equal(
    parent.stdin_usable,
    true,
    `${mode} parent could not read an echoed byte (${JSON.stringify(parent)})`,
  );
  assert.equal(parent.echo_byte.includes('Z'), true, `${mode} echo was ${parent.echo_byte}`);
}

function assertRestoreSequence(transcript, mode) {
  assert.ok(
    transcript.includes(Buffer.from(RESTORE_SEQUENCE, 'utf8')),
    `${mode} transcript missing restore sequence`,
  );
  assert.ok(
    transcript.includes(Buffer.from('\u001b[?25h', 'utf8')),
    `${mode} transcript missing cursor show`,
  );
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

    const quit = runs.quit;
    assert.equal(quit.result.stdout_is_tty, true);
    assert.equal(quit.result.integrated_shell, true);
    assert.equal(quit.result.ink_loaded, true);
    assert.equal(quit.result.react_loaded, true);
    assert.equal(quit.result.content_surface, 'help');
    assert.equal(quit.result.stdin_is_raw, false);
    assert.equal(quit.result.guard_raw_mode, false);
    assert.equal(quit.result.restored.ok, true);
    assert.equal(quit.result.restored.outcome, 'completed');
    assert.equal(quit.result.reason_code, 'TUI_SHELL_QUIT');
    assertRestoreSequence(quit.transcript, 'quit');
    assertParentTerminalUsable(quit.parent, 'quit');

    const ctrlC = runs['ctrl-c'];
    assert.equal(ctrlC.parent.timed_out, false, 'ctrl-c did not end the session');
    assert.equal(ctrlC.result.integrated_shell, true);
    assert.equal(ctrlC.result.reason_code, 'TUI_SHELL_ABORT');
    assert.equal(ctrlC.result.stdin_is_raw, false);
    assert.equal(ctrlC.result.guard_raw_mode, false);
    assert.equal(ctrlC.result.restored.ok, true);
    assert.equal(ctrlC.result.restored.outcome, 'completed');
    assertRestoreSequence(ctrlC.transcript, 'ctrl-c');
    assertParentTerminalUsable(ctrlC.parent, 'ctrl-c');

    for (const mode of ['sigint', 'sigterm', 'sighup', 'fatal']) {
      const run = runs[mode];
      assert.equal(run.parent.timed_out, false, `${mode} did not terminate the child`);
      assert.equal(run.result, null, `${mode} should exit from the signal or fatal handler`);
      assertRestoreSequence(run.transcript, mode);
      assertParentTerminalUsable(run.parent, mode);
      assert.ok(run.transcript.length > 0, `${mode} produced no terminal output`);
    }
    assert.equal(runs.sigint.parent.exit_signal, 2, 'SIGINT must still terminate the TUI process');

    const hangup = runs['master-close'];
    assert.equal(hangup.parent.timed_out, false, 'master close left the child running');
    assert.equal(hangup.result, null, 'master close must end the child from the hangup path');
    assert.ok(hangup.restorations.length >= 1, 'master close ran no restore');
    const deadRestore = hangup.restorations[hangup.restorations.length - 1];
    assert.equal(deadRestore.ok, false, 'a closed master cannot prove the terminal was restored');
    assert.notEqual(deadRestore.outcome, 'completed');
    assert.match(String(deadRestore.restoration_reason), /EIO|EPIPE|ENXIO|dead_pty/);

    for (const mode of ['handoff-close', 'handoff-failure']) {
      const run = runs[mode];
      assert.equal(run.result.stdout_is_tty, true);
      assert.equal(run.result.handoff, true);
      assert.equal(run.result.stdin_is_raw, false);
      assert.equal(run.result.guard_raw_mode, false);
      assert.equal(run.result.restored.ok, true);
      assert.equal(run.result.restored.outcome, 'completed');
      assertRestoreSequence(run.transcript, mode);
      assertParentTerminalUsable(run.parent, mode);
    }
    assert.equal(runs['handoff-failure'].result.restored.reason, 'fatal_error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Linux real PTY runs the shell for quit, Ctrl+C, SIGINT, SIGTERM, SIGHUP, fatal, master close, plus handoff restore', {
  skip: process.platform === 'linux'
    ? false
    : `real Linux PTY evidence is not this host (${process.platform}); skip is not a pass`,
}, async () => {
  await assertRealPtyEvidence();
});

test('macOS real PTY runs the shell for quit, Ctrl+C, SIGINT, SIGTERM, SIGHUP, fatal, master close, plus handoff restore', {
  skip: process.platform === 'darwin'
    ? false
    : 'macOS real PTY cannot run on this host; skip is not a macOS pass',
}, async () => {
  await assertRealPtyEvidence();
});
