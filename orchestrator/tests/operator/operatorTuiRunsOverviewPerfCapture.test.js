'use strict';

/**
 * Real-PTY capture of the native Runs → Overview navigation.
 *
 * Cold start is home. The driver sends `2` (Runs, surface run_browser) then
 * Enter (Overview, surface run_overview) on production Ink via
 * runOperatorTuiShell. The child forces interactive only for this mount, the
 * same way the PTY evidence fixture does, so a CI=true parent still paints.
 *
 * The overview pane load runs inside the workflow key handler before any
 * surface interval opens, so runtime_action_ms and operator_action_ms stay
 * unmeasured. The recorded intervals are the commit-to-accepted-write pair.
 * Do not treat a missing sample as zero.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ORCHESTRATOR_ROOT = path.join(__dirname, '..', '..');

const CHILD_SOURCE = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const resultPath = process.argv[2];
const orchestratorRoot = process.argv[3];
const { runOperatorTuiShell } = require(path.join(
  orchestratorRoot,
  'modules/operator/operator-tui-shell-entry.js',
));

async function main() {
  const result = await runOperatorTuiShell({
    isTTY: true,
    skipSplash: true,
    useColor: false,
    columns: 100,
    rows: 40,
    selectedRunId: 'run-perf-1',
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
      result_code: 'RUNS_FOUND',
      next_safe_action: 'none',
      json: {
        result_code: 'RUNS_FOUND',
        next_safe_action: 'none',
        runs: [{
          run_id: 'run-perf-1',
          status: 'running',
          outcome: 'running',
          result_code: 'RUN_FOUND',
          goal_summary: 'perf capture fixture',
          action_eligibility: 'inspect',
        }],
      },
    }),
    importRenderer: async () => {
      const mod = await import(pathToFileURL(path.join(
        orchestratorRoot,
        'modules/operator/operator-tui-shell-render.mjs',
      )).href);
      return {
        renderOperatorTuiShell: (opts) => mod.renderOperatorTuiShell({
          ...opts,
          interactive: true,
        }),
      };
    },
  });
  const snap = result.guard && result.guard.metrics ? result.guard.metrics.snapshot() : null;
  fs.writeFileSync(resultPath, JSON.stringify({
    reason_code: result.reason_code,
    content_surface: result.model ? result.model.contentSurface : null,
    selected_run_id: result.model ? result.model.selectedRunId : null,
    workflow_step: result.model && result.model.activeWorkflow
      ? result.model.activeWorkflow.step
      : null,
    remount_count: snap ? snap.remount_count : null,
    render_count: snap ? snap.render_count : null,
    intervals: snap ? snap.intervals : null,
    samples: snap ? snap.samples : null,
  }));
  process.exit(result.reason_code === 'TUI_SHELL_QUIT' ? 0 : 1);
}

main().catch((err) => {
  fs.writeFileSync(resultPath, JSON.stringify({
    error: String(err && err.stack ? err.stack : err),
  }));
  process.exit(1);
});
`;

const PTY_DRIVER = String.raw`
import os, pty, select, sys, time
node, child, result_path, transcript_path, timing_path = sys.argv[1:6]
pid, fd = pty.fork()
if pid == 0:
    os.environ['NO_COLOR'] = '1'
    os.execv(node, [node, child, result_path, sys.argv[6]])
transcript = b''
deadline = time.time() + 20
sent_runs = False
sent_enter = False
sent_quit = False
runs_at = None
enter_at = None

def pump():
    global transcript
    ready, _, _ = select.select([fd], [], [], 0.1)
    if not ready:
        return
    try:
        chunk = os.read(fd, 8192)
    except OSError:
        return
    if chunk:
        transcript += chunk

while time.time() < deadline:
    alive = True
    try:
        wpid, _status = os.waitpid(pid, os.WNOHANG)
        if wpid != 0:
            alive = False
    except ChildProcessError:
        alive = False
    pump()
    if not alive:
        break
    text = transcript.decode('utf-8', 'replace')
    if (not sent_runs) and len(transcript) > 40:
        os.write(fd, b'2')
        sent_runs = True
        runs_at = time.time()
    elif sent_runs and (not sent_enter) and runs_at and (time.time() - runs_at) > 0.8:
        if 'Run browser' in text or len(transcript) > 200:
            os.write(fd, b'\r')
            sent_enter = True
            enter_at = time.time()
    elif sent_enter and (not sent_quit) and enter_at and (time.time() - enter_at) > 0.8:
        os.write(fd, b'q')
        sent_quit = True
    if sent_quit and os.path.exists(result_path):
        break

if not sent_quit:
    try:
        os.kill(pid, 9)
    except OSError:
        pass
else:
    end = time.time() + 5
    while time.time() < end:
        try:
            wpid, _status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                break
        except ChildProcessError:
            break
        pump()
        time.sleep(0.05)

with open(transcript_path, 'wb') as handle:
    handle.write(transcript)
with open(timing_path, 'w', encoding='utf-8') as handle:
    import json
    json.dump({
        'sent_runs': sent_runs,
        'sent_enter': sent_enter,
        'sent_quit': sent_quit,
        'key_runs_ms': None if runs_at is None else int(runs_at * 1000),
        'key_enter_ms': None if enter_at is None else int(enter_at * 1000),
    }, handle)
if fd >= 0:
    try:
        os.close(fd)
    except OSError:
        pass
`;

function runCapture(dir) {
  const childPath = path.join(dir, 'perf-child.js');
  const resultPath = path.join(dir, 'result.json');
  const transcriptPath = path.join(dir, 'transcript.bin');
  const timingPath = path.join(dir, 'timing.json');
  fs.writeFileSync(childPath, CHILD_SOURCE);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [
      '-c',
      PTY_DRIVER,
      process.execPath,
      childPath,
      resultPath,
      transcriptPath,
      timingPath,
      ORCHESTRATOR_ROOT,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!fs.existsSync(resultPath)) {
        reject(new Error(`no result file (python exit ${code}): ${stderr}`));
        return;
      }
      resolve({
        code,
        stderr,
        result: JSON.parse(fs.readFileSync(resultPath, 'utf8')),
        transcript: fs.readFileSync(transcriptPath),
        timing: JSON.parse(fs.readFileSync(timingPath, 'utf8')),
      });
    });
  });
}

function sampleFor(samples, name, surface) {
  const matches = samples.filter((sample) => sample.name === name && sample.surface === surface);
  assert.ok(matches.length >= 1, `missing ${name} for ${surface}`);
  return matches[matches.length - 1];
}

test('real PTY Runs to Overview records transition and frame without a remount', {
  skip: process.platform === 'linux' || process.platform === 'darwin'
    ? false
    : `real PTY is not available on ${process.platform}; skip is not a pass`,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-runs-overview-'));
  try {
    const run = await runCapture(dir);
    const result = run.result;
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.reason_code, 'TUI_SHELL_QUIT');
    assert.equal(result.content_surface, 'run_overview');
    assert.equal(result.workflow_step, 'overview');
    assert.equal(result.selected_run_id, 'run-perf-1');
    assert.equal(run.timing.sent_runs, true);
    assert.equal(run.timing.sent_enter, true);
    const text = run.transcript.toString('utf8');
    assert.match(text, /Run browser/);
    assert.match(text, /Selected run overview/);

    const samples = result.samples;
    const browser = sampleFor(samples, 'surface_transition_ms', 'run_browser');
    const transition = sampleFor(samples, 'surface_transition_ms', 'run_overview');
    const frame = sampleFor(samples, 'render_frame_ms', 'run_overview');
    assert.equal(browser.request_id, frame.request_id);
    assert.equal(transition.request_id, frame.request_id);
    for (const sample of [browser, transition, frame]) {
      assert.equal(typeof sample.ms, 'number');
      assert.ok(sample.ms >= 0);
      assert.equal(sample.measured, true);
    }
    assert.equal(transition.start, 'surface_change_begin');
    assert.equal(transition.end, 'accepted_stdout_write');
    assert.equal(transition.observes, 'accepted_stdout_write');
    assert.equal(frame.start, 'frame_armed');
    assert.equal(frame.end, 'stdout_write');
    assert.equal(frame.observes, 'stdout_write');
    assert.equal(transition.started_at, frame.started_at);
    assert.equal(transition.ended_at, frame.ended_at);

    assert.equal(result.intervals.runtime_action_ms.measured, false);
    assert.equal(result.intervals.runtime_action_ms.ms, null);
    assert.equal(result.intervals.operator_action_ms.measured, false);
    assert.equal(result.intervals.operator_action_ms.ms, null);
    // Session enter calls markMounted once. The two surface changes must not add mounts.
    assert.equal(result.remount_count, 1);
    assert.ok(result.render_count >= 2);

    const totalMs = transition.ended_at - transition.started_at;
    console.log(JSON.stringify({
      navigation: 'home -2-> run_browser -Enter-> run_overview',
      request_id: transition.request_id,
      from: 'run_browser',
      to: 'run_overview',
      surface_transition_ms: transition.ms,
      render_frame_ms: frame.ms,
      runtime_action_ms: null,
      operator_action_ms: null,
      total_ms: totalMs,
      remount_count: result.remount_count,
      remount_increment_on_navigation: 0,
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
