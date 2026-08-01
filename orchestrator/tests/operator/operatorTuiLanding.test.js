'use strict';

/**
 * Task-first landing view-model + shell navigation IA.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  resolveLandingComposition,
  LANDING_SCHEMA,
} = require('../../modules/operator/operator-tui-landing');
const { buildShellModel, formatShellText, resolveShellKeypress } = require('../../modules/operator/operator-tui-shell-model');
const { executeShellAction, resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');
const { resolveShellTheme, toneColor } = require('../../modules/operator/operator-tui-theme');

const LANDING_FIXTURES_DIR = path.join(__dirname, '../fixtures/tui/landing');
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI8 = String.fromCharCode(0x9b);
const ANSI_ESCAPE_PATTERN = `${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[()][AB012]|[=>])|${CSI8}[0-9;?]*[ -/]*[@-~]`;
const ANSI_ESCAPE_RE = new RegExp(ANSI_ESCAPE_PATTERN);
// Strip must be global — a non-global replace removes only the first sequence
// and miscounts width on hosts where Ink/chalk emits SGR (color-capable TTY).
const ANSI_ESCAPE_STRIP_RE = new RegExp(ANSI_ESCAPE_PATTERN, 'g');
const ESC_CHAR_RE = new RegExp(ESC);

function readLandingFixture(name) {
  return fs.readFileSync(path.join(LANDING_FIXTURES_DIR, name), 'utf8');
}

/**
 * Display-oriented width without pulling ESM string-width into CJS tests.
 * Landing chrome is ASCII / box-drawing (width 1); surrogate pairs count as one cell here.
 * @param {string} line
 */
function displayWidthApprox(line) {
  let width = 0;
  for (const ch of String(line)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    width += 1;
  }
  return width;
}

function measureLandingViewport(text, columns, rows) {
  const raw = String(text);
  const plain = raw.replace(ANSI_ESCAPE_STRIP_RE, '');
  const lines = plain.replace(/\s+$/, '').split('\n');
  const max_display_width = lines.reduce((m, l) => Math.max(m, displayWidthApprox(l)), 0);
  return {
    rendered_lines: lines.length,
    max_display_width,
    has_ansi: ANSI_ESCAPE_RE.test(raw),
    has_start_new_run: /Start New Run/.test(plain),
    has_overall: /Overall:/.test(plain),
    fits:
      lines.length <= rows
      && max_display_width <= columns
      && /Start New Run/.test(plain)
      && /Overall:/.test(plain),
  };
}

function assertLandingFitsViewport(text, columns, rows, label) {
  const m = measureLandingViewport(text, columns, rows);
  assert.ok(
    m.rendered_lines <= rows,
    `${label}: rendered_lines ${m.rendered_lines} > viewport_rows ${rows}`,
  );
  assert.ok(
    m.max_display_width <= columns,
    `${label}: max_display_width ${m.max_display_width} > viewport_columns ${columns}`,
  );
  assert.equal(m.has_start_new_run, true, `${label}: Start New Run must be visible`);
  assert.equal(m.has_overall, true, `${label}: Overall: must be visible`);
  return m;
}

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
    // Match capture fixtures: portable unicode (runtime default remains nerd).
    icons: 'unicode',
    truecolor: false,
    // Geometry/content contracts are color-independent: pin color off so the
    // render cannot inherit ambient terminal capabilities (chalk level) from
    // the host running the tests — fixtures and regexes expect plain text.
    colorEnabled: false,
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
    columns: 120,
    rows: 36,
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
    columns: 120,
    rows: 40,
  });
  assert.equal(landing.activity.state, 'active');
  assert.equal(landing.recent_runs_total, 4);
  assert.ok(landing.recent_runs.length >= 1);
  assert.equal(landing.recent_runs[0].activity_state, 'active');
  if (landing.composition.recent_runs_limit >= 4) {
    assert.equal(landing.recent_runs.length, 4);
    assert.equal(landing.recent_runs[1].activity_state, 'blocked');
    assert.equal(landing.recent_runs[2].activity_state, 'failed');
    assert.equal(landing.recent_runs[3].activity_state, 'completed');
    assert.equal(landing.recent_runs[3].summary, 'Sudoku fixture');
  }
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
      rows: 48,
      colorEnabled: true,
    });
    assert.equal(model.layout, 'narrow');
    assert.equal(model.landingLayout, 'compact');
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

test('home / help / diagnostics / config actions switch surfaces without readline', async () => {
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
  const {
    isInkLocalShellAction,
    contentSurfaceForLocalAction,
  } = require('../../modules/operator/operator-tui-shell-model');
  assert.equal(isInkLocalShellAction('config'), true);
  assert.equal(isInkLocalShellAction('settings'), true);
  assert.equal(contentSurfaceForLocalAction('config'), 'config');
});

test('help and diagnostics formatters expose remediation without inventing truth', () => {
  const helpList = formatHelpLines().join('\n');
  assert.match(helpList, /Topics \(in-process/);
  assert.match(helpList, /Help overview · Navigation/);
  assert.match(helpList, /Overview \(o\)/);
  assert.match(helpList, /Monitor \(m\)/);
  assert.match(helpList, /Evidence \(e\)/);
  assert.match(helpList, /Explain \(x\)/);

  const helpNav = formatHelpLines({ openTopicId: 'navigation' }).join('\n');
  assert.match(helpNav, /New Run \(1\)/);
  assert.match(helpNav, /System Status \(3\)/);
  assert.match(helpNav, /Settings \(4\)/);
  assert.match(helpNav, /Help \(5 \/ \?\)/);

  const helpOverview = formatHelpLines({ openTopicId: 'overview' }).join('\n');
  assert.match(helpOverview, /Overview \(hotkey o\)/);

  const helpMonitor = formatHelpLines({ openTopicId: 'monitor' }).join('\n');
  assert.match(helpMonitor, /Monitor \(hotkey m\)/);

  const helpEvidence = formatHelpLines({ openTopicId: 'evidence' }).join('\n');
  assert.match(helpEvidence, /Evidence \(hotkey e\)/);
  assert.match(helpEvidence, /never Settings/);

  const helpExplain = formatHelpLines({ openTopicId: 'explain' }).join('\n');
  assert.match(helpExplain, /Explain \(hotkey x\)/);

  const helpKeys = formatHelpLines({ openTopicId: 'keys' }).join('\n');
  assert.match(helpKeys, /AI_MINIONS_TUI_LEGACY=1/);

  const helpLimits = formatHelpLines({ openTopicId: 'limits' }).join('\n');
  assert.match(helpLimits, /operator modules remain authoritative/i);

  const diag = formatDiagnosticsLines(baseHome({
    providers: [{ env_var: 'EXAMPLE_TOKEN', status: 'absent', required_for_policy: true }],
  })).join('\n');
  assert.match(diag, /git_commit: abc1234/);
  assert.match(diag, /EXAMPLE_TOKEN: absent \(required\)/);
  assert.match(diag, /Advanced/);
});

test('helpTopics catalog lists Overview/Monitor/Evidence/Explain and digits open each', () => {
  const {
    helpTopics,
    resolveShellKeypress,
    openHelpTopic,
    moveHelpTopicSelection,
    buildShellModel,
  } = require('../../modules/operator/operator-tui-shell-model');
  const topics = helpTopics();
  const ids = topics.map((t) => t.id);
  assert.deepEqual(ids, [
    'navigation',
    'overview',
    'monitor',
    'evidence',
    'explain',
    'keys',
    'display',
    'limits',
  ]);
  assert.equal(topics.length, 8);
  assert.equal(topics.every((t) => /^\d+$/.test(t.key)), true);

  let model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: { ok: true, json: { runs: [] } },
    contentSurface: 'help',
    selectedNavId: 'help',
  });
  for (const topic of topics) {
    const intent = resolveShellKeypress(topic.key, {}, model);
    assert.equal(intent.type, 'help_open', `digit ${topic.key} → ${topic.id}`);
    assert.equal(intent.topicId, topic.id);
    model = openHelpTopic(model, topic.id);
    assert.equal(model.helpOpenTopicId, topic.id);
    model = buildShellModel({
      ...require('../../modules/operator/operator-tui-shell-model').shellModelToOptions(model),
      helpOpenTopicId: null,
    });
  }
  // Arrow walk reaches every topic from the first.
  model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: { ok: true, json: { runs: [] } },
    contentSurface: 'help',
    selectedNavId: 'help',
    helpSelectedTopicId: topics[0].id,
  });
  const seen = new Set([model.helpSelectedTopicId]);
  for (let i = 0; i < topics.length - 1; i += 1) {
    model = moveHelpTopicSelection(model, 'next');
    seen.add(model.helpSelectedTopicId);
  }
  assert.equal(seen.size, topics.length, '↑/↓ visits every help topic');
});

test('theme exposes blocked distinct from danger (hex palette)', () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const theme = resolveShellTheme({ colorEnabled: true, truecolor: false });
    assert.equal(theme.blocked, '#D27BEA');
    assert.equal(theme.danger, '#F07178');
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

test('resolveLandingComposition: fits row budget; keeps Start New Run + Overall', () => {
  // Mid estimate without art height uses compact lock default (9 rows).
  const mid = resolveLandingComposition(80, 24, { guardianArtRows: 9, sectionIconRows: 2 });
  assert.equal(mid.layout, 'mid');
  assert.equal(mid.composition.show_primary_cta, true);
  assert.equal(mid.composition.show_readiness, true);
  assert.ok(mid.estimated_rows <= 24);
  // Lock v2: keep compact guardian at ≥80×24; recent may drop first.
  assert.equal(mid.composition.show_guardian, true);
  assert.ok(mid.composition.drops.includes('hide_recent'));
  assert.ok(!mid.composition.drops.includes('hide_guardian'));

  const compact = resolveLandingComposition(50, 16);
  assert.equal(compact.layout, 'compact');
  assert.equal(compact.composition.show_primary_cta, true);
  assert.equal(compact.composition.show_readiness, true);
  assert.ok(compact.estimated_rows <= 16);
  assert.equal(compact.composition.show_guardian, false);
});

test('buildLandingViewModel: non-empty runs never apply recent_empty_short; mid may hide recent', () => {
  const runs = Array.from({ length: 5 }, (_, i) => ({
    run_id: `r${i + 1}`,
    goal_summary: `goal ${i + 1}`,
    status: 'completed',
    outcome: 'success',
  }));
  const mid = buildLandingViewModel({
    home: baseHome(),
    runs: { runs, result_code: 'OK' },
    columns: 80,
    rows: 24,
    icons: 'unicode',
    art: 'arcade',
    guardianStyle: 'neon',
  });
  assert.equal(mid.composition.recent_empty_short, false);
  assert.ok(!mid.composition.drops.includes('recent_empty_short'));
  assert.equal(mid.composition.show_primary_cta, true);
  assert.equal(mid.composition.show_readiness, true);
  assert.equal(mid.composition.show_guardian, true);
  assert.ok(
    mid.composition.drops.includes('hide_recent')
      || mid.composition.recent_runs_limit <= 1
      || mid.estimated_rows <= 24,
  );
  assert.ok(mid.estimated_rows <= 24);

  const empty = buildLandingViewModel({
    home: baseHome(),
    runs: { runs: [], result_code: 'RUNS_EMPTY' },
    columns: 80,
    rows: 24,
    icons: 'unicode',
    art: 'arcade',
  });
  assert.equal(empty.composition.recent_empty_short, true);
});

test('typical ≥80×24 Semantic keeps full Quick Start + System Readiness', () => {
  const runs = Array.from({ length: 5 }, (_, i) => ({
    run_id: `r${i + 1}`,
    goal_summary: `goal ${i + 1}`,
    status: 'completed',
    outcome: 'success',
  }));
  for (const [columns, rows] of [[120, 36], [80, 24]]) {
    const landing = buildLandingViewModel({
      home: baseHome(),
      runs: { runs, result_code: 'OK' },
      columns,
      rows,
      icons: 'unicode',
      art: 'arcade',
      // default guardian = semantic
    });
    const id = `${columns}x${rows}`;
    assert.equal(landing.guardian_style, 'semantic', id);
    assert.equal(landing.composition.show_primary_cta, true, id);
    assert.equal(landing.composition.show_readiness, true, id);
    assert.equal(landing.composition.show_readiness_details, true, id);
    assert.equal(landing.composition.show_readiness_next, true, id);
    assert.equal(landing.composition.show_quick_start, true, id);
    assert.equal(landing.composition.quick_start_limit, 5, id);
    assert.equal(landing.composition.show_quick_start_hint, true, id);
    assert.ok(landing.quick_start.length >= 5, `${id}: full QS actions`);
    assert.ok(landing.readiness_rows.length >= 4, `${id}: readiness detail rows`);
    assert.ok(
      !landing.composition.drops.includes('quick_start_primary_only'),
      `${id}: must not cut QS on typical viewport`,
    );
    assert.ok(
      !landing.composition.drops.includes('hide_readiness_details'),
      `${id}: must not strip readiness details on typical viewport`,
    );
    assert.ok(landing.estimated_rows <= rows, `${id}: estimated ${landing.estimated_rows}`);
    if (columns >= 120) {
      assert.ok(
        landing.guardian_rows.length >= 8
          || landing.guardian_lines.some((l) => /VALIDATE/.test(l)),
        `${id}: prefer compact lock art at 120×36`,
      );
    } else {
      assert.ok(landing.guardian_rows.length > 0, `${id}: guardian stays visible`);
    }
  }
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
  assert.ok(landing.guardian_lines.some((l) => /VALIDATE|CERBERUS/.test(l)));
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

test('Ink wide/mid/compact landing fits viewport and matches fixtures', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { measureLandingRender, normalizeLandingSnapshot } = await import(
    '../../scripts/lib/tui-landing-render-metrics.mjs'
  );

  const cases = [
    {
      id: 'ready_120x36',
      columns: 120,
      rows: 36,
      fixture: 'ready-120x36.txt',
      layout: 'wide',
      options: readyShellOptions({ columns: 120, rows: 36 }),
      expectMatch: [/AI-MINIONS/, /VALIDATE|CERBERUS/, /Start New Run/, /Overall:/, /Recent Runs/],
      expectNot: [],
    },
    {
      id: 'ready_80x24',
      columns: 80,
      rows: 24,
      fixture: 'ready-80x24.txt',
      layout: 'mid',
      options: readyShellOptions({ columns: 80, rows: 24 }),
      // Mid may demote to minimal guardian (V/T/E) to keep full Quick Start + readiness.
      expectMatch: [
        /AI-MINIONS/,
        /VALIDATE|CERBERUS|V\/T\/E/,
        /Start New Run/,
        /Browse Runs/,
        /Overall:/,
        /System Readiness/,
        /Model Policy/,
      ],
      expectNot: [],
    },
    {
      id: 'ready_50x16',
      columns: 50,
      rows: 16,
      fixture: 'ready-50x16.txt',
      layout: 'compact',
      options: readyShellOptions({ columns: 50, rows: 16 }),
      expectMatch: [/AI-MINIONS/, /Start New Run/, /Overall:/],
      expectNot: [/VALIDATE|CERBERUS/],
    },
    // Runtime default icons=nerd (unicode fixtures stay portable for review).
    {
      id: 'ready_nerd_120x36',
      columns: 120,
      rows: 36,
      fixture: 'ready-nerd-120x36.txt',
      layout: 'wide',
      options: readyShellOptions({ columns: 120, rows: 36, icons: 'nerd' }),
      expectMatch: [/AI-MINIONS/, /VALIDATE|CERBERUS/, /Start New Run/, /Overall:/, /Recent Runs/],
      expectNot: [],
    },
    {
      id: 'ready_nerd_80x24',
      columns: 80,
      rows: 24,
      fixture: 'ready-nerd-80x24.txt',
      layout: 'mid',
      options: readyShellOptions({ columns: 80, rows: 24, icons: 'nerd' }),
      expectMatch: [
        /AI-MINIONS/,
        /VALIDATE|CERBERUS|V\/T\/E/,
        /Start New Run/,
        /Browse Runs/,
        /Overall:/,
        /System Readiness/,
        /Model Policy/,
      ],
      expectNot: [],
    },
  ];

  for (const c of cases) {
    const model = buildShellModel(c.options);
    assert.equal(model.landingLayout, c.layout, c.id);
    if (c.id.startsWith('ready_nerd_')) {
      assert.equal(model.iconMode, 'nerd', `${c.id}: iconMode`);
    }
    const out = renderOperatorTuiShellToString(model, {
      columns: c.columns,
      rows: c.rows,
    });
    const m = measureLandingRender(out, { columns: c.columns, rows: c.rows });
    assert.ok(
      m.rendered_lines <= c.rows,
      `${c.id}: rendered_lines ${m.rendered_lines} > ${c.rows}`,
    );
    assert.ok(
      m.max_display_width <= c.columns,
      `${c.id}: max_display_width ${m.max_display_width} > ${c.columns}`,
    );
    assert.equal(m.has_start_new_run, true, `${c.id}: Start New Run`);
    assert.equal(m.has_overall, true, `${c.id}: Overall:`);
    assert.equal(m.fits_viewport, true, `${c.id}: fits_viewport`);
    for (const re of c.expectMatch) assert.match(out, re, c.id);
    for (const re of c.expectNot) assert.doesNotMatch(out, re, c.id);
    assert.equal(
      normalizeLandingSnapshot(out),
      readLandingFixture(c.fixture),
      `${c.id}: fixture drift — regenerate with node scripts/capture-tui-landing-fixtures.mjs`,
    );
  }

  const metrics = JSON.parse(readLandingFixture('metrics.json'));
  assert.equal(metrics.meta.method, 'ink.renderToString');
  assert.equal(metrics.meta.ink_version, '7.1.1');
  for (const id of [
    'ready_120x36',
    'ready_80x24',
    'ready_50x16',
    'ready_nerd_120x36',
    'ready_nerd_80x24',
  ]) {
    assert.equal(metrics.cases[id].fits_viewport, true, id);
  }
});

test('NO_COLOR landing output contains no ANSI escape sequences', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { measureLandingRender, normalizeLandingSnapshot, hasAnsiEscape } = await import(
    '../../scripts/lib/tui-landing-render-metrics.mjs'
  );

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
    const m = measureLandingRender(out, { columns: 120, rows: 36 });
    assert.equal(m.has_ansi, false, 'NO_COLOR must not emit ANSI');
    assert.equal(hasAnsiEscape(out), false);
    assert.doesNotMatch(out, ESC_CHAR_RE);
    assert.ok(m.rendered_lines <= 36);
    assert.ok(m.max_display_width <= 120);
    assert.match(out, /AI-MINIONS/);
    assert.match(out, /›|Start New Run/);
    assert.match(out, /Overall:/);
    assert.match(out, /No runs|empty_state|No runs yet/i);
    assert.equal(
      normalizeLandingSnapshot(out),
      readLandingFixture('nocolor-120x36.txt'),
      'nocolor fixture drift — regenerate with capture-tui-landing-fixtures.mjs',
    );
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('Ink landing empty runs and blocked readiness use contract states', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { measureLandingRender, normalizeLandingSnapshot } = await import(
    '../../scripts/lib/tui-landing-render-metrics.mjs'
  );
  const blocked = buildShellModel(readyShellOptions({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'cloud_preferred' },
    credentials: { credential_sufficiency: 'insufficient', providers: [] },
    columns: 120,
    rows: 36,
  }));
  assert.equal(blocked.landing.overall.state, 'blocked');
  const out = renderOperatorTuiShellToString(blocked, { columns: 120, rows: 36 });
  const m = measureLandingRender(out, { columns: 120, rows: 36 });
  assert.equal(m.fits_viewport, true);
  assert.match(out, /Overall:/);
  assert.match(out, /Blocked|blocked|insufficient|Settings/i);
  assert.match(out, /Recent Runs/);
  assert.doesNotMatch(out, /run_20250510/);
  assert.equal(
    normalizeLandingSnapshot(out),
    readLandingFixture('blocked-120x36.txt'),
    'blocked fixture drift — regenerate with capture-tui-landing-fixtures.mjs',
  );

  const loading = buildShellModel(readyShellOptions({
    columns: 50,
    rows: 16,
    pathActivation: { status: 'loading' },
    credentials: { credential_sufficiency: 'unavailable', providers: [] },
  }));
  assert.equal(loading.landing.overall.state, 'loading');
  const loadingOut = renderOperatorTuiShellToString(loading, { columns: 50, rows: 16 });
  assertLandingFitsViewport(loadingOut, 50, 16, 'loading_50x16');
  assert.equal(
    normalizeLandingSnapshot(loadingOut),
    readLandingFixture('loading-50x16.txt'),
    'loading fixture drift — regenerate with capture-tui-landing-fixtures.mjs',
  );
});
