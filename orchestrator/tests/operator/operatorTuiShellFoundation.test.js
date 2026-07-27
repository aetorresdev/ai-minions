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
} = require('../../modules/operator/operator-tui-shell-model');
const {
  createTerminalGuard,
  withTerminalGuard,
  RESTORE_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');
const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
} = require('../../modules/operator/operator-tui-shell-entry');
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
        onRequestAction('smoke');
        return { aborted: false, requestedAction: 'smoke' };
      },
    }),
    executeAction: async () => ({
      quit: false,
      selectedRunId: null,
      contentSurface: 'action_result',
      actionResult: {
        action_id: 'smoke',
        ok: false,
        exit_code: 1,
        reason_code: 'SMOKE_FAILED',
        text: 'failed',
      },
      evidenceModel: null,
      configModel: null,
      statusResult: null,
      runsPayload: null,
    }),
  });
  assert.equal(result.model.actionResult.reason_code, 'SMOKE_FAILED');
  assert.equal(result.guard.restored, true);
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
  assert.match(out, /ai-minions/);
  assert.match(out, /shell-run/);
  assert.match(out, /Actions/);
  assert.match(out, /live run monitor/);
});

test('resolveShellActionToken maps cockpit keys', () => {
  assert.equal(resolveShellActionToken('1'), 'smoke');
  assert.equal(resolveShellActionToken('s'), 'select');
  assert.equal(resolveShellActionToken('m'), 'monitor');
  assert.equal(resolveShellActionToken('q'), 'quit');
  assert.equal(resolveShellActionToken('', 'config'), 'config');
  assert.equal(resolveShellActionToken('nope'), null);
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
