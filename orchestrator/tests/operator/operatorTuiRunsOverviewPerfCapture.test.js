'use strict';

/**
 * Real-PTY capture of the native Runs → Overview navigation.
 *
 * Cold start is home. The driver sends `2` (Runs, surface run_browser) then
 * Enter (Overview, surface run_overview) on production Ink via
 * runOperatorTuiShell. The child forces interactive only for this mount, the
 * same way the PTY evidence fixture does, so a CI=true parent still paints.
 *
 * The overview request id is created before loadRunStatusPane. runtime_action_ms
 * wraps that read and the same id is kept on surface_transition_ms and
 * render_frame_ms. operator_action_ms stays unmeasured. Do not treat a missing
 * sample as zero, and do not treat the commit-to-write window as the
 * navigation total.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { TUI_SHELL_REASON, runOperatorTuiShell } = require('../../modules/operator/operator-tui-shell-entry');
const { loadRunStatusPane } = require('../../modules/operator/operator-run-selector-tui');
const {
  buildShellModel,
  shellModelToOptions,
} = require('../../modules/operator/operator-tui-shell-model');

const ORCHESTRATOR_ROOT = path.join(__dirname, '..', '..');
const CLOCK_SKEW_MS = 5;
const INJECTED_LOAD_DELAY_MS = 60;

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
    overview_navigation_remount: result.guard ? result.guard.overviewNavigationRemount : null,
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
    const runtime = sampleFor(samples, 'runtime_action_ms', 'run_overview');
    assert.equal(browser.request_id, 'tui-shell-idle');
    assert.match(String(runtime.request_id), /^tui-req-/);
    assert.equal(transition.request_id, runtime.request_id);
    assert.equal(frame.request_id, runtime.request_id);
    assert.notEqual(transition.request_id, 'tui-shell-idle');
    for (const sample of [browser, transition, frame, runtime]) {
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
    assert.equal(runtime.start, 'runtime_read_begin');
    assert.equal(runtime.end, 'runtime_read_end');
    // Same accepted write. Node's clock can step 1ms between the two closes.
    assert.ok(Math.abs(transition.ended_at - frame.ended_at) <= CLOCK_SKEW_MS);
    assert.ok(Math.abs(transition.started_at - frame.started_at) <= CLOCK_SKEW_MS);
    assert.ok(runtime.ended_at <= frame.started_at + CLOCK_SKEW_MS);

    assert.equal(result.intervals.operator_action_ms.measured, false);
    assert.equal(result.intervals.operator_action_ms.ms, null);
    // Live remount_count includes the initial session mount. That mount is not
    // a remount. The contract invariant is delta 0 across this navigation.
    assert.ok(result.overview_navigation_remount);
    assert.equal(result.overview_navigation_remount.delta, 0);
    assert.ok(result.overview_navigation_remount.before >= 1);
    assert.equal(result.remount_count, result.overview_navigation_remount.after);
    assert.ok(result.render_count >= 2);

    const navigationTotalMs = transition.ended_at - runtime.started_at;
    assert.ok(navigationTotalMs + CLOCK_SKEW_MS >= runtime.ms);
    console.log(JSON.stringify({
      navigation: 'home -2-> run_browser -Enter-> run_overview',
      request_id: transition.request_id,
      from: 'run_browser',
      to: 'run_overview',
      surface_transition_ms: transition.ms,
      render_frame_ms: frame.ms,
      runtime_action_ms: runtime.ms,
      operator_action_ms: null,
      navigation_total_ms: navigationTotalMs,
      commit_to_write_ms: transition.ms,
      remount_count: result.remount_count,
      remount_increment_on_navigation: result.overview_navigation_remount.delta,
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ttyStreams() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (mode) => {
    stdin.isRaw = Boolean(mode);
    return stdin;
  };
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 100;
  stdout.rows = 40;
  stdout.getColorDepth = () => 1;
  stdout.ref = () => stdout;
  stdout.unref = () => stdout;
  stdout.resume();
  return { stdin, stdout };
}

test('delayed loadRunStatusPane is inside runtime_action_ms and the navigation window', async () => {
  const { stdin, stdout } = ttyStreams();
  const result = await runOperatorTuiShell({
    isTTY: true,
    skipSplash: true,
    useColor: false,
    columns: 100,
    rows: 40,
    stdin,
    stdout,
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
        }],
      },
    }),
    loadRunStatusPane: async (entry, options) => {
      await new Promise((resolve) => { setTimeout(resolve, INJECTED_LOAD_DELAY_MS); });
      return loadRunStatusPane(entry, options);
    },
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ model, loadRunStatusPane: loadPane, onModelChange, stdout: out }) => {
        assert.equal(typeof loadPane, 'function');
        await loadPane({
          run_id: 'run-perf-1',
          status: 'running',
          outcome: 'running',
          result_code: 'RUN_FOUND',
          goal_summary: 'perf capture fixture',
        }, {});
        onModelChange(buildShellModel({
          ...shellModelToOptions(model),
          contentSurface: 'run_overview',
          selectedRunId: 'run-perf-1',
          focus: 'content',
        }));
        await new Promise((resolve) => { out.write('overview-frame', () => resolve()); });
        return { aborted: false, requestedAction: 'quit' };
      },
    }),
  });
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  const samples = result.guard.metrics.snapshot().samples;
  const runtime = sampleFor(samples, 'runtime_action_ms', 'run_overview');
  const transition = sampleFor(samples, 'surface_transition_ms', 'run_overview');
  const frame = sampleFor(samples, 'render_frame_ms', 'run_overview');
  assert.match(String(runtime.request_id), /^tui-req-/);
  assert.equal(transition.request_id, runtime.request_id);
  assert.equal(frame.request_id, runtime.request_id);
  assert.notEqual(runtime.request_id, 'tui-shell-idle');
  assert.ok(runtime.ms + CLOCK_SKEW_MS >= INJECTED_LOAD_DELAY_MS);
  // Navigation total is request-open to the accepted write. The delay sits
  // inside that window. It is not the commit-to-write sample, and render_frame_ms
  // is a later interval that is not added onto runtime_action_ms.
  const navigationTotalMs = transition.ended_at - runtime.started_at;
  assert.ok(navigationTotalMs + CLOCK_SKEW_MS >= runtime.ms);
  assert.ok(navigationTotalMs > transition.ms);
  assert.ok(runtime.ended_at <= frame.started_at + CLOCK_SKEW_MS);
  assert.equal(runtime.ms, Math.max(0, runtime.ended_at - runtime.started_at));
  assert.equal(frame.ms, Math.max(0, frame.ended_at - frame.started_at));
  // Live remount_count includes the initial mount. Initial mount is not a remount.
  assert.equal(result.guard.overviewNavigationRemount.delta, 0);
  assert.ok(result.guard.overviewNavigationRemount.before >= 1);
  stdin.destroy();
  stdout.destroy();
});
