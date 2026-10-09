'use strict';

/**
 * Every content surface must render a clean frame on a short terminal.
 *
 * Regression guard for: Status / System Status / Help and the other non-list surfaces being rendered
 * with the full chrome and every line, so on a 20-24 row terminal the frame was taller than the
 * viewport and rows overwrote each other (`2. RunsRun`, `5. Helpings`, ` ontent · status`,
 * `status: blockedN_FOUND`, lost run_id / created_at / result_code).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildShellModel, shellModelToOptions } = require('../../modules/operator/operator-tui-shell-model');
const { windowEntriesToHeight } = require('../../modules/operator/operator-tui-run-browser-workflow');
const {
  createLauncherWorkflow,
  applyLauncherWorkflowKeypress,
} = require('../../modules/operator/operator-tui-launcher-workflow');

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const strip = (text) => text.replace(ANSI, '');

const SURFACES = ['diagnostics', 'help', 'runs', 'status', 'evidence', 'config', 'launcher', 'lifecycle'];
const SIZES = [
  [20, 300], [20, 120], [20, 80], [24, 80], [20, 60], [24, 60], [30, 120], [36, 300], [12, 60],
];

function makeRuns(count) {
  return Array.from({ length: count }, (_, i) => ({
    run_id: `task-sudoku-integrated-r${count - i}`,
    status: 'blocked',
    outcome: 'blocked',
    result_code: 'RUN_FOUND',
    goal_summary: 'Build a small self-contained Sudoku HTML app',
    created_at: `2026-10-05T21:4${i % 10}:00.000Z`,
    last_event_at: `2026-10-05T21:5${i % 10}:00.000Z`,
    current_phase: 'complete',
    reason_code: 'cerberus_anchor_required',
    action_eligibility: 'inspect',
  }));
}

const STATUS = {
  available: true,
  run_id: 'task-sudoku-integrated-r20',
  goal_summary: 'Build a small self-contained Sudoku HTML app',
  created_at: '2026-10-05T21:40:00.000Z',
  last_event_at: '2026-10-05T21:50:00.000Z',
  status: 'blocked',
  outcome: 'blocked',
  result_code: 'RUN_FOUND',
  current_phase: 'complete',
  reason_code: 'cerberus_anchor_required',
  action_eligibility: 'inspect',
  next_safe_action: 'ai-minions explain --run-id task-sudoku-integrated-r20',
};

function surfaceModel(surface, columns, rows) {
  return buildShellModel({
    columns,
    rows,
    skipSplash: true,
    icons: 'unicode',
    contentSurface: surface,
    runsPayload: { runs: makeRuns(20), result_code: 'RUNS_OK' },
    statusResult: STATUS,
    selectedRunId: STATUS.run_id,
  });
}

async function renderFrame(model, columns, rows) {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  return strip(renderOperatorTuiShellToString(model, { columns, rows })).replace(/\s+$/, '').split('\n');
}

/** First characters of an entry: long lines may be truncated with an ellipsis, the start must survive. */
const stem = (text) => String(text).trim().slice(0, 24);

test('every surface renders a clean frame from 12x60 to 36x300', async () => {
  const { buildContentEntries, resolveShellChrome } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  for (const surface of SURFACES) {
    for (const [rows, columns] of SIZES) {
      const label = `${surface} @ ${rows}x${columns}`;
      // The string renderer rebuilds the model from its options; plan against the same rebuilt model.
      const model = buildShellModel({ ...shellModelToOptions(surfaceModel(surface, columns, rows)), columns, rows });
      const plan = resolveShellChrome(model);
      const entries = buildContentEntries(model, plan);
      const lines = await renderFrame(model, columns, rows);
      const text = lines.join('\n');

      assert.ok(lines.length <= rows, `${label}: frame is ${lines.length} rows, terminal has ${rows}`);
      assert.ok(lines.every((line) => [...line].length <= columns), `${label}: a line exceeds ${columns} columns`);
      assert.ok(entries.length <= Math.max(plan.contentRows, 0), `${label}: ${entries.length} entries for ${plan.contentRows} rows`);

      // Nothing was painted over another row: every shown entry starts intact in the frame.
      for (const entry of entries) {
        if (!String(entry.text).trim()) continue;
        assert.ok(text.includes(stem(entry.text)), `${label}: entry ${JSON.stringify(stem(entry.text))} is missing or overwritten\n${text}`);
      }

      // The footer key hints always survive.
      assert.ok(text.includes(stem(model.footerHints).slice(0, 8)), `${label}: footer key hints missing`);
    }
  }
});

test('status keeps all of its fields on a 20-row terminal', async () => {
  for (const [rows, columns] of [[20, 300], [20, 120], [24, 80]]) {
    const model = surfaceModel('status', columns, rows);
    const text = (await renderFrame(model, columns, rows)).join('\n');
    for (const field of ['run_id:', 'title:', 'created_at:', 'updated_at:', 'current_phase:', 'result_code:', 'status:', 'outcome:', 'reason_code:', 'action:', 'next_safe_action:']) {
      assert.ok(text.includes(field), `${rows}x${columns}: ${field} missing\n${text}`);
    }
    assert.doesNotMatch(text, /RunsRun|Helpings|blockedN_|[^C]ontent · status/, `${rows}x${columns}: overwritten text\n${text}`);
  }
});

test('long non-list content is cut with a marker that counts what was left out', async () => {
  const { buildContentEntries, buildContentLines, resolveShellChrome } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const model = surfaceModel('help', 60, 12);
  const plan = resolveShellChrome(model);
  const all = buildContentLines(model);
  const shown = buildContentEntries(model, plan);
  assert.ok(all.length > shown.length, 'precondition: help does not fit 12 rows');
  assert.equal(shown.length, plan.contentRows);
  const marker = shown.at(-1);
  assert.equal(marker.kind, 'more');
  assert.equal(marker.text.trim(), `... ${all.length - (shown.length - 1)} more below`);
  assert.deepEqual(shown.slice(0, -1).map((e) => e.text), all.slice(0, shown.length - 1));
});

test('chrome is relaxed only as far as needed: roomy terminals keep the full shell', async () => {
  const { resolveShellChrome } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const roomy = resolveShellChrome(surfaceModel('status', 120, 40));
  assert.deepEqual(roomy.chrome, { header: 'full', nav: 'full', contentChrome: 'full', input: 'full', disclaimer: 'full' });
  const short = resolveShellChrome(surfaceModel('status', 300, 20));
  assert.ok(short.contentRows >= 12, `status needs its 12 rows at 20 high, got ${short.contentRows}`);
  assert.notEqual(short.chrome.header, 'full');
});

test('the landing keeps its own composition and is not planned by the surface ladder', async () => {
  const { resolveShellChrome } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const plan = resolveShellChrome(buildShellModel({ columns: 300, rows: 20, skipSplash: true, icons: 'unicode' }));
  assert.equal(plan.contentRows, null);
  assert.equal(plan.chrome.header, 'full');
});

test('windowEntriesToHeight leaves list windowing untouched and bounds plain entries', () => {
  const plain = Array.from({ length: 9 }, (_, i) => ({ text: `line ${i + 1}` }));
  assert.deepEqual(windowEntriesToHeight(plain, 20), plain);
  assert.deepEqual(windowEntriesToHeight(plain, 0), []);
  assert.deepEqual(windowEntriesToHeight(plain, 1).map((e) => e.text), ['line 1']);
  const cut = windowEntriesToHeight(plain, 4);
  assert.equal(cut.length, 4);
  assert.deepEqual(cut.map((e) => e.text), ['line 1', 'line 2', 'line 3', '  ... 6 more below']);
});

async function launcherPreview(localBackendReachable) {
  let workflow = createLauncherWorkflow();
  const ctx = { localBackendReachable, credentials: {} };
  for (let step = 0; step < 4; step += 1) {
    const out = await applyLauncherWorkflowKeypress(workflow, '', { return: true }, ctx);
    assert.equal(out.action, 'update');
    workflow = out.workflow;
  }
  assert.equal(workflow.step, 'preview');
  return workflow;
}

test('launcher preview keeps readiness, block reason and recovery on a short terminal', async () => {
  const blocked = await launcherPreview(false);
  assert.equal(blocked.previewModel.can_launch, false);
  assert.equal(blocked.previewModel.blocked_reason_code, 'MATRIX_SKIP_LOCAL_BACKEND_MISSING');
  const ready = await launcherPreview(true);
  assert.equal(ready.previewModel.can_launch, true);

  for (const [rows, columns, workflow, expects] of [
    [20, 300, blocked, [/readiness:\s*skip/, /MATRIX_SKIP_LOCAL_BACKEND_MISSING/, /cannot launch:/, /ollama serve/, /equivalent_command:/]],
    [24, 80, blocked, [/readiness:\s*skip/, /MATRIX_SKIP_LOCAL_BACKEND_MISSING/, /cannot launch:/, /ollama serve/, /equivalent_command:/]],
    [20, 300, ready, [/readiness:\s*ready/, /equivalent_command:\s+\S/]],
    [24, 80, ready, [/readiness:\s*ready/, /equivalent_command:\s+\S/]],
  ]) {
    const model = buildShellModel({
      ...shellModelToOptions(buildShellModel({
        columns,
        rows,
        skipSplash: true,
        icons: 'unicode',
        contentSurface: 'launcher_workflow',
        focus: 'content',
        activeWorkflow: workflow,
      })),
      columns,
      rows,
    });
    const lines = await renderFrame(model, columns, rows);
    const text = lines.join('\n');
    const label = `${rows}x${columns} can_launch=${workflow.previewModel.can_launch}`;
    assert.ok(lines.length <= rows, `${label}: frame is ${lines.length} rows`);
    for (const pattern of expects) {
      assert.match(text, pattern, `${label}: missing ${pattern}\n${text}`);
    }
    if (workflow.previewModel.can_launch) {
      assert.doesNotMatch(text, /equivalent_command: unavailable/, `${label}: confirmation command missing\n${text}`);
    }
  }
});
