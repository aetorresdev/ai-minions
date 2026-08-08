'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  ADAPTER_SCHEMA,
  provenanceField,
  adaptRunsList,
  adaptSelectedRunStatus,
  adaptEvidenceAttachState,
  adaptConfigReadiness,
  adaptActionResult,
  adaptLifecycleSummary,
  adaptHomeReadiness,
  formatProvenanceField,
} = require('../../modules/operator/operator-tui-adapters');
const {
  SHELL_SCHEMA,
  buildShellModel,
  moveNavSelection,
  moveRunSelection,
  cycleFocus,
  layoutModeForColumns,
  formatShellText,
  resolveNavHotkey,
  resolveShellKeypress,
  isShellSessionEndAction,
  shellModelToOptions,
  isInkLocalShellAction,
  contentSurfaceForLocalAction,
  } = require('../../modules/operator/operator-tui-shell-model');
const {
  createTerminalGuard,
  withTerminalGuard,
  prepareNestedPaneIo,
  prepareInkRemount,
  drainStdin,
  drainStdinColdStart,
  COLD_START_DRAIN_SAFETY_MAX,
  RESTORE_SEQUENCE,
  SOFT_HANDOFF_SEQUENCE,
  CLEAR_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');
const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
  resolveColdStartShellSurface,
} = require('../../modules/operator/operator-tui-shell-entry');
const {
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('../../modules/operator/operator-tui-native-workflows');
const { resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');
const {
  seedConfigModelFromShell,
  seedStatusResultFromSelectedRun,
  focusTargetsForModel,
} = require('../../modules/operator/operator-tui-shell-model');

const ORCH_ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ORCH_ROOT, 'ai-minions-cli.js');

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

function canonicalRunsResult(runs, extras = {}) {
  const result_code = extras.result_code ?? (runs.length ? 'RUNS_FOUND' : 'RUNS_EMPTY');
  const next_safe_action = extras.next_safe_action ?? 'none';
  return {
    ok: true,
    exitCode: 0,
    result_code,
    next_safe_action,
    json: { result_code, runs, next_safe_action },
  };
}

test('adapters preserve absent vs zero vs unavailable vs unlimited', () => {
  const absent = provenanceField(undefined);
  const zero = provenanceField(0);
  const unavailable = provenanceField('unavailable');
  const unlimited = provenanceField('unlimited');
  const notConfigured = provenanceField('not_configured');
  assert.equal(absent.availability, 'absent');
  assert.equal(zero.availability, 'available');
  assert.equal(zero.value, 0);
  assert.equal(unavailable.availability, 'unavailable');
  assert.equal(unlimited.availability, 'unlimited');
  assert.equal(notConfigured.availability, 'not_configured');
  assert.notEqual(formatProvenanceField(absent), formatProvenanceField(zero));
  assert.notEqual(formatProvenanceField(unavailable), '0');
});

test('lifecycle adapter fixtures: active, blocked, exhausted, unavailable-budget, zero-cost', () => {
  const active = adaptLifecycleSummary({
    current_iteration: 2,
    max_iterations: 5,
    current_phase: 'DEV',
    latest_verdict: null,
    measured_cost: 0,
    configured_budget: 'unlimited',
  });
  assert.equal(active.schema, ADAPTER_SCHEMA);
  assert.equal(active.current_iteration.value, 2);
  assert.equal(active.measured_cost.value, 0);
  assert.equal(active.measured_cost.availability, 'available');
  assert.equal(active.configured_budget.availability, 'unlimited');
  assert.equal(active.latest_blocker.availability, 'absent');

  const blocked = adaptLifecycleSummary({
    current_iteration: 1,
    max_iterations: 3,
    blocking_reason_code: 'GATE_BLOCKED',
    human_action_required: true,
  });
  assert.equal(blocked.latest_blocker.value, 'GATE_BLOCKED');
  assert.equal(blocked.human_action_required.value, true);

  const exhausted = adaptLifecycleSummary({
    current_iteration: 3,
    max_iterations: 3,
    terminal_stop_reason: 'max_iterations',
  });
  assert.equal(exhausted.terminal_stop_reason.value, 'max_iterations');

  const unavailableBudget = adaptLifecycleSummary({
    cost_token_run_summary: {
      run: { estimated_cost_usd: null, cost_status: 'unavailable' },
    },
  });
  assert.equal(unavailableBudget.measured_cost.availability, 'unavailable');

  const zeroCost = adaptLifecycleSummary({
    cost_token_run_summary: {
      run: { estimated_cost_usd: 0, cost_status: 'known' },
    },
  });
  assert.equal(zeroCost.measured_cost.value, 0);
  assert.equal(zeroCost.measured_cost.availability, 'available');
});

test('lifecycle latest_verdict stays absent when only outcome is present', () => {
  const adapted = adaptLifecycleSummary({
    operator_trace_summary: {
      outcome: 'success',
    },
  });
  assert.equal(adapted.latest_verdict.availability, 'absent');
  assert.equal(adapted.latest_verdict.value, null);

  const withVerdict = adaptLifecycleSummary({
    operator_trace_summary: {
      outcome: 'success',
      verdict: 'pass',
    },
  });
  assert.equal(withVerdict.latest_verdict.availability, 'available');
  assert.equal(withVerdict.latest_verdict.value, 'pass');
});

test('home / runs / status / evidence / config / action adapters are framework-neutral', () => {
  const home = adaptHomeReadiness({
    aboutInfo: { version: '0.26.0-beta.1', git_commit: 'abc', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
  });
  assert.equal(home.kind, 'home_readiness');
  const runs = adaptRunsList(canonicalRunsResult([
    { run_id: 'r1', status: 'complete', outcome: 'success', result_code: 'RUN_FOUND' },
  ]));
  assert.equal(runs.runs[0].run_id, 'r1');
  const status = adaptSelectedRunStatus({
    result_code: 'RUN_FOUND',
    json: {
      run_id: 'r1',
      status: 'complete',
      operator_trace_summary: { outcome: 'success', next_safe_action: 'none' },
      run_state_visibility: { blocking_reason_code: null },
    },
  });
  assert.equal(status.run_id, 'r1');
  const evidence = adaptEvidenceAttachState({
    run_id: 'r1',
    result_code: 'OK',
    attach_available: false,
    attach_bundle_available: false,
    attach_action_available: true,
    reason_code: null,
    next_safe_action: 'attach',
  });
  assert.equal(evidence.attach_available, false);
  assert.equal(evidence.attach_action_available, true);
  const config = adaptConfigReadiness({
    path_status: 'ready',
    model_policy: 'local_only',
    doctor_ok: true,
    credential_sufficiency: 'not_required',
    next_safe_action: 'smoke',
    remediations: ['Run smoke'],
  });
  assert.equal(config.doctor_ok, true);
  const action = adaptActionResult({
    action_id: 'runs',
    ok: true,
    exitCode: 0,
    reason_code: 'RUNS_FOUND',
  });
  assert.equal(action.reason_code, 'RUNS_FOUND');
});

test('shell model chrome + nav + resize', () => {
  let model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: canonicalRunsResult([
      { run_id: 'a', status: 'running' },
      { run_id: 'b', status: 'complete' },
    ]),
    columns: 120,
    rows: 36,
  });
  assert.equal(model.schema, SHELL_SCHEMA);
  assert.equal(model.layout, 'wide');
  assert.equal(layoutModeForColumns(40), 'narrow');
  model = moveNavSelection(model, 'next');
  assert.ok(model.selectedNavId);
  assert.equal(model.landing.composition.show_recent_runs, true);
  model = moveRunSelection(model, 'next');
  assert.equal(model.selectedRunId, 'b');
  model = cycleFocus(model);
  assert.equal(model.focus, 'content');
  const { shellModelToOptions } = require('../../modules/operator/operator-tui-shell-model');
  const narrow = buildShellModel({ ...shellModelToOptions(model), columns: 50 });
  assert.equal(narrow.layout, 'narrow');
  assert.match(formatShellText(model), /ai-minions/);
  assert.match(formatShellText(model), /operator modules remain authoritative/i);
  assert.match(model.footerHints, /Navigate|Quit|Help|↑/i);
  assert.match(model.disclaimer, /mouse/i);
  assert.equal(resolveNavHotkey('1', model.navItems), 'launcher');
  assert.equal(resolveNavHotkey('h', model.navItems), 'home');
  assert.equal(resolveNavHotkey('3', model.navItems), 'diagnostics');
  assert.equal(resolveNavHotkey('j', model.navItems), null);
});

test('hotkey matrix: labeled keys dispatch panes; only q ends session', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: canonicalRunsResult([{ run_id: 'r1', status: 'running' }]),
    focus: 'nav',
    selectedNavId: 'launcher',
    selectedRunId: 'r1',
  });
  const expected = [
    ['1', 'launcher'],
    ['2', 'runs'],
    ['3', 'diagnostics'],
    ['4', 'config'],
    ['5', 'help'],
    ['h', 'home'],
    ['o', 'status'],
    ['e', 'evidence'],
    ['m', 'monitor'],
    ['x', 'explain'],
  ];
  for (const [key, actionId] of expected) {
    const intent = resolveShellKeypress(key, {}, model);
    assert.equal(intent.type, 'dispatch', `key ${key} type`);
    assert.equal(intent.actionId, actionId, `key ${key} action`);
    assert.equal(intent.endsSession, false, `key ${key} must not end session`);
    assert.equal(isShellSessionEndAction(intent.actionId), false);
  }
  const quitIntent = resolveShellKeypress('q', {}, model);
  assert.equal(quitIntent.type, 'quit');
  assert.equal(quitIntent.actionId, 'quit');
  assert.equal(quitIntent.endsSession, true);
  assert.equal(isShellSessionEndAction('quit'), true);
  assert.equal(isShellSessionEndAction('1'), false);
  assert.equal(isShellSessionEndAction('launcher'), false);

  // Unlabeled digits / letters must not quit or dispatch.
  for (const key of ['0', '6', '7', '8', '9', 's', 'z']) {
    const intent = resolveShellKeypress(key, {}, model);
    assert.equal(intent.endsSession, false, `key ${key}`);
    assert.notEqual(intent.type, 'quit', `key ${key}`);
    assert.notEqual(intent.type, 'dispatch', `key ${key}`);
  }

  // Enter on highlighted launcher → dispatch launcher (not quit).
  const enterLauncher = resolveShellKeypress('', { return: true }, {
    ...model,
    focus: 'nav',
    selectedNavId: 'launcher',
  });
  assert.equal(enterLauncher.type, 'dispatch');
  assert.equal(enterLauncher.actionId, 'launcher');
  assert.equal(enterLauncher.endsSession, false);

  // Terminals that emit \n (Ink name "enter") must also dispatch — not ignore/quit.
  const enterNewline = resolveShellKeypress('\n', {}, {
    ...model,
    focus: 'nav',
    selectedNavId: 'launcher',
  });
  assert.equal(enterNewline.type, 'dispatch');
  assert.equal(enterNewline.actionId, 'launcher');
  assert.equal(enterNewline.endsSession, false);

  // Enter on highlighted quit → intentional quit.
  const enterQuit = resolveShellKeypress('', { return: true }, {
    ...model,
    focus: 'nav',
    selectedNavId: 'quit',
  });
  assert.equal(enterQuit.type, 'quit');
  assert.equal(enterQuit.endsSession, true);

  // Ctrl+C abort.
  const abort = resolveShellKeypress('c', { ctrl: true }, model);
  assert.equal(abort.type, 'abort');
  assert.equal(abort.endsSession, true);
});

test('key 1 and Enter open native launcher workflow (no nested executeAction), never silent quit', async () => {
  // Keys typed before the first interactive mount are cold-start noise and get
  // drained by design — wait for the first stdout paint (mount evidence) before
  // writing, otherwise the hotkey races the renderer import window.
  function waitForFirstPaint(stdout, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stdout.off('data', onData);
        reject(new Error('shell did not paint within timeout'));
      }, timeoutMs);
      const onData = () => {
        clearTimeout(timer);
        stdout.off('data', onData);
        resolve();
      };
      stdout.on('data', onData);
    });
  }
  async function runWithKey(writeKey) {
    const actions = [];
    const { stdin, stdout } = createFakeTtyStreams();
    const painted = waitForFirstPaint(stdout);
    const promise = runOperatorTuiShell({
      isTTY: true,
      stdin,
      stdout,
      maxLoops: 2,
      loadRuns: () => canonicalRunsResult([]),
      buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
      assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
      assessPath: () => ({ status: 'ready', on_path: true }),
      importRenderer: async () => {
        // CI=true makes Ink default to non-interactive (frames written only on
        // unmount), so the first-paint signal would never fire. Force interactive
        // for this mount only — production keeps Ink's CI/TTY auto-detection.
        const mod = await import('../../modules/operator/operator-tui-shell-render.mjs');
        return {
          renderOperatorTuiShell: (opts) => mod.renderOperatorTuiShell({ ...opts, interactive: true }),
        };
      },
      executeAction: async (opts) => {
        actions.push(opts.actionId);
        return {
          quit: false,
          selectedRunId: null,
          contentSurface: 'action_result',
          actionResult: {
            action_id: opts.actionId,
            ok: true,
            exit_code: 0,
            reason_code: 'OK',
            text: 'ok',
          },
        };
      },
    });
    await painted;
    stdin.write(writeKey);
    await new Promise((r) => setTimeout(r, 80));
    stdin.write('q');
    const result = await promise;
    stdin.destroy();
    stdout.destroy();
    return { result, actions };
  }

  const byDigit = await runWithKey('1');
  assert.deepEqual(byDigit.actions, [], 'Phase-1 launcher stays in Ink — no nested executeAction');
  assert.equal(byDigit.result.model?.activeWorkflow?.kind, 'launcher');
  assert.equal(byDigit.result.model?.contentSurface, 'launcher_workflow');
  assert.notEqual(byDigit.result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(byDigit.result.reason_code, TUI_SHELL_REASON.QUIT);

  const byEnter = await runWithKey('\r');
  assert.deepEqual(byEnter.actions, []);
  assert.equal(byEnter.result.model?.activeWorkflow?.kind, 'launcher');
  assert.equal(byEnter.result.reason_code, TUI_SHELL_REASON.QUIT);
});

test('digit hotkeys never take quit path; q still quits without running panes', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 3,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 100));
  stdin.write('2'); // runs → native run browser (no executeAction)
  await new Promise((r) => setTimeout(r, 80));
  stdin.write('\u001b'); // Esc cancels native workflow back to shell
  await new Promise((r) => setTimeout(r, 80));
  stdin.write('4'); // settings / config → Ink-local (no executeAction)
  await new Promise((r) => setTimeout(r, 80));
  stdin.write('q'); // quit — must not call executeAction('quit') after early session-end
  const result = await promise;
  assert.deepEqual(actions, [], 'digits stay Ink-local/native; quit is session-end only');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.equal(result.model?.contentSurface, 'config');
  stdin.destroy();
  stdout.destroy();
});

test('landing interactions stay in session until q (Enter/1/arrows/Esc/help)', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 8,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: opts.actionId === 'launcher' ? 'launcher' : 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
        launcherModel: opts.actionId === 'launcher' ? { can_launch: false } : null,
      };
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  // Arrows must not end the session or dispatch.
  stdin.write('\x1b[A');
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('\x1b[B');
  await new Promise((r) => setTimeout(r, 70));
  // Local surfaces — no executeAction, no session end.
  stdin.write('?');
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('\x1b'); // Esc → home
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('3'); // diagnostics local
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('h'); // home local
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('2'); // runs → native workflow (no executeAction)
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('\x1b'); // Esc cancels workflow → prior surface
  await new Promise((r) => setTimeout(r, 70));
  // Home CTA Enter + digit 1 → native launcher workflow (still no executeAction).
  stdin.write('\r');
  await new Promise((r) => setTimeout(r, 100));
  stdin.write('1');
  await new Promise((r) => setTimeout(r, 100));
  stdin.write('q');
  const result = await promise;
  assert.deepEqual(actions, []);
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  stdin.destroy();
  stdout.destroy();
});

test('Esc and local surfaces never set endsSession; q/Ctrl+C//quit do', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([]),
    contentSurface: 'help',
    selectedNavId: 'help',
  });
  const {
    isInkLocalShellAction,
    contentSurfaceForLocalAction,
    isShellSessionEndAction,
  } = require('../../modules/operator/operator-tui-shell-model');

  assert.equal(isInkLocalShellAction('home'), true);
  assert.equal(isInkLocalShellAction('help'), true);
  assert.equal(isInkLocalShellAction('diagnostics'), true);
  assert.equal(isInkLocalShellAction('config'), true, 'Settings stays Ink-local');
  assert.equal(isInkLocalShellAction('runs'), false, 'runs is native workflow, not contentSurface local');
  assert.equal(isInkLocalShellAction('launcher'), false);
  assert.equal(contentSurfaceForLocalAction('3'), null);
  assert.equal(contentSurfaceForLocalAction('diagnostics'), 'diagnostics');
  assert.equal(contentSurfaceForLocalAction('config'), 'config');

  assert.equal(resolveShellKeypress('', { escape: true }, model).type, 'surface_home');
  assert.equal(resolveShellKeypress('', { escape: true }, model).endsSession, false);
  assert.equal(resolveShellKeypress('?', {}, model).type, 'ignore', 're-? on Help stays mounted');
  assert.equal(resolveShellKeypress('?', {}, model).endsSession, false);
  assert.equal(resolveShellKeypress('2', {}, model).type, 'help_open');
  assert.equal(resolveShellKeypress('2', {}, model).topicId, 'overview');
  assert.equal(resolveShellKeypress('3', {}, model).type, 'help_open');
  assert.equal(resolveShellKeypress('3', {}, model).topicId, 'monitor');
  assert.equal(resolveShellKeypress('3', {}, model).endsSession, false);
  assert.equal(resolveShellKeypress('4', {}, model).type, 'help_open', 'digit 4 on Help is Evidence topic, not Settings');
  assert.equal(resolveShellKeypress('4', {}, model).topicId, 'evidence');
  assert.notEqual(resolveShellKeypress('4', {}, model).actionId, 'config');
  assert.equal(resolveShellKeypress('5', {}, model).type, 'help_open', 'digit 5 opens Explain topic');
  assert.equal(resolveShellKeypress('5', {}, model).topicId, 'explain');
  assert.equal(resolveShellKeypress('8', {}, model).type, 'help_open', 'digit 8 opens limits topic');
  assert.equal(resolveShellKeypress('8', {}, model).topicId, 'limits');
  assert.equal(resolveShellKeypress('', { upArrow: true }, model).type, 'help_move');
  assert.equal(resolveShellKeypress('', { upArrow: true }, model).endsSession, false);
  assert.equal(resolveShellKeypress('', { return: true }, {
    ...model,
    focus: 'nav',
    selectedNavId: 'launcher',
    contentSurface: 'home',
  }).endsSession, false);
  assert.equal(resolveShellKeypress('q', {}, model).endsSession, true);
  assert.equal(resolveShellKeypress('c', { ctrl: true }, model).endsSession, true);

  // Help isolation must win over command-input focus (Tab → prompt).
  const helpInput = { ...model, focus: 'input', commandInput: '4' };
  assert.equal(resolveShellKeypress('4', {}, helpInput).type, 'help_open');
  assert.equal(resolveShellKeypress('4', {}, helpInput).topicId, 'evidence');
  assert.notEqual(resolveShellKeypress('', { return: true }, helpInput).type, 'input_submit');
  assert.equal(resolveShellKeypress('', { return: true }, helpInput).type, 'help_open');
  assert.equal(resolveShellKeypress('q', {}, helpInput).type, 'quit');
  assert.equal(resolveShellKeypress('q', {}, helpInput).endsSession, true);
  assert.equal(resolveShellKeypress('', { escape: true }, helpInput).type, 'surface_home');

  // /quit via Enter remains a session terminator off Help; on Help use q.
  const quitSlashHome = resolveShellKeypress('', { return: true }, {
    ...model,
    contentSurface: 'home',
    focus: 'input',
    commandInput: '/quit',
  });
  assert.equal(quitSlashHome.type, 'quit');
  assert.equal(quitSlashHome.actionId, '/quit');
  assert.equal(quitSlashHome.endsSession, true);
  assert.equal(isShellSessionEndAction('/quit'), true);
  assert.equal(isShellSessionEndAction('quit'), true);
  assert.equal(isShellSessionEndAction('q'), true);
  assert.equal(isShellSessionEndAction('help'), false);
});

test('Help + Tab to input: 4/Enter stay in-process; q quits; executeAction never called', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 4,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  stdin.write('5'); // Help (in-process)
  await new Promise((r) => setTimeout(r, 80));
  // nav → content → input
  stdin.write('\t');
  await new Promise((r) => setTimeout(r, 40));
  stdin.write('\t');
  await new Promise((r) => setTimeout(r, 40));
  stdin.write('4');
  await new Promise((r) => setTimeout(r, 60));
  stdin.write('\r');
  await new Promise((r) => setTimeout(r, 100));
  stdin.write('q');
  const result = await promise;
  stdin.destroy();
  stdout.destroy();

  assert.deepEqual(actions, [], 'Help must never remount via executeAction/requestAction');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  // Stay on Help (topic open or list) — never Settings/config remount surface.
  assert.equal(result.model?.contentSurface, 'help');
  assert.ok(
    result.model?.helpOpenTopicId === 'evidence'
      || result.model?.helpSelectedTopicId === 'evidence'
      || result.model?.helpOpenTopicId == null,
    'digit 4 on Help is Evidence topic, not Settings',
  );
});

test('prepareNestedPaneIo clears screen so nested panes do not overprint Ink', () => {
  const writes = [];
  let resumed = false;
  let rawMode = true;
  const result = prepareNestedPaneIo({
    writeClear: (seq) => writes.push(seq),
    stdin: {
      resume() { resumed = true; },
      setRawMode(mode) { rawMode = Boolean(mode); },
    },
    drain: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.wrote, true);
  assert.ok(writes.includes(SOFT_HANDOFF_SEQUENCE));
  assert.ok(writes.includes(CLEAR_SEQUENCE));
  assert.ok(!writes.includes(RESTORE_SEQUENCE), 'nested pane must not exit alt-screen');
  assert.equal(resumed, true);
  assert.equal(rawMode, false);
});

test('drainStdin strips one dispatch newline but preserves next answer', () => {
  const stdin = new PassThrough();
  stdin.write('\nc\n');
  const n = drainStdin(stdin);
  assert.equal(n, 1);
  assert.equal(String(stdin.read()), 'c\n');
});

test('drainStdin strips CRLF residue and leaves following answer', () => {
  const stdin = new PassThrough();
  stdin.write('\r\nyes\n');
  const n = drainStdin(stdin);
  assert.equal(n, 2);
  assert.equal(String(stdin.read()), 'yes\n');
});

test('drainStdin strips bare CR residue and leaves following answer', () => {
  const stdin = new PassThrough();
  stdin.write('\rc\n');
  const n = drainStdin(stdin);
  assert.equal(n, 1);
  assert.equal(String(stdin.read()), 'c\n');
});

test('drainStdin does not discard a buffered answer without leading newline', () => {
  const stdin = new PassThrough();
  stdin.write('c\n');
  const n = drainStdin(stdin);
  assert.equal(n, 0);
  assert.equal(String(stdin.read()), 'c\n');
});

test('drainStdin never discards a second buffered newline as residue', () => {
  // Fast type-ahead may leave `\n` (dispatch) + `c\n` (answer). Only one residue.
  const stdin = new PassThrough();
  stdin.write('\nc\n');
  assert.equal(drainStdin(stdin), 1);
  assert.equal(drainStdin(stdin), 0, 'second call must not eat answer newline');
  assert.equal(String(stdin.read()), 'c\n');
});

test('prepareNestedPaneIo preserves buffered prompt answer after dispatch Enter', async () => {
  const { createInterface } = require('node:readline');
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  // Residue Enter from dispatch + operator answer already buffered.
  stdin.write('\nc\n');
  const prep = prepareNestedPaneIo({
    stdin,
    stdout,
    writeClear: () => {},
    clear: false,
    banner: null,
  });
  assert.equal(prep.drained, 1);
  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  const answer = await new Promise((resolve) => {
    rl.question('Select: ', (a) => resolve(a));
  });
  rl.close();
  assert.equal(answer, 'c');
});

test('prepareNestedPaneIo preserves answer after bare CR residue', async () => {
  const { createInterface } = require('node:readline');
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.write('\rc\n');
  const prep = prepareNestedPaneIo({
    stdin,
    stdout,
    writeClear: () => {},
    clear: false,
    banner: null,
  });
  assert.equal(prep.drained, 1);
  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  const answer = await new Promise((resolve) => {
    rl.question('Select: ', (a) => resolve(a));
  });
  rl.close();
  assert.equal(answer, 'c');
});

test('shell nested pane receives answer buffered immediately after dispatch Enter', async () => {
  const { createInterface } = require('node:readline');
  const { stdin, stdout } = createFakeTtyStreams();
  const answers = [];
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 2,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction }) => {
        // Settings is Ink-local; use attach (still nested) to prove buffered answer.
        stdin.write('\nc\n');
        onRequestAction('attach');
        return { aborted: false, requestedAction: 'attach' };
      },
    }),
    executeAction: async ({ stdin: actionStdin, stdout: actionStdout }) => {
      const rl = createInterface({
        input: actionStdin,
        output: actionStdout,
        terminal: false,
      });
      const answer = await new Promise((resolve) => {
        rl.question('Select: ', (a) => resolve(a));
      });
      rl.close();
      answers.push(answer);
      return {
        quit: true,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: 'attach',
          ok: true,
          exit_code: 0,
          reason_code: 'ATTACH_OK',
          text: `got:${answer}`,
        },
        evidenceModel: null,
        configModel: null,
        statusResult: null,
        runsPayload: null,
      };
    },
  });
  assert.deepEqual(answers, ['c'], 'nested prompt must receive buffered answer, not hang');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.equal(result.guard.restored, true);
  stdin.destroy();
  stdout.destroy();
});

test('withTerminalGuard success softens; session-end restore emits alt-screen exit once', async () => {
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
  assert.equal(guard.restored, false, 'success path must not full-restore');
  assert.ok(writes.includes(SOFT_HANDOFF_SEQUENCE));
  assert.ok(!writes.includes(RESTORE_SEQUENCE));
  guard.restore('quit');
  assert.equal(guard.restored, true);
  assert.ok(writes.includes(RESTORE_SEQUENCE));
});

test('prepareInkRemount resumes stdin after readline pause', () => {
  let resumed = 0;
  const result = prepareInkRemount({
    stdin: {
      isPaused: () => true,
      resume() { resumed += 1; },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.resumed, true);
  assert.equal(resumed, 1);
});

test('key 1 with leftover Enter opens native launcher (no nested readline)', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 3,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 100));
  // Paste-style "1"+Enter must open native launcher without nested readline.
  stdin.write('1\r');
  await new Promise((r) => setTimeout(r, 120));
  stdin.write('q');
  const result = await promise;
  assert.deepEqual(actions, [], 'native launcher must not dispatch nested executeAction');
  assert.equal(result.model?.activeWorkflow?.kind, 'launcher');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  stdin.destroy();
  stdout.destroy();
});

test('resolveNavHotkey accepts paste bundle 1\\r', () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: canonicalRunsResult([]),
  });
  assert.equal(resolveNavHotkey('1\r', model.navItems), 'launcher');
  assert.equal(resolveShellKeypress('1\r', {}, { ...model, focus: 'nav' }).type, 'dispatch');
  assert.equal(resolveShellKeypress('1\r', {}, { ...model, focus: 'nav' }).actionId, 'launcher');
});

test('non-TTY path does not initialize Ink/React', async () => {
  const result = await runOperatorTuiShell({
    isTTY: false,
    importRenderer: async () => {
      throw new Error('renderer must not load on non-TTY');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, TUI_SHELL_REASON.NON_TTY);
  assert.equal(result.ink_loaded, false);
  assert.equal(result.react_loaded, false);
  assert.match(result.text, /requires a TTY/i);
  assert.match(result.text, /ai-minions smoke/);
});

test('terminal guard softens after success; full-restores on exception and harness child inject', async () => {
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
  assert.equal(guard.restored, false);
  assert.equal(stdin.isRaw, false);
  assert.ok(writes.some((w) => w === SOFT_HANDOFF_SEQUENCE));
  guard.restore('normal');
  assert.equal(guard.restored, true);
  assert.ok(writes.some((w) => w === RESTORE_SEQUENCE));

  const child = await runOperatorTuiShell({
    isTTY: true,
    injectFailure: 'child',
    loadRuns: () => canonicalRunsResult([]),
    importRenderer: async () => ({ renderOperatorTuiShell: async () => ({}) }),
  });
  assert.equal(child.reason_code, TUI_SHELL_REASON.CHILD_FAILURE);
  assert.equal(child.guard.restored, true);
});

test('renderer exception restores terminal', async () => {
  const result = await runOperatorTuiShell({
    isTTY: true,
    injectFailure: 'renderer',
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async () => ({ aborted: false }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, TUI_SHELL_REASON.RENDERER_EXCEPTION);
  assert.equal(result.guard.restored, true);
});

test('skipSplash renderer import failure resolves as renderer exception with guard restored', async () => {
  // No-splash route imports the renderer after discovery (import-before-drain);
  // a rejection there must follow the splash-route contract — result payload,
  // load flags false, guard restored — never an escaping rejection.
  const { stdin, stdout } = createFakeTtyStreams();
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 1,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => {
      throw new Error('simulated renderer import failure');
    },
    executeAction: async () => {
      throw new Error('renderer import failure must not executeAction');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason_code, TUI_SHELL_REASON.RENDERER_EXCEPTION);
  assert.equal(result.ink_loaded, false);
  assert.equal(result.react_loaded, false);
  assert.equal(result.guard.restored, true);
  assert.match(result.error, /simulated renderer import failure/);
  stdin.destroy();
  stdout.destroy();
});

test('interactive render with fake TTY auto-quits and restores', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    autoQuitMs: 50,
    maxLoops: 1,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'live1', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ink_loaded, true);
  assert.equal(result.guard.restored, true);
  assert.match(result.model.title, /ai-minions/);
  stdin.destroy();
  stdout.destroy();
});

test('Ctrl+C abort restores terminal', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 1,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'abort1', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  stdin.write('\u0003');
  const result = await promise;
  assert.equal(result.reason_code, TUI_SHELL_REASON.ABORT);
  assert.equal(result.guard.restored, true);
  assert.equal(stdin.isRaw, false);
  stdin.destroy();
  stdout.destroy();
});

test('non-fatal failed action result soft-remounts; full restore only on quit', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  let renderPasses = 0;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 2,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction }) => {
        renderPasses += 1;
        if (renderPasses === 1) {
          // Nested attach still exercises soft remount on ok:false.
          onRequestAction('attach');
          return { aborted: false, requestedAction: 'attach' };
        }
        onRequestAction('q');
        return { aborted: false, requestedAction: 'q' };
      },
    }),
    executeAction: async ({ actionId }) => {
      if (actionId === 'quit') {
        return {
          quit: true,
          selectedRunId: null,
          contentSurface: 'action_result',
          actionResult: {
            action_id: 'quit',
            ok: true,
            exit_code: 0,
            reason_code: null,
            text: 'quit',
          },
          evidenceModel: null,
          configModel: null,
          statusResult: null,
          runsPayload: null,
        };
      }
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: 'attach',
          ok: false,
          exit_code: 1,
          reason_code: 'ATTACH_FAILED',
          text: 'failed',
        },
        evidenceModel: null,
        configModel: null,
        statusResult: null,
        runsPayload: null,
      };
    },
  });
  const joined = out.join('');
  const restoreCount = joined.split(RESTORE_SEQUENCE).length - 1;
  const softCount = joined.split(SOFT_HANDOFF_SEQUENCE).length - 1;
  assert.equal(renderPasses, 2, 'failed action must remount for a second Ink frame');
  assert.ok(softCount >= 1, 'ok:false uses soft handoff (not session-ending)');
  assert.equal(restoreCount, 1, 'alt-screen exit only once at session end');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  assert.equal(result.guard.restored, true);
  assert.equal(result.model.actionResult?.reason_code, 'ATTACH_FAILED');
  stdin.destroy();
  stdout.destroy();
});

test('caught launch failure (runSmoke throw → ok:false) soft-remounts', async () => {
  const { executeShellAction } = require('../../modules/operator/operator-tui-shell-actions');
  const {
    runOperatorGuidedLauncherPane,
  } = require('../../modules/operator/operator-guided-launcher-pane-tui');
  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  let renderPasses = 0;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 2,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction, onModelChange, model }) => {
        renderPasses += 1;
        if (renderPasses === 1) {
          onModelChange(buildShellModel({
            ...shellModelToOptions(model),
            pendingLauncherSelections: {
              agentFlow: 'single_agent',
              inferenceLane: 'local_only',
              gatePosture: 'degraded',
              goalSource: 'custom',
              goal: 'x',
              confirm: true,
            },
          }));
          onRequestAction(NATIVE_LAUNCHER_EXECUTE_ACTION);
          return { aborted: false, requestedAction: NATIVE_LAUNCHER_EXECUTE_ACTION };
        }
        onRequestAction('q');
        return { aborted: false, requestedAction: 'q' };
      },
    }),
    executeAction: async (opts) => {
      if (opts.actionId === 'quit') {
        return executeShellAction({ ...opts, stdin, stdout });
      }
      return executeShellAction({
        ...opts,
        stdin,
        stdout,
        launcherSelections: opts.launcherSelections,
        runLauncherPane: async (paneOpts) => runOperatorGuidedLauncherPane({
          ...paneOpts,
          selections: paneOpts.selections ?? {
            agentFlow: 'single_agent',
            inferenceLane: 'local_only',
            gatePosture: 'degraded',
            goalSource: 'custom',
            goal: 'x',
            confirm: true,
          },
          env: {},
          localBackendReachable: true,
          runSmokeFn: async () => {
            throw new Error('spawn failed');
          },
        }),
      });
    },
  });
  const joined = out.join('');
  const restoreCount = joined.split(RESTORE_SEQUENCE).length - 1;
  const softCount = joined.split(SOFT_HANDOFF_SEQUENCE).length - 1;
  assert.equal(renderPasses, 2, 'caught launch failure must remount for a second Ink frame');
  assert.ok(softCount >= 1, 'caught launch ok:false uses soft handoff');
  assert.equal(restoreCount, 1, 'alt-screen exit only once at session end');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.CHILD_FAILURE);
  assert.equal(result.guard.restored, true);
  assert.equal(result.model.actionResult?.ok, false);
  assert.equal(result.model.actionResult?.reason_code, 'LAUNCHER_RUN_FAILED');
  stdin.destroy();
  stdout.destroy();
});

test('thrown action exception full-restores terminal', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    maxLoops: 1,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction }) => {
        onRequestAction('attach');
        return { aborted: false, requestedAction: 'attach' };
      },
    }),
    executeAction: async () => {
      throw new Error('boom');
    },
  });
  const joined = out.join('');
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  assert.equal(result.guard.restored, true);
  assert.ok(
    joined.includes(RESTORE_SEQUENCE),
    'thrown exception must emit full alt-screen restore',
  );
  stdin.destroy();
  stdout.destroy();
});

test('action failure returns to shell state with reason_code', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    autoQuitMs: 40,
    maxLoops: 1,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction }) => {
        onRequestAction('attach');
        return { aborted: false, requestedAction: 'attach' };
      },
    }),
    executeAction: async () => ({
      quit: false,
      selectedRunId: null,
      contentSurface: 'action_result',
      actionResult: {
        action_id: 'attach',
        ok: false,
        exit_code: 1,
        reason_code: 'ATTACH_FAILED',
        text: 'failed',
      },
      evidenceModel: null,
      configModel: null,
      statusResult: null,
      runsPayload: null,
    }),
  });
  assert.equal(result.model.actionResult.reason_code, 'ATTACH_FAILED');
  // maxLoops/autoQuit ends the session — restore is session-end, not action-failure.
  assert.equal(result.guard.restored, true);
  assert.equal(result.reason_code, TUI_SHELL_REASON.OK);
  stdin.destroy();
  stdout.destroy();
});

test('Ink renderToString shows shell chrome', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: canonicalRunsResult([
      { run_id: 'shell-run', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    columns: 80,
    rows: 40,
  });
  const out = renderOperatorTuiShellToString(model, { columns: 80 });
  assert.match(out, /AI-MINIONS|ai-minions/i);
  assert.match(out, /shell-run/);
  assert.match(out, /Quick Start|Start New Run/);
  assert.match(out, /System Readiness/);
  assert.match(out, /Overall:/);
  assert.match(out, /Recent Runs/);
});

test('run browser keeps one numbered row per run when notes are long (no wrap mangling)', async () => {
  const { renderOperatorTuiShellToString } = await import(
    '../../modules/operator/operator-tui-shell-render.mjs'
  );
  const { openNativeWorkflow } = require('../../modules/operator/operator-tui-native-workflows.js');
  const { formatRunBrowserWorkflowLines } = require('../../modules/operator/operator-tui-run-browser-workflow.js');
  const model = buildShellModel({
    columns: 80,
    rows: 40,
    skipSplash: true,
    runsPayload: canonicalRunsResult([
      {
        run_id: 'task-5d3cdbc7', status: 'failed', outcome: 'failed', result_code: 'RUN_FOUND',
        reason_code: 'OUTPUT_BUDGET_EXHAUSTED', goal_summary: 'Sudoku HTML generation',
        created_at: '2026-08-01T12:00:00.000Z', last_event_at: '2026-08-01T12:05:00.000Z',
        current_phase: 'dev', action_eligibility: 'unavailable',
      },
      {
        run_id: 'task-aaaa1111', status: 'complete', outcome: 'success', result_code: 'RUN_FOUND',
        goal_summary: 'Solar system demo',
        created_at: '2026-08-01T10:00:00.000Z', last_event_at: '2026-08-01T10:30:00.000Z',
        current_phase: 'done',
      },
      { run_id: 'task-bbbb2222', status: 'blocked', outcome: 'blocked', result_code: 'RUN_FOUND', goal_summary: 'x' },
    ]),
  });
  const workflow = openNativeWorkflow(model, 'runs');
  assert.ok(workflow, 'runs workflow opens');
  // Full workflow text (not viewport-clipped) must keep sequential numbers.
  const full = formatRunBrowserWorkflowLines(workflow).join('\n');
  assert.match(full, /› 1\. task-5d3cdbc7/);
  assert.match(full, / {2}2\. task-aaaa1111/);
  assert.match(full, / {2}3\. task-bbbb2222/);
  assert.match(full, /selected 1\/3 · task-5d3cdbc7/);
  assert.doesNotMatch(full, /\n\s*[4-9]\. /);

  const browserModel = buildShellModel({
    ...shellModelToOptions(model),
    activeWorkflow: workflow,
    contentSurface: 'run_browser',
    focus: 'content',
    selectedNavId: 'runs',
  });
  const out = renderOperatorTuiShellToString(browserModel, { columns: 80, rows: 40 });
  // Tall viewport must still show the first numbered row (no scroll-off of headers).
  assert.match(out, /1\. task-5d3cdbc7/);
  assert.match(out, /2\. task-aaaa1111/);
  assert.match(out, /3\. task-bbbb2222/);
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  for (const line of out.split('\n')) {
    const visible = line.replace(ansiPattern, '');
    assert.ok(
      visible.length <= 80,
      `rendered line exceeds 80 cols (${visible.length}): ${visible}`,
    );
  }
});

test('resolveShellActionToken maps cockpit keys', () => {
  assert.equal(resolveShellActionToken('1'), 'launcher');
  assert.equal(resolveShellActionToken('launcher'), 'launcher');
  assert.equal(resolveShellActionToken('smoke'), 'launcher');
  assert.equal(resolveShellActionToken('s'), 'select');
  assert.equal(resolveShellActionToken('m'), 'monitor');
  assert.equal(resolveShellActionToken('help'), 'help');
  assert.equal(resolveShellActionToken('diagnostics'), 'diagnostics');
  assert.equal(resolveShellActionToken('home'), 'home');
  assert.equal(resolveShellActionToken('q'), 'quit');
  assert.equal(resolveShellActionToken('', 'config'), 'config');
  assert.equal(resolveShellActionToken('nope'), null);
  // Fullscreen task-first digits (not legacy 3=status / 4=attach / 5=config).
  assert.equal(resolveShellActionToken('3'), 'diagnostics');
  assert.equal(resolveShellActionToken('4'), 'config');
  assert.equal(resolveShellActionToken('5'), 'help');
});

test('Overview/Explain/Evidence/Monitor hotkeys stay Ink-local (zero executeAction)', async () => {
  assert.equal(isInkLocalShellAction('status'), true);
  assert.equal(isInkLocalShellAction('explain'), true);
  assert.equal(isInkLocalShellAction('evidence'), true);
  assert.equal(isInkLocalShellAction('monitor'), true);
  assert.equal(contentSurfaceForLocalAction('status'), 'status');
  assert.equal(contentSurfaceForLocalAction('explain'), 'status');
  assert.equal(contentSurfaceForLocalAction('evidence'), 'evidence');
  assert.equal(contentSurfaceForLocalAction('monitor'), 'monitor');
  const {
    isInkLocalRemountFallbackAction,
    deriveRunActionEligibility,
  } = require('../../modules/operator/operator-tui-shell-model');
  assert.equal(isInkLocalRemountFallbackAction('help'), true);
  assert.equal(isInkLocalRemountFallbackAction('diagnostics'), true);
  assert.equal(isInkLocalRemountFallbackAction('status'), false);
  assert.equal(isInkLocalRemountFallbackAction('explain'), false);
  assert.equal(isInkLocalRemountFallbackAction('evidence'), false);
  assert.equal(isInkLocalRemountFallbackAction('monitor'), false);
  assert.equal(deriveRunActionEligibility({ status: 'failed', outcome: 'failed' }), 'inspect');
  assert.equal(deriveRunActionEligibility({ status: 'running' }), 'continue_current');
  assert.equal(deriveRunActionEligibility({ status: 'invalid' }), 'unavailable');

  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  const actions = [];
  let mountCount = 0;
  /** @type {string[]} */
  const surfaces = [];
  const softAt = [];
  const softCount = () => out.join('').split(SOFT_HANDOFF_SEQUENCE).length - 1;
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 8,
    selectedRunId: 'blocked-1',
    statusResult: {
      run_id: 'blocked-1',
      result_code: 'RUN_FOUND',
      status: 'blocked',
      outcome: 'blocked',
      reason_code: 'CERBERUS_REJECT',
      next_safe_action: 'address CERBERUS blockers',
    },
    evidenceModel: {
      run_id: 'blocked-1',
      result_code: 'EVIDENCE_FOUND',
      attach_available: false,
      reason_code: 'ATTACH_UNAVAILABLE',
      next_safe_action: 'generate attach bundle from Overview',
    },
    loadRuns: () => canonicalRunsResult([
      {
        run_id: 'blocked-1',
        status: 'blocked',
        outcome: 'blocked',
        result_code: 'RUN_FOUND',
        reason_code: 'CERBERUS_REJECT',
        goal_summary: 'canonical fixture blocked path',
        created_at: '2026-08-01T00:00:00.000Z',
        last_event_at: '2026-08-01T00:01:00.000Z',
        current_phase: 'review',
        action_eligibility: 'inspect',
      },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => {
      const mod = await import('../../modules/operator/operator-tui-shell-render.mjs');
      return {
        renderOperatorTuiShell: async (opts) => {
          mountCount += 1;
          const prev = opts.onModelChange;
          opts.onModelChange = (next) => {
            surfaces.push(String(next?.contentSurface ?? ''));
            if (typeof prev === 'function') prev(next);
          };
          return mod.renderOperatorTuiShell(opts);
        },
      };
    },
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: opts.selectedRunId ?? null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  softAt.push({ label: 'start', soft: softCount(), mounts: mountCount });
  stdin.write('o'); // Overview → status surface
  await new Promise((r) => setTimeout(r, 80));
  softAt.push({ label: 'after_o', soft: softCount(), mounts: mountCount });
  stdin.write('x'); // Explain → status surface (same local path)
  await new Promise((r) => setTimeout(r, 80));
  softAt.push({ label: 'after_x', soft: softCount(), mounts: mountCount });
  stdin.write('e'); // Evidence → evidence surface
  await new Promise((r) => setTimeout(r, 80));
  softAt.push({ label: 'after_e', soft: softCount(), mounts: mountCount });
  stdin.write('m'); // Monitor → monitor surface (must stay mounted)
  await new Promise((r) => setTimeout(r, 80));
  softAt.push({ label: 'after_m', soft: softCount(), mounts: mountCount });
  assert.deepEqual(actions, [], 'o/x/e/m must not open nested executeAction');
  assert.equal(mountCount, 1, 'o→x→e→m must keep a single Ink renderer mount');
  assert.equal(softAt[softAt.length - 1].soft, 0, 'o→x→e→m must emit zero SOFT_HANDOFF_SEQUENCE');
  assert.ok(surfaces.includes('status'), 'Overview/Explain must set seeded status surface');
  assert.ok(surfaces.includes('evidence'), 'Evidence must set seeded evidence surface');
  assert.ok(surfaces.includes('monitor'), 'Monitor must set monitor surface');
  for (const snap of softAt) {
    if (snap.label === 'start') {
      assert.ok(snap.mounts <= 1, snap.label);
    } else {
      assert.equal(snap.mounts, 1, snap.label);
    }
    assert.equal(snap.soft, 0, `${snap.label} soft handoff`);
  }
  stdin.write('\x1b'); // Esc → home (still local)
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(actions, [], 'Esc from monitor stays local');
  assert.equal(mountCount, 1, 'Esc home must not remount');
  assert.equal(softCount(), 0, 'Esc home must not soft-handoff');
  stdin.write('q');
  const result = await promise;
  assert.deepEqual(actions, []);
  assert.equal(mountCount, 1, 'quit must not remount mid-session surfaces');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.equal(result.model?.contentSurface, 'home');
  assert.ok(result.model?.status?.reason_code === 'CERBERUS_REJECT'
    || /CERBERUS_REJECT/.test(String(result.text ?? '')));
  assert.ok(result.model?.evidence?.reason_code === 'ATTACH_UNAVAILABLE'
    || /ATTACH_UNAVAILABLE/.test(String(result.text ?? '')));
  stdin.destroy();
  stdout.destroy();
});

test('seeded Overview carries title/dates/eligibility without inventing Resume', async () => {
  const {
    seedStatusResultFromSelectedRun,
    buildShellModel,
  } = require('../../modules/operator/operator-tui-shell-model');
  const { buildContentLines } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const seeded = seedStatusResultFromSelectedRun({
    selectedRunId: 'task-5d3cdbc7',
    runs: {
      runs: [{
        run_id: 'task-5d3cdbc7',
        status: 'failed',
        outcome: 'failed',
        result_code: 'RUN_FOUND',
        reason_code: 'OUTPUT_BUDGET_EXHAUSTED',
        goal_summary: 'Sudoku HTML generation',
        created_at: '2026-08-01T12:00:00.000Z',
        last_event_at: '2026-08-01T12:05:00.000Z',
        current_phase: 'review',
        next_safe_action: 'inspect planner output-contract evidence',
      }],
    },
  });
  assert.equal(seeded.goal_summary, 'Sudoku HTML generation');
  assert.equal(seeded.created_at, '2026-08-01T12:00:00.000Z');
  // Legacy row without action_eligibility must not invent Inspect from status.
  assert.equal(seeded.action_eligibility, 'unavailable');
  const model = buildShellModel({
    statusResult: {
      ...seeded,
      action_eligibility: 'inspect',
    },
    selectedRunId: 'task-5d3cdbc7',
    contentSurface: 'status',
    runsPayload: {
      runs: [{ ...seeded, action_eligibility: 'inspect' }],
      result_code: 'RUNS_OK',
    },
  });
  const lines = buildContentLines(model).join('\n');
  assert.match(lines, /title: Sudoku HTML generation/);
  assert.match(lines, /created_at: 2026-08-01T12:00:00.000Z/);
  assert.match(lines, /OUTPUT_BUDGET_EXHAUSTED/);
  assert.match(lines, /Inspect only/);
  assert.ok(lines.includes('no Resume claimed'));
});

test('Runs → Overview keeps unavailable for legacy row without eligibility', async () => {
  const {
    seedStatusResultFromSelectedRun,
    buildShellModel,
    shellModelToOptions,
  } = require('../../modules/operator/operator-tui-shell-model');
  const { adaptRunsList } = require('../../modules/operator/operator-tui-adapters');
  const { buildContentLines } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const adapted = adaptRunsList({
    result_code: 'RUNS_OK',
    runs: [{
      run_id: 'legacy-blocked',
      status: 'blocked',
      outcome: 'blocked',
      result_code: 'RUN_FOUND',
      reason_code: 'CERBERUS_REJECT',
      goal_summary: 'legacy board row',
      created_at: '2026-08-01T00:00:00.000Z',
      last_event_at: '2026-08-01T00:01:00.000Z',
      current_phase: 'review',
      // intentionally omit action_eligibility
    }],
  });
  assert.equal(adapted.runs[0].action_eligibility, 'unavailable');
  const runsModel = buildShellModel({
    contentSurface: 'runs',
    selectedRunId: 'legacy-blocked',
    runsPayload: adapted,
  });
  const runsLines = buildContentLines(runsModel).join('\n');
  assert.match(runsLines, /Unavailable — inspect reason_code/);
  assert.equal(runsLines.includes('Inspect only'), false);

  const seeded = seedStatusResultFromSelectedRun(runsModel);
  assert.equal(seeded.action_eligibility, 'unavailable');
  const overview = buildShellModel({
    ...shellModelToOptions(runsModel),
    statusResult: seeded,
    contentSurface: 'status',
    selectedRunId: 'legacy-blocked',
  });
  const overviewLines = buildContentLines(overview).join('\n');
  assert.match(overviewLines, /Unavailable — inspect reason_code/);
  assert.equal(overviewLines.includes('Inspect only'), false);

  // Invalid with conflicting inspect still forced unavailable.
  const invalidAdapted = adaptRunsList({
    runs: [{
      run_id: 'bad',
      status: 'invalid',
      result_code: 'RUN_TRACE_INVALID',
      action_eligibility: 'inspect',
    }],
  });
  assert.equal(invalidAdapted.runs[0].action_eligibility, 'unavailable');
});

test('runs board lines render title/dates/phase/reason/eligibility with unavailable fallbacks', async () => {
  const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');
  const { buildContentLines } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const model = buildShellModel({
    contentSurface: 'runs',
    selectedRunId: 'r-rich',
    runsPayload: {
      result_code: 'RUNS_OK',
      runs: [
        {
          run_id: 'r-rich',
          status: 'blocked',
          outcome: 'blocked',
          result_code: 'RUN_FOUND',
          goal_summary: 'canonical fixture blocked path',
          created_at: '2026-08-01T00:00:00.000Z',
          last_event_at: '2026-08-01T00:01:00.000Z',
          current_phase: 'review',
          reason_code: 'CERBERUS_REJECT',
          action_eligibility: 'inspect',
        },
        {
          run_id: 'r-bare',
          status: 'invalid',
          outcome: null,
          result_code: 'RUN_TRACE_INVALID',
          reason_code: 'OPERATOR_TRACE_INVALID',
          // intentionally omit title/dates/phase/eligibility
        },
      ],
    },
  });
  const lines = buildContentLines(model).join('\n');
  assert.match(lines, /> r-rich {2}blocked \/ blocked \/ RUN_FOUND/);
  assert.match(lines, /title: canonical fixture blocked path/);
  assert.match(lines, /created_at: 2026-08-01T00:00:00\.000Z/);
  assert.match(lines, /updated_at: 2026-08-01T00:01:00\.000Z/);
  assert.match(lines, /phase: review/);
  assert.match(lines, /reason_code: CERBERUS_REJECT/);
  assert.match(lines, /Inspect only — no Resume claimed/);
  assert.match(lines, / r-bare {2}invalid \/ - \/ RUN_TRACE_INVALID/);
  assert.match(lines, /title: \(unavailable\)/);
  assert.match(lines, /created_at: \(unavailable\)/);
  assert.match(lines, /updated_at: \(unavailable\)/);
  assert.match(lines, /phase: \(unavailable\)/);
  assert.match(lines, /Unavailable — inspect reason_code/);
  assert.equal(model.runs.runs[1].action_eligibility, 'unavailable');
});

test('invalid status without eligibility renders Unavailable not Inspect', async () => {
  const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');
  const { adaptSelectedRunStatus } = require('../../modules/operator/operator-tui-adapters');
  const { buildContentLines } = await import('../../modules/operator/operator-tui-shell-render.mjs');
  const adapted = adaptSelectedRunStatus({
    run_id: 'corrupt-1',
    status: 'invalid',
    result_code: 'RUN_TRACE_INVALID',
    reason_code: 'OPERATOR_TRACE_INVALID',
    // no action_eligibility — must not become Inspect
  });
  assert.equal(adapted.action_eligibility, 'unavailable');
  const model = buildShellModel({
    statusResult: adapted,
    selectedRunId: 'corrupt-1',
    contentSurface: 'status',
  });
  const lines = buildContentLines(model).join('\n');
  assert.match(lines, /status: invalid/);
  assert.match(lines, /RUN_TRACE_INVALID/);
  assert.match(lines, /Unavailable — inspect reason_code/);
  assert.equal(lines.includes('Inspect only'), false);
});

test('System Status hotkey 3 and Enter stay mounted; Settings stays Ink-local', async () => {
  const { RESTORE_SEQUENCE: restoreSeq } = require('../../modules/operator/operator-tui-terminal-guard');
  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  const actions = [];
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 6,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  // Enter on System Status after arrowing to diagnostics (Quick Start skips Home).
  stdin.write('\x1b[B'); // runs
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('\x1b[B'); // diagnostics
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('\r');
  await new Promise((r) => setTimeout(r, 80));
  stdin.write('3'); // hotkey System Status
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(actions, [], 'System Status must not open nested executeAction');
  stdin.write('4'); // Settings → Ink-local config
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(actions, [], 'Settings must stay Ink-local (no nested executeAction)');
  stdin.write('q');
  const result = await promise;
  const joined = out.join('');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(joined.split(restoreSeq).length - 1, 1, 'alt-screen exit only at session end');
  assert.equal(result.model?.contentSurface, 'config');
  stdin.destroy();
  stdout.destroy();
});

test('Help topics stay in-process: digit 4 opens topic, never Settings remount', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 8,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  stdin.write('5'); // open Help
  await new Promise((r) => setTimeout(r, 90));
  stdin.write('4'); // topic "Icons and display" — must NOT dispatch config
  await new Promise((r) => setTimeout(r, 90));
  stdin.write('\x1b'); // Esc → topic list
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('\r'); // Enter → open selected topic
  await new Promise((r) => setTimeout(r, 90));
  stdin.write('\x1b'); // Esc → topic list
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('\x1b'); // Esc → Home
  await new Promise((r) => setTimeout(r, 70));
  stdin.write('q');
  const result = await promise;
  assert.deepEqual(actions, [], 'Help topics must never call executeAction / Settings remount');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(result.model?.contentSurface, 'home');
  stdin.destroy();
  stdout.destroy();
});

test('Settings Ink-local: digit 4 stays mounted; Esc home; q quits', async () => {
  const actions = [];
  const { stdin, stdout } = createFakeTtyStreams();
  let passes = 0;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 4,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ onRequestAction, model }) => {
        passes += 1;
        if (passes === 1) {
          // Simulate Ink-local Settings via requestAction leak path — entry must not nested-pane.
          onRequestAction('config');
          return { aborted: false, requestedAction: 'config' };
        }
        if (passes === 2) {
          assert.equal(model?.contentSurface, 'config');
          onRequestAction('q');
          return { aborted: false, requestedAction: 'q' };
        }
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async ({ actionId }) => {
      actions.push(actionId);
      if (actionId === 'quit') {
        return {
          quit: true,
          selectedRunId: null,
          contentSurface: 'home',
          actionResult: {
            action_id: 'quit',
            ok: true,
            exit_code: 0,
            reason_code: null,
            text: 'quit',
          },
        };
      }
      throw new Error(`Settings must not nested executeAction(${actionId})`);
    },
  });
  assert.equal(passes, 2, 'config stays in remount loop without nested pane');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.ok(!actions.includes('config'), 'config must not call executeAction');
  assert.equal(result.model?.contentSurface, 'config');
  stdin.destroy();
  stdout.destroy();
});

test('landing Quick Start ↑/↓ skips Home so System Status is two downs from New Run', () => {
  const {
    moveNavSelection,
    navItemsForMovement,
  } = require('../../modules/operator/operator-tui-shell-model');
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([]),
    contentSurface: 'home',
    selectedNavId: 'launcher',
  });
  const movable = navItemsForMovement(model);
  assert.equal(movable.some((n) => n.id === 'home'), false);
  assert.equal(movable[0]?.id, 'launcher');
  const afterOne = moveNavSelection(model, 'next');
  assert.equal(afterOne.selectedNavId, 'runs');
  const afterTwo = moveNavSelection(afterOne, 'next');
  assert.equal(afterTwo.selectedNavId, 'diagnostics');
  const enterDiag = resolveShellKeypress('', { return: true }, {
    ...afterTwo,
    focus: 'nav',
  });
  assert.equal(enterDiag.actionId, 'diagnostics');
  assert.equal(enterDiag.endsSession, false);
});

test('select/evidence/config actions propagate nested pane payloads into remounted shell model', async () => {
  const { executeShellAction } = require('../../modules/operator/operator-tui-shell-actions');
  const statusPane = {
    run_id: 'run-select-1',
    result_code: 'RUN_FOUND',
    status: 'complete',
    outcome: 'success',
    reason_code: null,
    next_safe_action: 'attach',
  };
  const evidencePane = {
    run_id: 'run-ev-1',
    result_code: 'RUN_FOUND',
    status: 'complete',
    outcome: 'success',
    attach_available: true,
    attach_bundle_available: true,
    attach_action_available: true,
    reason_code: null,
    next_safe_action: 'none',
  };
  const configPane = {
    ok: true,
    model_policy: 'local_only',
    path_activation: { status: 'ready', on_path: true },
    credentials: {
      credential_sufficiency: 'not_required',
      providers: [],
    },
    next_safe_action: 'smoke',
    remediation_candidates: ['Run smoke: ai-minions smoke --model-policy local_only'],
  };

  const selectOutcome = await executeShellAction({
    actionId: 'select',
    question: async () => '1',
    write: () => {},
    runSelector: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_SELECTED',
      selected_run_id: 'run-select-1',
      status_pane: statusPane,
      text: 'selected',
    }),
  });
  assert.equal(selectOutcome.contentSurface, 'status');
  assert.deepEqual(selectOutcome.statusResult, statusPane);
  const selectModel = buildShellModel({
    statusResult: selectOutcome.statusResult,
    contentSurface: selectOutcome.contentSurface,
    selectedRunId: selectOutcome.selectedRunId,
  });
  assert.equal(selectModel.status.available, true);
  assert.equal(selectModel.status.run_id, 'run-select-1');
  assert.equal(selectModel.status.outcome, 'success');
  assert.equal(selectModel.status.result_code, 'RUN_FOUND');

  const evidenceOutcome = await executeShellAction({
    actionId: 'evidence',
    selectedRunId: 'run-ev-1',
    question: async () => '',
    write: () => {},
    runEvidencePane: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'EVIDENCE_ATTACH_PANE_BACK',
      pane: evidencePane,
      text: 'evidence',
    }),
  });
  assert.equal(evidenceOutcome.contentSurface, 'evidence');
  assert.deepEqual(evidenceOutcome.evidenceModel, evidencePane);
  const evidenceModel = buildShellModel({
    evidenceModel: evidenceOutcome.evidenceModel,
    contentSurface: evidenceOutcome.contentSurface,
    selectedRunId: evidenceOutcome.selectedRunId,
  });
  assert.equal(evidenceModel.evidence.available, true);
  assert.equal(evidenceModel.evidence.run_id, 'run-ev-1');
  assert.equal(evidenceModel.evidence.attach_available, true);

  const configOutcome = await executeShellAction({
    actionId: 'config',
    question: async () => 'b',
    write: () => {},
    runConfigPane: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'CONFIG_READINESS_PANE_BACK',
      pane: configPane,
      text: 'config',
    }),
  });
  assert.equal(configOutcome.contentSurface, 'config');
  assert.deepEqual(configOutcome.configModel, configPane);
  const configModel = buildShellModel({
    configModel: configOutcome.configModel,
    contentSurface: configOutcome.contentSurface,
  });
  assert.equal(configModel.config.available, true);
  assert.equal(configModel.config.path_status, 'ready');
  assert.equal(configModel.config.credential_sufficiency, 'not_required');
  assert.equal(configModel.config.doctor_ok, true);
  assert.equal(configModel.config.remediations.length, 1);
  assert.match(configModel.config.remediations[0], /smoke/);
});

test('adaptConfigReadiness normalizes nested operator pane fields', () => {
  const nested = adaptConfigReadiness({
    ok: false,
    model_policy: 'hybrid',
    path_activation: { status: 'activation_required' },
    credentials: { credential_sufficiency: 'missing_required' },
    next_safe_action: 'doctor',
    remediation_candidates: ['Export provider env var (value not shown): export X=<your-token>'],
  });
  assert.equal(nested.path_status, 'activation_required');
  assert.equal(nested.credential_sufficiency, 'missing_required');
  assert.equal(nested.doctor_ok, false);
  assert.equal(nested.remediations[0].includes('Export provider'), true);
});

test('product CLI non-TTY tui exits with guidance and without Ink', () => {
  const r = spawnSync(process.execPath, [CLI_PATH, 'tui'], {
    cwd: ORCH_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    input: '',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a TTY/i);
  assert.match(r.stderr, /ai-minions smoke/);
});

test('legacy readline rollback path does not load Ink', async () => {
  const result = await runOperatorTuiShell({
    isTTY: true,
    preferLegacy: true,
    runLegacyCockpit: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'COCKPIT_QUIT',
      text: 'quit',
    }),
    importRenderer: async () => {
      throw new Error('legacy must not load Ink');
    },
  });
  assert.equal(result.legacy, true);
  assert.equal(result.ink_loaded, false);
  assert.equal(result.reason_code, 'COCKPIT_QUIT');
});

test('dumb surface walk: all major Ink-local surfaces stay single-mount including Settings', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const out = [];
  stdout.on('data', (chunk) => {
    out.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  });
  const actions = [];
  let mountCount = 0;
  /** @type {string[]} */
  const surfaces = [];
  const softCount = () => out.join('').split(SOFT_HANDOFF_SEQUENCE).length - 1;
  const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

  const promise = runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 12,
    selectedRunId: 'blocked-1',
    statusResult: {
      run_id: 'blocked-1',
      result_code: 'RUN_FOUND',
      status: 'blocked',
      outcome: 'blocked',
      reason_code: 'CERBERUS_REJECT',
      next_safe_action: 'address CERBERUS blockers',
    },
    evidenceModel: {
      run_id: 'blocked-1',
      result_code: 'EVIDENCE_FOUND',
      attach_available: false,
      reason_code: 'ATTACH_UNAVAILABLE',
      next_safe_action: 'generate attach bundle from Overview',
    },
    loadRuns: () => canonicalRunsResult([
      {
        run_id: 'blocked-1',
        status: 'blocked',
        outcome: 'blocked',
        result_code: 'RUN_FOUND',
        reason_code: 'CERBERUS_REJECT',
      },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => {
      const mod = await import('../../modules/operator/operator-tui-shell-render.mjs');
      return {
        renderOperatorTuiShell: async (opts) => {
          mountCount += 1;
          const prev = opts.onModelChange;
          opts.onModelChange = (next) => {
            surfaces.push(String(next?.contentSurface ?? ''));
            if (typeof prev === 'function') prev(next);
          };
          return mod.renderOperatorTuiShell(opts);
        },
      };
    },
    executeAction: async (opts) => {
      actions.push(opts.actionId);
      return {
        quit: false,
        selectedRunId: opts.selectedRunId ?? null,
        contentSurface: 'action_result',
        actionResult: {
          action_id: opts.actionId,
          ok: true,
          exit_code: 0,
          reason_code: 'OK',
          text: 'ok',
        },
      };
    },
  });

  await tick(150);
  assert.equal(mountCount, 1, 'initial mount');
  assert.equal(softCount(), 0);

  // Help topics (in-process) — walk topic keys then Esc home.
  stdin.write('?');
  await tick();
  stdin.write('1');
  await tick(60);
  stdin.write('\x1b'); // topic list
  await tick(50);
  stdin.write('2');
  await tick(60);
  stdin.write('\x1b');
  await tick(50);
  stdin.write('3');
  await tick(60);
  stdin.write('\x1b');
  await tick(50);
  // Tab → input: digit must stay Help topic, never Settings remount.
  stdin.write('\t');
  await tick(40);
  stdin.write('\t');
  await tick(40);
  stdin.write('4');
  await tick(70);
  assert.deepEqual(actions, [], 'Help Tab→input must not executeAction/Settings');
  assert.equal(mountCount, 1, 'Help Tab→input must keep single mount');
  assert.equal(softCount(), 0, 'Help Tab→input must not soft-handoff');
  stdin.write('\x1b'); // close topic
  await tick(50);
  stdin.write('\x1b'); // home
  await tick();

  // Diagnostics / System Status
  stdin.write('3');
  await tick();
  assert.ok(surfaces.includes('diagnostics'), 'diagnostics surface');
  stdin.write('\x1b');
  await tick();

  // Overview / Explain / Evidence
  stdin.write('o');
  await tick();
  stdin.write('x');
  await tick();
  stdin.write('e');
  await tick();
  assert.ok(surfaces.includes('status'), 'status/overview');
  assert.ok(surfaces.includes('evidence'), 'evidence');
  assert.deepEqual(actions, [], 'o/x/e stay Ink-local');
  assert.equal(mountCount, 1);
  assert.equal(softCount(), 0);
  stdin.write('\x1b');
  await tick();

  // Runs — native workflow (no executeAction); Esc cancels.
  stdin.write('2');
  await tick(100);
  assert.deepEqual(actions, [], 'runs must not nested executeAction');
  assert.equal(mountCount, 1, 'native runs workflow stays on same Ink mount');
  stdin.write('\x1b');
  await tick();

  // Settings — Ink-local seeded config (no remount / nested pane).
  stdin.write('4');
  await tick(120);
  assert.deepEqual(actions, [], 'Settings must not nested executeAction');
  assert.equal(mountCount, 1, 'Settings stays single-mount');
  assert.equal(softCount(), 0, 'Settings must not soft-handoff');
  assert.ok(surfaces.includes('config'), 'config surface');
  stdin.write('\x1b');
  await tick();

  stdin.write('q');
  const result = await promise;
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.deepEqual(actions, [], 'no nested remount actions on dumb walk');
  stdin.destroy();
  stdout.destroy();
});

test('viewport budgets keep CTA and Overall across 50x16 / 80x24 / 120x36', () => {
  const budgets = [
    { columns: 50, rows: 16 },
    { columns: 80, rows: 24 },
    { columns: 120, rows: 36 },
  ];
  for (const vp of budgets) {
    const model = buildShellModel({
      aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
      credentials: { credential_sufficiency: 'not_required', providers: [] },
      pathActivation: { status: 'ready', on_path: true },
      runsPayload: canonicalRunsResult([]),
      contentSurface: 'home',
      selectedNavId: 'launcher',
      columns: vp.columns,
      rows: vp.rows,
      icons: 'unicode',
      art: 'arcade',
    });
    const text = formatShellText(model);
    assert.match(text, /Start New Run/, `${vp.columns}x${vp.rows}: CTA`);
    assert.match(text, /Overall:/, `${vp.columns}x${vp.rows}: Overall`);
  }
});

test('cold start ignores stale launcher resume and drains residual stdin', async () => {
  assert.deepEqual(resolveColdStartShellSurface({
    contentSurface: 'launcher_workflow',
    activeWorkflow: { kind: 'launcher', step: 'agent_flow' },
  }), { contentSurface: 'home', activeWorkflow: null });
  assert.equal(
    resolveColdStartShellSurface({ explicitStartRun: true, activeWorkflow: { kind: 'launcher' } })
      .contentSurface,
    'launcher_workflow',
  );

  const fakeStdin = {
    readableLength: 2,
    _n: 0,
    read() {
      this._n += 1;
      if (this._n === 1) {
        this.readableLength = 1;
        return Buffer.from('\r');
      }
      if (this._n === 2) {
        this.readableLength = 0;
        return Buffer.from('1');
      }
      this.readableLength = 0;
      return null;
    },
  };
  assert.ok(drainStdinColdStart(fakeStdin) >= 2, 'cold start drains leftover keys');

  const { stdin, stdout } = createFakeTtyStreams();
  stdin.write('\r1\r');
  let modelSnap = null;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 1,
    autoQuitMs: 80,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    activeWorkflow: { kind: 'launcher', step: 'agent_flow' },
    contentSurface: 'launcher_workflow',
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ model, onModelChange }) => {
        modelSnap = model;
        if (typeof onModelChange === 'function') onModelChange(model);
        await new Promise((r) => setTimeout(r, 40));
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async () => {
      throw new Error('cold start must not executeAction');
    },
  });
  assert.equal(modelSnap?.contentSurface, 'home');
  assert.equal(modelSnap?.activeWorkflow, null);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  stdin.destroy();
  stdout.destroy();
});

test('Tab content focus Enter stays in-process (no monitor soft-handoff exit)', () => {
  const withRun = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([
      { run_id: 'r1', status: 'complete', outcome: 'success', result_code: 'RUN_FOUND' },
    ]),
    contentSurface: 'home',
    focus: 'content',
    selectedRunId: 'r1',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
  });
  assert.equal(withRun.landing.composition.show_recent_runs, true);
  assert.ok(withRun.landing.recent_runs.some((r) => r.run_id === 'r1'));
  const enterRun = resolveShellKeypress('', { return: true }, withRun);
  assert.equal(enterRun.type, 'dispatch');
  assert.equal(enterRun.actionId, 'status', 'Enter on Recent Runs opens Overview, not monitor');
  assert.equal(enterRun.endsSession, false);
  assert.equal(isInkLocalShellAction(enterRun.actionId), true);

  const empty = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([]),
    contentSurface: 'home',
    focus: 'content',
    selectedRunId: null,
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
  });
  const enterEmpty = resolveShellKeypress('', { return: true }, empty);
  assert.equal(enterEmpty.endsSession, false);
  assert.ok(
    enterEmpty.actionId === 'diagnostics' || enterEmpty.actionId === 'runs',
    `empty content Enter stays local/native: ${enterEmpty.actionId}`,
  );
  assert.notEqual(enterEmpty.actionId, 'monitor');
  assert.notEqual(enterEmpty.type, 'quit');
});

test('Recent Runs content focus: ↑/↓ select run; Enter opens Overview', () => {
  let model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([
      { run_id: 'a', status: 'complete', outcome: 'success', result_code: 'RUN_FOUND' },
      { run_id: 'b', status: 'blocked', outcome: 'blocked', result_code: 'RUN_FOUND' },
    ]),
    contentSurface: 'home',
    focus: 'nav',
    selectedRunId: 'a',
    selectedNavId: 'launcher',
    columns: 120,
    rows: 36,
  });
  model = cycleFocus(model);
  assert.equal(model.focus, 'content', 'Tab lands on Recent Runs content focus');
  assert.equal(resolveShellKeypress('', { downArrow: true }, model).type, 'run_move');
  model = moveRunSelection(model, 'next');
  assert.equal(model.selectedRunId, 'b');
  const open = resolveShellKeypress('', { return: true }, { ...model, focus: 'content' });
  assert.equal(open.actionId, 'status');
  assert.equal(isInkLocalShellAction('status'), true);

  const seeded = seedStatusResultFromSelectedRun(model);
  assert.equal(seeded.run_id, 'b');
  assert.equal(seeded.status, 'blocked');
  assert.equal(seeded.outcome, 'blocked');
  assert.equal(seeded.result_code, 'RUN_FOUND');
  const overview = buildShellModel({
    ...shellModelToOptions(model),
    contentSurface: 'status',
    statusResult: seeded,
  });
  assert.equal(overview.status.available, true);
  assert.equal(overview.status.run_id, 'b');
  assert.equal(overview.status.status, 'blocked');
  assert.equal(overview.status.outcome, 'blocked');
  assert.match(formatShellText(overview), /run=b/);
  assert.doesNotMatch(formatShellText(overview), /status: \(unavailable\)/);
});

test('cold start drains >64 bytes of leftover stdin before mount', async () => {
  const leftover = '1'.repeat(65);
  const buffered = {
    readableLength: leftover.length,
    buf: Buffer.from(leftover, 'utf8'),
    read(n) {
      const want = Math.max(1, Number(n) || 1);
      if (this.buf.length === 0) {
        this.readableLength = 0;
        return null;
      }
      const take = Math.min(want, this.buf.length);
      const out = this.buf.subarray(0, take);
      this.buf = this.buf.subarray(take);
      this.readableLength = this.buf.length;
      return out;
    },
  };
  assert.equal(drainStdinColdStart(buffered), 65);
  assert.equal(buffered.readableLength, 0);

  assert.throws(
    () => drainStdinColdStart({
      readableLength: 8,
      buf: Buffer.from('12345678'),
      read(n) {
        const want = Math.max(1, Number(n) || 1);
        if (this.buf.length === 0) {
          this.readableLength = 0;
          return null;
        }
        const take = Math.min(want, this.buf.length);
        const out = this.buf.subarray(0, take);
        this.buf = this.buf.subarray(take);
        this.readableLength = this.buf.length;
        return out;
      },
    }, { maxBytes: 4 }),
    (err) => err && err.code === 'COLD_START_STDIN_DRAIN_TRUNCATED',
  );
  assert.ok(COLD_START_DRAIN_SAFETY_MAX > 64);

  const { stdin, stdout } = createFakeTtyStreams();
  stdin.write(`${'1'.repeat(65)}\r`);
  let modelSnap = null;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 1,
    autoQuitMs: 80,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async ({ model, onModelChange }) => {
        modelSnap = model;
        if (typeof onModelChange === 'function') onModelChange(model);
        await new Promise((r) => setTimeout(r, 40));
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async () => {
      throw new Error('cold start must not executeAction after draining 65x1');
    },
  });
  assert.equal(modelSnap?.contentSurface, 'home');
  assert.equal(modelSnap?.activeWorkflow, null);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED);
  stdin.destroy();
  stdout.destroy();
});

/**
 * Stdin that never empties past the cold-start safety ceiling — forces
 * COLD_START_STDIN_DRAIN_TRUNCATED without allocating a 1MiB+ buffer.
 */
function createNeverEmptyColdStartStdin() {
  const stdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(mode) {
      this.isRaw = Boolean(mode);
      return this;
    },
    ref() { return this; },
    unref() { return this; },
    resume() { return this; },
    pause() { return this; },
    isPaused() { return false; },
    get readableLength() {
      return 4096;
    },
    read(n) {
      const want = Math.max(1, Number(n) || 1);
      return Buffer.alloc(want, 0x31);
    },
  };
  return stdin;
}

test('cold-start drain truncation reports real ink/react flags; interactive shell never mounts', async () => {
  const sharedHarness = {
    isTTY: true,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async () => {
      throw new Error('truncation must not executeAction');
    },
  };

  // Without splash: Ink/React never loaded → flags stay false; shell never mounts.
  {
    const stdin = createNeverEmptyColdStartStdin();
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.columns = 100;
    stdout.rows = 30;
    stdout.getColorDepth = () => 1;
    stdout.ref = () => stdout;
    stdout.unref = () => stdout;
    let interactiveMounts = 0;
    const result = await runOperatorTuiShell({
      ...sharedHarness,
      stdin,
      stdout,
      skipSplash: true,
      maxLoops: 1,
      importRenderer: async () => ({
        renderOperatorTuiShell: async () => {
          interactiveMounts += 1;
          return { aborted: false, requestedAction: null };
        },
      }),
    });
    assert.equal(result.reason_code, TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.ink_loaded, false);
    assert.equal(result.react_loaded, false);
    assert.equal(interactiveMounts, 0, 'interactive shell must not mount after truncation');
    stdout.destroy();
  }

  // With splash: drain still runs before Ink — truncation aborts with flags false;
  // neither splash nor interactive shell mounts.
  {
    const stdin = createNeverEmptyColdStartStdin();
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.columns = 100;
    stdout.rows = 30;
    stdout.getColorDepth = () => 1;
    stdout.ref = () => stdout;
    stdout.unref = () => stdout;
    let splashMounts = 0;
    let interactiveMounts = 0;
    const result = await runOperatorTuiShell({
      ...sharedHarness,
      stdin,
      stdout,
      splashMs: 0,
      // Unbounded loops → production splash gate (not harness skip).
      importRenderer: async () => ({
        renderOperatorTuiShell: async (opts) => {
          if (opts.showSplash === true) {
            splashMounts += 1;
            assert.equal(opts.splashOnly, true);
            return { aborted: false };
          }
          interactiveMounts += 1;
          return { aborted: false, requestedAction: null };
        },
      }),
    });
    assert.equal(result.reason_code, TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(splashMounts, 0, 'drain truncation must abort before splash Ink mount');
    assert.equal(result.ink_loaded, false, 'Ink must not load when drain aborts before mount');
    assert.equal(result.react_loaded, false, 'React must not load when drain aborts before mount');
    assert.equal(interactiveMounts, 0, 'interactive shell must not mount after truncation');
    stdout.destroy();
  }
});

test('cold start drains stdin buffered during discovery (no splash route)', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let shellMounts = 0;
  let bufferedAtMount = null;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 1,
    autoQuitMs: 80,
    loadRuns: () => {
      // Operator types `1` + Enter while run discovery is in flight.
      stdin.write('1\r');
      return canonicalRunsResult([]);
    },
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async (opts) => {
        shellMounts += 1;
        bufferedAtMount = stdin.readableLength;
        // Simulate Ink keypress handling: a buffered `1` at mount dispatches the launcher.
        const b = stdin.read(1);
        if (b && b[0] === 0x31) {
          if (typeof opts.onRequestAction === 'function') opts.onRequestAction('launcher');
          return { aborted: false, requestedAction: 'launcher' };
        }
        return { aborted: false, requestedAction: null };
      },
    }),
    executeAction: async () => {
      throw new Error('discovery drain regression must not executeAction');
    },
  });
  assert.equal(shellMounts, 1);
  assert.equal(bufferedAtMount, 0, 'stdin must be drained after discovery before shell mount');
  assert.equal(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(result.model?.contentSurface, 'home');
  assert.equal(result.model?.activeWorkflow, null);
  stdin.destroy();
  stdout.destroy();
});

test('cold start drains stdin buffered during renderer import (no splash route)', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let shellMounts = 0;
  let bufferedAtMount = null;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    skipSplash: true,
    maxLoops: 1,
    autoQuitMs: 80,
    loadRuns: () => canonicalRunsResult([]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    importRenderer: async () => {
      // Real Ink repro: operator types `1` + Enter while the renderer imports.
      // The post-import drain must clear it before the first shell mount.
      stdin.write('1\r');
      return {
        renderOperatorTuiShell: async (opts) => {
          shellMounts += 1;
          bufferedAtMount = stdin.readableLength;
          // Simulate Ink keypress handling: a buffered `1` at mount dispatches the launcher.
          const b = stdin.read(1);
          if (b && b[0] === 0x31) {
            if (typeof opts.onRequestAction === 'function') opts.onRequestAction('launcher');
            return { aborted: false, requestedAction: 'launcher' };
          }
          return { aborted: false, requestedAction: null };
        },
      };
    },
    executeAction: async () => {
      throw new Error('import-window drain regression must not executeAction');
    },
  });
  assert.equal(shellMounts, 1);
  assert.equal(bufferedAtMount, 0, 'stdin must be drained after renderer import before shell mount');
  assert.equal(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(result.model?.contentSurface, 'home');
  assert.equal(result.model?.activeWorkflow, null);
  stdin.destroy();
  stdout.destroy();
});

test('cold start drains stdin buffered during discovery (splash route)', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const order = [];
  let shellMounts = 0;
  let bufferedAtFirstShellMount = null;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    splashMs: 0,
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    loadRuns: () => {
      // Operator types `1` + Enter while run discovery is in flight (post-splash).
      stdin.write('1\r');
      return canonicalRunsResult([]);
    },
    importRenderer: async () => ({
      renderOperatorTuiShell: async (opts) => {
        if (opts.showSplash === true) {
          order.push('splash');
          assert.equal(opts.splashOnly, true);
          return { aborted: false };
        }
        shellMounts += 1;
        order.push('shell');
        if (shellMounts === 1) {
          bufferedAtFirstShellMount = stdin.readableLength;
          // Simulate Ink keypress handling: a buffered `1` at mount dispatches the launcher.
          const b = stdin.read(1);
          if (b && b[0] === 0x31) {
            if (typeof opts.onRequestAction === 'function') opts.onRequestAction('launcher');
            return { aborted: false, requestedAction: 'launcher' };
          }
        }
        if (typeof opts.onRequestAction === 'function') opts.onRequestAction('quit');
        return { aborted: false, requestedAction: 'quit' };
      },
    }),
    executeAction: async () => {
      throw new Error('discovery drain regression must not executeAction');
    },
  });
  assert.deepEqual(order, ['splash', 'shell'], 'no remount into launcher workflow after drained key');
  assert.equal(bufferedAtFirstShellMount, 0, 'stdin must be drained after discovery before shell mount');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.equal(result.model?.contentSurface, 'home');
  assert.equal(result.model?.activeWorkflow, null);
  stdin.destroy();
  stdout.destroy();
});

/**
 * Stdin that reads empty until discovery floods it past the safety ceiling —
 * trips only the post-discovery drain, never the pre-splash one.
 */
function createDiscoveryFloodStdin() {
  const state = { flooded: false };
  return {
    isTTY: true,
    isRaw: false,
    setRawMode(mode) {
      this.isRaw = Boolean(mode);
      return this;
    },
    ref() { return this; },
    unref() { return this; },
    resume() { return this; },
    pause() { return this; },
    isPaused() { return false; },
    flood() { state.flooded = true; },
    get readableLength() {
      return state.flooded ? 4096 : 0;
    },
    read(n) {
      if (!state.flooded) return null;
      return Buffer.alloc(Math.max(1, Number(n) || 1), 0x31);
    },
  };
}

test('post-discovery drain truncation aborts before shell mount with real ink flags', async () => {
  const sharedHarness = {
    isTTY: true,
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    executeAction: async () => {
      throw new Error('truncation must not executeAction');
    },
  };
  const stdoutFor = () => {
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.columns = 100;
    stdout.rows = 30;
    stdout.getColorDepth = () => 1;
    stdout.ref = () => stdout;
    stdout.unref = () => stdout;
    return stdout;
  };

  // No splash: renderer imports BEFORE the post-discovery drain → flags report
  // the real loaded state (true) when truncation aborts; shell never mounts.
  {
    const stdin = createDiscoveryFloodStdin();
    const stdout = stdoutFor();
    let interactiveMounts = 0;
    const result = await runOperatorTuiShell({
      ...sharedHarness,
      stdin,
      stdout,
      skipSplash: true,
      maxLoops: 1,
      loadRuns: () => {
        stdin.flood();
        return canonicalRunsResult([]);
      },
      importRenderer: async () => ({
        renderOperatorTuiShell: async () => {
          interactiveMounts += 1;
          return { aborted: false, requestedAction: null };
        },
      }),
    });
    assert.equal(result.reason_code, TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.ink_loaded, true, 'renderer imports before the post-discovery drain');
    assert.equal(result.react_loaded, true, 'renderer imports before the post-discovery drain');
    assert.equal(interactiveMounts, 0, 'interactive shell must not mount after post-discovery truncation');
    stdout.destroy();
  }

  // Splash: Ink/React already loaded for the splash → truncation reports true flags.
  {
    const stdin = createDiscoveryFloodStdin();
    const stdout = stdoutFor();
    let splashMounts = 0;
    let interactiveMounts = 0;
    const result = await runOperatorTuiShell({
      ...sharedHarness,
      stdin,
      stdout,
      splashMs: 0,
      loadRuns: () => {
        stdin.flood();
        return canonicalRunsResult([]);
      },
      importRenderer: async () => ({
        renderOperatorTuiShell: async (opts) => {
          if (opts.showSplash === true) {
            splashMounts += 1;
            assert.equal(opts.splashOnly, true);
            return { aborted: false };
          }
          interactiveMounts += 1;
          return { aborted: false, requestedAction: null };
        },
      }),
    });
    assert.equal(result.reason_code, TUI_SHELL_REASON.COLD_START_DRAIN_TRUNCATED);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(splashMounts, 1, 'splash mounts before the discovery flood');
    assert.equal(result.ink_loaded, true, 'post-splash truncation must report the real ink flag');
    assert.equal(result.react_loaded, true, 'post-splash truncation must report the real react flag');
    assert.equal(interactiveMounts, 0, 'interactive shell must not mount after post-discovery truncation');
    stdout.destroy();
  }
});

test('cold start drains residual stdin before brand splash (does not auto-dismiss)', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  // Leftover Enter/`1` from a prior session — must be drained before splash mounts.
  stdin.write('\r1\r');
  const order = [];
  let splashSeen = false;
  const result = await runOperatorTuiShell({
    isTTY: true,
    stdin,
    stdout,
    splashMs: 0,
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    loadRuns: () => canonicalRunsResult([]),
    importRenderer: async () => ({
      renderOperatorTuiShell: async (opts) => {
        if (opts.showSplash === true) {
          splashSeen = true;
          order.push('splash');
          assert.equal(opts.splashOnly, true);
          assert.equal(opts.model?.readiness, 'loading');
          // Buffer must already be empty — residual keys must not reach splash input.
          assert.equal(
            typeof stdin.readableLength === 'number' ? stdin.readableLength : 0,
            0,
            'stdin must be drained before brand splash mount',
          );
          return { aborted: false };
        }
        order.push('shell');
        assert.equal(opts.showSplash, false);
        assert.equal(opts.model?.contentSurface, 'home');
        if (typeof opts.onRequestAction === 'function') {
          opts.onRequestAction('quit');
        }
        return { aborted: false, requestedAction: 'quit' };
      },
    }),
    executeAction: async () => {
      throw new Error('cold start splash regression must not executeAction');
    },
  });
  assert.equal(splashSeen, true, 'brand splash must mount on cold start');
  assert.deepEqual(order, ['splash', 'shell']);
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  stdin.destroy();
  stdout.destroy();
});

test('Recent Runs selection stays on visible window; hidden panel skips content focus', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({
    run_id: `r${i + 1}`,
    status: 'complete',
    outcome: 'success',
    result_code: 'RUN_FOUND',
  }));
  let wide = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult(seven),
    contentSurface: 'home',
    focus: 'content',
    selectedRunId: 'r1',
    columns: 120,
    rows: 36,
  });
  assert.equal(wide.landing.composition.show_recent_runs, true);
  assert.ok(wide.landing.recent_runs.length >= 1);
  assert.ok(wide.landing.recent_runs.length < 7, 'composition limits visible Recent Runs');
  const visibleLimit = wide.landing.composition.recent_runs_limit;
  assert.equal(wide.landing.recent_runs.length, visibleLimit);

  for (let i = 0; i < 6; i += 1) {
    wide = moveRunSelection(wide, 'next');
    const visibleIds = wide.landing.recent_runs.map((r) => r.run_id);
    assert.ok(
      visibleIds.includes(wide.selectedRunId),
      `selected ${wide.selectedRunId} must be in visible ${visibleIds.join(',')}`,
    );
  }
  assert.equal(wide.selectedRunId, 'r7');
  const enterVisible = resolveShellKeypress('', { return: true }, { ...wide, focus: 'content' });
  assert.equal(enterVisible.actionId, 'status');

  let mid = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult(seven),
    contentSurface: 'home',
    focus: 'nav',
    selectedRunId: 'r1',
    columns: 80,
    rows: 24,
  });
  // Force a composition where Recent is dropped (short rows) if not already.
  if (mid.landing.composition.show_recent_runs) {
    mid = buildShellModel({
      ...shellModelToOptions(mid),
      columns: 80,
      rows: 16,
    });
  }
  if (!mid.landing.composition.show_recent_runs) {
    assert.deepEqual(focusTargetsForModel(mid), ['nav', 'input']);
    mid = cycleFocus(mid);
    assert.equal(mid.focus, 'input', 'Tab skips content when Recent Runs hidden');
    mid = buildShellModel({ ...shellModelToOptions(mid), focus: 'content' });
    const stuck = moveRunSelection(mid, 'next');
    assert.equal(stuck.selectedRunId, 'r1', '↑/↓ must not move invisible runs');
    const enterHidden = resolveShellKeypress('', { return: true }, stuck);
    assert.notEqual(enterHidden.actionId, 'status');
  }
});

test('Settings seed separates snapshot_ok from doctor_ok (doctor not_run)', () => {
  const home = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'x' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: canonicalRunsResult([]),
    contentSurface: 'home',
  });
  const seed = seedConfigModelFromShell(home);
  assert.equal(seed.snapshot_ok, true);
  assert.equal(seed.doctor_status, 'not_run');
  assert.equal(seed.ok, undefined);
  assert.equal(seed.doctor_ok, undefined);
  const config = adaptConfigReadiness(seed);
  assert.equal(config.snapshot_ok, true);
  assert.equal(config.doctor_status, 'not_run');
  assert.equal(config.doctor_ok, null);
  const surface = buildShellModel({
    ...shellModelToOptions(home),
    contentSurface: 'config',
    configModel: seed,
  });
  assert.equal(surface.config.doctor_status, 'not_run');
  assert.equal(surface.config.doctor_ok, null);
  assert.match(formatShellText(surface), /doctor_status=not_run/);
});
