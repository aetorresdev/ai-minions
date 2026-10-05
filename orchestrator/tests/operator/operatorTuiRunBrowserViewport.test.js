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
const { windowEntriesToHeight, formatRunBrowserWorkflowEntries: formatNativeWorkflowEntries } = require('../../modules/operator/operator-tui-run-browser-workflow');
const { adaptSelectedRunStatus } = require('../../modules/operator/operator-tui-adapters');
const { loadOperatorTraceContext, runOperatorStatus } = require('../../modules/operator/operator-trace-command');

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const strip = (text) => text.replace(ANSI, '');

const GOAL = 'Build a small self-contained Sudoku HTML app as a single file named sudoku.html';

// idLength 0 -> short `task-00000001` ids; otherwise a long, space-free id that
// hard-wraps unless the chrome truncates it.
function runIdFor(index, idLength = 0) {
  return idLength
    ? `run-${'x'.repeat(idLength)}-${index + 1}`
    : `task-${String(index + 1).padStart(8, '0')}`;
}

function makeRuns(count, idLength = 0) {
  return Array.from({ length: count }, (_, i) => ({
    run_id: runIdFor(i, idLength),
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

function browserModel({ columns, rows, runCount, cursor, runs, idLength = 0 }) {
  const base = buildShellModel({
    columns,
    rows,
    skipSplash: true,
    runsPayload: { runs: runs ?? makeRuns(runCount, idLength), result_code: 'RUNS_OK' },
  });
  const opened = openNativeWorkflow(base, 'runs');
  const workflow = { ...opened, select: { ...opened.select, cursorIndex: cursor } };
  return buildShellModel({
    ...shellModelToOptions(base),
    activeWorkflow: workflow,
    contentSurface: 'run_browser',
    focus: 'content',
    selectedNavId: 'runs',
  });
}

async function renderModel(model, columns, rows) {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  return strip(renderOperatorTuiShellToString(model, { columns, rows })).split('\n');
}

async function renderBrowser({ columns, rows, runCount, cursor, runs, idLength = 0 }) {
  return renderModel(browserModel({ columns, rows, runCount, cursor, runs, idLength }), columns, rows);
}

/**
 * A frame is clean when every required row appears exactly once, runs are
 * listed in order without gaps, and no row was overprinted by another one.
 * Ink overprints by writing a row into cells that already hold other text, so
 * a mangled row cannot match its exact expected text and box borders break.
 */
function assertCleanBrowserFrame(lines, { columns, rows, cursor, total, label, idLength = 0 }) {
  const selectedId = runIdFor(cursor, idLength);
  const idPrefix = selectedId.slice(0, 12);
  const headerId = runIdFor(0, idLength); // the shell selects the first run by default
  const count = (predicate) => lines.filter(predicate).length;

  assert.ok(lines.length <= rows, `${label}: frame is ${lines.length} rows, terminal has ${rows}`);
  assert.ok(lines.every((line) => [...line].length <= columns), `${label}: a line exceeds ${columns} columns`);

  assert.equal(
    count((line) => line.includes(`› ${cursor + 1}. ${idPrefix}`)),
    1,
    `${label}: selected numbered row must appear exactly once`,
  );
  assert.equal(
    count((line) => line.includes(`selected ${cursor + 1}/${total}`)),
    1,
    `${label}: "selected ${cursor + 1}/${total}" counter must appear exactly once`,
  );
  assert.equal(
    count((line) => line.includes('Esc cancel')),
    1,
    `${label}: list key hint must appear exactly once`,
  );
  assert.equal(
    count((line) => /Native workflow · ↑\/↓|workflow · ↑↓ · Enter · Esc · q/.test(line)),
    1,
    `${label}: footer key hints must appear exactly once`,
  );

  // Numbered runs: consecutive, ascending, each once, selected one inside.
  const numbered = lines
    .map((line) => /(\d+)\. (?:task|run)-/.exec(line))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  assert.ok(numbered.includes(cursor + 1), `${label}: selected run missing from numbered rows`);
  numbered.forEach((n, i) => {
    if (i > 0) assert.equal(n, numbered[i - 1] + 1, `${label}: numbered rows ${numbered.join(',')} are not consecutive`);
  });

  // Scroll markers must state exact hidden counts.
  const first = numbered[0];
  const last = numbered[numbered.length - 1];
  const above = lines.map((l) => /(\d+) more above/.exec(l)).filter(Boolean);
  const below = lines.map((l) => /(\d+) more below/.exec(l)).filter(Boolean);
  assert.deepEqual(above.map((m) => Number(m[1])), first > 1 ? [first - 1] : [], `${label}: "more above" marker`);
  assert.deepEqual(below.map((m) => Number(m[1])), last < total ? [total - last] : [], `${label}: "more below" marker`);

  // No overprint: boxed rows keep both borders and visible text rows are distinct.
  for (const line of lines) {
    const startsBoxed = /^[║│]/.test(line);
    const endsBoxed = /[║│]$/.test(line);
    assert.equal(startsBoxed, endsBoxed, `${label}: broken box row ${JSON.stringify(line)}`);
  }
  const texts = lines
    .map((line) => line.replace(/^[║│\s]+|[║│\s]+$/g, ''))
    .filter((text) => text && !/^[─═╔╗╚╝┌┐└┘\s]+$/.test(text))
    // Per-run detail lines legitimately repeat across runs on tall terminals.
    .filter((text) => !/^(title|created|updated|phase|reason|action): /.test(text));
  assert.equal(new Set(texts).size, texts.length, `${label}: duplicated or overprinted rows`);
  if (lines.some((line) => line.includes('Navigate'))) {
    for (const item of ['h. Home', '1. New Run', '2. Runs', '3. System Status', '4. Settings', '5. Help']) {
      assert.equal(count((line) => line.includes(item)), 1, `${label}: Navigate item "${item}" missing or overprinted`);
    }
    assert.ok(
      lines.some((line) => /│ run=\S+ *│/.test(line) && line.includes(`run=${headerId.slice(0, 8)}`)),
      `${label}: Navigate run row missing`,
    );
  } else {
    assert.equal(count((line) => /Nav › 2\. Runs · keys h 1 2 3 4 5/.test(line)), 1, `${label}: nav summary missing`);
  }
  // Header: product title (boxed header) or status line, always with a recognizable run id.
  assert.ok(
    lines.some((line) => line.includes('readiness=') && line.includes(`run=${headerId.slice(0, 8)}`)),
    `${label}: header status row with run id missing`,
  );
  assert.ok(count((line) => line.includes('Content · run_browser')) <= 1, `${label}: content title duplicated`);
  // Fixed chrome rows never leak partial text from a neighbour (e.g. "aboveser").
  assert.equal(count((line) => /more above\S/.test(line) || /more below\S/.test(line)), 0, `${label}: marker corrupted`);
}

const VIEWPORTS = [
  [60, 20],
  [60, 24],
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
      assertCleanBrowserFrame(lines, { columns, rows, cursor, total: 20, label });
      assert.ok(
        lines.join('\n').includes(`title: ${cursor % 3 === 0 ? 'Build a small' : '(unavailable)'}`),
        `${label}: selected run title row missing`,
      );
    }
  }
});

test('narrow minimum keeps navigation and recovery affordances with one to three runs', async () => {
  for (const [columns, rows] of [[60, 20], [60, 24]]) {
    for (const total of [1, 3]) {
      for (let cursor = 0; cursor < total; cursor += 1) {
        const label = `${columns}x${rows} ${cursor + 1}/${total}`;
        const lines = await renderBrowser({ columns, rows, runCount: total, cursor });
        assertCleanBrowserFrame(lines, { columns, rows, cursor, total, label });
        const text = lines.join('\n');
        assert.match(text, /Nav › 2\. Runs · keys h 1 2 3 4 5/, `${label}: navigation line missing`);
        assert.match(text, /Esc cancel/, `${label}: recovery hint missing`);
        assert.match(text, /readiness=/, `${label}: readiness missing`);
      }
    }
  }
});

test('narrow frames drop chrome in order and keep the content border and footer hints', async () => {
  const roomy = await renderBrowser({ columns: 60, rows: 60, runCount: 20, cursor: 7 });
  assert.ok(roomy.some((l) => l.includes('Navigate')), 'roomy narrow frame keeps the Navigate box');
  assert.ok(roomy.some((l) => l.includes('Task-first landing')), 'roomy narrow frame keeps the disclaimer');

  const minimum = await renderBrowser({ columns: 60, rows: 20, runCount: 20, cursor: 7 });
  const text = minimum.join('\n');
  assert.doesNotMatch(text, /Task-first landing/, 'disclaimer is the first chrome dropped');
  assert.doesNotMatch(text, /Navigate/, 'Navigate box collapses to the one-line summary');
  assert.match(text, /Content · run_browser/);
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

function listEntries(count, selectedIndex, detailLines = 6) {
  const blocks = Array.from({ length: count }, (_, i) => [
    { text: `${i === selectedIndex ? '›' : ' '} ${i + 1}. run-${i}`, kind: 'option', selected: i === selectedIndex },
    ...Array.from({ length: detailLines }, (__, d) => ({
      text: `       detail-${d}`,
      kind: 'detail',
      selected: i === selectedIndex,
    })),
    { text: '', kind: 'spacer' },
  ]);
  return [
    { text: 'Run browser (native)', kind: 'heading' },
    { text: '', kind: 'spacer' },
    { text: 'Startup snapshot', kind: 'note' },
    { text: '', kind: 'spacer' },
    { text: 'Newest-first runs', kind: 'title' },
    { text: '', kind: 'spacer' },
    ...blocks.flat().slice(0, -1),
    { text: '', kind: 'spacer' },
    { text: `selected ${selectedIndex + 1}/${count}`, kind: 'footer' },
    { text: 'hint', kind: 'hint' },
  ];
}

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

test('windowEntriesToHeight never exceeds its budget, including budgets below 8', () => {
  for (const [count, selectedIndex] of [[20, 7], [20, 0], [20, 19], [3, 1], [1, 0]]) {
    const entries = listEntries(count, selectedIndex);
    for (let limit = 0; limit <= 40; limit += 1) {
      const label = `${count} runs, cursor ${selectedIndex}, budget ${limit}`;
      const out = windowEntriesToHeight(entries, limit);
      assert.ok(out.length <= limit, `${label}: produced ${out.length} rows`);
      // Minimal representation: selected numbered row (budget 1), plus the
      // `selected N/M` counter (budget 2), plus the key hint (budget 3).
      if (limit >= 1) {
        assert.equal(
          out.filter((e) => e.kind === 'option' && e.selected === true).length,
          1,
          `${label}: selected numbered row missing`,
        );
      }
      if (limit >= 2) {
        assert.ok(out.some((e) => e.text === `selected ${selectedIndex + 1}/${count}`), `${label}: counter missing`);
      }
      if (limit >= 3) {
        assert.equal(out[out.length - 1].text, 'hint', `${label}: key hint missing`);
      }
      const ids = out.filter((e) => e.kind === 'option').map((e) => e.text);
      assert.equal(new Set(ids).size, ids.length, `${label}: duplicated option rows`);
    }
  }
});

test('windowEntriesToHeight keeps core detail lines and scroll markers when the budget allows', () => {
  const out = windowEntriesToHeight(listEntries(20, 7), 8);
  const texts = out.map((e) => e.text);
  assert.deepEqual(texts, [
    '  ... 7 more above',
    '› 8. run-7',
    '       detail-0',
    '       detail-1',
    '       detail-2',
    '  ... 12 more below',
    'selected 8/20',
    'hint',
  ]);
  const tiny = windowEntriesToHeight(listEntries(20, 7), 2).map((e) => e.text);
  assert.deepEqual(tiny, ['› 8. run-7', 'selected 8/20']);
  assert.deepEqual(windowEntriesToHeight(listEntries(20, 7), 1).map((e) => e.text), ['› 8. run-7']);
  assert.deepEqual(windowEntriesToHeight(listEntries(20, 7), 0), []);
});

test('real run-browser entries respect the budget at every size', () => {
  const workflow = openNativeWorkflow(
    buildShellModel({ columns: 60, rows: 20, skipSplash: true, runsPayload: { runs: makeRuns(20), result_code: 'RUNS_OK' } }),
    'runs',
  );
  const entries = formatNativeWorkflowEntries({ ...workflow, select: { ...workflow.select, cursorIndex: 7 } });
  for (const limit of [0, 1, 2, 3, 5, 7, 8, 9, 12, 20]) {
    const out = windowEntriesToHeight(entries, limit);
    assert.ok(out.length <= limit, `budget ${limit} produced ${out.length} rows`);
    if (limit >= 1) assert.ok(out.some((e) => e.kind === 'option' && e.selected === true));
  }
});

test('wide -> narrow -> wide resize restores the exact wide frame', async () => {
  const wide = { columns: 160, rows: 50 };
  const narrow = { columns: 60, rows: 20 };
  const first = browserModel({ ...wide, runCount: 20, cursor: 7 });
  const state = shellModelToOptions(first);
  const resized = (size) => buildShellModel({ ...state, ...size });

  const before = await renderModel(first, wide.columns, wide.rows);
  const squeezed = await renderModel(resized(narrow), narrow.columns, narrow.rows);
  const after = await renderModel(resized(wide), wide.columns, wide.rows);
  const fresh = await renderBrowser({ ...wide, runCount: 20, cursor: 7 });

  assertCleanBrowserFrame(squeezed, { ...narrow, cursor: 7, total: 20, label: 'resized 60x20' });
  assert.deepEqual(after, fresh, 'wide frame after resize differs from a fresh render');
  assert.deepEqual(after, before, 'wide frame after resize differs from the frame before it');
});

const LONG_ID_LENGTHS = [0, 18, 40, 80, 200];
const LONG_ID_SIZES = [[60, 20], [60, 24], [80, 24], [100, 30], [160, 50], [300, 90]];

test('long run ids never overprint chrome or content at any supported size', async () => {
  for (const idLength of LONG_ID_LENGTHS) {
    for (const [columns, rows] of LONG_ID_SIZES) {
      for (const cursor of [0, 7, 19]) {
        const label = `id+${idLength} ${columns}x${rows} cursor=${cursor}`;
        const lines = await renderBrowser({ columns, rows, runCount: 20, cursor, idLength });
        assertCleanBrowserFrame(lines, { columns, rows, cursor, total: 20, label, idLength });
        assert.match(lines.join('\n'), /Esc cancel/, `${label}: recovery hint missing`);
      }
    }
  }
});

test('a long id with one to three runs keeps the narrow minimum clean', async () => {
  for (const [columns, rows] of [[60, 20], [80, 24]]) {
    for (const total of [1, 3]) {
      for (let cursor = 0; cursor < total; cursor += 1) {
        const label = `long id ${columns}x${rows} ${cursor + 1}/${total}`;
        const lines = await renderBrowser({ columns, rows, runCount: total, cursor, idLength: 80 });
        assertCleanBrowserFrame(lines, { columns, rows, cursor, total, label, idLength: 80 });
      }
    }
  }
});

test('shortened ids keep a recognizable prefix and the distinguishing suffix', async () => {
  const { fitMiddle } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const id = runIdFor(6, 80);
  const short = fitMiddle(id, 24);
  assert.equal([...short].length, 24);
  assert.ok(short.startsWith('run-xxxx'));
  assert.ok(short.endsWith('-7'));
  assert.ok(short.includes('…'));
  assert.equal(fitMiddle('task-sudoku-default-r1', 40), 'task-sudoku-default-r1');
});

test('planned chrome rows equal rendered chrome rows for long ids', async () => {
  const { resolveShellChrome, chromeRowBreakdown, buildContentEntries } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  for (const idLength of LONG_ID_LENGTHS) {
    for (const [columns, rows] of LONG_ID_SIZES) {
      for (const cursor of [0, 7, 19]) {
        const label = `id+${idLength} ${columns}x${rows} cursor=${cursor}`;
        const model = browserModel({ columns, rows, runCount: 20, cursor, idLength });
        const plan = resolveShellChrome(model);
        const parts = chromeRowBreakdown(model, plan.chrome);
        const entries = buildContentEntries(model, plan);
        const lines = await renderModel(model, columns, rows);

        assert.equal(lines.length, rows, `${label}: frame is not exactly ${rows} rows`);
        assert.ok(entries.length <= plan.contentRows, `${label}: ${entries.length} entries exceed ${plan.contentRows} planned rows`);

        const probe = (text) => text.trim().slice(0, 16);
        const first = lines.findIndex((line) => line.includes(probe(entries[0].text)));
        const last = lines.length - 1 - [...lines].reverse().findIndex((line) => line.includes(probe(entries[entries.length - 1].text)));
        const sideBySide = model.layout !== 'narrow' && plan.chrome.nav === 'full';
        const above = parts.header + (sideBySide ? 0 : parts.nav) + parts.contentTop;
        const below = (plan.contentRows - entries.length) + parts.contentBottom + parts.input + parts.footer + parts.disclaimer;
        assert.equal(first, above, `${label}: rows above the content differ from the plan`);
        assert.equal(lines.length - 1 - last, below, `${label}: rows below the content differ from the plan`);
      }
    }
  }
});

test('wide -> narrow -> wide resize with long ids stays clean and restores the wide frame', async () => {
  for (const idLength of [22, 80]) {
    const sizes = [[160, 50], [60, 20], [80, 24], [60, 24], [160, 50]];
    const state = shellModelToOptions(browserModel({ columns: 160, rows: 50, runCount: 20, cursor: 7, idLength }));
    for (const [columns, rows] of sizes) {
      const label = `id+${idLength} resize ${columns}x${rows}`;
      const frame = await renderModel(buildShellModel({ ...state, columns, rows }), columns, rows);
      assertCleanBrowserFrame(frame, { columns, rows, cursor: 7, total: 20, label, idLength });
    }
    const last = await renderModel(buildShellModel({ ...state, columns: 160, rows: 50 }), 160, 50);
    const fresh = await renderBrowser({ columns: 160, rows: 50, runCount: 20, cursor: 7, idLength });
    assert.deepEqual(last, fresh, `id+${idLength}: final wide frame differs from a fresh render`);
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
