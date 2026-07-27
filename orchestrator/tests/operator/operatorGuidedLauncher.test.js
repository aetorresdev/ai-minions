'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  LAUNCHER_SCHEMA,
  LAUNCHER_REASON,
  INFERENCE_LANE_OPTIONS,
  buildGuidedLauncherModel,
  formatGuidedLauncherLines,
  buildEquivalentCommand,
  resolveConfiguredLimits,
  shellQuote,
} = require('../../modules/operator/operator-guided-launcher-model');
const {
  runOperatorGuidedLauncherPane,
} = require('../../modules/operator/operator-guided-launcher-pane-tui');
const { adaptGuidedLauncher } = require('../../modules/operator/operator-tui-adapters');
const { buildShellModel } = require('../../modules/operator/operator-tui-shell-model');
const { resolveCockpitAction, COCKPIT_ACTIONS } = require('../../modules/operator/operator-cockpit-tui');
const { DEFAULT_SMOKE_GOAL } = require('../../modules/operator/operator-guided-first-run');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MATRIX_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'tester-six-mode-matrix-data.mjs');

test('cockpit nav exposes guided launcher (smoke aliases resolve)', () => {
  assert.equal(COCKPIT_ACTIONS[0].id, 'launcher');
  assert.equal(resolveCockpitAction('1')?.id, 'launcher');
  assert.equal(resolveCockpitAction('launcher')?.id, 'launcher');
  assert.equal(resolveCockpitAction('smoke')?.id, 'launcher');
  assert.equal(resolveCockpitAction('new')?.id, 'launcher');
});

test('inference lanes map remote-only wording to remote_ok; hybrid disabled', () => {
  const remote = INFERENCE_LANE_OPTIONS.find((l) => l.id === 'remote_ok');
  const hybrid = INFERENCE_LANE_OPTIONS.find((l) => l.id === 'hybrid');
  assert.equal(remote.product_policy, 'remote_ok');
  assert.equal(remote.label, 'remote only');
  assert.equal(hybrid.enabled, false);
  assert.equal(hybrid.disabled_reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
  assert.equal(hybrid.product_policy, null);
});

test('mode matrix: each agent×lane selection builds honest readiness', () => {
  const cases = [
    { agentFlow: 'single_agent', inferenceLane: 'local_only', env: {}, expectReady: true },
    { agentFlow: 'multi_agent', inferenceLane: 'local_only', env: {}, expectReady: true },
    {
      agentFlow: 'single_agent',
      inferenceLane: 'remote_ok',
      env: { ANTHROPIC_API_KEY: 'x' },
      expectReady: true,
    },
    {
      agentFlow: 'multi_agent',
      inferenceLane: 'remote_ok',
      env: { OPENAI_API_KEY: 'y' },
      expectReady: true,
    },
    {
      agentFlow: 'single_agent',
      inferenceLane: 'remote_ok',
      env: {},
      expectReady: false,
      reason: LAUNCHER_REASON.REMOTE_CREDENTIALS_MISSING,
    },
    {
      agentFlow: 'single_agent',
      inferenceLane: 'hybrid',
      env: { ANTHROPIC_API_KEY: 'x' },
      expectReady: false,
      reason: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
    },
    {
      agentFlow: 'multi_agent',
      inferenceLane: 'hybrid',
      env: {},
      expectReady: false,
      reason: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
    },
  ];

  for (const c of cases) {
    const model = buildGuidedLauncherModel({
      agentFlow: c.agentFlow,
      inferenceLane: c.inferenceLane,
      gatePosture: 'degraded',
      goalSource: 'custom',
      goal: 'List three files and stop',
      env: c.env,
      localBackendReachable: true,
    });
    assert.equal(model.schema, LAUNCHER_SCHEMA);
    assert.equal(model.can_launch, c.expectReady, JSON.stringify(c));
    if (c.reason) {
      assert.equal(model.blocked_reason_code, c.reason);
    }
    if (c.inferenceLane === 'hybrid') {
      assert.equal(model.equivalent_command, null);
      assert.match(model.remediation || '', /hybrid/i);
      assert.doesNotMatch(model.equivalent_command || '', /--model-policy hybrid/);
    }
  }
});

test('missing local backend and missing goal produce explicit skip/block', () => {
  const localMissing = buildGuidedLauncherModel({
    agentFlow: 'single_agent',
    inferenceLane: 'local_only',
    goal: 'ok',
    goalSource: 'custom',
    localBackendReachable: false,
    env: {},
  });
  assert.equal(localMissing.can_launch, false);
  assert.equal(localMissing.blocked_reason_code, LAUNCHER_REASON.LOCAL_BACKEND_MISSING);
  assert.match(localMissing.remediation || '', /ollama|backend/i);

  const noGoal = buildGuidedLauncherModel({
    agentFlow: 'single_agent',
    inferenceLane: 'local_only',
    goal: '',
    goalSource: 'custom',
    localBackendReachable: true,
    env: {},
  });
  assert.equal(noGoal.can_launch, false);
  assert.equal(noGoal.blocked_reason_code, LAUNCHER_REASON.GOAL_REQUIRED);
});

test('strict vs degraded gate posture and configured vs unconfigured limits', () => {
  const degraded = buildGuidedLauncherModel({
    agentFlow: 'single_agent',
    inferenceLane: 'local_only',
    gatePosture: 'degraded',
    goalSource: 'custom',
    goal: 'goal',
    env: {},
    localBackendReachable: true,
  });
  assert.equal(degraded.gate_posture, 'degraded');
  assert.equal(degraded.execution_summary.skip_gates.value, true);
  assert.equal(degraded.execution_summary.max_iterations.value, 1);
  assert.equal(degraded.execution_summary.max_retries.availability, 'not_configured');
  assert.equal(degraded.execution_summary.cost_limit_usd.availability, 'not_configured');
  assert.equal(degraded.execution_summary.approved_artifacts.availability, 'not_configured');

  const strict = buildGuidedLauncherModel({
    agentFlow: 'multi_agent',
    inferenceLane: 'local_only',
    gatePosture: 'strict',
    goalSource: 'custom',
    goal: 'goal',
    maxIterations: 3,
    maxRetries: 0,
    costLimitUsd: 0,
    env: { ORCH_MAX_COST_USD: '1.5' },
    localBackendReachable: true,
  });
  assert.equal(strict.gate_posture, 'strict');
  assert.equal(strict.execution_summary.skip_gates.value, false);
  assert.equal(strict.execution_summary.max_iterations.value, 3);
  assert.equal(strict.execution_summary.max_retries.value, 0);
  assert.equal(strict.execution_summary.max_retries.availability, 'available');
  // explicit option wins over env
  assert.equal(strict.execution_summary.cost_limit_usd.value, 0);
  assert.match(strict.equivalent_command || '', /--flow multi_agent/);
  assert.doesNotMatch(strict.equivalent_command || '', /--skip-gates/);
  assert.match(formatGuidedLauncherLines(strict).join('\n'), /cerberus_gate/);
});

test('absent vs zero vs unlimited vs not_configured remain distinct', () => {
  const limits = resolveConfiguredLimits({
    maxIterations: undefined,
    maxRetries: 0,
    costLimitUsd: 'unlimited',
    timeLimit: 'not_configured',
    approvedArtifacts: undefined,
    env: {},
  });
  assert.equal(limits.max_iterations.availability, 'not_configured');
  assert.equal(limits.max_retries.availability, 'available');
  assert.equal(limits.max_retries.value, 0);
  assert.equal(limits.cost_limit_usd.availability, 'unlimited');
  assert.equal(limits.time_limit.availability, 'not_configured');
  assert.notEqual(
    String(limits.max_iterations.availability),
    String(limits.max_retries.value),
  );
});

test('equivalent command never invents hybrid policy', () => {
  const cmd = buildEquivalentCommand({
    agentFlow: 'single_agent',
    productPolicy: 'remote_ok',
    gatePosture: 'degraded',
    goal: 'x',
    defaultSmokeGoal: 'canonical default smoke goal',
    maxIterations: 1,
  });
  assert.equal(cmd, "ai-minions smoke --model-policy remote_ok --goal 'x'");
  assert.doesNotMatch(cmd, /hybrid/);
});

test('smoke equivalent_command includes --goal for custom and fixture goals', () => {
  const defaultGoal = 'canonical default smoke goal';
  const custom = buildEquivalentCommand({
    agentFlow: 'single_agent',
    productPolicy: 'local_only',
    gatePosture: 'degraded',
    goal: "List three files and stop",
    defaultSmokeGoal: defaultGoal,
    maxIterations: 1,
  });
  assert.match(custom, /^ai-minions smoke --model-policy local_only --goal /);
  assert.match(custom, /--goal 'List three files and stop'/);
  assert.equal(custom, `ai-minions smoke --model-policy local_only --goal ${shellQuote("List three files and stop")}`);

  const fixtureGoal = 'Build a sudoku HTML app and stop.';
  const fixture = buildEquivalentCommand({
    agentFlow: 'single_agent',
    productPolicy: 'local_only',
    gatePosture: 'degraded',
    goal: fixtureGoal,
    defaultSmokeGoal: defaultGoal,
    maxIterations: 1,
  });
  assert.equal(
    fixture,
    `ai-minions smoke --model-policy local_only --goal ${shellQuote(fixtureGoal)}`,
  );

  const defaultSmoke = buildEquivalentCommand({
    agentFlow: 'single_agent',
    productPolicy: 'local_only',
    gatePosture: 'degraded',
    goal: defaultGoal,
    defaultSmokeGoal: defaultGoal,
    maxIterations: 1,
  });
  assert.equal(defaultSmoke, 'ai-minions smoke --model-policy local_only');
  assert.doesNotMatch(defaultSmoke, /--goal/);
});

test('unknown wall-clock env vars do not invent a time_limit', () => {
  const limits = resolveConfiguredLimits({
    env: {
      ORCH_WALL_CLOCK_LIMIT_MS: '60000',
      ORCH_MAX_WALL_MS: '120000',
      ORCH_MAX_ITERATIONS: '4',
    },
  });
  assert.equal(limits.time_limit.availability, 'not_configured');
  assert.equal(limits.time_limit.value, null);
  assert.equal(limits.max_iterations.value, 4);

  const explicit = resolveConfiguredLimits({
    timeLimit: 90000,
    env: { ORCH_WALL_CLOCK_LIMIT_MS: '60000' },
  });
  assert.equal(explicit.time_limit.availability, 'available');
  assert.equal(explicit.time_limit.value, 90000);
  assert.equal(explicit.time_limit.source, 'cli_or_options');
});

test('pane: hybrid selection skips without launching; remote missing remediates', async () => {
  const hybrid = await runOperatorGuidedLauncherPane({
    question: async () => 'n',
    write: () => {},
    selections: {
      agentFlow: 'single_agent',
      inferenceLane: 'hybrid',
      gatePosture: 'degraded',
      goalSource: 'custom',
      goal: 'x',
      confirm: true,
    },
    env: {},
    localBackendReachable: true,
    runSmokeFn: async () => {
      throw new Error('must not launch');
    },
  });
  assert.equal(hybrid.launched, false);
  assert.equal(hybrid.reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
  assert.match(hybrid.text, /MATRIX_SKIP_HYBRID_UNSUPPORTED|hybrid/i);

  const remote = await runOperatorGuidedLauncherPane({
    question: async () => 'n',
    write: () => {},
    selections: {
      agentFlow: 'multi_agent',
      inferenceLane: 'remote_ok',
      gatePosture: 'strict',
      goalSource: 'custom',
      goal: 'x',
      confirm: true,
    },
    env: {},
    localBackendReachable: true,
    runSmokeFn: async () => {
      throw new Error('must not launch');
    },
  });
  assert.equal(remote.launched, false);
  assert.equal(remote.reason_code, LAUNCHER_REASON.REMOTE_CREDENTIALS_MISSING);
  assert.match(remote.text, /ANTHROPIC_API_KEY|OPENAI_API_KEY/);
});

test('pane launches via smoke contract when single_agent degraded', async () => {
  let called = null;
  const customGoal = 'List three files and stop';
  const result = await runOperatorGuidedLauncherPane({
    question: async () => 'y',
    write: () => {},
    selections: {
      agentFlow: 'single_agent',
      inferenceLane: 'local_only',
      gatePosture: 'degraded',
      goalSource: 'custom',
      goal: customGoal,
      confirm: true,
    },
    env: {},
    localBackendReachable: true,
    defaultSmokeGoal: DEFAULT_SMOKE_GOAL,
    runSmokeFn: async (opts) => {
      called = opts;
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'SMOKE_OK',
        smokeText: 'smoke ok',
        next_safe_action: 'ai-minions status --run-id t1',
        launched: { task_id: 't1', terminal_status: 'done' },
      };
    },
  });
  assert.equal(result.launched, true);
  assert.equal(result.ok, true);
  assert.equal(called.modelPolicy, 'local_only');
  assert.equal(called.skipGates, true);
  assert.equal(called.maxIterations, 1);
  assert.equal(called.goal, customGoal);
  const expectedCmd = `ai-minions smoke --model-policy local_only --goal ${shellQuote(customGoal)}`;
  assert.equal(result.model.equivalent_command, expectedCmd);
  assert.match(result.text, /equivalent_command: ai-minions smoke --model-policy local_only --goal /);
  assert.equal(result.model.launch_options.goal, customGoal);
});

test('pane fixture goal is recorded in equivalent_command and launch_options', async () => {
  const fixtureGoal = 'Fixture: build solar-system HTML demo and stop.';
  let called = null;
  const result = await runOperatorGuidedLauncherPane({
    question: async () => 'y',
    write: () => {},
    selections: {
      agentFlow: 'single_agent',
      inferenceLane: 'local_only',
      gatePosture: 'degraded',
      goalSource: 'fixture',
      fixtureId: 'solar-system-html-demo',
      goal: fixtureGoal,
      confirm: true,
    },
    env: {},
    localBackendReachable: true,
    defaultSmokeGoal: DEFAULT_SMOKE_GOAL,
    loadFixturePromptFn: async () => fixtureGoal,
    runSmokeFn: async (opts) => {
      called = opts;
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'SMOKE_OK',
        smokeText: 'smoke ok',
        next_safe_action: 'ai-minions status --run-id t-fixture',
        launched: { task_id: 't-fixture', terminal_status: 'done' },
      };
    },
  });
  assert.equal(result.launched, true);
  assert.equal(called.goal, fixtureGoal);
  assert.equal(result.model.launch_options.goal, fixtureGoal);
  assert.equal(
    result.model.equivalent_command,
    `ai-minions smoke --model-policy local_only --goal ${shellQuote(fixtureGoal)}`,
  );
});

test('pane multi_agent strict uses runStart without expanding budgets', async () => {
  let called = null;
  const result = await runOperatorGuidedLauncherPane({
    question: async () => 'y',
    write: () => {},
    selections: {
      agentFlow: 'multi_agent',
      inferenceLane: 'local_only',
      gatePosture: 'strict',
      goalSource: 'custom',
      goal: 'goal text',
      confirm: true,
    },
    env: {},
    localBackendReachable: true,
    maxIterations: undefined,
    runStartFn: async (opts) => {
      called = opts;
      return {
        ok: true,
        exitCode: 0,
        text: 'started',
        launched: { task_id: 't2', terminal_status: 'done' },
        next_safe_action: 'ai-minions status --run-id t2',
      };
    },
  });
  assert.equal(result.launched, true);
  assert.equal(called.flowMode, 'multi_agent');
  assert.equal(called.skipGates, false);
  assert.equal(called.modelPolicy, 'local_only');
  assert.match(result.model.equivalent_command, /ai-minions start --flow multi_agent/);
  assert.doesNotMatch(result.model.equivalent_command, /--skip-gates/);
});

test('shell adapter + content surface carry launcher summary', () => {
  const model = buildGuidedLauncherModel({
    agentFlow: 'single_agent',
    inferenceLane: 'local_only',
    gatePosture: 'degraded',
    goalSource: 'custom',
    goal: 'g',
    env: {},
    localBackendReachable: true,
  });
  const adapted = adaptGuidedLauncher(model);
  assert.equal(adapted.available, true);
  assert.equal(adapted.inference_policy, 'local_only');
  const shell = buildShellModel({
    launcherModel: model,
    contentSurface: 'launcher',
    selectedNavId: 'launcher',
  });
  assert.equal(shell.contentSurface, 'launcher');
  assert.equal(shell.launcher.can_launch, true);
  assert.ok(shell.navItems.some((n) => n.id === 'launcher'));
});

test('matrix parity: hybrid reason code matches SIX_MODE_ROWS authority', async () => {
  const mod = await import(pathToFileURL(MATRIX_DATA).href);
  assert.equal(
    mod.REASON_CODES.SKIP_HYBRID_UNSUPPORTED,
    LAUNCHER_REASON.HYBRID_UNSUPPORTED,
  );
  const hybridRows = mod.SIX_MODE_ROWS.filter((r) => r.hybrid_honest_skip);
  assert.equal(hybridRows.length, 2);
  for (const row of hybridRows) {
    const assessed = mod.assessMatrixRow(row, {
      credentials: mod.assessCredentialPresence({ ANTHROPIC_API_KEY: 'x' }),
      skipLive: true,
    });
    assert.equal(assessed.reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
  }
});
