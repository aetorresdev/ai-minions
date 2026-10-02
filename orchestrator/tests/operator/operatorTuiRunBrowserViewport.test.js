'use strict';

/**
 * Run browser + status must stay legible at any terminal size.
 *
 * Regression guard for: title / execution dates shown as "(unavailable)" in the
 * status surface, and the run list overprinting the footer or hiding the
 * selected run on tall terminals.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildShellModel, shellModelToOptions } = require('../../modules/operator/operator-tui-shell-model');
const { openNativeWorkflow } = require('../../modules/operator/operator-tui-native-workflows');
const { windowEntriesToHeight } = require('../../modules/operator/operator-tui-run-browser-workflow');
const { adaptSelectedRunStatus } = require('../../modules/operator/operator-tui-adapters');
const { loadOperatorTraceContext, runOperatorStatus } = require('../../modules/operator/operator-trace-command');

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const strip = (text) => text.replace(ANSI, '');

const GOAL = 'Build a small self-contained Sudoku HTML app as a single file named sudoku.html';

function makeRuns(count) {
  return Array.from({ length: count }, (_, i) => ({
    run_id: `task-${String(i + 1).padStart(8, '0')}`,
    status: 'blocked',
    outcome: 'blocked',
    result_code: 'RUN_FOUND',
    goal_summary: i % 3 === 0 ? GOAL : null,
    created_at: `2026-08-10T22:${String(10 + i).padStart(2, '0')}:00.000Z`,
    last_event_at: `2026-08-10T22:${String(11 + i).padStart(2, '0')}:00.000Z`,
    current_phase: 'review',
    reason_code: 'MAX_ITERATIONS_CERBERUS_BLOCKERS',
    action_eligibility: 'inspect',
  }));
}

async function renderBrowser({ columns, rows, runCount, cursor }) {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const base = buildShellModel({
    columns,
    rows,
    skipSplash: true,
    runsPayload: { runs: makeRuns(runCount), result_code: 'RUNS_OK' },
  });
  const opened = openNativeWorkflow(base, 'runs');
  const workflow = { ...opened, select: { ...opened.select, cursorIndex: cursor } };
  const model = buildShellModel({
    ...shellModelToOptions(base),
    activeWorkflow: workflow,
    contentSurface: 'run_browser',
    focus: 'content',
    selectedNavId: 'runs',
  });
  return strip(renderOperatorTuiShellToString(model, { columns, rows })).split('\n');
}

const VIEWPORTS = [
  [80, 24],
  [100, 30],
  [120, 40],
  [160, 50],
  [200, 70],
  [300, 90],
];

test('run browser keeps selected run, its fields and the footer on screen at every size', async () => {
  for (const [columns, rows] of VIEWPORTS) {
    for (const cursor of [0, 7, 19]) {
      const label = `${columns}x${rows} cursor=${cursor}`;
      const lines = await renderBrowser({ columns, rows, runCount: 20, cursor });
      const selectedId = `task-${String(cursor + 1).padStart(8, '0')}`;
      const text = lines.join('\n');

      assert.ok(lines.length <= rows, `${label}: frame is ${lines.length} rows, terminal has ${rows}`);
      assert.ok(
        lines.every((line) => [...line].length <= columns),
        `${label}: a line exceeds ${columns} columns`,
      );
      assert.ok(
        lines.some((line) => line.includes('›') && line.includes(selectedId)),
        `${label}: selected run ${selectedId} is not visible`,
      );
      assert.match(text, /selected \d+\/20/, `${label}: selection footer hidden`);
      assert.match(text, /Native workflow|q=quit/, `${label}: key hints hidden`);
    }
  }
});

test('run browser shows title and execution dates for the selected run on tall terminals', async () => {
  const lines = await renderBrowser({ columns: 200, rows: 70, runCount: 20, cursor: 0 });
  const text = lines.join('\n');
  assert.match(text, /title: Build a small self-contained Sudoku HTML app/);
  assert.match(text, /created: 2026-08-10T22:10:00\.000Z/);
  assert.match(text, /updated: 2026-08-10T22:11:00\.000Z/);
});

test('run browser tells the operator when runs are scrolled out of view', async () => {
  const lines = await renderBrowser({ columns: 120, rows: 30, runCount: 20, cursor: 12 });
  const text = lines.join('\n');
  assert.match(text, /\d+ more above/);
  assert.match(text, /\d+ more below/);
});

test('windowEntriesToHeight leaves short lists untouched and never drops the selected run', () => {
  const entries = [
    { text: 'Run browser', kind: 'heading' },
    { text: '', kind: 'spacer' },
    ...Array.from({ length: 6 }, (_, i) => [
      { text: `${i === 4 ? '›' : ' '} ${i + 1}. run-${i}`, kind: 'option', selected: i === 4 },
      { text: '   title: x', kind: 'detail', selected: i === 4 },
      { text: '', kind: 'spacer' },
    ]).flat().slice(0, -1),
    { text: '', kind: 'spacer' },
    { text: 'selected 5/6', kind: 'footer' },
    { text: 'hint', kind: 'hint' },
  ];
  assert.equal(windowEntriesToHeight(entries, 500), entries);
  for (const limit of [8, 10, 14]) {
    const out = windowEntriesToHeight(entries, limit);
    assert.ok(out.length <= limit, `limit ${limit} produced ${out.length} rows`);
    assert.ok(out.some((e) => e.selected === true && e.kind === 'option'), `limit ${limit} lost selection`);
    assert.equal(out[out.length - 1].text, 'hint');
    assert.ok(out.some((e) => e.text === 'selected 5/6'));
  }
});

test('status surface shows title and dates from a real trace, not (unavailable)', async () => {
  const startedMs = 1790808029663;
  const lastMs = 1790808087138;
  const createdIso = new Date(startedMs).toISOString();
  const updatedIso = new Date(lastMs).toISOString();
  const rows = [
    { event: 'session_start', task_id: 'task-c7fcc0d', goal: GOAL, ts_ms: startedMs },
    { event: 'agent_start', task_id: 'task-c7fcc0d', ts_ms: lastMs },
  ];
  const ctx = loadOperatorTraceContext({
    filePath: '/tmp/task-c7fcc0d.jsonl',
    existsSync: () => true,
    readFileSync: () => rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    repoRoot: '/tmp/repo',
  });
  assert.equal(ctx.ok, true);
  const operatorResult = runOperatorStatus({ loadContext: () => ctx, json: true });

  const status = adaptSelectedRunStatus(operatorResult);
  assert.equal(status.goal_summary, GOAL);
  assert.equal(status.created_at, createdIso);
  assert.equal(status.last_event_at, updatedIso);

  const { buildContentLines } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const model = buildShellModel({
    statusResult: status,
    selectedRunId: 'task-c7fcc0d',
    contentSurface: 'status',
  });
  const text = buildContentLines(model).join('\n');
  assert.match(text, /title: Build a small self-contained Sudoku HTML app/);
  assert.ok(text.includes(`created_at: ${createdIso}`), 'created_at missing from status surface');
  assert.ok(text.includes(`updated_at: ${updatedIso}`), 'updated_at missing from status surface');
  assert.doesNotMatch(text, /(title|created_at|updated_at): \(unavailable\)/);
});
