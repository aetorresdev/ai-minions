"use strict";

/**
 * Session lifecycle start: local model setup, session_start trace, degraded banner,
 * register_task. Observable boundary ends before plan resolution.
 *
 * @param {{
 *   taskId: string,
 *   cwd: string,
 *   flowMode: string,
 *   goal: string,
 *   maxIterations: number,
 *   runScope: { scope: string, scope_unknown_reason?: string },
 *   scenarioId: string | null,
 *   requireHandoff: boolean,
 *   skipStateMcp: boolean,
 *   approvedArtifacts: string[],
 *   sessionEnv: { mode: string, credentials: unknown[] } | null,
 *   parsedBudgetWarningRatio: { value: number | null, invalid?: object },
 *   parsedBudgetLimits: { limits: object, invalid?: object },
 *   maxContextChars: number,
 *   stepSummary: boolean,
 *   maxCostUsd: number | null,
 *   budgetWarningRatio: number | null,
 *   budgetLimits: object,
 *   maxStepRetries: number | null,
 *   localModel: string | null | undefined,
 *   log: (agent: string, msg: string) => void,
 *   traceEvent: (taskId: string, payload: object) => void,
 *   checkOllama: () => Promise<boolean>,
 *   configureLocalModelPolicy: (opts: object) => void,
 *   setLocalModelTraceReporter: (fn: (payload: object) => void) => void,
 *   validateLocalOnlyRunPrerequisites: (opts: object) => Promise<object>,
 *   clearDegradedAgents: () => void,
 *   buildWorktreeTraceFields: (cwd: string) => object,
 *   callStateMcp: (tool: string, payload: object, opts: object) => object,
 *   CONTRACT_VERSION: string,
 *   orchTestSystemPathHarnessOn: () => boolean,
 * }} deps
 * @returns {Promise<{ localOnlyCtx: object }>}
 */
async function executeSessionStartPhase(deps) {
  const {
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
    localModel,
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
  } = deps;

  clearDegradedAgents();
  configureLocalModelPolicy({ cliModel: localModel ?? null, cwd });
  setLocalModelTraceReporter((payload) => traceEvent(taskId, payload));
  const localOnlyCtx = await validateLocalOnlyRunPrerequisites({ checkOllama, cwd });

  log("orchestrator", `Working directory: ${cwd}`);
  log("orchestrator", `task_id: ${taskId} | flow: ${flowMode} | max_iterations: ${maxIterations}`);
  if (parsedBudgetWarningRatio.invalid) {
    traceEvent(taskId, {
      event: "budget_config_invalid",
      ...parsedBudgetWarningRatio.invalid,
    });
  }
  if (parsedBudgetLimits.invalid) {
    traceEvent(taskId, {
      event: "budget_config_invalid",
      ...parsedBudgetLimits.invalid,
    });
  }
  if (sessionEnv) {
    const credNames = sessionEnv.credentials.map((c) => c.name).join(", ");
    log("orchestrator", `Environment: mode=${sessionEnv.mode} | credentials: ${credNames || "none"}`);
  }

  const ollamaModel = process.env.OLLAMA_MODEL || null;
  if (localOnlyCtx.local_only_mode) {
    log(
      "orchestrator",
      `Local-only mode — model: ${localOnlyCtx.selected_model} (source: ${localOnlyCtx.override_source}${localOnlyCtx.selection_reason ? `; ${localOnlyCtx.selection_reason}` : ""})`,
    );
  } else if (ollamaModel) {
    const ollamaOk = await checkOllama();
    if (!ollamaOk) {
      log(
        "orchestrator",
        `WARNING: OLLAMA_MODEL=${ollamaModel} set but Ollama unreachable at ${process.env.OLLAMA_HOST || "localhost"}:${process.env.OLLAMA_PORT || "11434"}. orchestrator/summarizer will use claude-haiku fallback.`,
      );
    } else {
      log("orchestrator", `Ollama ready — model: ${ollamaModel}`);
    }
  } else {
    log("orchestrator", "Ollama not configured (OLLAMA_MODEL unset) — orchestrator/summarizer using claude-haiku.");
  }
  log(
    "orchestrator",
    `Context: ${stepSummary ? "Ollama handoff between steps" : "no Ollama summary"}; truncation: ${maxContextChars > 0 ? `${maxContextChars} chars/step` : "off"}`,
  );
  if (maxCostUsd != null) {
    log("orchestrator", `Guardrail: ORCH_MAX_COST_USD=${maxCostUsd} (Ollama USD estimate from ORCH_USD_PER_MTOK_*)`);
    if (budgetWarningRatio != null) {
      log("orchestrator", `Guardrail: ORCH_BUDGET_WARNING_RATIO=${budgetWarningRatio} (trace-only warning threshold)`);
    }
  }
  if (
    Object.keys(budgetLimits.roles || {}).length
    || Object.keys(budgetLimits.steps || {}).length
    || Object.keys(budgetLimits.models || {}).length
  ) {
    log("orchestrator", "Guardrail: ORCH_BUDGET_LIMITS_JSON active (run/role/step/model actual-token budget limits)");
  }
  if (maxStepRetries != null) {
    log("orchestrator", `Guardrail: ORCH_MAX_RETRIES=${maxStepRetries} (per agentId retry_number cap within one iteration)`);
  }
  traceEvent(taskId, {
    event: "session_start",
    session_id: taskId,
    flow_mode: flowMode,
    flow_src: "orchestrator_cli",
    scope: runScope.scope,
    ...(runScope.scope_unknown_reason ? { scope_unknown_reason: runScope.scope_unknown_reason } : {}),
    max_iterations: maxIterations,
    cwd,
    goal: goal.slice(0, 200),
    require_handoff: requireHandoff,
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    ...localOnlyCtx,
    ...buildWorktreeTraceFields(cwd),
  });

  if (skipStateMcp) {
    const YELLOW = "\x1b[33m";
    const BOLD = "\x1b[1m";
    const RESET = "\x1b[0m";
    console.log(`\n${YELLOW}${BOLD}⚠  DEGRADED MODE — hard gates DISABLED${RESET}`);
    console.log(`${YELLOW}   orchestrator-state and compact-handoff MCPs are not active.`);
    console.log(`   No transitions are recorded. No goal alignment is checked.`);
    console.log(`   No approved-artifact enforcement. Output contracts still apply.`);
    console.log(`   Run without --skip-gates to enable strict mode.\n${RESET}`);
    traceEvent(taskId, { event: "degraded_mode", reason: "skipStateMcp=true" });
  }

  if (!skipStateMcp) {
    log("gate", `Registering task "${taskId}" in state store...`);
    try {
      /** @type {Record<string, unknown>} */
      const registerPayload = {
        goal,
        task_id: taskId,
        flow_mode: flowMode,
        max_iterations: maxIterations,
        approved_artifacts: JSON.stringify(approvedArtifacts),
        contract_version: CONTRACT_VERSION,
      };
      if (orchTestSystemPathHarnessOn()) {
        registerPayload.enforce_goal_alignment = false;
      }
      const reg = callStateMcp("register_task", registerPayload, { cwd });
      if (!reg.ok) throw new Error(reg.error || "register_task failed");
      log("gate", `Task registered — envelope: ${reg.envelope_path}`);
    } catch (err) {
      log("gate", `\x1b[33m\x1b[1m⚠  DEGRADED MODE — state store unavailable\x1b[0m (${err.message}). Continuing without hard gates.`);
      traceEvent(taskId, { event: "degraded_mode", reason: err.message });
    }
  }

  return { localOnlyCtx };
}

module.exports = {
  executeSessionStartPhase,
};
