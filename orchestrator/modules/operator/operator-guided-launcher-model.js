'use strict';

/**
 * Guided execution launcher view-model.
 * Maps tester mode labels → authoritative product policy / CLI contracts.
 * Does not invent budgets, artifacts, tools, or hybrid routing.
 * Keeps provenance helpers local to avoid adapter ↔ cockpit circular requires.
 */

const { assessProviderCredentials } = require('./operator-credential-readiness');

const LAUNCHER_SCHEMA = '1';

/** @typedef {'available'|'absent'|'unavailable'|'unknown'|'not_configured'|'unlimited'} FieldAvailability */

/**
 * @param {unknown} raw
 * @returns {FieldAvailability}
 */
function normalizeAvailability(raw) {
  const token = String(raw ?? 'absent').trim().toLowerCase();
  if (
    token === 'available'
    || token === 'absent'
    || token === 'unavailable'
    || token === 'unknown'
    || token === 'not_configured'
    || token === 'unlimited'
  ) {
    return token;
  }
  return 'unknown';
}

/**
 * @param {unknown} raw
 * @param {string} [source]
 * @returns {{ value: unknown, availability: FieldAvailability, source: string }}
 */
function provenanceField(raw, source = 'operator') {
  if (raw === undefined || raw === null) {
    return { value: null, availability: 'absent', source: 'none' };
  }
  if (typeof raw === 'object' && raw !== null && 'availability' in /** @type {object} */ (raw)) {
    const obj = /** @type {{ value?: unknown, availability?: string, source?: string }} */ (raw);
    return {
      value: obj.value === undefined ? null : obj.value,
      availability: normalizeAvailability(obj.availability),
      source: obj.source == null ? source : String(obj.source),
    };
  }
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (
      token === 'unavailable'
      || token === 'unknown'
      || token === 'not_configured'
      || token === 'unlimited'
    ) {
      return { value: null, availability: token, source };
    }
  }
  return { value: raw, availability: 'available', source };
}

/**
 * @param {{ value: unknown, availability: FieldAvailability, source: string }} field
 * @returns {string}
 */
function formatProvenanceField(field) {
  if (field.availability === 'available') {
    if (field.value === null || field.value === undefined || field.value === '') return '(empty)';
    return String(field.value);
  }
  return field.availability;
}

/** Product skip / readiness reason codes (parity with tester six-mode matrix). */
const LAUNCHER_REASON = Object.freeze({
  READY: 'LAUNCHER_READY',
  HYBRID_UNSUPPORTED: 'MATRIX_SKIP_HYBRID_UNSUPPORTED',
  LOCAL_BACKEND_MISSING: 'MATRIX_SKIP_LOCAL_BACKEND_MISSING',
  REMOTE_CREDENTIALS_MISSING: 'MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING',
  GOAL_REQUIRED: 'LAUNCHER_GOAL_REQUIRED',
  CANCELLED: 'LAUNCHER_CANCELLED',
});

/** @typedef {'single_agent' | 'multi_agent'} AgentFlow */
/** @typedef {'local_only' | 'remote_ok' | 'hybrid'} InferenceLane */
/** @typedef {'strict' | 'degraded'} GatePosture */
/** @typedef {'default_smoke' | 'fixture' | 'custom'} GoalSource */

const AGENT_FLOW_OPTIONS = Object.freeze([
  {
    id: 'single_agent',
    label: 'single-agent',
    cli_value: 'single_agent',
  },
  {
    id: 'multi_agent',
    label: 'multi-agent',
    cli_value: 'multi_agent',
  },
]);

/**
 * Inference lanes shown in the TUI.
 * "remote only" tester wording maps to product policy `remote_ok` (no remote_only CLI value).
 * hybrid is visible but disabled until a product policy exists.
 */
const INFERENCE_LANE_OPTIONS = Object.freeze([
  {
    id: 'local_only',
    label: 'local only',
    product_policy: 'local_only',
    enabled: true,
    credential_requirement: 'not_required',
  },
  {
    id: 'remote_ok',
    label: 'remote only',
    product_policy: 'remote_ok',
    enabled: true,
    credential_requirement: 'any_provider',
    note: 'maps to --model-policy remote_ok (no remote_only CLI value)',
  },
  {
    id: 'hybrid',
    label: 'hybrid',
    product_policy: null,
    enabled: false,
    credential_requirement: 'any_provider',
    disabled_reason_code: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
    note: 'unsupported — do not pass --model-policy hybrid',
  },
]);

const CANONICAL_FIXTURE_OPTIONS = Object.freeze([
  {
    id: 'sudoku-html-app',
    title: 'Sudoku HTML app (canonical)',
  },
  {
    id: 'solar-system-html-demo',
    title: 'Solar-system HTML demo (secondary)',
  },
]);

/**
 * @param {unknown} raw
 * @returns {AgentFlow}
 */
function normalizeAgentFlow(raw) {
  const token = String(raw ?? 'single_agent').trim().toLowerCase();
  return token === 'multi_agent' || token === 'multi' ? 'multi_agent' : 'single_agent';
}

/**
 * @param {unknown} raw
 * @returns {InferenceLane}
 */
function normalizeInferenceLane(raw) {
  const token = String(raw ?? 'local_only').trim().toLowerCase();
  if (token === 'remote_ok' || token === 'remote' || token === 'remote_only' || token === 'remote-only') {
    return 'remote_ok';
  }
  if (token === 'hybrid') return 'hybrid';
  return 'local_only';
}

/**
 * @param {unknown} raw
 * @returns {GatePosture}
 */
function normalizeGatePosture(raw) {
  const token = String(raw ?? 'degraded').trim().toLowerCase();
  return token === 'strict' ? 'strict' : 'degraded';
}

/**
 * @param {unknown} raw
 * @returns {GoalSource}
 */
function normalizeGoalSource(raw) {
  const token = String(raw ?? 'default_smoke').trim().toLowerCase();
  if (token === 'fixture') return 'fixture';
  if (token === 'custom' || token === 'prompt') return 'custom';
  return 'default_smoke';
}

/**
 * Env / option limit → provenance field (never invent a default as "configured").
 * @param {unknown} raw
 * @param {string} source
 */
function limitFromRaw(raw, source) {
  if (raw === undefined || raw === null || raw === '') {
    return provenanceField('not_configured', source);
  }
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (token === 'unlimited' || token === 'not_configured' || token === 'unavailable' || token === 'absent') {
      return provenanceField(token, source);
    }
  }
  if (raw === 0 || raw === '0') {
    return provenanceField(0, source);
  }
  const asNum = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (Number.isFinite(asNum)) {
    return provenanceField(asNum, source);
  }
  return provenanceField(String(raw), source);
}

/**
 * Resolve configured limits from explicit options first, then env — absent when unset.
 * @param {{
 *   maxIterations?: unknown,
 *   maxRetries?: unknown,
 *   costLimitUsd?: unknown,
 *   timeLimit?: unknown,
 *   approvedArtifacts?: unknown,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
function resolveConfiguredLimits(options = {}) {
  const env = options.env ?? process.env;
  const iterations = options.maxIterations !== undefined
    ? options.maxIterations
    : env.ORCH_MAX_ITERATIONS;
  const retries = options.maxRetries !== undefined
    ? options.maxRetries
    : env.ORCH_MAX_RETRIES;
  const cost = options.costLimitUsd !== undefined
    ? options.costLimitUsd
    : env.ORCH_MAX_COST_USD;
  const timeLimit = options.timeLimit !== undefined
    ? options.timeLimit
    : (env.ORCH_WALL_CLOCK_LIMIT_MS ?? env.ORCH_MAX_WALL_MS);
  let approved = options.approvedArtifacts;
  if (approved === undefined) {
    approved = null;
  }
  return {
    max_iterations: limitFromRaw(iterations, 'cli_or_env'),
    max_retries: limitFromRaw(retries, 'cli_or_env'),
    cost_limit_usd: limitFromRaw(cost, 'cli_or_env'),
    time_limit: limitFromRaw(timeLimit, 'cli_or_env'),
    approved_artifacts: Array.isArray(approved)
      ? provenanceField(approved.length === 0 ? [] : approved, 'cli_or_options')
      : provenanceField(approved == null ? 'not_configured' : approved, 'cli_or_options'),
  };
}

/**
 * @param {InferenceLane} lane
 */
function laneOption(lane) {
  return INFERENCE_LANE_OPTIONS.find((o) => o.id === lane) ?? INFERENCE_LANE_OPTIONS[0];
}

/**
 * Shell-escape a goal for equivalent-command display (reproducibility, not execution).
 * @param {string} goal
 */
function shellQuote(goal) {
  return `'${String(goal).replace(/'/g, `'"'"'`)}'`;
}

/**
 * Build equivalent product CLI command from resolved launcher choices.
 * @param {{
 *   agentFlow: AgentFlow,
 *   productPolicy: 'local_only' | 'remote_ok',
 *   gatePosture: GatePosture,
 *   goal: string,
 *   maxIterations?: number | null,
 * }} input
 */
function buildEquivalentCommand(input) {
  const skipGates = input.gatePosture === 'degraded';
  const iterations = input.maxIterations != null && Number.isFinite(Number(input.maxIterations))
    ? Number(input.maxIterations)
    : null;

  if (input.agentFlow === 'single_agent' && skipGates && (iterations === 1 || iterations == null)) {
    return `ai-minions smoke --model-policy ${input.productPolicy}`;
  }

  const parts = [
    'ai-minions start',
    `--flow ${input.agentFlow}`,
    `--model-policy ${input.productPolicy}`,
  ];
  if (skipGates) parts.push('--skip-gates');
  if (iterations != null) parts.push(`--iterations ${iterations}`);
  parts.push(`--goal ${shellQuote(input.goal)}`);
  return parts.join(' ');
}

/**
 * Assess launch readiness without executing.
 * @param {{
 *   agentFlow?: AgentFlow | string,
 *   inferenceLane?: InferenceLane | string,
 *   gatePosture?: GatePosture | string,
 *   goalSource?: GoalSource | string,
 *   goal?: string,
 *   fixtureId?: string | null,
 *   fixturePrompt?: string | null,
 *   defaultSmokeGoal?: string,
 *   maxIterations?: unknown,
 *   maxRetries?: unknown,
 *   costLimitUsd?: unknown,
 *   timeLimit?: unknown,
 *   approvedArtifacts?: unknown,
 *   deterministicVerifiers?: unknown,
 *   cerberusGateStatus?: unknown,
 *   localBackendReachable?: boolean | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 *   env?: NodeJS.ProcessEnv,
 *   modelPolicyForCreds?: string,
 * }} [options]
 */
function buildGuidedLauncherModel(options = {}) {
  const agentFlow = normalizeAgentFlow(options.agentFlow);
  const inferenceLane = normalizeInferenceLane(options.inferenceLane);
  const gatePosture = normalizeGatePosture(options.gatePosture);
  const goalSource = normalizeGoalSource(options.goalSource);
  const lane = laneOption(inferenceLane);
  const env = options.env ?? process.env;

  const credentials = options.credentials
    ?? assessProviderCredentials({
      modelPolicy: options.modelPolicyForCreds
        ?? (lane.product_policy ?? 'local_only'),
      env,
    });

  let goal = '';
  let fixtureId = options.fixtureId == null ? null : String(options.fixtureId);
  if (goalSource === 'default_smoke') {
    goal = String(options.defaultSmokeGoal ?? options.goal ?? '').trim();
  } else if (goalSource === 'fixture') {
    goal = String(options.fixturePrompt ?? options.goal ?? '').trim();
    if (!fixtureId) fixtureId = CANONICAL_FIXTURE_OPTIONS[0].id;
  } else {
    goal = String(options.goal ?? '').trim();
  }

  const limits = resolveConfiguredLimits({
    maxIterations: options.maxIterations,
    maxRetries: options.maxRetries,
    costLimitUsd: options.costLimitUsd,
    timeLimit: options.timeLimit,
    approvedArtifacts: options.approvedArtifacts,
    env,
  });

  /** When degraded smoke path and iterations not configured, CLI smoke defaults to 1 — surface as available from contract. */
  let resolvedMaxIterations = limits.max_iterations;
  if (
    gatePosture === 'degraded'
    && agentFlow === 'single_agent'
    && limits.max_iterations.availability === 'not_configured'
    && options.maxIterations === undefined
    && !(env.ORCH_MAX_ITERATIONS && String(env.ORCH_MAX_ITERATIONS).trim())
  ) {
    resolvedMaxIterations = provenanceField(1, 'smoke_contract_default');
  } else if (
    options.maxIterations !== undefined
    && options.maxIterations !== null
    && options.maxIterations !== ''
  ) {
    resolvedMaxIterations = limitFromRaw(options.maxIterations, 'launcher_selection');
  }

  /** @type {string | null} */
  let blockedReason = null;
  /** @type {string | null} */
  let remediation = null;
  /** @type {'ready' | 'blocked' | 'skip'} */
  let readiness = 'ready';

  if (!lane.enabled || inferenceLane === 'hybrid' || lane.product_policy == null) {
    readiness = 'skip';
    blockedReason = LAUNCHER_REASON.HYBRID_UNSUPPORTED;
    remediation = 'hybrid model policy is not implemented — select local only or remote only (remote_ok)';
  } else if (lane.product_policy === 'remote_ok') {
    const creds = credentials.credential_sufficiency;
    if (creds === 'insufficient' || (credentials.remote_tokens_required && !credentials.providers?.some((p) => p.status === 'present'))) {
      readiness = 'skip';
      blockedReason = LAUNCHER_REASON.REMOTE_CREDENTIALS_MISSING;
      remediation = 'export at least one of ANTHROPIC_API_KEY or OPENAI_API_KEY (status only; never paste secret values), then re-open launcher';
    }
  } else if (lane.product_policy === 'local_only') {
    if (options.localBackendReachable === false) {
      readiness = 'skip';
      blockedReason = LAUNCHER_REASON.LOCAL_BACKEND_MISSING;
      remediation = 'start local backend (ollama serve) and ensure a model is available; re-run doctor';
    }
  }

  if (readiness === 'ready' && !goal) {
    readiness = 'blocked';
    blockedReason = LAUNCHER_REASON.GOAL_REQUIRED;
    remediation = 'provide a task prompt or select a canonical tester fixture';
  }

  const productPolicy = lane.product_policy;
  const canLaunch = readiness === 'ready' && productPolicy != null;
  const equivalentCommand = canLaunch
    ? buildEquivalentCommand({
      agentFlow,
      productPolicy,
      gatePosture,
      goal,
      maxIterations: resolvedMaxIterations.availability === 'available'
        ? Number(resolvedMaxIterations.value)
        : null,
    })
    : null;

  const localBackendStatus = options.localBackendReachable === true
    ? provenanceField('reachable', 'probe')
    : options.localBackendReachable === false
      ? provenanceField('unreachable', 'probe')
      : provenanceField('not_checked', 'probe');

  const verifiers = options.deterministicVerifiers !== undefined
    ? (options.deterministicVerifiers == null
      ? provenanceField('not_configured', 'operator')
      : provenanceField(options.deterministicVerifiers, 'operator'))
    : provenanceField('not_configured', 'operator');

  const cerberusGate = options.cerberusGateStatus !== undefined
    ? (options.cerberusGateStatus == null
      ? provenanceField('not_configured', 'operator')
      : provenanceField(options.cerberusGateStatus, 'operator'))
    : provenanceField(
      gatePosture === 'strict' ? 'enabled_via_mcp_gates' : 'degraded_skip_gates',
      'gate_posture',
    );

  const executionSummary = {
    goal_summary: goal
      ? provenanceField(goal.length > 120 ? `${goal.slice(0, 117)}...` : goal, 'launcher_selection')
      : provenanceField(null, 'none'),
    agent_mode: provenanceField(agentFlow, 'launcher_selection'),
    inference_lane_label: provenanceField(lane.label, 'launcher_selection'),
    inference_policy: productPolicy
      ? provenanceField(productPolicy, 'product_policy')
      : provenanceField('unavailable', 'product_policy'),
    gate_posture: provenanceField(gatePosture, 'launcher_selection'),
    skip_gates: provenanceField(gatePosture === 'degraded', 'launcher_selection'),
    max_iterations: resolvedMaxIterations,
    max_retries: limits.max_retries,
    cost_limit_usd: limits.cost_limit_usd,
    time_limit: limits.time_limit,
    approved_artifacts: limits.approved_artifacts,
    deterministic_verifiers: verifiers,
    cerberus_gate: cerberusGate,
    local_backend: localBackendStatus,
    credential_sufficiency: provenanceField(
      credentials.credential_sufficiency ?? 'unknown',
      'credential_readiness',
    ),
  };

  return {
    schema: LAUNCHER_SCHEMA,
    kind: 'guided_launcher',
    agent_flow: agentFlow,
    inference_lane: inferenceLane,
    inference_policy: productPolicy,
    gate_posture: gatePosture,
    goal_source: goalSource,
    fixture_id: fixtureId,
    goal,
    agent_flow_options: AGENT_FLOW_OPTIONS,
    inference_lane_options: INFERENCE_LANE_OPTIONS,
    fixture_options: CANONICAL_FIXTURE_OPTIONS,
    readiness,
    can_launch: canLaunch,
    blocked_reason_code: blockedReason,
    remediation,
    credentials: {
      credential_sufficiency: credentials.credential_sufficiency ?? null,
      remote_tokens_required: credentials.remote_tokens_required === true,
      providers: Array.isArray(credentials.providers)
        ? credentials.providers.map((p) => ({
          provider: p.provider,
          env_var: p.env_var,
          status: p.status,
        }))
        : [],
    },
    execution_summary: executionSummary,
    equivalent_command: equivalentCommand,
    launch_options: canLaunch
      ? {
        goal,
        flowMode: agentFlow,
        modelPolicy: productPolicy,
        skipGates: gatePosture === 'degraded',
        maxIterations: resolvedMaxIterations.availability === 'available'
          ? resolvedMaxIterations.value
          : undefined,
      }
      : null,
  };
}

/**
 * Human-readable launcher summary lines (tests / pane / shell content).
 * @param {ReturnType<typeof buildGuidedLauncherModel>} model
 * @returns {string[]}
 */
function formatGuidedLauncherLines(model) {
  const s = model.execution_summary;
  const lines = [
    '== Guided execution launcher ==',
    `agent_mode: ${model.agent_flow}`,
    `inference_lane: ${model.inference_lane} → policy=${model.inference_policy ?? 'unavailable'}`,
    `gate_posture: ${model.gate_posture} (skip_gates=${formatProvenanceField(s.skip_gates)})`,
    `goal_source: ${model.goal_source}${model.fixture_id ? ` (${model.fixture_id})` : ''}`,
    `goal: ${formatProvenanceField(s.goal_summary)}`,
    `max_iterations: ${formatProvenanceField(s.max_iterations)}`,
    `max_retries: ${formatProvenanceField(s.max_retries)}`,
    `cost_limit_usd: ${formatProvenanceField(s.cost_limit_usd)}`,
    `time_limit: ${formatProvenanceField(s.time_limit)}`,
    `approved_artifacts: ${formatProvenanceField(s.approved_artifacts)}`,
    `deterministic_verifiers: ${formatProvenanceField(s.deterministic_verifiers)}`,
    `cerberus_gate: ${formatProvenanceField(s.cerberus_gate)}`,
    `local_backend: ${formatProvenanceField(s.local_backend)}`,
    `credential_sufficiency: ${formatProvenanceField(s.credential_sufficiency)}`,
    `readiness: ${model.readiness}`,
  ];
  if (model.blocked_reason_code) {
    lines.push(`blocked_reason_code: ${model.blocked_reason_code}`);
  }
  if (model.remediation) {
    lines.push(`remediation: ${model.remediation}`);
  }
  if (model.equivalent_command) {
    lines.push(`equivalent_command: ${model.equivalent_command}`);
  } else {
    lines.push('equivalent_command: unavailable');
  }
  lines.push('Policy: launches only via existing CLI/module contracts; no parallel config path.');
  return lines;
}

module.exports = {
  LAUNCHER_SCHEMA,
  LAUNCHER_REASON,
  AGENT_FLOW_OPTIONS,
  INFERENCE_LANE_OPTIONS,
  CANONICAL_FIXTURE_OPTIONS,
  normalizeAgentFlow,
  normalizeInferenceLane,
  normalizeGatePosture,
  normalizeGoalSource,
  resolveConfiguredLimits,
  buildEquivalentCommand,
  buildGuidedLauncherModel,
  formatGuidedLauncherLines,
  shellQuote,
};
