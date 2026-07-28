'use strict';

/**
 * Interactive guided execution launcher pane for the operator TUI.
 * Collects mode selections, shows an authoritative execution summary, then
 * invokes existing runStart / runSmoke contracts — no parallel engine.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const {
  LAUNCHER_REASON,
  AGENT_FLOW_OPTIONS,
  INFERENCE_LANE_OPTIONS,
  CANONICAL_FIXTURE_OPTIONS,
  buildGuidedLauncherModel,
  formatGuidedLauncherLines,
} = require('./operator-guided-launcher-model');
const { assessProviderCredentials } = require('./operator-credential-readiness');
const { DEFAULT_SMOKE_GOAL, runSmoke } = require('./operator-guided-first-run');
const { ansi } = require('./terminal-style');

const GUIDED_LAUNCHER_PANE_SCHEMA = '1';

function getLiveHarness() {
  return require('./operator-live-harness');
}

function getAdaptLiveHarnessEvidence() {
  return require('./operator-tui-adapters').adaptLiveHarnessEvidence;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES_DATA = path.join(REPO_ROOT, 'scripts', 'lib', 'canonical-real-task-fixtures-data.mjs');

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeToken(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * @param {string} fixtureId
 * @returns {Promise<{ id: string, prompt: string, expected_artifacts: string[] } | null>}
 */
async function loadFixtureRecord(fixtureId) {
  const mod = await import(pathToFileURL(FIXTURES_DATA).href);
  const fixture = mod.getFixture(fixtureId);
  if (!fixture) return null;
  return {
    id: fixture.id,
    prompt: fixture.prompt,
    expected_artifacts: [...(fixture.expected_artifacts || [])],
  };
}

/**
 * @param {string} fixtureId
 * @returns {Promise<string>}
 */
async function loadFixturePrompt(fixtureId) {
  const fixture = await loadFixtureRecord(fixtureId);
  return fixture ? fixture.prompt : '';
}

/**
 * @param {{
 *   question: (prompt: string) => Promise<string>,
 *   write?: (text: string) => void,
 *   useColor?: boolean,
 *   prompt: string,
 *   options: { key: string, label: string, disabled?: boolean, note?: string }[],
 *   allowCancel?: boolean,
 * }} input
 * @returns {Promise<string | null>}
 */
async function promptChoice(input) {
  const write = input.write ?? (() => {});
  const useColor = input.useColor === true;
  write('');
  write(ansi(useColor, '1;36', input.prompt));
  for (const opt of input.options) {
    const marker = opt.disabled ? ' (disabled)' : '';
    write(`  [${opt.key}]  ${opt.label}${marker}`);
    if (opt.note) write(`         ${opt.note}`);
  }
  if (input.allowCancel !== false) {
    write('  [c]  cancel');
  }
  const answer = normalizeToken(await input.question('Select: '));
  if (!answer || answer === 'c' || answer === 'cancel' || answer === 'q' || answer === 'quit') {
    return null;
  }
  const match = input.options.find((o) => o.key === answer || normalizeToken(o.label) === answer);
  if (!match) return '';
  if (match.disabled) return `__disabled__:${match.key}`;
  return match.key;
}

/**
 * @param {{
 *   question: (prompt: string) => Promise<string>,
 *   write?: (text: string) => void,
 *   useColor?: boolean,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   localBackendReachable?: boolean | null,
 *   assessCredentials?: typeof assessProviderCredentials,
 *   loadFixturePromptFn?: typeof loadFixturePrompt,
 *   runSmokeFn?: typeof runSmoke,
 *   runStartFn?: Function,
 *   collectLiveHarnessPostRunFn?: typeof collectLiveHarnessPostRun,
 *   liveEvidenceDir?: string | null,
 *   collectLiveEvidence?: boolean,
 *   defaultSmokeGoal?: string,
 *   selections?: {
 *     agentFlow?: string,
 *     inferenceLane?: string,
 *     gatePosture?: string,
 *     goalSource?: string,
 *     fixtureId?: string,
 *     goal?: string,
 *     confirm?: boolean,
 *   },
 * }} options
 */
async function runOperatorGuidedLauncherPane(options) {
  const write = options.write
    ?? ((text) => {
      process.stdout.write(String(text).endsWith('\n') ? String(text) : `${text}\n`);
    });
  const useColor = options.useColor === true;
  const question = options.question;
  const env = options.env ?? process.env;
  const assessCredentials = options.assessCredentials ?? assessProviderCredentials;
  const loadFixture = options.loadFixturePromptFn ?? loadFixturePrompt;
  const selections = options.selections ?? null;

  /** @type {string} */
  let agentFlow = 'single_agent';
  /** @type {string} */
  let inferenceLane = 'local_only';
  /** @type {string} */
  let gatePosture = 'degraded';
  /** @type {string} */
  let goalSource = 'default_smoke';
  /** @type {string | null} */
  let fixtureId = null;
  /** @type {string} */
  let goal = '';
  /** @type {string | null} */
  let fixturePrompt = null;

  if (!selections) {
    write(ansi(useColor, '1', 'ai-minions guided launcher'));
    write('Choose agent mode, inference lane, and goal. Hybrid stays an honest skip.');
    write('Launcher cannot expand budgets, tools, or approved artifacts beyond existing contracts.');

    const agentKey = await promptChoice({
      question,
      write,
      useColor,
      prompt: 'Agent mode',
      options: AGENT_FLOW_OPTIONS.map((o, i) => ({
        key: String(i + 1),
        label: `${o.label} (${o.cli_value})`,
      })),
    });
    if (agentKey == null) {
      return cancelledResult();
    }
    if (agentKey === '') {
      return usageResult('invalid agent mode selection');
    }
    agentFlow = AGENT_FLOW_OPTIONS[Number(agentKey) - 1]?.id ?? 'single_agent';

    const laneKey = await promptChoice({
      question,
      write,
      useColor,
      prompt: 'Inference lane',
      options: INFERENCE_LANE_OPTIONS.map((o, i) => ({
        key: String(i + 1),
        label: `${o.label} → ${o.product_policy ?? 'unsupported'}`,
        disabled: !o.enabled,
        note: o.note,
      })),
    });
    if (laneKey == null) {
      return cancelledResult();
    }
    if (laneKey === '' || laneKey.startsWith('__disabled__:')) {
      const model = buildGuidedLauncherModel({
        agentFlow,
        inferenceLane: 'hybrid',
        gatePosture,
        goalSource: 'default_smoke',
        defaultSmokeGoal: options.defaultSmokeGoal ?? DEFAULT_SMOKE_GOAL,
        localBackendReachable: options.localBackendReachable,
        env,
        credentials: assessCredentials({ modelPolicy: 'local_only', env }),
      });
      const text = formatGuidedLauncherLines(model).join('\n');
      write(text);
      return {
        ok: false,
        exitCode: 0,
        reason_code: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
        schema: GUIDED_LAUNCHER_PANE_SCHEMA,
        model,
        text,
        launched: false,
        next_safe_action: 'ai-minions tui (re-open guided launcher) or ai-minions doctor',
      };
    }
    inferenceLane = INFERENCE_LANE_OPTIONS[Number(laneKey) - 1]?.id ?? 'local_only';

    const gateKey = await promptChoice({
      question,
      write,
      useColor,
      prompt: 'Gate posture (existing CLI: omit --skip-gates = strict; --skip-gates = degraded)',
      options: [
        { key: '1', label: 'degraded (--skip-gates) — typical smoke / matrix cell' },
        { key: '2', label: 'strict (MCP gates / CERBERUS path enabled)' },
      ],
    });
    if (gateKey == null) {
      return cancelledResult();
    }
    gatePosture = gateKey === '2' ? 'strict' : 'degraded';

    const goalKey = await promptChoice({
      question,
      write,
      useColor,
      prompt: 'Task / goal source',
      options: [
        { key: '1', label: 'default smoke goal (guided CLI smoke contract)' },
        { key: '2', label: 'canonical tester fixture' },
        { key: '3', label: 'custom prompt' },
      ],
    });
    if (goalKey == null) {
      return cancelledResult();
    }
    if (goalKey === '2') {
      goalSource = 'fixture';
      const fixtureKey = await promptChoice({
        question,
        write,
        useColor,
        prompt: 'Canonical fixture',
        options: CANONICAL_FIXTURE_OPTIONS.map((f, i) => ({
          key: String(i + 1),
          label: `${f.title} [${f.id}]`,
        })),
      });
      if (fixtureKey == null) {
        return cancelledResult();
      }
      const fixture = CANONICAL_FIXTURE_OPTIONS[Number(fixtureKey) - 1]
        ?? CANONICAL_FIXTURE_OPTIONS[0];
      fixtureId = fixture.id;
      try {
        fixturePrompt = await loadFixture(fixture.id);
        goal = fixturePrompt;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          exitCode: 1,
          reason_code: LAUNCHER_REASON.GOAL_REQUIRED,
          schema: GUIDED_LAUNCHER_PANE_SCHEMA,
          model: null,
          text: `fixture load failed: ${message}`,
          launched: false,
          next_safe_action: 'ai-minions doctor',
        };
      }
    } else if (goalKey === '3') {
      goalSource = 'custom';
      goal = String(await question('Goal prompt: ')).trim();
    } else {
      goalSource = 'default_smoke';
      goal = options.defaultSmokeGoal ?? DEFAULT_SMOKE_GOAL;
    }
  } else {
    agentFlow = selections.agentFlow ?? 'single_agent';
    inferenceLane = selections.inferenceLane ?? 'local_only';
    gatePosture = selections.gatePosture ?? 'degraded';
    goalSource = selections.goalSource ?? 'default_smoke';
    fixtureId = selections.fixtureId ?? null;
    if (goalSource === 'fixture' && fixtureId) {
      fixturePrompt = await loadFixture(fixtureId);
      goal = fixturePrompt;
    } else if (goalSource === 'custom') {
      goal = String(selections.goal ?? '').trim();
    } else {
      goal = options.defaultSmokeGoal ?? DEFAULT_SMOKE_GOAL;
    }
  }

  const productPolicyForCreds = inferenceLane === 'remote_ok' ? 'remote_ok' : 'local_only';
  const credentials = assessCredentials({
    modelPolicy: productPolicyForCreds,
    env,
  });

  const model = buildGuidedLauncherModel({
    agentFlow,
    inferenceLane,
    gatePosture,
    goalSource,
    goal,
    fixtureId,
    fixturePrompt,
    defaultSmokeGoal: options.defaultSmokeGoal ?? DEFAULT_SMOKE_GOAL,
    localBackendReachable: options.localBackendReachable,
    credentials,
    env,
    maxIterations: gatePosture === 'degraded' && agentFlow === 'single_agent' ? 1 : undefined,
  });

  const summaryText = formatGuidedLauncherLines(model).join('\n');
  write('');
  write(ansi(useColor, '1;36', '== Pre-launch execution summary =='));
  write(summaryText);

  if (!model.can_launch) {
    return {
      ok: false,
      exitCode: 0,
      reason_code: model.blocked_reason_code ?? LAUNCHER_REASON.GOAL_REQUIRED,
      schema: GUIDED_LAUNCHER_PANE_SCHEMA,
      model,
      text: summaryText,
      launched: false,
      next_safe_action: model.remediation
        ?? 'ai-minions doctor --model-policy local_only',
    };
  }

  let confirm = true;
  if (!selections) {
    const confirmRaw = normalizeToken(
      await question('Launch with the equivalent command above? [y/N]: '),
    );
    confirm = confirmRaw === 'y' || confirmRaw === 'yes';
  } else if (selections.confirm === false) {
    confirm = false;
  }

  if (!confirm) {
    return {
      ok: true,
      exitCode: 0,
      reason_code: LAUNCHER_REASON.CANCELLED,
      schema: GUIDED_LAUNCHER_PANE_SCHEMA,
      model,
      text: `${summaryText}\nlaunch cancelled`,
      launched: false,
      next_safe_action: 'none',
    };
  }

  write('');
  write(`Launching via existing contract:\n  ${model.equivalent_command}`);

  const launch = model.launch_options;
  const runSmokeFn = options.runSmokeFn ?? runSmoke;

  /** @type {Record<string, { path: string, mtimeMs: number, size: number, sha256: string }>} */
  let artifactBaseline = {};
  let fixtureRecordForBaseline = null;
  if (
    options.collectLiveEvidence !== false
    && model.goal_source === 'fixture'
    && model.fixture_id
  ) {
    fixtureRecordForBaseline = await loadFixtureRecord(String(model.fixture_id));
    const { snapshotArtifactBaseline } = getLiveHarness();
    artifactBaseline = snapshotArtifactBaseline({
      cwd: options.cwd ?? process.cwd(),
      expectedArtifacts: Array.isArray(fixtureRecordForBaseline?.expected_artifacts)
        ? fixtureRecordForBaseline.expected_artifacts
        : [],
    });
  }

  try {
    let result;
    if (
      launch.flowMode === 'single_agent'
      && launch.skipGates === true
      && (launch.maxIterations === 1 || launch.maxIterations == null)
    ) {
      result = await runSmokeFn({
        goal: launch.goal,
        cwd: options.cwd,
        modelPolicy: launch.modelPolicy,
        skipGates: true,
        maxIterations: 1,
        useColor,
      });
    } else {
      const runStart = options.runStartFn
        ?? require('./ai-minions-cli').runStart;
      result = await runStart({
        goal: launch.goal,
        cwd: options.cwd,
        flowMode: launch.flowMode,
        modelPolicy: launch.modelPolicy,
        skipGates: launch.skipGates === true,
        maxIterations: launch.maxIterations,
      });
    }

    const ok = result.ok !== false && (result.exitCode == null || result.exitCode === 0);
    const taskId = result.task_id ?? result.launched?.task_id ?? null;
    const textParts = [
      summaryText,
      '',
      `equivalent_command: ${model.equivalent_command}`,
      result.preflightText || '',
      result.routingText || '',
      result.smokeText || result.text || '',
    ];

    /** @type {object | null} */
    let liveHarness = null;
    const wantLiveEvidence = options.collectLiveEvidence !== false
      && model.goal_source === 'fixture'
      && model.fixture_id
      && ok
      && taskId;

    if (wantLiveEvidence) {
      const { collectLiveHarnessPostRun, matrixRowIdFromModes } = getLiveHarness();
      const adaptLiveHarnessEvidence = getAdaptLiveHarnessEvidence();
      const collect = options.collectLiveHarnessPostRunFn ?? collectLiveHarnessPostRun;
      const fixtureRecord = fixtureRecordForBaseline || await loadFixtureRecord(String(model.fixture_id));
      liveHarness = await collect({
        fixture: fixtureRecord || {
          id: model.fixture_id,
          prompt: model.goal,
          expected_artifacts: [],
        },
        rowId: matrixRowIdFromModes(model.agent_flow, model.inference_lane),
        runId: String(taskId),
        cwd: options.cwd,
        evidenceDir: options.liveEvidenceDir ?? null,
        launchOk: ok,
        terminalStatus: result.launched?.terminal_status ?? null,
        artifactBaseline,
        modelPolicy: model.inference_policy,
        agentMode: model.agent_flow,
        equivalentCommand: model.equivalent_command,
      });
      const adapted = adaptLiveHarnessEvidence(liveHarness);
      textParts.push(
        '',
        '== Live harness evidence (shared adapter) ==',
        `outcome: ${adapted.outcome}`,
        `reason_code: ${adapted.reason_code}`,
        `run_id: ${adapted.run_id}`,
        `verifier_ok: ${adapted.verifier_ok}`,
        `privacy_ok: ${adapted.privacy_ok}`,
        `status_ok: ${adapted.status_ok}`,
        `attach_ok: ${adapted.attach_ok}`,
      );
    }

    const text = textParts.filter(Boolean).join('\n');

    return {
      ok,
      exitCode: result.exitCode ?? (ok ? 0 : 1),
      reason_code: result.reason_code ?? (ok ? LAUNCHER_REASON.READY : 'LAUNCHER_RUN_FAILED'),
      schema: GUIDED_LAUNCHER_PANE_SCHEMA,
      model,
      text,
      launched: true,
      launch_result: result,
      live_harness: liveHarness,
      live_harness_adapted: liveHarness
        ? getAdaptLiveHarnessEvidence()(liveHarness)
        : null,
      next_safe_action: result.next_safe_action
        ?? (taskId
          ? `ai-minions status --run-id ${taskId}`
          : 'ai-minions runs'),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'LAUNCHER_RUN_FAILED',
      schema: GUIDED_LAUNCHER_PANE_SCHEMA,
      model,
      text: `${summaryText}\nerror: ${message}`,
      launched: false,
      next_safe_action: 'ai-minions doctor',
    };
  }
}

function cancelledResult() {
  return {
    ok: true,
    exitCode: 0,
    reason_code: LAUNCHER_REASON.CANCELLED,
    schema: GUIDED_LAUNCHER_PANE_SCHEMA,
    model: null,
    text: 'guided launcher cancelled',
    launched: false,
    next_safe_action: 'none',
  };
}

function usageResult(message) {
  return {
    ok: false,
    exitCode: 1,
    reason_code: 'LAUNCHER_USAGE',
    schema: GUIDED_LAUNCHER_PANE_SCHEMA,
    model: null,
    text: message,
    launched: false,
    next_safe_action: 'ai-minions tui',
  };
}

module.exports = {
  GUIDED_LAUNCHER_PANE_SCHEMA,
  runOperatorGuidedLauncherPane,
  loadFixturePrompt,
  loadFixtureRecord,
};
