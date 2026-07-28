'use strict';

/**
 * Integrated fullscreen TUI quality gate — release-blocking product journey.
 * State/reason-code assertions; not pixel snapshots or live provider credentials.
 */

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  TUI_QUALITY_SCENARIOS,
  TUI_QUALITY_INTEGRATED_SCENARIOS,
  TUI_QUALITY_RELEASE_COMMAND,
  TUI_QUALITY_PLATFORM_SLOTS,
  LIVE_FIXTURE_EVIDENCE,
  PROVENANCE_DISTINCT_TOKENS,
  buildLifecycleStateFixtures,
  buildPlatformEvidenceRecord,
  evaluateReleaseGateVerdict,
  assertNoFabricatedZero,
  assertNoInferredProgress,
  assertMvpClaimHonesty,
  assertAnsiPolicy,
} = require('../../modules/operator/operator-tui-quality-harness');

const {
  provenanceField,
  formatProvenanceField,
  adaptHomeReadiness,
  adaptRunsList,
  adaptSelectedRunStatus,
  adaptEvidenceAttachState,
  adaptConfigReadiness,
  adaptLifecycleSummary,
  adaptLiveHarnessEvidence,
} = require('../../modules/operator/operator-tui-adapters');

const {
  buildShellModel,
  layoutModeForColumns,
  formatShellText,
  shellModelToOptions,
} = require('../../modules/operator/operator-tui-shell-model');

const {
  adaptLiveMonitor,
  formatLiveMonitorLines,
} = require('../../modules/operator/operator-tui-live-monitor');

const {
  createTerminalGuard,
  withTerminalGuard,
  RESTORE_SEQUENCE,
  SOFT_HANDOFF_SEQUENCE,
} = require('../../modules/operator/operator-tui-terminal-guard');

const {
  TUI_SHELL_REASON,
  runOperatorTuiShell,
} = require('../../modules/operator/operator-tui-shell-entry');

const { executeShellAction, resolveShellActionToken } = require('../../modules/operator/operator-tui-shell-actions');
const {
  parseSlashCommand,
  resolveSlashDispatch,
  IMPLEMENTED_COMMANDS,
} = require('../../modules/operator/operator-tui-slash-commands');
const {
  buildGuidedLauncherModel,
} = require('../../modules/operator/operator-guided-launcher-model');
const {
  LIVE_REASON,
  classifyLiveHarnessOutcome,
} = require('../../modules/operator/operator-live-harness');
const { resolveUseColorForCli } = require('../../modules/operator/terminal-style');

function createFakeTtyStreams(columns = 100) {
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
  stdout.columns = columns;
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

function shellFixtures(overrides = {}) {
  return {
    isTTY: true,
    loadRuns: () => canonicalRunsResult([
      { run_id: 'qg-run-1', status: 'running', result_code: 'RUN_FOUND', outcome: null },
    ]),
    buildAbout: () => ({ version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'qg' }),
    assessCredentials: () => ({ credential_sufficiency: 'not_required', providers: [] }),
    assessPath: () => ({ status: 'ready', on_path: true }),
    ...overrides,
  };
}

test('integrated inventory covers MVP and fullscreen journey scenarios', () => {
  for (const id of TUI_QUALITY_SCENARIOS) {
    assert.ok(typeof id === 'string' && id.length > 0);
  }
  assert.ok(TUI_QUALITY_SCENARIOS.includes('non_tty_fallback'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('fullscreen_boot_clean_exit'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('guided_launcher'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('live_monitor'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('slash_commands'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('canonical_fixture_acceptance_hooks'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('live_fixture_evidence_separate'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('run_state_repeated_blocker'));
  assert.ok(TUI_QUALITY_INTEGRATED_SCENARIOS.includes('detach_does_not_mutate_run'));
  assert.match(TUI_QUALITY_RELEASE_COMMAND, /test:tui-quality/);
  assert.equal(LIVE_FIXTURE_EVIDENCE.replaced_by_mocks, false);
});

test('provenance tokens 0 / unknown / unavailable / not_configured / unlimited stay distinct', () => {
  const rendered = PROVENANCE_DISTINCT_TOKENS.map((token) => formatProvenanceField(provenanceField(token)));
  assert.equal(new Set(rendered).size, rendered.length);
  assert.notEqual(formatProvenanceField(provenanceField(0)), formatProvenanceField(provenanceField('unavailable')));
  assert.notEqual(formatProvenanceField(provenanceField('unavailable')), '0');
  assert.notEqual(formatProvenanceField(provenanceField('unknown')), '0');
  assert.notEqual(formatProvenanceField(provenanceField('not_configured')), 'unlimited');
});

test('lifecycle fixtures cover active through zero-cost without fabricating missing cost', () => {
  const fixtures = buildLifecycleStateFixtures();
  const required = [
    'active',
    'successful',
    'failed',
    'blocked',
    'exhausted',
    'cancelled',
    'repeated_blocker',
    'unavailable_budget',
    'zero_cost',
  ];
  for (const key of required) {
    assert.ok(fixtures[key], `missing fixture ${key}`);
  }

  const active = adaptLifecycleSummary(fixtures.active);
  assert.equal(active.measured_cost.value, 0);
  assert.equal(active.measured_cost.availability, 'available');
  assert.equal(active.configured_budget.availability, 'unlimited');
  assert.equal(active.latest_verdict.availability, 'absent');

  const successful = adaptLiveMonitor({ loop_envelope: fixtures.successful });
  assert.ok(['done', 'evidence_ready'].includes(successful.monitor_phase));
  assertNoInferredProgress(successful);

  const failed = adaptLiveMonitor({ loop_envelope: fixtures.failed });
  assert.equal(failed.monitor_phase, 'failed');
  assert.equal(failed.outcome.value, 'failed');

  const blocked = adaptLiveMonitor({ loop_envelope: fixtures.blocked });
  assert.equal(blocked.monitor_phase, 'blocked');
  assert.equal(blocked.loop.latest_blocker.value, 'CERBERUS_REJECT');
  assertNoFabricatedZero(blocked.loop.measured_cost, 'blocked.measured_cost');

  const exhausted = adaptLiveMonitor({ loop_envelope: fixtures.exhausted });
  assert.equal(exhausted.monitor_phase, 'exhausted');
  assert.equal(exhausted.guard_visually_distinct, true);

  const cancelled = adaptLiveMonitor({ loop_envelope: fixtures.cancelled });
  assert.equal(cancelled.monitor_phase, 'cancelled');
  assert.notEqual(cancelled.monitor_phase, 'done');

  const repeated = adaptLiveMonitor({ loop_envelope: fixtures.repeated_blocker });
  assert.match(formatLiveMonitorLines(repeated).join('\n'), /CERBERUS_BLOCKERS_ITERATE/);

  const unavailableBudget = adaptLifecycleSummary(fixtures.unavailable_budget);
  assert.equal(unavailableBudget.measured_cost.availability, 'unavailable');
  assertNoFabricatedZero(unavailableBudget.measured_cost, 'unavailable_budget');

  const zeroCost = adaptLifecycleSummary(fixtures.zero_cost);
  assert.equal(zeroCost.measured_cost.value, 0);
  assert.equal(zeroCost.measured_cost.availability, 'available');
  assert.notEqual(
    formatProvenanceField(unavailableBudget.measured_cost),
    formatProvenanceField(zeroCost.measured_cost),
  );
});

test('operator adapters remain authoritative across home / runs / status / evidence / config', () => {
  const home = adaptHomeReadiness({
    aboutInfo: { version: '0.26.0-beta.1', git_commit: 'qg', model_policy: 'local_only' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
  });
  assert.equal(home.kind, 'home_readiness');
  assert.equal(home.path_status, 'ready');

  const runs = adaptRunsList(canonicalRunsResult([
    { run_id: 'r1', status: 'complete', outcome: 'success', reason_code: 'OK' },
  ]));
  assert.equal(runs.runs[0].reason_code, 'OK');

  const status = adaptSelectedRunStatus({
    run_id: 'r1',
    result_code: 'RUN_FOUND',
    status: 'complete',
    outcome: 'success',
    reason_code: 'GATE_OK',
    next_safe_action: 'attach',
  });
  assert.equal(status.reason_code, 'GATE_OK');
  assert.equal(status.available, true);

  const evidence = adaptEvidenceAttachState({
    run_id: 'r1',
    result_code: 'OK',
    attach_available: false,
    attach_bundle_available: false,
    attach_action_available: true,
    reason_code: 'ATTACH_MISSING',
    next_safe_action: 'attach',
  });
  assert.equal(evidence.reason_code, 'ATTACH_MISSING');
  assert.equal(evidence.attach_available, false);

  const config = adaptConfigReadiness({
    path_status: 'ready',
    model_policy: 'local_only',
    doctor_ok: true,
    credential_sufficiency: 'not_required',
    next_safe_action: 'smoke',
    remediations: [],
  });
  assert.equal(config.doctor_ok, true);
});

test('shell journey: home + panes + launcher + monitor + slash + resize without prose parsing', async () => {
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'qg' },
    pathActivation: { status: 'ready', on_path: true },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    runsPayload: canonicalRunsResult([
      { run_id: 'qg-run-1', status: 'running', result_code: 'RUN_FOUND' },
    ]),
    statusResult: {
      run_id: 'qg-run-1',
      result_code: 'RUN_FOUND',
      status: 'running',
      outcome: null,
      reason_code: null,
      next_safe_action: 'monitor',
    },
    evidenceModel: {
      run_id: 'qg-run-1',
      result_code: 'OK',
      attach_available: false,
      attach_bundle_available: false,
      attach_action_available: true,
      reason_code: null,
      next_safe_action: 'attach',
    },
    configModel: {
      ok: true,
      model_policy: 'local_only',
      path_activation: { status: 'ready', on_path: true },
      credentials: { credential_sufficiency: 'not_required', providers: [] },
      next_safe_action: 'smoke',
      remediation_candidates: [],
    },
    launcherModel: buildGuidedLauncherModel({
      agentFlow: 'single_agent',
      inferenceLane: 'local_only',
      gatePosture: 'degraded',
      goalSource: 'custom',
      goal: 'integrated quality gate',
      env: {},
      localBackendReachable: true,
      credentials: { credential_sufficiency: 'not_required', providers: [] },
    }),
    monitorSource: { loop_envelope: buildLifecycleStateFixtures().active },
    contentSurface: 'home',
    columns: 100,
    rows: 30,
  });

  assert.equal(model.home.path_status, 'ready');
  assert.equal(model.runs.runs[0].run_id, 'qg-run-1');
  assert.equal(model.status.reason_code, null);
  assert.equal(model.evidence.attach_available, false);
  assert.equal(model.config.doctor_ok, true);
  assert.equal(model.launcher.can_launch, true);
  assert.equal(model.monitor.monitor_phase, 'running');
  assertNoInferredProgress(model.monitor);
  assertMvpClaimHonesty(formatShellText(model));

  const narrow = buildShellModel({ ...shellModelToOptions(model), columns: 50 });
  assert.equal(layoutModeForColumns(50), 'narrow');
  assert.equal(narrow.layout, 'narrow');

  assert.equal(resolveShellActionToken('1'), 'launcher');
  assert.equal(resolveShellActionToken('m'), 'monitor');
  assert.equal(parseSlashCommand('/status qg-run-1').kind, 'implemented');
  assert.ok(IMPLEMENTED_COMMANDS.length >= 1);
  const slash = resolveSlashDispatch(parseSlashCommand('/help'));
  assert.equal(slash.ok, true);
  assert.equal(slash.reason_code, 'TUI_SLASH_HELP');

  const select = await executeShellAction({
    actionId: 'select',
    question: async () => '1',
    write: () => {},
    runSelector: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_SELECTED',
      selected_run_id: 'qg-run-1',
      status_pane: model.status,
      text: 'selected',
    }),
  });
  assert.equal(select.contentSurface, 'status');
  assert.equal(select.actionResult.reason_code, 'RUN_SELECTOR_SELECTED');
});

test('fullscreen boot clean exit and failure paths restore terminal', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  const boot = await runOperatorTuiShell({
    ...shellFixtures(),
    stdin,
    stdout,
    autoQuitMs: 40,
    maxLoops: 1,
  });
  assert.equal(boot.ok, true);
  assert.equal(boot.ink_loaded, true);
  assert.equal(boot.guard.restored, true);
  assert.ok(
    boot.reason_code === TUI_SHELL_REASON.OK
      || boot.reason_code === TUI_SHELL_REASON.QUIT
      || boot.reason_code === TUI_SHELL_REASON.MAX_LOOPS,
  );
  stdin.destroy();
  stdout.destroy();

  const child = await runOperatorTuiShell({
    ...shellFixtures({ injectFailure: 'child' }),
    importRenderer: async () => ({ renderOperatorTuiShell: async () => ({}) }),
  });
  assert.equal(child.reason_code, TUI_SHELL_REASON.CHILD_FAILURE);
  assert.equal(child.guard.restored, true);

  const renderer = await runOperatorTuiShell({
    ...shellFixtures({ injectFailure: 'renderer' }),
    importRenderer: async () => ({
      renderOperatorTuiShell: async () => ({ aborted: false }),
    }),
  });
  assert.equal(renderer.reason_code, TUI_SHELL_REASON.RENDERER_EXCEPTION);
  assert.equal(renderer.guard.restored, true);

  const actionStreams = createFakeTtyStreams();
  const actionFail = await runOperatorTuiShell({
    ...shellFixtures(),
    stdin: actionStreams.stdin,
    stdout: actionStreams.stdout,
    autoQuitMs: 40,
    maxLoops: 1,
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
  assert.equal(actionFail.model.actionResult.reason_code, 'SMOKE_FAILED');
  // ok:false remounts soft; session ends via maxLoops/autoQuit — not ACTION_FAILURE.
  assert.equal(actionFail.guard.restored, true);
  assert.notEqual(actionFail.reason_code, TUI_SHELL_REASON.ACTION_FAILURE);
  assert.equal(actionFail.reason_code, TUI_SHELL_REASON.OK);
  actionStreams.stdin.destroy();
  actionStreams.stdout.destroy();

  const writes = [];
  const guardStdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(mode) {
      this.isRaw = Boolean(mode);
      return this;
    },
  };
  const guard = createTerminalGuard({
    stdin: guardStdin,
    writeRestore: (seq) => writes.push(seq),
  });
  guardStdin.setRawMode(true);
  await withTerminalGuard(guard, async () => 'ok', 'normal');
  // Success softens for remount/pane handoff — full restore is session-end only.
  assert.equal(guard.restored, false);
  assert.equal(guardStdin.isRaw, false);
  assert.ok(writes.includes(SOFT_HANDOFF_SEQUENCE));
  guard.restore('normal');
  assert.equal(guard.restored, true);
  assert.ok(writes.includes(RESTORE_SEQUENCE));
});

test('Ctrl+C abort restores terminal and does not mutate run success', async () => {
  const { stdin, stdout } = createFakeTtyStreams();
  let tracesMutated = false;
  const promise = runOperatorTuiShell({
    ...shellFixtures(),
    stdin,
    stdout,
    maxLoops: 1,
    executeAction: async () => {
      tracesMutated = true;
      throw new Error('must not execute after abort');
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  stdin.write('\u0003');
  const result = await promise;
  assert.equal(result.reason_code, TUI_SHELL_REASON.ABORT);
  assert.equal(result.guard.restored, true);
  assert.equal(stdin.isRaw, false);
  assert.equal(tracesMutated, false);
  stdin.destroy();
  stdout.destroy();
});

test('non-TTY and NO_COLOR policies stay honest', async () => {
  const nonTty = await runOperatorTuiShell({
    isTTY: false,
    importRenderer: async () => {
      throw new Error('renderer must not load on non-TTY');
    },
  });
  assert.equal(nonTty.ok, false);
  assert.equal(nonTty.reason_code, TUI_SHELL_REASON.NON_TTY);
  assert.equal(nonTty.ink_loaded, false);
  assert.match(nonTty.text, /requires a TTY/i);
  assertAnsiPolicy(nonTty.text, { useColor: false });

  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    assert.equal(resolveUseColorForCli({}), false);
    const model = buildShellModel({
      aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only' },
      pathActivation: { status: 'ready', on_path: true },
      credentials: { credential_sufficiency: 'not_required', providers: [] },
      runsPayload: canonicalRunsResult([]),
      columns: 80,
      colorEnabled: false,
    });
    assertAnsiPolicy(formatShellText(model), { useColor: false });
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('detach / quit does not claim successful run mutation', async () => {
  const quit = await executeShellAction({
    actionId: 'quit',
    write: () => {},
  });
  assert.equal(quit.quit, true);
  assert.equal(quit.actionResult.reason_code, 'TUI_SHELL_QUIT');
  assert.notEqual(quit.actionResult.reason_code, 'RUN_SUCCESS');

  const monitor = adaptLiveMonitor({
    loop_envelope: buildLifecycleStateFixtures().active,
  });
  assert.equal(monitor.detach_safe, true);
  assert.notEqual(monitor.monitor_phase, 'done');
});

test('canonical fixture hooks remain separate from live PASS mocks', () => {
  assert.equal(LIVE_FIXTURE_EVIDENCE.replaced_by_mocks, false);
  assert.match(LIVE_FIXTURE_EVIDENCE.command_hint, /execute-live/);
  assert.match(LIVE_FIXTURE_EVIDENCE.note, /MATRIX_READY is not PASS/);

  const readyOnly = classifyLiveHarnessOutcome({
    readiness: 'ready',
  });
  assert.equal(readyOnly.outcome, 'BLOCKED');
  assert.equal(readyOnly.reason_code, LIVE_REASON.READY_IS_NOT_PASS);
  assert.notEqual(readyOnly.outcome, 'PASS');

  const adapted = adaptLiveHarnessEvidence({
    fixture_id: 'sudoku-html-app',
    row_id: 'sa-local_only',
    reason_code: LIVE_REASON.READY_IS_NOT_PASS,
    outcome: 'BLOCKED',
    executed_live: false,
  });
  assert.equal(adapted.reason_code, LIVE_REASON.READY_IS_NOT_PASS);
  assert.notEqual(String(adapted.outcome ?? '').toUpperCase(), 'PASS');
});

test('platform evidence: Linux stamps pass; macOS/live never silent-pass; missing blocks release', () => {
  assert.ok(TUI_QUALITY_PLATFORM_SLOTS.linux_node22.required_for_release);
  assert.ok(TUI_QUALITY_PLATFORM_SLOTS.macos_node22_tty.required_for_release);
  assert.equal(TUI_QUALITY_PLATFORM_SLOTS.windows_interactive.required_for_release, false);

  const nodeMajor = Number.parseInt(String(process.versions.node).split('.')[0], 10);
  const evidence = buildPlatformEvidenceRecord({
    automatedGateOk: true,
    platform: 'linux',
    nodeMajor,
  });
  assert.equal(evidence.live_fixture.replaced_by_mocks, false);
  assert.equal(evidence.slots.macos_node22_tty.status, 'blocked');
  assert.equal(evidence.slots.windows_interactive.status, 'deferred');
  assert.equal(evidence.slots.live_canonical_fixture.status, 'deferred');
  if (nodeMajor === 22) assert.equal(evidence.slots.linux_node22.status, 'pass');
  if (nodeMajor === 24) assert.equal(evidence.slots.linux_node24.status, 'pass');

  const blocked = evaluateReleaseGateVerdict({
    automatedGateOk: true,
    platformEvidence: evidence,
  });
  assert.equal(blocked.verdict, 'blocked');
  assert.ok(blocked.reasons.some((r) => r.startsWith('macos_node22_tty:')));

  const fail = evaluateReleaseGateVerdict({ automatedGateOk: false });
  assert.equal(fail.verdict, 'fail');

  const releaseReady = evaluateReleaseGateVerdict({
    automatedGateOk: true,
    platformEvidence: buildPlatformEvidenceRecord({
      automatedGateOk: true,
      platform: 'linux',
      nodeMajor: 22,
      overrides: {
        linux_node22: { status: 'pass', evidence: 'CI Node 22' },
        linux_node24: { status: 'pass', evidence: 'CI Node 24' },
        macos_node22_tty: { status: 'pass', evidence: 'manual TTY smoke recorded' },
      },
    }),
  });
  assert.equal(releaseReady.verdict, 'pass');
  assert.deepEqual(releaseReady.reasons, []);
});
