/**
 * Autonomous orchestrator loop following the MODE protocol.
 *
 * Flow per iteration:
 *   1. ORCHESTRATOR plans (Ollama → JSON steps)
 *   2. Each step runs the assigned agent (claude CLI)
 *   3. compact-handoff MCP compacts each agent output → YAML
 *   4. orchestrator-state MCP validates alignment + gates the transition
 *   5. CERBERUS reviews the full iteration output
 *   6. ORCHESTRATOR decides: done or corrections (blockers only)
 *
 * Hard gates (orchestrator-state MCP):
 *   - register_task at session start
 *   - validate_goal_alignment before every DEV→QA and QA→CERBERUS advance
 *   - validate_transition dry-run before advance_mode
 *   - advance_mode records every MODE transition on disk
 *   - close_task at session end
 *
 * Requires:
 *   - Default: claude CLI in PATH — MCP tools invoked via `claude -p` (MCPs registered in Claude)
 *   - Ollama at localhost:11434 with qwen2.5-coder:7b (agents + compact-handoff server)
 *   - Optional **system-path E2E / CI without Claude MCP:** set `ORCH_MCP_TRANSPORT=direct` to call
 *     `mcp-direct.py` (Python + `mcp-servers` venvs) instead of the claude CLI for state store + compact_handoff.
 */

// ── Node built-ins ────────────────────────────────────────────────────────────
const { randomUUID } = require("crypto");
const fs = require("fs");

// ── Session context & environment ─────────────────────────────────────────────
const { deriveRunScope, writeOrchRunContext } = require("./flow-hook-bridge");
const { parseEnvironment } = require("./environment-parser");
const { buildWorktreeTraceFields } = require("./worktree-isolation");

// ── Agents, contracts & capability ────────────────────────────────────────────
const { askAgent, summarizeHandoff, CONTRACT_VERSION, getDegradedAgents, clearDegradedAgents } = require("./agents");
const { qaAgentDoneTraceExtras } = require("./agents/validate-output");
const {
  validatePlanStepsCapability,
  CAPABILITY_MATRIX_VERSION,
} = require("./agents/capability-matrix");
const {
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,
  qaSpecFlowTraceExtras,
  shouldEmitQaReviewRecord,
} = require("./qa-spec-flow");
const {
  configureLocalModelPolicy,
  validateLocalOnlyRunPrerequisites,
  setLocalModelTraceReporter,
} = require("./local-model-policy");
const { formatArtifactLine, envInt, truncateForContext } = require("./context-utils");

// ── Run state & planning decisions ────────────────────────────────────────────
const {
  createRunState,
  syncRunIteration,
  setStepRunning,
  setStepCompleted,
  setStepFailedAndClear,
  markStepRetryingAfterGate,
  finalizeRunState,
  getRunStatePublicView,
} = require("./run-state");
const {
  decideFromOrchestratorDecide,
  mapDecideLoopToPlanOutcome,
  planStepsAfterCorrectionsResponse,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
  decideCorrectionsPlan,
  loopExhaustedDefaultSummary,
  decideCostGuard,
  decideStepRetryGuard,
  formatGateBlockedReasonLines,
  planStepsReplayFromGateBlockedArtifacts,
  summaryMaxIterationsGateBlocked,
} = require("./decision-engine");

// ── Trace write path (schema: trace-schema.js; writer: trace-writer.js) ───────
const {
  traceEvent,
  loadTraceRowsForTask,
  TRACE_SCHEMA_VERSION,
  _sanitize,
  _hashGoal,
  transitionReason,
  TRANSITION_REASON_TYPES,
  TRANSITION_REASON_CODES,
  inferReasonCode,
  FAILURE_TYPES,
  FAILURE_AXES,
  failureTypeForIterationDone,
  failureAxisForIterationDone,
  traceIterationDone,
  composeIterationDonePayload,
} = require("./trace-writer");
const { redactSensitivePlaintext } = require("./trace-redact");
const {
  emitModelFallbackLifecycleIfNeeded,
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
} = require("./trace-lifecycle-events");
const {
  createContextHygieneTracker,
  emitContextHygieneSignalsFromStats,
} = require("./context-hygiene-signals");
const { buildReviewRecord, traceReviewRecord } = require("./review-record");
const {
  buildDoubtReviewCycleFromCerberusOutput,
  traceDoubtReviewCycle,
} = require("./doubt-review");
const { runRecoverySweepAndTrace } = require("./recovery-sweep");

// ── MCP invocation & permission audit ─────────────────────────────────────────
const {
  beginMcpAudit,
  clearMcpAudit,
  getMcpAuditCalls,
  getPermissionCheckAuditBuffer,
  aggregateMcpUsage,
  emitPermissionCheckTrace,
  invokeMcpDirect,
  callStateMcp,
  callCompactHandoff,
} = require("./mcp-client");
const { aggregatePermissionCheckRows } = require("./security/permission-check-summary");

// ── Run-loop helpers (env/budget, logging, graph, handoff) ─────────────────────
const {
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  EDGE_TYPE_CATEGORY,
  edgeMeta,
  validateStepGraph,
  assertParentStepExists,
  orchTestSystemPathHarnessOn,
  DEFAULT_MAX_CONTEXT_CHARS,
  DEFAULT_MAX_REVIEW_CHARS,
  parseOptionalNonNegativeInt,
  parseOptionalPositiveFloat,
  parseOptionalRatioWithInvalid,
  parseBudgetLimitsJson,
  loadOllamaUsdRatesMtok,
  resolveMaxIterations,
  roundUsd6,
  log,
  logRoleSwitch,
  writeAgentState,
  extractJson,
  validateHandoffStructure,
  detectBlockers,
  AGENT_TO_MODE,
  VALID_WORKER_AGENTS,
  AGENTS_REQUIRING_GATE,
  checkOllama,
  AGENT_STATE_FILE,
} = require("./run-loop-helpers");

// ── Approval & governance gates ───────────────────────────────────────────────
const {
  buildGateContextFromArtifacts,
  loadApprovalPolicyFromEnv,
  evaluateDevExecutionGate,
} = require("./approval-policy-gate");

// ── Run loop phases (observable boundaries) ───────────────────────────────────
const { executeSessionStartPhase } = require("./run-phases/session-start");
const { executePlanResolutionPhase } = require("./run-phases/plan-resolution");
const { createPhaseContext } = require("./run-phases/phase-context");
const { executeStepAgentInvocation } = require("./run-phases/step-execution");

const DEV_AGENT_IDS = new Set(["dev-backend", "dev-frontend", "dev-devops"]);

/**
 * When true, compact_handoff failure is a hard gate (gateBlocked).
 * When false, failure uses explicit fallback metadata (run continues in degraded mode).
 * Default: same as strict mode — derived from !skipStateMcp unless overridden.
 */
function resolveRequireHandoff(options) {
  if (typeof options.requireHandoff === "boolean") return options.requireHandoff;
  return options.skipStateMcp !== true;
}

/** Structured metadata when compact_handoff fails in degraded mode (policy B). */
function compactHandoffDegradedMeta(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoff_compression: "unavailable",
    handoff_fallback_used: true,
    handoff_degraded: true,
    handoff_error: msg,
  };
}

/** Artifact fields when compact_handoff fails in strict mode (policy A). */
function compactHandoffStrictFailureFields(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoffYaml: "",
    gateBlocked: true,
    gateReason: `compact_handoff failed: ${msg}`,
    handoff_compression: "failed",
    handoff_error: msg,
  };
}

// ── Main run function ─────────────────────────────────────────────────────────

/**
 * Runs the orchestrator loop.
 * @param {string} goal - Goal / epic / task description
 * @param {{
 *   maxIterations?: number — outer loop cap; explicit option beats **ORCH_MAX_ITERATIONS** (1–500), then default 3,
 *   cwd?: string,
 *   flowMode?: string,
 *   taskId?: string,
 *   approvedArtifacts?: string[],
 *   maxContextCharsPerArtifact?: number,
 *   maxReviewCharsPerArtifact?: number,
 *   stepSummary?: boolean,
 *   skipStateMcp?: boolean
 *   requireHandoff?: boolean — if set, overrides default: strict (!skipStateMcp) requires compact_handoff; degraded skips hard fail
 *   traceScenarioId?: string — optional label written to trace `session_start` / `session_end` as `scenario_id` (batch metrics export). Env: ORCH_TRACE_SCENARIO_ID.
 *   localModel?: string — CLI `--model` override for local-only / Ollama execution.
 *   credentialSessionMode?: 'read'|'write' — session credential ceiling for plan validation with `requiredDomains` (default write). Env: ORCH_SESSION_CREDENTIAL_MODE=read.
 * }} options
 */
async function run(goal, options = {}) {
  const maxIterations = resolveMaxIterations(options);
  const maxCostUsd = parseOptionalPositiveFloat("ORCH_MAX_COST_USD");
  const parsedBudgetWarningRatio = parseOptionalRatioWithInvalid("ORCH_BUDGET_WARNING_RATIO");
  const budgetWarningRatio = parsedBudgetWarningRatio.value;
  const parsedBudgetLimits = parseBudgetLimitsJson();
  const budgetLimits = parsedBudgetLimits.limits;
  if (!budgetLimits.roles) budgetLimits.roles = {};
  if (!budgetLimits.steps) budgetLimits.steps = {};
  if (!budgetLimits.models) budgetLimits.models = {};
  if (maxCostUsd != null && budgetLimits.run == null) budgetLimits.run = maxCostUsd;
  const usdRatesMtok = loadOllamaUsdRatesMtok();
  const hasBudgetLimits =
    budgetLimits.run != null ||
    Object.keys(budgetLimits.roles || {}).length > 0 ||
    Object.keys(budgetLimits.steps || {}).length > 0 ||
    Object.keys(budgetLimits.models || {}).length > 0;
  if (hasBudgetLimits && !usdRatesMtok) {
    throw new Error(
      "Budget guards require both ORCH_USD_PER_MTOK_PROMPT and ORCH_USD_PER_MTOK_COMPLETION (non-negative floats, USD per 1e6 tokens; same basis as token-trace-report).",
    );
  }
  const maxStepRetries = parseOptionalNonNegativeInt("ORCH_MAX_RETRIES", 500);

  const cwd           = options.cwd || process.cwd();
  const flowMode      = options.flowMode || "single_agent";
  const taskId        = options.taskId || `task-${randomUUID().slice(0, 8)}`;
  writeOrchRunContext(cwd, { taskId, flowMode, goal });
  const runScope = deriveRunScope(goal);
  const rawScenario = options.traceScenarioId ?? process.env.ORCH_TRACE_SCENARIO_ID ?? "";
  const scenarioId = String(rawScenario).trim() ? String(rawScenario).trim().slice(0, 240) : null;
  beginMcpAudit(taskId);
  const approvedArtifacts = options.approvedArtifacts || [];
  const skipStateMcp  = options.skipStateMcp === true;
  const requireHandoff = resolveRequireHandoff(options);
  const credentialSessionMode =
    options.credentialSessionMode === "read" || options.credentialSessionMode === "write"
      ? options.credentialSessionMode
      : String(process.env.ORCH_SESSION_CREDENTIAL_MODE || "").toLowerCase() === "read"
        ? "read"
        : "write";

  const maxContextChars = options.maxContextCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS);
  const maxReviewChars  = options.maxReviewCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_REVIEW_CHARS_PER_ARTIFACT", DEFAULT_MAX_REVIEW_CHARS);
  const stepSummary = options.stepSummary !== undefined
    ? Boolean(options.stepSummary)
    : process.env.AI_TEAM_STEP_SUMMARY !== "0";

  const sessionEnv = options.sessionEnv || parseEnvironment(goal) || null;

  const artifacts = [];
  let plan        = { steps: [] };
  let iterations  = 0;
  let done          = false;
  let summary       = "";
  let manualReview  = false;  // set true in gate-blocked or CERBERUS-unresolved paths
  /** When true, skip advance_mode + main iteration loop (e.g. plan-phase cost guard). */
  let skipMainOrchestrationLoop = false;
  const runState = createRunState({
    taskId,
    flowMode,
    goal,
    maxIterations,
  });
  const ollamaTokenTotals = { prompt: 0, completion: 0 };
  const budgetUsage = {
    run: 0,
    roles: {},
    steps: {},
    models: {},
  };
  const budgetWarningsEmitted = new Set();
  let lastBudgetMeta = {};
  const contextHygieneTracker = createContextHygieneTracker();
  function bumpOllamaFromStats(stats) {
    if (!stats || typeof stats !== "object") return;
    if (typeof stats.ollama_prompt_tokens === "number" && !Number.isNaN(stats.ollama_prompt_tokens)) {
      ollamaTokenTotals.prompt += stats.ollama_prompt_tokens;
    }
    if (typeof stats.ollama_completion_tokens === "number" && !Number.isNaN(stats.ollama_completion_tokens)) {
      ollamaTokenTotals.completion += stats.ollama_completion_tokens;
    }
  }

  function usdForTokens(promptTokens, completionTokens) {
    if (!usdRatesMtok) return null;
    return (promptTokens / 1e6) * usdRatesMtok.prompt
      + (completionTokens / 1e6) * usdRatesMtok.completion;
  }

  function budgetModelKey(row) {
    const backend = typeof row.model_backend === "string" && row.model_backend ? row.model_backend : "unknown";
    const name =
      typeof row.model_name === "string" && row.model_name
        ? row.model_name
        : typeof row.model === "string" && row.model
          ? row.model
          : "unknown";
    return `${backend}/${name}`;
  }

  function addBudgetUsageFromRow(row) {
    const p = typeof row.ollama_prompt_tokens === "number" && !Number.isNaN(row.ollama_prompt_tokens)
      ? row.ollama_prompt_tokens
      : 0;
    const c = typeof row.ollama_completion_tokens === "number" && !Number.isNaN(row.ollama_completion_tokens)
      ? row.ollama_completion_tokens
      : 0;
    const usd = usdForTokens(p, c);
    if (usd == null || usd === 0) return;
    budgetUsage.run += usd;
    const role =
      typeof row.attributed_to_role === "string" && row.attributed_to_role
        ? row.attributed_to_role
        : typeof row.agent === "string" && row.agent
          ? row.agent
          : "unknown";
    budgetUsage.roles[role] = (budgetUsage.roles[role] || 0) + usd;
    if (typeof row.step_id === "string" && row.step_id) {
      budgetUsage.steps[row.step_id] = (budgetUsage.steps[row.step_id] || 0) + usd;
    }
    const m = budgetModelKey(row);
    budgetUsage.models[m] = (budgetUsage.models[m] || 0) + usd;
    lastBudgetMeta = {
      role,
      ...(typeof row.step_id === "string" && row.step_id ? { step_id: row.step_id } : {}),
      model_key: m,
    };
  }

  /**
   * Expand `context_stats` into one trace row per model segment (fallback chain) or a single row.
   * @param {string} agent
   * @param {number} iteration
   * @param {Record<string, unknown>} graphMeta
   * @param {Record<string, unknown>} intentStep
   * @param {Record<string, unknown>} stats
   * @param {Record<string, unknown>} loc
   */
  function expandContextStatsTraceRows(agent, iteration, graphMeta, intentStep, stats, loc = {}) {
    if (!stats || typeof stats !== "object") return [];
    const rawSegs = stats.model_fallback_segments;
    const rest = { ...stats };
    delete rest.model_fallback_segments;
    const base = { agent, iteration, ...graphMeta, ...intentStep, ...loc, invocation_type: "agent_call" };
    if (!Array.isArray(rawSegs) || rawSegs.length === 0) {
      return [{ ...base, ...rest }];
    }
    return rawSegs.map((seg, i) => ({
      ...base,
      ...rest,
      ...seg,
      model_fallback_segment_index: i,
      model_fallback_chain_length: rawSegs.length,
    }));
  }

  function emitContextStatsRows(stats, agent, iteration, graphMeta, intentStep, loc = {}) {
    if (!stats || typeof stats !== "object") return;
    const meta = { ...graphMeta, ...intentStep, ...loc };
    emitContextHygieneSignalsFromStats(
      traceEvent,
      taskId,
      agent,
      iteration,
      stats,
      meta,
      contextHygieneTracker,
    );
    for (const row of expandContextStatsTraceRows(agent, iteration, graphMeta, intentStep, stats, loc)) {
      bumpOllamaFromStats(row);
      addBudgetUsageFromRow(row);
      traceEvent(taskId, { event: "context_stats", ...row });
    }
  }
  function estimateRunUsd() {
    if (!usdRatesMtok) return null;
    return budgetUsage.run;
  }

  function budgetCheckDetails(phase, meta = {}) {
    if (!usdRatesMtok || !hasBudgetLimits) return { ok: true };
    /** @type {Array<Record<string, unknown>>} */
    const triggered = [];
    function add(scope, key, estimate, limit) {
      if (limit == null || estimate == null || !Number.isFinite(estimate) || estimate <= limit) return;
      triggered.push({
        scope,
        key,
        estimate_usd: roundUsd6(estimate),
        limit_usd: limit,
      });
    }
    add("run", "run", budgetUsage.run, budgetLimits.run);
    if (typeof meta.role === "string" && meta.role) add("role", meta.role, budgetUsage.roles[meta.role] || 0, budgetLimits.roles[meta.role]);
    if (typeof meta.step_id === "string" && meta.step_id) add("step", meta.step_id, budgetUsage.steps[meta.step_id] || 0, budgetLimits.steps[meta.step_id]);
    if (typeof meta.model_key === "string" && meta.model_key) add("model", meta.model_key, budgetUsage.models[meta.model_key] || 0, budgetLimits.models[meta.model_key]);
    if (!triggered.length) return { ok: true };
    const precedence = ["step", "role", "model", "run"];
    const primary = [...triggered].sort((a, b) => precedence.indexOf(String(a.scope)) - precedence.indexOf(String(b.scope)))[0];
    return {
      ok: false,
      estimate: Number(primary.estimate_usd),
      limit: Number(primary.limit_usd),
      phase,
      budget_scope: primary.scope,
      budget_key: primary.key,
      triggered_budgets: triggered.map((x) => x.scope),
      triggered_budget_details: triggered,
      attributed_to_role: meta.role,
      step_id: meta.step_id,
      model: meta.model_key,
      model_backend: typeof meta.model_key === "string" ? String(meta.model_key).split("/")[0] : undefined,
    };
  }

  /** @returns {{ ok: true } | ReturnType<typeof budgetCheckDetails>} */
  function checkCostGuard(phase, meta = {}) {
    return budgetCheckDetails(phase, meta);
  }

  function maybeEmitBudgetWarning(phase, meta = {}) {
    if (!usdRatesMtok || budgetWarningRatio == null || budgetWarningRatio <= 0) return;
    const runLimit = budgetLimits.run;
    if (runLimit == null) return;
    const estimate = estimateRunUsd();
    if (estimate == null || !Number.isFinite(estimate)) return;
    const thresholdUsd = runLimit * budgetWarningRatio;
    if (estimate < thresholdUsd) return;
    const key = String(phase || "unknown");
    if (budgetWarningsEmitted.has(key)) return;
    budgetWarningsEmitted.add(key);
    traceEvent(taskId, {
      event: "budget_warning",
      phase: key,
      estimate_usd: roundUsd6(estimate),
      threshold_usd: roundUsd6(thresholdUsd),
      limit_usd: runLimit,
      warning_ratio: budgetWarningRatio,
      cost_basis: "actual_env_pricing_ollama_tokens",
      budget_scope: "run",
      ...(typeof meta.role === "string" ? { attributed_to_role: meta.role } : {}),
      ...(typeof meta.step_id === "string" ? { step_id: meta.step_id } : {}),
      ...(typeof meta.model_key === "string" ? { model: meta.model_key } : {}),
      ...(typeof meta.model_key === "string" ? { model_backend: String(meta.model_key).split("/")[0] } : {}),
    });
  }

  function budgetEventFields(d) {
    return {
      phase: d.phase,
      estimate_usd: d.estimate,
      limit_usd: d.limit,
      cost_basis: "actual_env_pricing_ollama_tokens",
      reason_code: "GUARD_COST_LIMIT",
      budget_scope: d.budget_scope,
      budget_key: d.budget_key,
      triggered_budgets: d.triggered_budgets,
      triggered_budget_details: d.triggered_budget_details,
      ...(typeof d.attributed_to_role === "string" ? { attributed_to_role: d.attributed_to_role } : {}),
      ...(typeof d.step_id === "string" ? { step_id: d.step_id } : {}),
      ...(typeof d.model === "string" ? { model: d.model } : {}),
      ...(typeof d.model_backend === "string" ? { model_backend: d.model_backend } : {}),
    };
  }
  let currentMode = "ORCHESTRATOR";
  const degradedInRun = new Set(); // agents that ran in fallback at least once this run
  await executeSessionStartPhase({
    taskId,
    cwd,
    flowMode,
    goal,
    maxIterations,
    runScope,
    scenarioId,
    requireHandoff,
    skipStateMcp,
    approvedArtifacts,
    sessionEnv,
    parsedBudgetWarningRatio,
    parsedBudgetLimits,
    maxContextChars,
    stepSummary,
    maxCostUsd,
    budgetWarningRatio,
    budgetLimits,
    maxStepRetries,
    localModel: options.localModel,
    log,
    traceEvent,
    checkOllama,
    configureLocalModelPolicy,
    setLocalModelTraceReporter,
    validateLocalOnlyRunPrerequisites,
    clearDegradedAgents,
    buildWorktreeTraceFields,
    callStateMcp,
    CONTRACT_VERSION,
    orchTestSystemPathHarnessOn,
  });

  ({
    plan,
    summary,
    manualReview,
    skipMainOrchestrationLoop,
    currentMode,
  } = await executePlanResolutionPhase({
    taskId,
    cwd,
    flowMode,
    goal,
    maxIterations,
    sessionEnv,
    skipStateMcp,
    credentialSessionMode,
    plan,
    summary,
    manualReview,
    skipMainOrchestrationLoop,
    currentMode,
    getLastBudgetMeta: () => lastBudgetMeta,
    log,
    traceEvent,
    askAgent,
    emitModelFallbackLifecycleIfNeeded,
    emitContextStatsRows,
    maybeEmitBudgetWarning,
    checkCostGuard,
    budgetEventFields,
    traceIterationDone,
    transitionReason,
    roundUsd6,
    extractJson,
    stripLeadingOwnerArchitectForDegradedMultiAgent,
    isQaSpecBeforeDevEnabled,
    applyQaSpecBeforeDevPlan,
    validatePlanStepsCapability,
    CAPABILITY_MATRIX_VERSION,
    callStateMcp,
    AGENT_TO_MODE,
  }));

  // ── Main loop ─────────────────────────────────────────────────────────────────
  const RED = "\x1b[31m", BOLD_C = "\x1b[1m", RESET_C = "\x1b[0m";

  orchestration: while (!skipMainOrchestrationLoop && !done && iterations < maxIterations) {
    if (skipStateMcp) {
      console.log(`${RED}${BOLD_C}  ⚠ NO HARD GATES ACTIVE — iteration unprotected${RESET_C}`);
    }
    iterations += 1;
    syncRunIteration(runState, iterations);
    log("orchestrator", `── Iteration ${iterations}/${maxIterations} ──`);

    // Corrections from decide replace plan.steps — validate again from iteration 2 onward (iteration 1 covered after plan parse).
    if (iterations > 1) {
      const stepsEarly = plan.steps && plan.steps.length ? plan.steps : [];
      const capIter = validatePlanStepsCapability(stepsEarly, { sessionCredentialMode: credentialSessionMode });
      if (!capIter.ok) {
        summary = `Plan rejected — ${capIter.errors.join("; ")}`;
        manualReview = true;
        traceEvent(taskId, {
          event: "plan_capability_reject",
          capability_matrix_version: CAPABILITY_MATRIX_VERSION,
          errors: capIter.errors,
          iteration: iterations,
        });
        break orchestration;
      }
    }

    const intentByStepSlot = new Map();
    const intentIdsThisIteration = new Set();
    /** @param {Record<string, unknown>} [extra] */
    function iterationDoneCtx(extra = {}) {
      const ids = [...intentIdsThisIteration];
      return { ...extra, ...(ids.length ? { intent_ids: ids.slice(0, 48) } : {}) };
    }
    /**
     * @param {string} phase
     * @returns {boolean} true if run must stop (caller should `break orchestration`)
     */
    function costGuardAbort(phase) {
      maybeEmitBudgetWarning(phase, lastBudgetMeta);
      const raw = checkCostGuard(phase, lastBudgetMeta);
      const d = decideCostGuard({ estimate: raw.ok ? null : (raw.estimate ?? null), maxCostUsd: raw.ok ? maxCostUsd : raw.limit, phase });
      if (!d.abort) return false;
      summary = d.summary;
      manualReview = true;
      traceEvent(taskId, {
        event: "budget_block",
        ...budgetEventFields(raw),
      });
      traceEvent(taskId, {
        event: "budget_exhausted",
        ...budgetEventFields(raw),
      });
      traceIterationDone(taskId, iterations, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
        estimate_usd: d.estimateUsd,
        limit_usd: raw.limit,
        guard_phase: phase,
        budget_scope: raw.budget_scope,
        triggered_budgets: raw.triggered_budgets,
      }, iterationDoneCtx());
      return true;
    }

    const steps = plan.steps && plan.steps.length ? plan.steps : [];
    const contextHeader = stepSummary
      ? "Prior steps = Ollama handoff summaries. Full detail is in the repo/cwd — open cited files as needed.\n\n"
      : maxContextChars > 0
        ? "Prior steps may be truncated; use cwd, git diff, and mentioned paths.\n\n"
        : "";

    function contextChunk(a) {
      return stepSummary && a.handoffSummary
        ? `## Handoff (${a.agentId})\n${a.handoffSummary}`
        : formatArtifactLine(a, maxContextChars);
    }

    // ── Execute each step ───────────────────────────────────────────────────────
    // retry_number tracks how many times each agentId has run in this iteration
    const retryCountThisIteration = {};
    let previousAgentId = null;
    let previousStepId = null;  // for parent_step_id graph edges
    const emittedStepIds = new Set(); 


    const graphCheck = validateStepGraph(steps, VALID_WORKER_AGENTS);
    if (!graphCheck.valid) {
      const msg = `Step graph validation failed: ${graphCheck.errors.join("; ")}`;
      traceEvent(taskId, { event: "graph_validation_fail", iteration: iterations, errors: graphCheck.errors });
      throw new Error(msg);
    }

    let qaSpecSatisfiedThisIteration = false;
    const qaSpecFlowEnabledRun = isQaSpecBeforeDevEnabled(flowMode);
    const phaseCtx = createPhaseContext({
      taskId,
      cwd,
      goal,
      sessionEnv,
      iterations: () => iterations,
      traceEvent,
      log,
      getLastBudgetMeta: () => lastBudgetMeta,
      emitContextStatsRows,
      emitModelFallbackLifecycleIfNeeded,
      costGuardAbort,
    });

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const agentId = step.agentId != null ? String(step.agentId).trim() : "";
      if (!agentId || !VALID_WORKER_AGENTS.has(agentId)) continue;

      if (previousAgentId && previousAgentId !== agentId) logRoleSwitch(previousAgentId, agentId);
      previousAgentId = agentId;

      const prevRetries = retryCountThisIteration[agentId] ?? 0;
      const retryGuard = decideStepRetryGuard({ prevRetries, maxStepRetries, agentId });
      if (retryGuard.abort) {
        summary = retryGuard.summary;
        manualReview = true;
        traceIterationDone(
          taskId,
          iterations,
          "guard_abort",
          transitionReason("GUARD", "step_retry_limit", {
            reason_code: "GUARD_STEP_RETRY_LIMIT",
            gate_id: agentId,
          }),
          { max_step_retries: maxStepRetries, agent_id: agentId, retry_number: retryGuard.retryNumber },
          iterationDoneCtx(),
        );
        break orchestration;
      }
      const retryNumber = prevRetries;
      retryCountThisIteration[agentId] = prevRetries + 1;
      const stepSlotKey = `${stepIndex}:${agentId}`;
      let intentId = intentByStepSlot.get(stepSlotKey);
      if (!intentId) {
        intentId = require("crypto").randomUUID();
        intentByStepSlot.set(stepSlotKey, intentId);
      }
      intentIdsThisIteration.add(intentId);
      const intentStep = { intent_id: intentId };
      const stepId = `${taskId}-i${iterations}-${agentId}${retryNumber > 0 ? `-r${retryNumber}` : ""}`;
      const graphMeta = { parent_step_id: previousStepId };
      assertParentStepExists(previousStepId, emittedStepIds);

      const contextBlock = contextHeader + [goal, ...artifacts.map(contextChunk)].join("\n\n---\n\n");
      const stepExec = await executeStepAgentInvocation(phaseCtx, {
        agentId,
        step,
        stepId,
        stepIndex,
        retryNumber,
        graphMeta,
        intentStep,
        contextBlock,
        writeAgentState,
        setStepRunning,
        setStepFailedAndClear,
        setStepCompleted,
        runState,
        askAgent,
        getDegradedAgents,
        clearDegradedAgents,
        degradedInRun,
        edgeMeta,
        qaAgentDoneTraceExtras,
        shouldEmitQaReviewRecord,
        traceReviewRecord,
        buildReviewRecord,
        onAfterAgentStart: async () => {
          if (DEV_AGENT_IDS.has(agentId) && !skipStateMcp && !orchTestSystemPathHarnessOn()) {
            const gateCtx = buildGateContextFromArtifacts(artifacts);
            const policy = loadApprovalPolicyFromEnv();
            const devGate = evaluateDevExecutionGate(gateCtx, policy);
            if (!devGate.allowed) {
              log("gate", `🟥 DEV blocked (approval policy): ${devGate.reason}`);
              for (const skipRow of devGate.traceSkips) {
                traceEvent(taskId, {
                  ...skipRow,
                  iteration: iterations,
                  step_id: stepId,
                  step_index: stepIndex,
                  ...graphMeta,
                  ...intentStep,
                });
              }
              traceEvent(taskId, {
                event: "gate_result",
                agent: agentId,
                iteration: iterations,
                step_id: stepId,
                step_index: stepIndex,
                ...graphMeta,
                ...intentStep,
                ...edgeMeta("gate_block"),
                gate: "approval_policy",
                passed: false,
                reason: devGate.reason,
              });
              artifacts.push({
                agentId,
                task: step.task,
                result: "",
                handoffYaml: "",
                gateBlocked: true,
                gateReason: `approval_policy: ${devGate.reason}`,
                step_id: stepId,
                intent_id: intentId,
                gate_kind: "approval_policy",
              });
              markStepRetryingAfterGate(runState);
              return "skip_step";
            }
            for (const skipRow of devGate.traceSkips) {
              traceEvent(taskId, {
                ...skipRow,
                iteration: iterations,
                step_id: stepId,
                step_index: stepIndex,
                ...graphMeta,
                ...intentStep,
              });
            }
          }
          return "proceed";
        },
      });

      if (stepExec.artifact) artifacts.push(stepExec.artifact);
      if (stepExec.emittedStepId) {
        emittedStepIds.add(stepExec.emittedStepId);
        previousStepId = stepExec.previousStepId ?? stepExec.emittedStepId;
      }
      if (stepExec.action === "break_orchestration") break orchestration;
      if (stepExec.action === "break_iteration") break;
      if (!stepExec.result) continue;

      let result = stepExec.result;

      // ── Compact handoff (compact-handoff MCP) ──────────────────────────────
      let handoffYaml = "";
      /** @type {Record<string, unknown>} */
      let handoffCompressionMeta = {};
      const toMode = resolveHandoffMode(agentId, step, AGENT_TO_MODE[agentId]);
      const nextStepIdx = steps.indexOf(step) + 1;
      const nextAgent   = steps[nextStepIdx]?.agentId;
      const nextMode    = nextAgent ? (AGENT_TO_MODE[nextAgent] || "ORCHESTRATOR") : "ORCHESTRATOR";

      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        log("gate", `Compacting handoff for ${agentId} → ${nextMode}...`);
        const compactionMeta = { iteration: iterations, step_id: stepId, step_index: stepIndex, ...graphMeta, ...intentStep };
        emitContextCompactionStarted(traceEvent, taskId, agentId, compactionMeta);
        try {
          const compactRes = callCompactHandoff({
            text: result,
            modeCompleted: toMode,
            nextMode,
            iteration: iterations,
            maxIterations,
            flowMode,
          }, { cwd });
          handoffYaml = compactRes.yaml;
          bumpOllamaFromStats({
            ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
            ollama_completion_tokens: compactRes.ollama_completion_tokens,
          });
          emitContextCompactionCompleted(traceEvent, taskId, agentId, compactionMeta, compactRes);
          traceEvent(taskId, {
            event: "context_stats",
            agent: "context_compactor",
            attributed_to_role: agentId,
            invocation_type: "context_compaction",
            execution_actor: "context_compactor",
            trigger_reason: "handoff_policy",
            iteration: iterations,
            step_id: stepId,
            step_index: stepIndex,
            ...graphMeta,
            ...intentStep,
            ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
            ollama_completion_tokens: compactRes.ollama_completion_tokens,
          });
          log("gate", `Handoff YAML ready (${handoffYaml.length} chars)`);
          traceEvent(taskId, {
            event: "gate_result",
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            ...graphMeta,
            ...intentStep,
            ...edgeMeta("success"),
            gate: "compact_handoff",
            passed: true,
            formal_handoff_completed: true,
          });
        } catch (err) {
          const msg = err.message || String(err);
          if (requireHandoff) {
            traceEvent(taskId, {
              event: "compact_handoff_failed",
              agent: agentId,
              iteration: iterations,
              step_id: stepId,
              ...intentStep,
              message: msg.slice(0, 400),
              phase: "worker_step",
            });
            log("gate", `🟥 compact_handoff failed (strict — hard fail): ${msg}`);
            artifacts.push({
              agentId,
              task: step.task,
              result,
              step_id: stepId,
              intent_id: intentId,
              gate_kind: "compact_handoff",
              ...compactHandoffStrictFailureFields(err),
            });
            markStepRetryingAfterGate(runState);
            continue;
          }
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            ...intentStep,
            message: msg.slice(0, 400),
            phase: "worker_step",
            handoff_degraded: true,
          });
          handoffCompressionMeta = compactHandoffDegradedMeta(err);
          log("gate", `⚠ compact_handoff unavailable (degraded — continuing without YAML compression): ${msg}`);
        }
      }

      // ── Structural handoff validation (per-MODE key check) ────────────────
      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        const requireQaSpecRef = qaSpecFlowEnabledRun && qaSpecSatisfiedThisIteration && toMode === "DEV";
        const sv = validateHandoffStructure(toMode, handoffYaml, { strict: requireHandoff, requireQaSpecRef });
        if (!sv.valid) {
          log("gate", `🟥 Handoff structure invalid (${toMode}): ${sv.reason}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "handoff_structure", passed: false, reason: sv.reason });
          artifacts.push({
            agentId,
            task: step.task,
            result,
            handoffYaml,
            gateBlocked: true,
            gateReason: `handoff_structure: ${sv.reason}`,
            step_id: stepId,
            intent_id: intentId,
            gate_kind: "handoff_structure",
          });
          markStepRetryingAfterGate(runState);
          continue;
        }
        traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "handoff_structure", passed: true });
        if (toMode === "QA_SPEC") qaSpecSatisfiedThisIteration = true;
        const qaFlowTrace = qaSpecFlowTraceExtras(toMode, true, handoffYaml);
        if (qaFlowTrace.event) {
          traceEvent(taskId, {
            ...qaFlowTrace,
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            step_index: stepIndex,
            ...graphMeta,
            ...intentStep,
          });
        }
      }

      // ── validate_goal_alignment + advance_mode ─────────────────────────────
      if (!skipStateMcp && AGENTS_REQUIRING_GATE.has(agentId) && handoffYaml) {
        try {
          log("gate", `Validating goal alignment for ${agentId}...`);
          const alignment = callStateMcp("validate_goal_alignment", {
            task_id: taskId,
            handoff_yaml: handoffYaml,
          }, { cwd });

          if (!alignment.ok) {
            log("gate", `WARNING: validate_goal_alignment failed: ${alignment.error}`);
          } else if (alignment.aligned === false) {
            // ORCH_TEST_SYSTEM_PATH_HARNESS: envelope has enforce_goal_alignment=false;
            // validate_transition still runs; LLM may return aligned=false — Node must not treat that as prod truth.
            if (orchTestSystemPathHarnessOn()) {
              log("gate", `⚠ ORCH_TEST_SYSTEM_PATH_HARNESS: goal alignment returned false — continuing (test harness only; not prod semantics)`);
              traceEvent(taskId, {
                event: "gate_result",
                agent: agentId,
                iteration: iterations,
                step_id: stepId,
                ...intentStep,
                gate: "goal_alignment",
                passed: true,
                confidence: alignment.confidence,
                test_system_path_harness: true,
                notes: alignment.notes,
              });
            } else {
              log("gate", `🟥 Goal not aligned: ${alignment.notes}. Skipping advance_mode for this step.`);
              traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "goal_alignment", passed: false, confidence: alignment.confidence, reason: alignment.notes });
              artifacts.push({
                agentId,
                task: step.task,
                result,
                handoffYaml,
                gateBlocked: true,
                gateReason: `goal_alignment: ${alignment.notes}`,
                step_id: stepId,
                intent_id: intentId,
                gate_kind: "goal_alignment",
              });
              markStepRetryingAfterGate(runState);
              continue;
            }
          } else {
            log("gate", `🟩 Goal aligned (confidence: ${alignment.confidence ?? "n/a"})`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "goal_alignment", passed: true, confidence: alignment.confidence });
          }

          log("gate", `validate_transition: ${currentMode} → ${nextMode} (iteration ${iterations})`);
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: currentMode,
            to_mode: nextMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (!vt.allowed) {
            log("gate", `🟥 Transition blocked: ${(vt.errors || []).join("; ")}`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: false, reason: (vt.errors || []).join("; ") });
            artifacts.push({
              agentId,
              task: step.task,
              result,
              handoffYaml,
              gateBlocked: true,
              gateReason: (vt.errors || []).join("; "),
              step_id: stepId,
              intent_id: intentId,
              gate_kind: "transition",
            });
            markStepRetryingAfterGate(runState);
            continue;
          }

          log("gate", `🟩 Transition allowed — advancing to ${nextMode}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: true });
          const adv = callStateMcp("advance_mode", {
            task_id: taskId,
            to_mode: nextMode,
            from_mode: currentMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (adv.ok) {
            currentMode = nextMode;
            log("gate", `Mode advanced → ${currentMode}`);
          } else {
            log("gate", `WARNING: advance_mode returned ok=false: ${adv.error || JSON.stringify(adv.errors)}`);
          }
        } catch (err) {
          log("gate", `WARNING: State MCP gate error (${err.message}). Continuing without gate.`);
        }
      }

      // ── Ollama step summary ────────────────────────────────────────────────
      let handoffSummary = "";
      if (stepSummary) {
        log("summarizer", `Summarizing ${agentId} output (Ollama)...`);
        try {
          const summaryResult = await summarizeHandoff({ agentId, task: step.task, result, cwd, priorArtifacts: artifacts });
          handoffSummary = summaryResult.summary;
          bumpOllamaFromStats(summaryResult);
          if (summaryResult.ollama_prompt_tokens != null || summaryResult.ollama_completion_tokens != null) {
            traceEvent(taskId, {
              event: "context_stats",
              agent: "summarizer",
              target_agent: agentId,
              iteration: iterations,
              ...(typeof summaryResult.ollama_prompt_tokens === "number" ? { ollama_prompt_tokens: summaryResult.ollama_prompt_tokens } : {}),
              ...(typeof summaryResult.ollama_completion_tokens === "number" ? { ollama_completion_tokens: summaryResult.ollama_completion_tokens } : {}),
            });
          }
          if (costGuardAbort("summarizer")) break orchestration;
          log("summarizer", `Summary ready (${handoffSummary.length} chars)`);
        } catch (err) {
          log("summarizer", `Ollama failed (${err.message}); next step uses truncation.`);
        }
      }

      artifacts.push({
        agentId,
        task: step.task,
        result,
        handoffYaml,
        gateBlocked: false,
        step_id: stepId,
        intent_id: intentId,
        ...(handoffSummary ? { handoffSummary } : {}),
        ...(Object.keys(handoffCompressionMeta).length ? handoffCompressionMeta : {}),
      });
      log(agentId, `Done (${result.length} chars)`);
    }

    // ── Cerberus review ───────────────────────────────────────────────────────
    let cerberusReviewRecordEmitted = false;
    logRoleSwitch(previousAgentId || "orchestrator", "cerberus");
    log("cerberus", "Reviewing deliverables...");
    const reviewChunks = artifacts.map((a) => {
      const { text } = truncateForContext(a.result, maxReviewChars);
      return `## ${a.agentId} — ${a.task}\n\n${text}`;
    });
    const cerberusPrompt = `Working directory: ${cwd}

Original goal: ${goal}

Deliverables from iteration ${iterations}:

${reviewChunks.join("\n\n---\n\n")}

Review the above. Classify each finding as blocker | improvement | nice-to-have.
Only blockers require another DEV iteration.

Your reply must begin with these three lines in this exact order (use (none) when a category has nothing to report; no preamble before blocker:):
blocker: ...
improvement: ...
nice-to-have: ...`;

    let cerberusResult = "";
    try {
      const { output, context_stats: cerbCtx } = await askAgent("cerberus", cerberusPrompt, { cwd, sessionEnv });
      cerberusResult = output;
      if (cerbCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "cerberus", cerbCtx, { iteration: iterations, phase: "review" });
        emitContextStatsRows(cerbCtx, "cerberus", iterations, {}, {}, { phase: "review" });
      }
      if (costGuardAbort("cerberus")) break orchestration;
      log("cerberus", `Review ready (${cerberusResult.length} chars)`);
    } catch (err) {
      const gateId = err.gate_id || null;
      const reason = (err.message || String(err)).slice(0, 300);
      traceEvent(taskId, {
        event: "contract_fail",
        agent: "cerberus",
        iteration: iterations,
        duration_ms: 0,
        reason,
        critical: true,
        ...(gateId ? { gate_id: gateId } : {}),
      });
      log("cerberus", `🟥 Output contract failed: ${err.message}`);
      traceReviewRecord(
        traceEvent,
        taskId,
        buildReviewRecord({
          reviewerRole: "cerberus",
          output: "",
          iteration: iterations,
          gateBlocked: true,
          gateReason: err.message,
          reviewedArtifactIds: artifacts
            .filter((a) => a.step_id && !a.gateBlocked)
            .map((a) => a.step_id),
        }),
      );
      cerberusReviewRecordEmitted = true;
      traceDoubtReviewCycle(
        traceEvent,
        taskId,
        buildDoubtReviewCycleFromCerberusOutput("", {
          iteration: iterations,
          reviewed_artifact_ids: artifacts
            .filter((a) => a.step_id && !a.gateBlocked && a.agentId !== "cerberus")
            .map((a) => a.step_id),
        }),
      );
      artifacts.push({
        agentId: "cerberus",
        task: "(session review) Deliverable review before decide",
        result: "",
        gateBlocked: true,
        gateReason: err.message,
        gate_kind: gateId || "cerberus_output_contract",
      });
    }

    // ── Compact cerberus handoff + advance to ORCHESTRATOR ────────────────────
    if (!skipStateMcp) {
      let cerberusHandoff = "";
      const cerbCompactionMeta = { iteration: iterations, phase: "cerberus_advance" };
      emitContextCompactionStarted(traceEvent, taskId, "cerberus", cerbCompactionMeta);
      try {
        const compactRes = callCompactHandoff({
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        }, { cwd });
        cerberusHandoff = compactRes.yaml;
        bumpOllamaFromStats({
          ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
          ollama_completion_tokens: compactRes.ollama_completion_tokens,
        });
        emitContextCompactionCompleted(traceEvent, taskId, "cerberus", cerbCompactionMeta, compactRes);
        traceEvent(taskId, {
          event: "context_stats",
          agent: "context_compactor",
          attributed_to_role: "cerberus",
          invocation_type: "context_compaction",
          execution_actor: "context_compactor",
          trigger_reason: "handoff_policy",
          iteration: iterations,
          phase: "cerberus_advance",
          ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
          ollama_completion_tokens: compactRes.ollama_completion_tokens,
        });
      } catch (err) {
        const msg = err.message || String(err);
        if (requireHandoff) {
          traceEvent(taskId, {
            event: "compact_handoff_failed",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
          });
          log("gate", `🟥 compact_handoff failed (strict — CERBERUS → ORCHESTRATOR): ${msg}`);
          artifacts.push({
            agentId: "cerberus",
            task: "(session review) Deliverable review before decide",
            result: cerberusResult,
            gate_kind: "compact_handoff",
            ...compactHandoffStrictFailureFields(err),
          });
        } else {
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
            handoff_degraded: true,
          });
          log("gate", `⚠ compact_handoff unavailable (degraded — CERBERUS advance): ${msg}`);
        }
      }
      if (cerberusHandoff) {
        try {
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: "CERBERUS",
            to_mode: "ORCHESTRATOR",
            handoff_yaml: cerberusHandoff,
            iteration: iterations,
          }, { cwd });

          if (vt.allowed) {
            callStateMcp("advance_mode", {
              task_id: taskId,
              to_mode: "ORCHESTRATOR",
              from_mode: "CERBERUS",
              handoff_yaml: cerberusHandoff,
              iteration: iterations,
            }, { cwd });
            currentMode = "ORCHESTRATOR";
          }
        } catch (err) {
          log("gate", `WARNING: Cerberus transition gate error (${err.message})`);
        }
      }
    }

    // ── Hard blocker enforcement (deterministic) ──────────────────────────────
    // Detect blockers from CERBERUS output directly — does not rely on the
    // orchestrator model to interpret whether iteration is required.
    // If blockers exist and iterations remain → force iterate.
    // If no blockers → allow orchestrator to declare done.
    const cerberusBlockers = detectBlockers(cerberusResult);
    const reviewedIds = artifacts
      .filter((a) => a.step_id && !a.gateBlocked && a.agentId !== "cerberus")
      .map((a) => a.step_id);
    if (!cerberusReviewRecordEmitted) {
      traceReviewRecord(
        traceEvent,
        taskId,
        buildReviewRecord({
          reviewerRole: "cerberus",
          output: cerberusResult,
          iteration: iterations,
          reviewedArtifactIds: reviewedIds,
        }),
      );
      traceDoubtReviewCycle(
        traceEvent,
        taskId,
        buildDoubtReviewCycleFromCerberusOutput(cerberusResult, {
          iteration: iterations,
          reviewed_artifact_ids: reviewedIds,
        }),
      );
    }
    traceEvent(taskId, { event: "cerberus_check", iteration: iterations, blockers: cerberusBlockers.count, items: cerberusBlockers.items.slice(0, 5) });

    const cerbDecision = decideCerberusBlockersBranch({
      blockerCount: cerberusBlockers.count,
      iterations,
      maxIterations,
    });
    if (cerbDecision === "iterate") {
      log("cerberus", `🟥 ${cerberusBlockers.count} blocker(s) detected — forcing iteration (deterministic)`);
      cerberusBlockers.items.forEach(b => log("cerberus", `  ↳ ${b.slice(0, 120)}`));

      // Ask orchestrator only for corrections — done=true is not an option when blockers exist
      const artifactsBlob = artifacts
        .map((a) => {
          const { text } = truncateForContext(a.result, maxReviewChars);
          return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
        })
        .join("\n\n---\n\n");

      const correctPrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus blockers (must be fixed):
${cerberusBlockers.items.join("\n")}

List the correction steps required. Reply with JSON: { "done": false, "corrections": [{ "agentId": "...", "task": "..." }] }`;

      logRoleSwitch("cerberus", "orchestrator");
      const { output: correctResponse, context_stats: correctCtx } = await askAgent("orchestrator", correctPrompt, { cwd, sessionEnv, phase: "decide" });
      if (correctCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", correctCtx, { iteration: iterations, phase: "correct" });
        emitContextStatsRows(correctCtx, "orchestrator", iterations, {}, {}, { phase: "correct" });
      }
      if (costGuardAbort("correct")) break orchestration;
      const corrections = extractJson(correctResponse);
      const corrPlan = decideCorrectionsPlan(corrections);
      const planOut = planStepsAfterCorrectionsResponse({
        corrPlan,
        artifacts,
        blockerItems: cerberusBlockers.items,
        maxBlockersInTask: 2,
      });
      const steps = /** @type {Array<{ agentId?: string, task: string }>} */ (planOut.steps);
      if (planOut.traceBranch === "iterate_corrections_json") {
        log("orchestrator", `↻ Correcting — ${steps.length} step(s):`);
        steps.forEach((c) =>
          log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
        );
        traceIterationDone(taskId, iterations, "iterate", transitionReason("GATE_BLOCK", "cerberus_blockers"), { blockers: cerberusBlockers.count, corrections: steps.length }, iterationDoneCtx());
        plan = { steps };
      } else {
        log("orchestrator", "WARNING: orchestrator returned no corrections — retrying last DEV steps");
        traceIterationDone(taskId, iterations, "iterate_fallback", transitionReason("ITERATE_FALLBACK", "orchestrator_no_corrections_json"), { blockers: cerberusBlockers.count }, iterationDoneCtx());
        plan = { steps };
      }
      continue;
    }

    if (cerbDecision === "manual_cap") {
      done = false;
      manualReview = true;
      summary = `Max iterations reached with ${cerberusBlockers.count} gate-blocked CERBERUS finding(s). Manual review required.`;
      log("orchestrator", `⚠ ${summary}`);
      traceIterationDone(taskId, iterations, "max_iterations_with_blockers", transitionReason("MAX_ITERATIONS", "cerberus_blockers_cap"), { blockers: cerberusBlockers.count }, iterationDoneCtx());
      continue;
    }

    // ── Gate-blocked artifact enforcement ────────────────────────────────────
    // Any artifact with gateBlocked:true in this iteration is an implicit blocker.
    // gateBlocked means a hard contract or gate failed — CERBERUS silence does not clear it.
    // This covers: output contract failures (missing files_read, files_modified,
    // validation_run), handoff structure failures, and goal alignment failures.
    const gateBlockedArtifacts = artifacts.filter(a => a.gateBlocked);
    const gateBlockedDecision = decideGateBlockedArtifactsBranch({
      artifactCount: gateBlockedArtifacts.length,
      iterations,
      maxIterations,
    });
    if (gateBlockedDecision === "iterate") {
      const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
      traceEvent(taskId, { event: "gate_blocked_completion", iteration: iterations, count: gateBlockedArtifacts.length, reasons: gateBlockReasons });
      log("orchestrator", `🟥 ${gateBlockedArtifacts.length} gate-blocked artifact(s) — cannot mark done (forcing iteration):`);
      gateBlockReasons.forEach(r => log("orchestrator", `  ↳ ${r}`));
      const _gb0 = gateBlockedArtifacts[0];
      traceIterationDone(
        taskId,
        iterations,
        "gate_blocked_iterate",
        transitionReason("GATE_BLOCK", "artifact_contract_or_handoff", {
          ...( _gb0 && _gb0.step_id ? { step_id: _gb0.step_id } : {}),
          ...( _gb0 && _gb0.gate_kind ? { gate_id: _gb0.gate_kind } : {}),
        }),
        { gate_blocks: gateBlockedArtifacts.length },
        iterationDoneCtx({ gateKinds: gateBlockedArtifacts.map((a) => a.gate_kind).filter(Boolean) }),
      );
      plan = { steps: planStepsReplayFromGateBlockedArtifacts(gateBlockedArtifacts) };
      continue;
    }
    if (gateBlockedDecision === "manual_cap") {
      const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
      done = false;
      manualReview = true;
      summary = summaryMaxIterationsGateBlocked({
        count: gateBlockedArtifacts.length,
        reasonLines: gateBlockReasons,
      });
      log("orchestrator", `⚠ ${summary}`);
      traceIterationDone(taskId, iterations, "max_iterations_with_gate_blocks", transitionReason("MAX_ITERATIONS", "gate_blocked_artifacts_cap"), { gate_blocks: gateBlockedArtifacts.length }, iterationDoneCtx());
      continue;
    }

    // ── ORCHESTRATOR decides (no blockers path) ───────────────────────────────
    logRoleSwitch("cerberus", "orchestrator");
    log("orchestrator", "No blockers — evaluating completion...");
    const artifactsBlob = artifacts
      .map((a) => {
        const { text } = truncateForContext(a.result, maxReviewChars);
        return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
      })
      .join("\n\n---\n\n");

    const decidePrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus review (no blockers):
${cerberusResult}

No blockers were found. Confirm completion or list any remaining corrections.
Reply with JSON only.`;

    let decideResponse = "";
    try {
      const { output, context_stats: decideCtx } = await askAgent("orchestrator", decidePrompt, { cwd, sessionEnv, phase: "decide" });
      decideResponse = output;
      if (decideCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", decideCtx, { iteration: iterations, phase: "decide" });
        emitContextStatsRows(decideCtx, "orchestrator", iterations, {}, {}, { phase: "decide" });
      }
      if (costGuardAbort("decide")) break orchestration;
    } catch (decideErr) {
      log("orchestrator", `⚠ Decide contract failed (${decideErr.message}) — treating as stopped`);
      traceEvent(taskId, { event: "decide_contract_fail", reason: decideErr.message });
    }
    const decide = extractJson(decideResponse);
    const loopDecision = decideFromOrchestratorDecide(decide);
    const mapped = mapDecideLoopToPlanOutcome(loopDecision);

    if (mapped.variant === "finish") {
      done = true;
      summary = /** @type {string} */ (mapped.summary);
      log("orchestrator", `✓ Done: ${summary}`);
      traceIterationDone(taskId, iterations, "done", transitionReason("DONE"), { summary: summary.slice(0, 200) }, iterationDoneCtx());
    } else if (mapped.variant === "iterate") {
      const corrections = /** @type {Array<{ agentId?: string, task: string }>} */ (mapped.planSteps);
      log("orchestrator", `↻ Iterating — ${corrections.length} correction(s):`);
      corrections.forEach((c) =>
        log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
      );
      traceIterationDone(taskId, iterations, "iterate", transitionReason("ITERATE", "orchestrator_decide_corrections"), { corrections: corrections.length }, iterationDoneCtx());
      plan = { steps: corrections };
    } else {
      done = true;
      summary = /** @type {string} */ (mapped.summary);
      log("orchestrator", summary);
      traceIterationDone(taskId, iterations, "stopped", transitionReason("CONTRACT_FAIL", summary), { summary }, iterationDoneCtx());
    }
  }

  if (!done && !summary) {
    summary = loopExhaustedDefaultSummary(maxIterations);
    log("orchestrator", summary);
    traceIterationDone(
      taskId,
      iterations,
      "loop_limit_stopped",
      transitionReason("MAX_ITERATIONS", "loop_exhausted_without_done"),
      { iterations, max_iterations: maxIterations },
    );
  }

  finalizeRunState(runState, { done, manualReview });

  // ── Surface degraded compact_handoff fallback in summary (structured data is on artifacts) ──
  const handoffFallbackArtifacts = artifacts.filter((a) => a.handoff_fallback_used === true);
  if (handoffFallbackArtifacts.length > 0) {
    const agents = [...new Set(handoffFallbackArtifacts.map((a) => a.agentId))].join(", ");
    const err0 = handoffFallbackArtifacts[0].handoff_error || "unknown";
    const note = `[handoff compression unavailable for ${agents} — continued without compact_handoff; error: ${String(err0).slice(0, 120)}]`;
    summary = summary ? `${summary}\n${note}` : note;
  }

  // ── Record session summary artifact before closing ───────────────────────
  if (!skipStateMcp) {
    try {
      const sessionSummary = [
        `goal: ${goal}`,
        `iterations: ${iterations}/${maxIterations}`,
        `agents_run: ${[...new Set(artifacts.map(a => a.agentId))].join(", ")}`,
        `outcome: ${summary}`,
        artifacts.length > 0
          ? `last_artifacts:\n${artifacts.slice(-3).map(a => `  - ${a.agentId}: ${a.task.slice(0, 80)}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

      callStateMcp("record_artifact", {
        task_id: taskId,
        artifact_id: "session-summary",
        content: sessionSummary,
        agent_id: "orchestrator",
      }, { cwd });
      log("gate", "Session summary recorded in envelope.");
    } catch (err) {
      log("gate", `WARNING: record_artifact failed (${err.message})`);
    }
  }

  // ── Close task (state store) ──────────────────────────────────────────────
  if (!skipStateMcp) {
    try {
      callStateMcp("close_task", { task_id: taskId, reason: summary }, { cwd });
      log("gate", `Task "${taskId}" closed in state store.`);
    } catch (err) {
      log("gate", `WARNING: close_task failed (${err.message})`);
    }
  }

  // Clear active agent state
  try { fs.unlinkSync(AGENT_STATE_FILE); } catch { /* already gone */ }

  const qaDegraded = degradedInRun.has("qa");
  if (qaDegraded) {
    log("qa", "⚠ QA ran in degraded mode (fallback model) — coverage may be reduced. Manual review recommended.");
  }
  const manualReviewRecommended = qaDegraded || manualReview;
  const handoffFallbackAny = artifacts.some((a) => a.handoff_fallback_used === true);
  const mcpSummary = aggregateMcpUsage(getMcpAuditCalls());
  const permission_summary = aggregatePermissionCheckRows(getPermissionCheckAuditBuffer());
  const traceRows = loadTraceRowsForTask(taskId);
  runRecoverySweepAndTrace(traceEvent, taskId, traceRows, {
    lifecycleMode: "live_before_session_end",
  });
  traceEvent(taskId, {
    event: "session_end",
    session_id: taskId,
    flow_src: "orchestrator_cli",
    scope: runScope.scope,
    ...(runScope.scope_unknown_reason ? { scope_unknown_reason: runScope.scope_unknown_reason } : {}),
    iterations,
    done,
    summary: summary.slice(0, 200),
    agents_run: [...new Set(artifacts.map((a) => a.agentId))],
    gate_blocks: artifacts.filter((a) => a.gateBlocked).length,
    run_state_snapshot: getRunStatePublicView(runState),
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    ...mcpSummary,
    permission_summary,
    ...(ollamaTokenTotals.prompt > 0 || ollamaTokenTotals.completion > 0
      ? {
        ollama_prompt_tokens_total: ollamaTokenTotals.prompt,
        ollama_completion_tokens_total: ollamaTokenTotals.completion,
      }
      : {}),
    ...(qaDegraded ? { qa_degraded: true } : {}),
    ...(manualReviewRecommended ? { manual_review_recommended: true } : {}),
    ...(handoffFallbackAny ? { handoff_fallback_used: true, handoff_degraded: true } : {}),
  });

  clearMcpAudit();
  return { done, summary, artifacts, iterations, taskId, runState: getRunStatePublicView(runState) };
}

// ── Public facade (require("../orchestrator") — preserve export names) ───────
module.exports = {
  // Entrypoint
  run,

  // Handoff policy (owned by orchestrator.js)
  resolveRequireHandoff,
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,

  // Run-loop helpers (re-exported from run-loop-helpers.js)
  resolveMaxIterations,
  detectBlockers,
  validateHandoffStructure,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  edgeMeta,
  EDGE_TYPE_CATEGORY,
  validateStepGraph,
  assertParentStepExists,

  // QA spec flow (re-exported from qa-spec-flow.js)
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,

  // Trace sanitization & iteration_done (re-exported from trace-writer.js / trace-redact.js)
  _sanitize,
  _hashGoal,
  redactSensitivePlaintext,
  TRACE_SCHEMA_VERSION,
  transitionReason,
  TRANSITION_REASON_TYPES,
  TRANSITION_REASON_CODES,
  inferReasonCode,
  FAILURE_TYPES,
  FAILURE_AXES,
  failureTypeForIterationDone,
  failureAxisForIterationDone,
  traceIterationDone,
  composeIterationDonePayload,

  // MCP & permission audit (re-exported from mcp-client.js / permission-check-summary.js)
  emitPermissionCheckTrace,
  aggregateMcpUsage,
  aggregatePermissionCheckRows,

  // Environment parsing (re-exported from environment-parser.js)
  parseEnvironment,

  // Test-only MCP surface — not a supported public API
  _test_invokeMcpDirect: invokeMcpDirect,
  _test_callStateMcp: callStateMcp,
  _test_callCompactHandoff: callCompactHandoff,
  _test_beginMcpAudit: beginMcpAudit,
  _test_clearMcpAudit: clearMcpAudit,
};
