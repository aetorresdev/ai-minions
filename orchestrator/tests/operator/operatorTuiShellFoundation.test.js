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
} = require('../../modules/operator/operator-tui-shell-model');
const {
  createTerminalGuard,
  withTerminalGuard,
  prepareNestedPaneIo,
  prepareInkRemount,
  drainStdin,
  RESTORE_SEQUENCE,
  SOFT_HANDOFF_SEQUENCE,
  CLEAR_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');
const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
} = require('../../modules/operator/operator-tui-shell-entry');
const {
  NATIVE_LAUNCHER_EXECUTE_ACTION,
} = require('../../modules/operator/operator-tui-native-workflows');
const { resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');

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
    columns: 100,
    rows: 30,
  });
  assert.equal(model.schema, SHELL_SCHEMA);
  assert.equal(model.layout, 'wide');
  assert.equal(layoutModeForColumns(40), 'narrow');
  model = moveNavSelection(model, 'next');
  assert.ok(model.selectedNavId);
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
  async function runWithKey(writeKey) {
    const actions = [];
    const { stdin, stdout } = createFakeTtyStreams();
    const promise = runOperatorTuiShell({
      isTTY: true,
      stdin,
      stdout,
      maxLoops: 2,
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
  stdin.write('4'); // settings / config → still nested Phase-2 pane
  await new Promise((r) => setTimeout(r, 80));
  stdin.write('q'); // quit — must not call executeAction('quit') after early session-end
  const result = await promise;
  assert.deepEqual(actions, ['config']);
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
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
  assert.equal(isInkLocalShellAction('runs'), false, 'runs is native workflow, not contentSurface local');
  assert.equal(isInkLocalShellAction('launcher'), false);
  assert.equal(contentSurfaceForLocalAction('3'), null);
  assert.equal(contentSurfaceForLocalAction('diagnostics'), 'diagnostics');

  assert.equal(resolveShellKeypress('', { escape: true }, model).type, 'surface_home');
  assert.equal(resolveShellKeypress('', { escape: true }, model).endsSession, false);
  assert.equal(resolveShellKeypress('?', {}, model).type, 'dispatch');
  assert.equal(resolveShellKeypress('?', {}, model).endsSession, false);
  assert.equal(resolveShellKeypress('3', {}, model).actionId, 'diagnostics');
  assert.equal(resolveShellKeypress('3', {}, model).endsSession, false);
  assert.equal(resolveShellKeypress('', { upArrow: true }, model).type, 'nav_move');
  assert.equal(resolveShellKeypress('', { upArrow: true }, model).endsSession, false);
  assert.equal(resolveShellKeypress('', { return: true }, {
    ...model,
    focus: 'nav',
    selectedNavId: 'launcher',
    contentSurface: 'home',
  }).endsSession, false);
  assert.equal(resolveShellKeypress('q', {}, model).endsSession, true);
  assert.equal(resolveShellKeypress('c', { ctrl: true }, model).endsSession, true);

  // Command-input /quit is a first-class session terminator (same as q).
  const quitSlash = resolveShellKeypress('', { return: true }, {
    ...model,
    focus: 'input',
    commandInput: '/quit',
  });
  assert.equal(quitSlash.type, 'quit');
  assert.equal(quitSlash.actionId, '/quit');
  assert.equal(quitSlash.endsSession, true);
  assert.equal(isShellSessionEndAction('/quit'), true);
  assert.equal(isShellSessionEndAction('quit'), true);
  assert.equal(isShellSessionEndAction('q'), true);
  assert.equal(isShellSessionEndAction('help'), false);
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
        // Phase-1 launcher is native Ink; use config (still nested) to prove buffered answer.
        stdin.write('\nc\n');
        onRequestAction('config');
        return { aborted: false, requestedAction: 'config' };
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
        contentSurface: 'config',
        actionResult: {
          action_id: 'config',
          ok: true,
          exit_code: 0,
          reason_code: 'CONFIG_OK',
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
          // Phase-2 nested pane still exercises soft remount on ok:false.
          onRequestAction('config');
          return { aborted: false, requestedAction: 'config' };
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
          action_id: 'config',
          ok: false,
          exit_code: 1,
          reason_code: 'CONFIG_FAILED',
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
  assert.equal(result.model.actionResult?.reason_code, 'CONFIG_FAILED');
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
        onRequestAction('config');
        return { aborted: false, requestedAction: 'config' };
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
        onRequestAction('config');
        return { aborted: false, requestedAction: 'config' };
      },
    }),
    executeAction: async () => ({
      quit: false,
      selectedRunId: null,
      contentSurface: 'action_result',
      actionResult: {
        action_id: 'config',
        ok: false,
        exit_code: 1,
        reason_code: 'CONFIG_FAILED',
        text: 'failed',
      },
      evidenceModel: null,
      configModel: null,
      statusResult: null,
      runsPayload: null,
    }),
  });
  assert.equal(result.model.actionResult.reason_code, 'CONFIG_FAILED');
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

test('System Status hotkey 3 and Enter stay mounted; Settings back remounts', async () => {
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
      if (opts.actionId === 'config') {
        return {
          quit: false,
          selectedRunId: null,
          contentSurface: 'config',
          actionResult: {
            action_id: 'config',
            ok: true,
            exit_code: 0,
            reason_code: 'CONFIG_READINESS_PANE_BACK',
            text: 'back',
          },
          configModel: {
            ok: true,
            model_policy: 'local_only',
            path_activation: { status: 'ready', on_path: true },
            credentials: { credential_sufficiency: 'not_required', providers: [] },
            remediation_candidates: [],
          },
        };
      }
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
  stdin.write('4'); // Settings → nested config
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(actions, ['config']);
  stdin.write('q');
  const result = await promise;
  const joined = out.join('');
  assert.ok(joined.includes('nested pane'), 'Settings still uses Phase-2 nested pane');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(joined.split(restoreSeq).length - 1, 1, 'alt-screen exit only at session end');
  stdin.destroy();
  stdout.destroy();
});

test('Settings nested pane back remounts Ink shell (not silent TUI_SHELL_OK)', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let renderPasses = 0;
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
      renderOperatorTuiShell: async ({ onRequestAction }) => {
        renderPasses += 1;
        if (renderPasses === 1) {
          onRequestAction('config');
          return { aborted: false, requestedAction: 'config' };
        }
        if (renderPasses === 2) {
          onRequestAction('q');
          return { aborted: false, requestedAction: 'q' };
        }
        return { aborted: false, requestedAction: null };
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
        };
      }
      return {
        quit: false,
        selectedRunId: null,
        contentSurface: 'config',
        actionResult: {
          action_id: 'config',
          ok: true,
          exit_code: 0,
          reason_code: 'CONFIG_READINESS_PANE_BACK',
          text: 'back',
        },
        configModel: {
          ok: true,
          model_policy: 'local_only',
          path_activation: { status: 'ready', on_path: true },
          credentials: { credential_sufficiency: 'not_required', providers: [] },
          remediation_candidates: [],
        },
      };
    },
  });
  assert.equal(renderPasses, 2, 'config back must remount a second Ink frame');
  assert.equal(result.reason_code, TUI_SHELL_REASON.QUIT);
  assert.notEqual(result.reason_code, TUI_SHELL_REASON.OK);
  assert.equal(result.model.contentSurface, 'config');
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
