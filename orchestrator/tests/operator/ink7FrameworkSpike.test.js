'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  SPIKE_SCHEMA,
  adaptRunsPayload,
  adaptStatusPayload,
  buildSpikeShellModel,
  applyLiveTick,
  moveSelection,
  cycleFocus,
  formatSpikeShellText,
  layoutModeForColumns,
} = require('../../modules/operator/ink7-spike-view-model');
const {
  createTerminalGuard,
  withTerminalGuard,
  RESTORE_SEQUENCE,
} = require('../../modules/operator/ink7-spike-cleanup');
const {
  SPIKE_ENTRY_REASON,
  formatNonTtySpikeGuidance,
  runInk7FrameworkSpike,
  probeInkPackage,
} = require('../../modules/operator/ink7-spike-entry');

const ORCH_ROOT = path.join(__dirname, '..', '..');

/**
 * Canonical `runOperatorRuns()` shape: runs live under `.json`, not the wrapper top level.
 * @param {object[]} runs
 * @param {{ result_code?: string, next_safe_action?: string }} [extras]
 */
function canonicalRunsResult(runs, extras = {}) {
  const result_code = extras.result_code ?? (runs.length ? 'RUNS_FOUND' : 'RUNS_EMPTY');
  const next_safe_action = extras.next_safe_action ?? 'none';
  return {
    ok: true,
    exitCode: 0,
    result_code,
    next_safe_action,
    json: {
      result_code,
      runs,
      next_safe_action,
    },
  };
}

function createFakeTtyStreams() {
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
  stdout.rows = 30;
  stdout.getColorDepth = () => 1;
  stdout.ref = () => stdout;
  stdout.unref = () => stdout;
  return { stdin, stdout };
}

test('view-model adapts operator runs/status without parsing CLI text', () => {
  const adapted = adaptRunsPayload({
    result_code: 'RUNS_OK',
    next_safe_action: 'ai-minions status --run-id demo',
    runs: [
      {
        run_id: 'demo',
        status: 'complete',
        outcome: 'success',
        result_code: 'RUN_FOUND',
        reason_code: null,
      },
    ],
  });
  assert.equal(adapted.runs[0].run_id, 'demo');
  const status = adaptStatusPayload({
    run_id: 'demo',
    result_code: 'RUN_FOUND',
    status: 'complete',
    outcome: 'success',
    reason_code: null,
    next_safe_action: 'none',
  });
  const model = buildSpikeShellModel({
    runs: adapted.runs,
    selectedRunId: 'demo',
    status,
    columns: 40,
    rows: 20,
  });
  assert.equal(model.schema, SPIKE_SCHEMA);
  assert.equal(model.layout, 'narrow');
  assert.equal(layoutModeForColumns(80), 'wide');
  assert.match(formatSpikeShellText(model), /demo/);
  assert.match(formatSpikeShellText(model), /Disposable framework spike/);
});

test('live tick and focus/selection stay in view-model', () => {
  let model = buildSpikeShellModel({
    runs: [
      { run_id: 'a', status: 'running' },
      { run_id: 'b', status: 'complete' },
    ],
    selectedRunId: 'a',
  });
  model = applyLiveTick(model, 2);
  assert.equal(model.liveTick, 2);
  model = moveSelection(model, 'next');
  assert.equal(model.selectedRunId, 'b');
  model = cycleFocus(model);
  assert.equal(model.focus, 'content');
});

test('non-TTY path does not load Ink/React', async () => {
  const guidance = formatNonTtySpikeGuidance();
  assert.match(guidance, /requires a TTY/);
  assert.match(guidance, /ai-minions runs/);
  const result = await runInk7FrameworkSpike({
    isTTY: false,
    importRenderer: async () => {
      throw new Error('renderer must not load on non-TTY');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, SPIKE_ENTRY_REASON.NON_TTY);
  assert.equal(result.ink_loaded, false);
  assert.equal(result.react_loaded, false);
  assert.equal(result.exitCode, 1);
});

test('terminal guard restores after normal, exception, and child failure', async () => {
  const writes = [];
  const stdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(mode) {
      this.isRaw = Boolean(mode);
      return this;
    },
  };
  const guard = createTerminalGuard({
    stdin,
    writeRestore: (seq) => writes.push(seq),
  });
  stdin.setRawMode(true);
  await withTerminalGuard(guard, async () => 'ok', 'normal');
  assert.equal(guard.restored, true);
  assert.equal(stdin.isRaw, false);
  assert.ok(writes.some((w) => w.includes(RESTORE_SEQUENCE.slice(0, 8)) || w === RESTORE_SEQUENCE));

  const guard2 = createTerminalGuard({
    stdin: {
      isTTY: true,
      isRaw: false,
      setRawMode(mode) {
        this.isRaw = Boolean(mode);
        return this;
      },
    },
    writeRestore: (seq) => writes.push(seq),
  });
  await assert.rejects(
    () => withTerminalGuard(guard2, async () => {
      throw new Error('boom');
    }, 'normal'),
    /boom/,
  );
  assert.equal(guard2.restored, true);
  assert.ok(guard2.mutations.some((m) => m.kind === 'restore_sequence' && m.value === 'renderer_exception'));

  const child = await runInk7FrameworkSpike({
    isTTY: true,
    injectFailure: 'child',
    loadRuns: () => canonicalRunsResult([]),
    loadStatus: () => ({ ok: false, reason_code: 'x', json: {} }),
    importRenderer: async () => ({ renderSpikeShell: async () => ({}) }),
  });
  assert.equal(child.reason_code, SPIKE_ENTRY_REASON.CHILD_FAILURE);
  assert.equal(child.guard.restored, true);
});

test('renderer exception restores terminal and reports reason', async () => {
  const result = await runInk7FrameworkSpike({
    isTTY: true,
    injectFailure: 'renderer',
    loadRuns: () => canonicalRunsResult([
      { run_id: 'r1', status: 'complete', outcome: 'success', result_code: 'RUN_FOUND' },
    ]),
    loadStatus: () => ({
      ok: true,
      json: {
        run_id: 'r1',
        status: 'complete',
        operator_trace_summary: { outcome: 'success', next_safe_action: 'none' },
        run_state_visibility: {},
      },
    }),
    importRenderer: async () => ({
      renderSpikeShell: async () => ({ aborted: false }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, SPIKE_ENTRY_REASON.RENDERER_EXCEPTION);
  assert.equal(result.guard.restored, true);
  assert.equal(result.ink_loaded, true);
});

test('entry adapts runs from runOperatorRuns.json and loads status', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let statusRunId = null;
  const result = await runInk7FrameworkSpike({
    isTTY: true,
    stdin,
    stdout,
    autoQuitMs: 50,
    loadRuns: () => ({
      ok: true,
      exitCode: 0,
      result_code: 'RUNS_FOUND',
      next_safe_action: 'ai-minions status --run-id canon1',
      // No top-level `runs` — mirrors real runOperatorRuns() wrapper.
      json: {
        schema_version: '1',
        result_code: 'RUNS_FOUND',
        runs: [
          {
            run_id: 'canon1',
            status: 'complete',
            outcome: 'success',
            result_code: 'RUN_FOUND',
            reason_code: null,
          },
        ],
        next_safe_action: 'ai-minions status --run-id canon1',
      },
    }),
    loadStatus: ({ runId }) => {
      statusRunId = runId;
      return {
        ok: true,
        result_code: 'RUN_FOUND',
        json: {
          run_id: runId,
          status: 'complete',
          operator_trace_summary: { outcome: 'success', next_safe_action: 'none' },
          run_state_visibility: {},
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason_code, SPIKE_ENTRY_REASON.OK);
  assert.equal(result.model.selectedRunId, 'canon1');
  assert.equal(result.model.runs[0]?.run_id, 'canon1');
  assert.equal(statusRunId, 'canon1');
  assert.equal(result.model.status?.run_id, 'canon1');
  assert.equal(result.guard.restored, true);
  stdin.destroy();
  stdout.destroy();
});

test('Ink renderToString produces shell chrome with injectable model', async () => {
  const { renderSpikeShellToString } = await import('../../modules/operator/ink7-spike-render.mjs');
  const model = buildSpikeShellModel({
    runs: [{ run_id: 'spike-run', status: 'running', outcome: null, result_code: 'RUN_FOUND' }],
    selectedRunId: 'spike-run',
    columns: 80,
    rows: 24,
    liveTick: 3,
  });
  const out = renderSpikeShellToString(model, { columns: 80 });
  assert.match(out, /ai-minions ink7 spike/);
  assert.match(out, /spike-run/);
  assert.match(out, /tick=3/);
  assert.match(out, /Disposable framework spike/);
});

test('interactive render with fake TTY exits via autoQuit and restores', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const result = await runInk7FrameworkSpike({
    isTTY: true,
    stdin,
    stdout,
    autoQuitMs: 50,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'live1', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    loadStatus: () => ({
      ok: true,
      json: {
        run_id: 'live1',
        status: 'running',
        operator_trace_summary: { outcome: null },
        run_state_visibility: {},
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason_code, SPIKE_ENTRY_REASON.OK);
  assert.equal(result.ink_loaded, true);
  assert.equal(result.guard.restored, true);
  stdin.destroy();
  stdout.destroy();
});

test('Ctrl+C abort restores terminal and reports INK7_SPIKE_ABORT', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const spikePromise = runInk7FrameworkSpike({
    isTTY: true,
    stdin,
    stdout,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'abort1', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    loadStatus: () => ({
      ok: true,
      json: {
        run_id: 'abort1',
        status: 'running',
        operator_trace_summary: { outcome: null },
        run_state_visibility: {},
      },
    }),
  });

  // Wait for Ink to mount input handlers, then deliver Ctrl+C (ETX).
  await new Promise((resolve) => setTimeout(resolve, 80));
  stdin.write('\u0003');

  const result = await spikePromise;
  assert.equal(result.reason_code, SPIKE_ENTRY_REASON.ABORT);
  assert.equal(result.ok, true);
  assert.equal(result.guard.restored, true);
  assert.equal(stdin.isRaw, false);
  assert.ok(
    result.guard.mutations.some((m) => m.kind === 'restore_sequence'),
    'expected restore_sequence mutation',
  );
  stdin.destroy();
  stdout.destroy();
});

test('probeInkPackage reports Ink 7 + React on Node >=22', () => {
  const probe = probeInkPackage();
  assert.match(probe.ink_version, /^7\./);
  assert.ok(probe.react_version);
  assert.equal(probe.ink_type, 'module');
  assert.ok(probe.ink_engines?.node);
});

test('CLI non-TTY exits non-zero without hanging', () => {
  const r = spawnSync(process.execPath, [
    path.join(ORCH_ROOT, 'modules', 'operator', 'ink7-spike-cli.js'),
  ], {
    cwd: ORCH_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    input: '',
  });
  // When stdin/stdout are piped, isTTY is false → non-TTY guidance.
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a TTY|ink7 framework spike/i);
});

test('resize narrow layout flag flips below threshold', () => {
  const wide = buildSpikeShellModel({ columns: 100, runs: [] });
  const narrow = buildSpikeShellModel({ columns: 50, runs: [] });
  assert.equal(wide.layout, 'wide');
  assert.equal(narrow.layout, 'narrow');
});
