'use strict';

/**
 * Task-first landing view-model + shell navigation IA.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLandingViewModel,
  formatLandingLines,
  formatHelpLines,
  formatDiagnosticsLines,
  adaptShellNavigation,
  deriveLandingOverall,
  classifyRunActivity,
  landingLayoutForViewport,
  LANDING_SCHEMA,
} = require('../../modules/operator/operator-tui-landing');
const { buildShellModel, formatShellText, resolveShellKeypress } = require('../../modules/operator/operator-tui-shell-model');
const { executeShellAction, resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');
const { resolveShellTheme, toneColor } = require('../../modules/operator/operator-tui-theme');

function baseHome(overrides = {}) {
  return {
    version: '0.26.0-beta.1',
    git_commit: 'abc1234',
    model_policy: 'local_only',
    path_status: 'ready',
    cli_on_path: true,
    credential_sufficiency: 'not_required',
    remote_tokens_required: false,
    providers: [],
    ...overrides,
  };
}

function readyShellOptions(overrides = {}) {
  return {
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    ...overrides,
  };
}

test('landing schema: ready / no runs emphasizes Start New Run', () => {
  const landing = buildLandingViewModel({
    home: baseHome(),
    runs: { runs: [], result_code: 'RUNS_EMPTY' },
    version: '0.26.0-beta.1',
  });
  assert.equal(landing.schema, LANDING_SCHEMA);
  assert.equal(landing.overall.state, 'ready');
  assert.equal(landing.primary_action_id, 'launcher');
  assert.equal(landing.empty_state.kind, 'no_runs');
  assert.match(landing.empty_state.title, /No runs/i);
  assert.match(landing.overall.next_action, /Start New Run|canonical fixture/i);
  const lines = formatLandingLines(landing, { selectedNavId: 'launcher' }).join('\n');
  assert.match(lines, /Quick Start/);
  assert.match(lines, /> 1\. Start New Run/);
  assert.match(lines, /System Readiness/);
  assert.match(lines, /Overall: Ready/);
  assert.match(lines, /No runs yet|\(No runs yet\)/);
  assert.doesNotMatch(lines, /git_commit/);
  assert.doesNotMatch(lines, /ANTHROPIC_API_KEY/);
});

test('landing: clean install / needs setup', () => {
  const landing = buildLandingViewModel({
    home: baseHome({
      path_status: 'needs_setup',
      cli_on_path: false,
      credential_sufficiency: 'needs_setup',
    }),
    runs: { runs: [] },
  });
  assert.equal(landing.overall.state, 'needs_setup');
  assert.match(landing.overall.next_action, /Settings|remediation/i);
  assert.equal(landing.empty_state.kind, 'needs_setup');
});

test('landing: blocked credentials vs failed probe are distinct', () => {
  const blocked = deriveLandingOverall(baseHome({
    path_status: 'ready',
    credential_sufficiency: 'insufficient',
  }));
  assert.equal(blocked.state, 'blocked');
  const failed = deriveLandingOverall(baseHome({ path_status: 'probe_failed' }));
  assert.equal(failed.state, 'failed');
  assert.notEqual(blocked.label, failed.label);
});

test('landing: loading first-paint does not invent ready', () => {
  const landing = buildLandingViewModel({
    home: baseHome({
      path_status: 'loading',
      credential_sufficiency: 'unavailable',
      cli_on_path: null,
    }),
    runs: { runs: [] },
    loading: true,
  });
  assert.equal(landing.overall.state, 'loading');
  assert.notEqual(landing.overall.state, 'ready');
  const pathRow = landing.readiness_rows.find((r) => /Path/i.test(r.label));
  assert.ok(pathRow);
  assert.equal(pathRow.tone, 'loading');
});

test('landing: active / blocked / failed / completed run states', () => {
  assert.equal(classifyRunActivity({ status: 'running' }).state, 'active');
  assert.equal(classifyRunActivity({
    status: 'stopped',
    reason_code: 'CERBERUS_BLOCKED',
  }).state, 'blocked');
  assert.equal(classifyRunActivity({ status: 'failed', outcome: 'failed' }).state, 'failed');
  assert.equal(classifyRunActivity({ status: 'complete', outcome: 'success' }).state, 'completed');

  const landing = buildLandingViewModel({
    home: baseHome(),
    runs: {
      runs: [
        {
          run_id: 'run_active',
          status: 'running',
          last_event_at: '2026-07-28T12:00:00.000Z',
        },
        {
          run_id: 'run_blocked',
          status: 'stopped',
          reason_code: 'CERBERUS_GATE_BLOCKED',
        },
        {
          run_id: 'run_failed',
          status: 'failed',
          outcome: 'failed',
        },
        {
          run_id: 'run_ok',
          status: 'complete',
          outcome: 'success',
          goal_summary: 'Sudoku fixture',
        },
      ],
    },
    selectedRunId: 'run_active',
  });
  assert.equal(landing.activity.state, 'active');
  assert.equal(landing.recent_runs.length, 4);
  assert.equal(landing.recent_runs[0].activity_state, 'active');
  assert.equal(landing.recent_runs[1].activity_state, 'blocked');
  assert.equal(landing.recent_runs[2].activity_state, 'failed');
  assert.equal(landing.recent_runs[3].activity_state, 'completed');
  assert.equal(landing.recent_runs[3].summary, 'Sudoku fixture');
  // Do not invent agent counts.
  assert.equal(landing.recent_runs[0].agent_count, null);
});

test('shell navigation: no duplicate select/status/monitor/evidence/attach top-level', () => {
  const nav = adaptShellNavigation({});
  const ids = nav.map((n) => n.id);
  assert.deepEqual(ids, ['home', 'launcher', 'runs', 'diagnostics', 'config', 'help']);
  assert.ok(!ids.includes('select'));
  assert.ok(!ids.includes('attach'));
  assert.ok(!ids.includes('status'));
  assert.ok(!ids.includes('monitor'));
  assert.ok(!ids.includes('evidence'));

  const withRun = adaptShellNavigation({ selectedRunId: 'run_1' });
  const withIds = withRun.map((n) => n.id);
  assert.ok(withIds.includes('status'));
  assert.ok(withIds.includes('monitor'));
  assert.ok(withIds.includes('evidence'));
  assert.ok(withIds.includes('explain'));
  assert.equal(withRun.filter((n) => n.id === 'status').length, 1);
});

test('shell model home surface is landing, not doctor wall', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    columns: 80,
  });
  assert.ok(model.landing);
  assert.equal(model.landing.overall.state, 'ready');
  const text = formatShellText(model);
  assert.match(text, /Quick Start|Start New Run/);
  assert.match(text, /System Readiness|Overall: Ready/);
  assert.doesNotMatch(text, /^home: policy=/m);
  assert.ok(model.navItems.every((n) => n.id !== 'select'));
  assert.match(model.footerHints, /Navigate|Quit|Help/i);
});

test('narrow + NO_COLOR preserve hierarchy markers', () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const model = buildShellModel({
      aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
      pathActivation: { status: 'ready', on_path: true },
      credentials: { credential_sufficiency: 'not_required', providers: [] },
      runsPayload: {
        runs: [{ run_id: 'r1', status: 'complete', outcome: 'success' }],
      },
      contentSurface: 'home',
      columns: 40,
      colorEnabled: true,
    });
    assert.equal(model.layout, 'narrow');
    assert.equal(model.colorEnabled, false);
    const theme = resolveShellTheme({ colorEnabled: model.colorEnabled });
    assert.equal(theme.brand, undefined);
    assert.equal(theme.blocked, undefined);
    assert.equal(toneColor(theme, 'ok'), undefined);
    const lines = formatLandingLines(model.landing, {
      selectedNavId: 'launcher',
      narrow: true,
    }).join('\n');
    assert.match(lines, /> 1\. Start New Run/);
    assert.match(lines, /Overall: Ready/);
    assert.match(lines, /COMPLETED|r1/);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('hotkeys: task-first digits; ? help; contextual run keys when selected', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: { runs: [{ run_id: 'r1', status: 'running' }] },
    selectedRunId: 'r1',
    focus: 'nav',
  });
  assert.equal(resolveShellKeypress('1', {}, model).actionId, 'launcher');
  assert.equal(resolveShellKeypress('2', {}, model).actionId, 'runs');
  assert.equal(resolveShellKeypress('3', {}, model).actionId, 'diagnostics');
  assert.equal(resolveShellKeypress('4', {}, model).actionId, 'config');
  assert.equal(resolveShellKeypress('5', {}, model).actionId, 'help');
  assert.equal(resolveShellKeypress('h', {}, model).actionId, 'home');
  assert.equal(resolveShellKeypress('?', {}, model).actionId, 'help');
  assert.equal(resolveShellKeypress('m', {}, model).actionId, 'monitor');
  assert.equal(resolveShellKeypress('o', {}, model).actionId, 'status');
  assert.equal(resolveShellKeypress('e', {}, model).actionId, 'evidence');
  // select / attach are not top-level hotkeys anymore
  assert.equal(resolveShellKeypress('s', {}, model).type, 'ignore');
});

test('home / help / diagnostics actions switch surfaces without readline', async () => {
  for (const [id, surface] of [
    ['home', 'home'],
    ['help', 'help'],
    ['diagnostics', 'diagnostics'],
  ]) {
    const result = await executeShellAction({
      actionId: id,
      selectedRunId: null,
      skipRunPrompt: true,
      question: async () => {
        throw new Error('readline must not be used');
      },
      write: () => {},
    });
    assert.equal(result.contentSurface, surface, id);
    assert.equal(result.quit, false);
  }
  assert.equal(resolveShellActionToken('help'), 'help');
  assert.equal(resolveShellActionToken('diagnostics'), 'diagnostics');
  assert.equal(resolveShellActionToken('settings'), 'config');
  assert.equal(resolveShellActionToken('home'), 'home');
});

test('help and diagnostics formatters expose remediation without inventing truth', () => {
  const help = formatHelpLines().join('\n');
  assert.match(help, /New Run \(1\)/);
  assert.match(help, /System Status \(3\)/);
  assert.match(help, /Settings \(4\)/);
  assert.match(help, /Help \(5 \/ \?\)/);
  assert.match(help, /Overview \(o\)/);
  assert.match(help, /AI_MINIONS_TUI_LEGACY=1/);
  assert.match(help, /operator modules remain authoritative/i);

  const diag = formatDiagnosticsLines(baseHome({
    providers: [{ env_var: 'EXAMPLE_TOKEN', status: 'absent', required_for_policy: true }],
  })).join('\n');
  assert.match(diag, /git_commit: abc1234/);
  assert.match(diag, /EXAMPLE_TOKEN: absent \(required\)/);
  assert.match(diag, /Advanced/);
});

test('theme exposes blocked distinct from danger', () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const theme = resolveShellTheme({ colorEnabled: true });
    assert.equal(theme.blocked, 'magentaBright');
    assert.equal(theme.danger, 'red');
    assert.notEqual(theme.blocked, theme.danger);
    assert.equal(toneColor(theme, 'blocked'), theme.blocked);
    assert.equal(toneColor(theme, 'fail'), theme.danger);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('landingLayoutForViewport: wide / mid / compact thresholds', () => {
  assert.equal(landingLayoutForViewport(120, 36), 'wide');
  assert.equal(landingLayoutForViewport(100, 24), 'wide');
  assert.equal(landingLayoutForViewport(99, 40), 'mid');
  assert.equal(landingLayoutForViewport(80, 24), 'mid');
  assert.equal(landingLayoutForViewport(79, 40), 'compact');
  assert.equal(landingLayoutForViewport(120, 16), 'compact');
  assert.equal(landingLayoutForViewport(50, 16), 'compact');
});

test('wide landing text: guardian + primary + readiness + runs + controls', () => {
  const landing = buildLandingViewModel({
    home: baseHome(),
    runs: { runs: [], result_code: 'RUNS_EMPTY' },
    version: '0.26.0-beta.1',
    columns: 120,
    rows: 36,
  });
  assert.equal(landing.layout, 'wide');
  assert.equal(landing.show_guardian, true);
  assert.ok(landing.guardian_lines.some((l) => /CERBERUS/.test(l)));
  const lines = formatLandingLines(landing, { selectedNavId: 'launcher' }).join('\n');
  assert.match(lines, /== Guardian ==/);
  assert.match(lines, /== Primary ==/);
  assert.match(lines, /AI-MINIONS/);
  assert.match(lines, /> 1\. Start New Run/);
  assert.match(lines, /== System Readiness ==/);
  assert.match(lines, /== Recent Runs ==/);
  assert.match(lines, /== Controls ==/);
  const gIdx = lines.indexOf('== Guardian ==');
  const pIdx = lines.indexOf('== Primary ==');
  const rIdx = lines.indexOf('== System Readiness ==');
  const rrIdx = lines.indexOf('== Recent Runs ==');
  const cIdx = lines.indexOf('== Controls ==');
  assert.ok(gIdx < pIdx && pIdx < rIdx && rIdx < rrIdx && rrIdx < cIdx);
});

test('compact landing drops guardian art before action/state', () => {
  const landing = buildLandingViewModel({
    home: baseHome({ path_status: 'loading', credential_sufficiency: 'unavailable' }),
    runs: { runs: [] },
    columns: 50,
    rows: 16,
    loading: true,
  });
  assert.equal(landing.layout, 'compact');
  assert.equal(landing.show_guardian, false);
  assert.deepEqual(landing.guardian_lines, []);
  const lines = formatLandingLines(landing, { selectedNavId: 'launcher', narrow: true }).join('\n');
  assert.doesNotMatch(lines, /== Guardian ==/);
  assert.match(lines, /> 1\. Start New Run/);
  assert.match(lines, /Overall: Loading/);
  assert.match(lines, /== System Readiness ==/);
});

test('Ink wide/mid/compact + NO_COLOR landing renders', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );

  const wide = buildShellModel(readyShellOptions({ columns: 120, rows: 36 }));
  assert.equal(wide.landingLayout, 'wide');
  const wideOut = renderOperatorTuiShellToString(wide, { columns: 120, rows: 36 });
  assert.match(wideOut, /AI-MINIONS/);
  assert.match(wideOut, /CERBERUS/);
  assert.match(wideOut, /Start New Run/);
  assert.match(wideOut, /System Readiness/);
  assert.match(wideOut, /Recent Runs/);
  assert.match(wideOut, /Navigate|Quit|Help/i);

  const mid = buildShellModel(readyShellOptions({ columns: 80, rows: 24 }));
  assert.equal(mid.landingLayout, 'mid');
  const midOut = renderOperatorTuiShellToString(mid, { columns: 80, rows: 24 });
  assert.match(midOut, /AI-MINIONS/);
  assert.match(midOut, /CERBERUS/);
  assert.match(midOut, /Start New Run/);
  assert.match(midOut, /System Readiness/);
  assert.match(midOut, /Recent Runs/);

  const compact = buildShellModel(readyShellOptions({
    columns: 50,
    rows: 16,
    pathActivation: { status: 'loading' },
    credentials: { credential_sufficiency: 'unavailable', providers: [] },
  }));
  assert.equal(compact.landingLayout, 'compact');
  assert.equal(compact.landing.overall.state, 'loading');
  const compactOut = renderOperatorTuiShellToString(compact, { columns: 50, rows: 16 });
  assert.match(compactOut, /AI-MINIONS/);
  assert.match(compactOut, /Start New Run/);
  assert.match(compactOut, /System Readiness|Overall:/);
  assert.doesNotMatch(compactOut, /CERBERUS/);

  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const noColor = buildShellModel(readyShellOptions({
      columns: 120,
      rows: 36,
      colorEnabled: true,
      runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    }));
    assert.equal(noColor.colorEnabled, false);
    const out = renderOperatorTuiShellToString(noColor, { columns: 120, rows: 36 });
    assert.match(out, /AI-MINIONS/);
    assert.match(out, /›|Start New Run/);
    assert.match(out, /Overall:/);
    assert.match(out, /No runs|empty_state|No runs yet/i);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('Ink landing empty runs and blocked readiness use contract states', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const blocked = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'cloud_preferred' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'insufficient', providers: [] },
    runsPayload: { runs: [], result_code: 'RUNS_EMPTY' },
    contentSurface: 'home',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
  });
  assert.equal(blocked.landing.overall.state, 'blocked');
  const out = renderOperatorTuiShellToString(blocked, { columns: 120, rows: 36 });
  assert.match(out, /Overall:/);
  assert.match(out, /Blocked|blocked|insufficient|Settings/i);
  assert.match(out, /Recent Runs/);
  assert.doesNotMatch(out, /run_20250510/);
});