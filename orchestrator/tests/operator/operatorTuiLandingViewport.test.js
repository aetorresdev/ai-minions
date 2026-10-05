'use strict';

/**
 * Landing must keep every action reachable and visible at any terminal size.
 *
 * Regression guard for: very wide, short windows dropping Browse Runs / System
 * Status / Settings / Help from the landing (selection moved onto invisible
 * entries) and hiding the recovery hint next to the readiness line.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildShellModel, shellModelToOptions } = require('../../modules/operator/operator-tui-shell-model');
const {
  formatLandingMenuLine,
  formatLandingOverallLine,
  landingQuickStartActions,
} = require('../../modules/operator/operator-tui-landing');

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const strip = (text) => text.replace(ANSI, '');

const NAV_IDS = ['launcher', 'runs', 'diagnostics', 'config', 'help'];
const FULL_LABELS = ['Start New Run', 'Browse Runs', 'System Status', 'Settings', 'Help'];

const STATES = {
  'needs-setup': {
    pathActivation: { status: 'needs_setup', on_path: false },
    credentials: { credential_sufficiency: 'needs_setup', providers: [] },
    overall: 'Needs setup',
    recovery: /Open Settings/,
  },
  ready: {
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    overall: 'Ready',
    recovery: null,
  },
};

function makeRuns(count) {
  return Array.from({ length: count }, (_, i) => ({
    run_id: `task-sudoku-integrated-r${count - i}`,
    status: 'blocked',
    outcome: 'blocked',
    result_code: 'RUN_FOUND',
    goal_summary: 'Build a small self-contained Sudoku HTML app',
    created_at: `2026-10-05T21:4${i}:00.000Z`,
    last_event_at: `2026-10-05T21:5${i}:00.000Z`,
    current_phase: 'complete',
    reason_code: 'cerberus_anchor_required',
    action_eligibility: 'inspect',
  }));
}

function landingModel({ columns, rows, state, selected = 'launcher', runCount = 0 }) {
  const s = STATES[state];
  return buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: s.pathActivation,
    credentials: s.credentials,
    runsPayload: { runs: makeRuns(runCount), result_code: 'RUNS_OK' },
    columns,
    rows,
    skipSplash: true,
    icons: 'unicode',
    selectedNavId: selected,
  });
}

async function renderLanding(model, columns, rows) {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  return strip(renderOperatorTuiShellToString(model, { columns, rows })).replace(/\s+$/, '').split('\n');
}

/**
 * A landing frame is clean when it fits the terminal, shows every action by
 * key, marks the selected one exactly once, and keeps the readiness line, the
 * command input and the footer key hints.
 */
function assertLandingFrame(lines, { columns, rows, state, selected, label }) {
  const text = lines.join('\n');
  assert.ok(lines.length <= rows, `${label}: frame is ${lines.length} rows, terminal has ${rows}`);
  assert.ok(lines.every((line) => [...line].length <= columns), `${label}: a line exceeds ${columns} columns`);

  // Every action is listed: the full Quick Start panel or the one-line keyed menu.
  const roomy = /Browse Runs/.test(text) && /System Status/.test(text);
  if (roomy) {
    for (const entry of FULL_LABELS) assert.match(text, new RegExp(entry), `${label}: ${entry} missing`);
  } else {
    const menuLine = lines.find((line) => /1\. Start New Run/.test(line) && /\b5\b/.test(line));
    assert.ok(menuLine, `${label}: compact menu line with all five keys missing`);
    for (const key of ['1', '2', '3', '4', '5']) {
      assert.match(menuLine, new RegExp(`(^|[^\\d])${key}([^\\d]|$)`), `${label}: key ${key} missing in menu line`);
    }
  }

  // Selection marker: exactly one marked menu entry matching the selected key.
  const selectedKey = String(NAV_IDS.indexOf(selected) + 1);
  const marked = lines.flatMap((line) => [...line.matchAll(/›\s*(\d)/g)].map((m) => m[1]));
  assert.ok(marked.includes(selectedKey), `${label}: selected entry ${selectedKey} has no marker (marked: ${marked.join(',')})`);
  assert.ok(
    marked.every((key) => key === selectedKey),
    `${label}: only entry ${selectedKey} may be marked (marked: ${marked.join(',')})`,
  );

  assert.match(text, new RegExp(`Overall: ${STATES[state].overall}`), `${label}: Overall line missing`);
  if (STATES[state].recovery) {
    assert.match(text, STATES[state].recovery, `${label}: recovery hint missing`);
  }
  assert.ok(lines.some((line) => /^[│║] >/.test(line)), `${label}: command input missing`);
  assert.match(lines[lines.length - 1], /↑↓|↑\/↓/, `${label}: footer key hints must be the last row`);
  assert.equal(
    lines.filter((line) => /Esc/.test(line) && /· q|q Quit/.test(line)).length,
    1,
    `${label}: footer key hints must appear exactly once`,
  );

  // No overprint: boxed rows keep both borders (compact layout; roomy layouts put art beside the hero).
  for (const line of rows < 24 || columns < 80 ? lines : []) {
    assert.equal(/^[║│]/.test(line), /[║│]$/.test(line), `${label}: broken box row ${JSON.stringify(line)}`);
  }
}

const SIZES = [
  [60, 20], [60, 24], [80, 24], [100, 14], [100, 20], [120, 30],
  [250, 14], [250, 16], [250, 20], [250, 24], [300, 16], [300, 20], [300, 40],
  // Full-screen-width dropdown terminals (250-350 columns) from 16 to 36 rows.
  [280, 18], [280, 22], [330, 20], [330, 28], [350, 16], [350, 20], [350, 34], [350, 36],
];

test('landing keeps every action, selection marker, recovery hint and footer at every size', async () => {
  for (const state of Object.keys(STATES)) {
    for (const [columns, rows] of SIZES) {
      for (const [selected, runCount] of [['launcher', 0], ['diagnostics', 3], ['help', 3]]) {
        const label = `${state} ${columns}x${rows} sel=${selected} runs=${runCount}`;
        const lines = await renderLanding(landingModel({ columns, rows, state, selected, runCount }), columns, rows);
        assertLandingFrame(lines, { columns, rows, state, selected, label });
      }
    }
  }
});

test('landing at the supported narrow minimum lists all five actions for every selection', async () => {
  for (const state of Object.keys(STATES)) {
    for (const [columns, rows] of [[60, 20], [60, 24]]) {
      for (const selected of NAV_IDS) {
        const label = `${state} ${columns}x${rows} sel=${selected}`;
        const lines = await renderLanding(landingModel({ columns, rows, state, selected, runCount: 3 }), columns, rows);
        assertLandingFrame(lines, { columns, rows, state, selected, label });
      }
    }
  }
});

test('wide-short landing (250x16 / 300x20) shows all five actions in the menu', async () => {
  for (const [columns, rows] of [[250, 16], [300, 20]]) {
    const lines = await renderLanding(landingModel({ columns, rows, state: 'needs-setup', selected: 'config' }), columns, rows);
    const menu = lines.find((line) => /1\. Start New Run/.test(line) && /5\. Help/.test(line));
    assert.ok(menu, `${columns}x${rows}: expected a one-line menu with all five labelled actions`);
    for (const label of ['2. Runs', '3. Status', '4. Settings']) {
      assert.ok(menu.includes(label), `${columns}x${rows}: ${label} missing in ${JSON.stringify(menu)}`);
    }
  }
});

test('typical viewports keep the full Quick Start panel with all five entries', async () => {
  for (const [columns, rows] of [[80, 24], [120, 30], [250, 24], [300, 40]]) {
    const lines = await renderLanding(landingModel({ columns, rows, state: 'needs-setup', selected: 'runs' }), columns, rows);
    const text = lines.join('\n');
    assert.match(text, /Quick Start/);
    for (const entry of FULL_LABELS) assert.match(text, new RegExp(entry), `${columns}x${rows}: ${entry}`);
    assert.match(text, /Model Policy/, `${columns}x${rows}: readiness details`);
  }
});

test('wide -> short -> wide resize equals a fresh render at every step', async () => {
  const wide = { columns: 250, rows: 40 };
  const short = { columns: 250, rows: 16 };
  for (const state of Object.keys(STATES)) {
    for (const selected of ['launcher', 'config']) {
      const first = landingModel({ ...wide, state, selected });
      const options = shellModelToOptions(first);
      const resized = (size) => buildShellModel({ ...options, ...size });

      const before = await renderLanding(first, wide.columns, wide.rows);
      const squeezed = await renderLanding(resized(short), short.columns, short.rows);
      const after = await renderLanding(resized(wide), wide.columns, wide.rows);

      const freshShort = await renderLanding(landingModel({ ...short, state, selected }), short.columns, short.rows);
      const freshWide = await renderLanding(landingModel({ ...wide, state, selected }), wide.columns, wide.rows);

      assert.deepEqual(squeezed, freshShort, `${state}/${selected}: squeezed frame differs from fresh`);
      assert.deepEqual(after, freshWide, `${state}/${selected}: restored frame differs from fresh`);
      assert.deepEqual(after, before, `${state}/${selected}: restored frame differs from the original`);
      assertLandingFrame(squeezed, { ...short, state, selected, label: `resized ${state}/${selected}` });
    }
  }
});

test('formatLandingMenuLine never drops an action and respects its width', () => {
  const items = landingQuickStartActions();
  for (const width of [8, 20, 34, 46, 56, 76, 200]) {
    for (const selectedId of NAV_IDS) {
      const line = formatLandingMenuLine(items, { selectedId, marker: '›', width });
      const keys = [...line.matchAll(/(^|[^\d])([1-5])(?!\d)/g)].map((m) => m[2]);
      assert.deepEqual(keys, ['1', '2', '3', '4', '5'], `width ${width} sel ${selectedId}: ${line}`);
      assert.equal((line.match(/›/g) ?? []).length, 1, `width ${width} sel ${selectedId}: one marker`);
      if (width >= 20) assert.ok([...line].length <= width, `width ${width}: ${line}`);
    }
  }
  assert.equal(
    formatLandingMenuLine(items, { selectedId: 'runs', marker: '>', width: 200 }),
    '1. Start New Run · > 2. Runs · 3. Status · 4. Settings · 5. Help',
  );
});

test('formatLandingOverallLine adds the recovery hint only when the next row was dropped', () => {
  const needs = { overall: { state: 'needs_setup', label: 'Needs setup', next_action: 'Open Settings' } };
  const ready = { overall: { state: 'ready', label: 'Ready', next_action: 'Start New Run' } };
  assert.equal(formatLandingOverallLine(needs, { show_readiness_next: true }), 'Overall: Needs setup');
  assert.equal(formatLandingOverallLine(needs, { show_readiness_next: false }), 'Overall: Needs setup · Open Settings');
  assert.equal(formatLandingOverallLine(ready, { show_readiness_next: false }), 'Overall: Ready');
});
