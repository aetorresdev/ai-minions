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
 * Linux and macOS run this against a pseudoterminal from python3's pty.fork.
 * macOS revokes the PTY when the session leader exits (master writes then
 * fail with EIO), so the echo probe runs while the child is still alive.
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
parent_probed = False
parent = {'icanon': False, 'echo': False, 'stdin_usable': False, 'echo_byte': None, 'io_error': None,
          'timed_out': False, 'exit_code': None, 'exit_signal': None}

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

def probe_parent():
    global parent_probed, transcript
    if parent_probed or fd < 0:
        return
    parent_probed = True
    # Drop bytes the child already painted so the echo is not leftover output.
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
    try:
        attr = termios.tcgetattr(fd)
        parent['icanon'] = bool(attr[3] & termios.ICANON)
        parent['echo'] = bool(attr[3] & termios.ECHO)
    except OSError as exc:
        parent['io_error'] = exc.errno
        return
    # Newline so a cooked (ICANON) read in the child unblocks. ECHO still
    # paints the byte on the master before the child consumes the line.
    for _attempt in range(4):
        try:
            os.write(fd, b'Z\n')
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
    elif alive and fd >= 0 and (not parent_probed):
        # macOS returns EIO on the master once this session leader exits, so
        # the echo probe has to run while the child is blocked in its hold.
        # Clean exits publish the result file first. Signal and fatal exits
        # publish the restore record and then block inside the re-raise.
        ready_for_probe = os.path.exists(result_path) or (
            mode in ('sigint', 'sigterm', 'sighup', 'fatal')
            and os.path.exists(result_path + '.restore.json')
        )
        if ready_for_probe:
            probe_parent()

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

parent['timed_out'] = timed_out
if child_status is not None:
    if os.WIFEXITED(child_status):
        parent['exit_code'] = os.WEXITSTATUS(child_status)
    elif os.WIFSIGNALED(child_status):
        parent['exit_signal'] = os.WTERMSIG(child_status)
# Fallback for a child that exited before the in-loop probe (Linux still
# accepts a master write after the slave closes). macOS will not.
if not parent_probed:
    probe_parent()

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

function runPtyMode(mode, dir, envOverrides = {}) {
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
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envOverrides } });
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
      resolve({
        mode,
        ciEnv: 'CI' in envOverrides ? envOverrides.CI : (process.env.CI ?? null),
        code,
        stderr,
        result,
        resultFileExists: fs.existsSync(resultPath),
        transcript,
        parent,
        restorations,
      });
    });
  });
}

function diagnose(run) {
  const tail = run.transcript.subarray(Math.max(0, run.transcript.length - 240)).toString('utf8');
  return [
    `scenario=${run.mode}`,
    `bytes_received=${run.transcript.length}`,
    `timed_out=${run.parent.timed_out}`,
    `exit_code=${run.parent.exit_code}`,
    `exit_signal=${run.parent.exit_signal}`,
    `result_file=${run.resultFileExists ? 'present' : 'missing'}`,
    `ci_env=${JSON.stringify(run.ciEnv)}`,
    `pty_tail=${JSON.stringify(tail)}`,
    `stderr_tail=${JSON.stringify(String(run.stderr || '').slice(-240))}`,
  ].join(' ');
}

/**
 * Fails with a scenario diagnosis before any result field is read.
 * @returns {object} the child result
 */
function requireResult(run) {
  assert.equal(run.parent.timed_out, false, `${run.mode} timed out and was killed: ${diagnose(run)}`);
  assert.ok(run.transcript.length > 0, `${run.mode} emitted no bytes on the PTY: ${diagnose(run)}`);
  assert.ok(
    run.result !== null && typeof run.result === 'object',
    `${run.mode} produced no result file: ${diagnose(run)}`,
  );
  assert.equal(
    run.result.error,
    undefined,
    `${run.mode} child reported an error (${run.result.error}): ${diagnose(run)}`,
  );
  return run.result;
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

async function assertPythonPty() {
  const python = spawn('python3', ['-c', 'import pty']);
  const pythonOk = await new Promise((resolve) => {
    python.on('error', () => resolve(false));
    python.on('close', (code) => resolve(code === 0));
  });
  assert.equal(pythonOk, true, 'python3 pty module is required for real PTY evidence');
}

function assertQuitThroughNavigation(quit) {
  const result = requireResult(quit);
  const why = diagnose(quit);
  assert.equal(result.stdout_is_tty, true, `quit stdout is not a TTY: ${why}`);
  assert.equal(result.integrated_shell, true, why);
  assert.equal(result.ink_loaded, true, why);
  assert.equal(result.react_loaded, true, why);
  assert.equal(result.content_surface, 'help', `quit did not navigate to help: ${why}`);
  assert.equal(result.stdin_is_raw, false, why);
  assert.equal(result.guard_raw_mode, false, why);
  assert.equal(result.restored.ok, true, why);
  assert.equal(result.restored.outcome, 'completed', why);
  assert.equal(result.reason_code, 'TUI_SHELL_QUIT', why);
  assertRestoreSequence(quit.transcript, 'quit');
  assertParentTerminalUsable(quit.parent, 'quit');
}

async function assertRealPtyEvidence() {
  await assertPythonPty();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-pty-'));
  try {
    const runs = {};
    for (const mode of MODES) {
      runs[mode] = await runPtyMode(mode, dir);
    }

    assertQuitThroughNavigation(runs.quit);

    const ctrlC = runs['ctrl-c'];
    const ctrlCResult = requireResult(ctrlC);
    const ctrlCWhy = diagnose(ctrlC);
    assert.equal(ctrlCResult.integrated_shell, true, ctrlCWhy);
    assert.equal(ctrlCResult.reason_code, 'TUI_SHELL_ABORT', ctrlCWhy);
    assert.equal(ctrlCResult.stdin_is_raw, false, ctrlCWhy);
    assert.equal(ctrlCResult.guard_raw_mode, false, ctrlCWhy);
    assert.equal(ctrlCResult.restored.ok, true, ctrlCWhy);
    assert.equal(ctrlCResult.restored.outcome, 'completed', ctrlCWhy);
    assertRestoreSequence(ctrlC.transcript, 'ctrl-c');
    assertParentTerminalUsable(ctrlC.parent, 'ctrl-c');

    for (const mode of ['sigint', 'sigterm', 'sighup', 'fatal']) {
      const run = runs[mode];
      const why = diagnose(run);
      assert.equal(run.parent.timed_out, false, `${mode} did not terminate the child: ${why}`);
      assert.ok(run.transcript.length > 0, `${mode} produced no terminal output: ${why}`);
      assert.equal(run.result, null, `${mode} should exit from the signal or fatal handler: ${why}`);
      assertRestoreSequence(run.transcript, mode);
      assertParentTerminalUsable(run.parent, mode);
    }
    assert.equal(
      runs.sigint.parent.exit_signal,
      2,
      `SIGINT must still terminate the TUI process: ${diagnose(runs.sigint)}`,
    );

    const hangup = runs['master-close'];
    const hangupWhy = diagnose(hangup);
    assert.equal(hangup.parent.timed_out, false, `master close left the child running: ${hangupWhy}`);
    assert.equal(hangup.result, null, `master close must end the child from the hangup path: ${hangupWhy}`);
    assert.ok(hangup.restorations.length >= 1, `master close ran no restore: ${hangupWhy}`);
    const deadRestore = hangup.restorations[hangup.restorations.length - 1];
    assert.equal(deadRestore.ok, false, 'a closed master cannot prove the terminal was restored');
    assert.notEqual(deadRestore.outcome, 'completed');
    assert.match(String(deadRestore.restoration_reason), /EIO|EPIPE|ENXIO|dead_pty/);

    for (const mode of ['handoff-close', 'handoff-failure']) {
      const run = runs[mode];
      const result = requireResult(run);
      const why = diagnose(run);
      assert.equal(result.stdout_is_tty, true, why);
      assert.equal(result.handoff, true, why);
      assert.equal(result.stdin_is_raw, false, why);
      assert.equal(result.guard_raw_mode, false, why);
      assert.equal(result.restored.ok, true, why);
      assert.equal(result.restored.outcome, 'completed', why);
      assertRestoreSequence(run.transcript, mode);
      assertParentTerminalUsable(run.parent, mode);
    }
    assert.equal(runs['handoff-failure'].result.restored.reason, 'fatal_error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * CI runners export CI=true. Ink then defaults to non-interactive and paints
 * nothing on the PTY, so the driver never sends keys and the child is killed.
 * The fixture must still render and quit through navigation under CI=true.
 */
async function assertCiEnvStillInteractive() {
  await assertPythonPty();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-pty-ci-'));
  try {
    const quit = await runPtyMode('quit', dir, { CI: 'true' });
    assertQuitThroughNavigation(quit);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('real PTY under CI=true still renders, navigates, and quits', {
  skip: process.platform === 'linux' || process.platform === 'darwin'
    ? false
    : `real PTY is not available on ${process.platform}; skip is not a pass`,
}, async () => {
  await assertCiEnvStillInteractive();
});

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
