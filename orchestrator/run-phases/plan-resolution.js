"use strict";

/**
 * Plan resolution phase: orchestrator planning prompt, plan parse/normalize,
 * capability validation, optional cost-guard abort, first advance_mode.
 * Observable boundary ends before main iteration loop.
 *
 * @param {{
 *   taskId: string,
 *   cwd: string,
 *   flowMode: string,
 *   goal: string,
 *   maxIterations: number,
 *   sessionEnv: object | null,
 *   skipStateMcp: boolean,
 *   credentialSessionMode: string,
 *   plan: { steps: object[] },
 *   summary: string,
 *   manualReview: boolean,
 *   skipMainOrchestrationLoop: boolean,
 *   currentMode: string,
 *   log: (agent: string, msg: string) => void,
 *   traceEvent: (taskId: string, payload: object) => void,
 *   askAgent: (agent: string, prompt: string, opts: object) => Promise<{ output: string, context_stats?: object }>,
 *   emitModelFallbackLifecycleIfNeeded: (...args: unknown[]) => void,
 *   emitContextStatsRows: (stats: object, agent: string, iteration: number, graphMeta: object, intentStep: object, loc?: object) => void,
 *   maybeEmitBudgetWarning: (phase: string) => void,
 *   checkCostGuard: (phase: string, meta?: object) => object,
 *   budgetEventFields: (d: object) => object,
 *   traceIterationDone: (...args: unknown[]) => void,
 *   transitionReason: (...args: unknown[]) => object,
 *   roundUsd6: (n: number) => number,
 *   extractJson: (text: string) => object | null,
 *   stripLeadingOwnerArchitectForDegradedMultiAgent: (steps: object[]) => object[],
 *   isQaSpecBeforeDevEnabled: (flowMode: string) => boolean,
 *   applyQaSpecBeforeDevPlan: (steps: object[], opts: object) => object[],
 *   validatePlanStepsCapability: (steps: object[], opts: object) => { ok: boolean, errors: string[] },
 *   CAPABILITY_MATRIX_VERSION: string,
 *   callStateMcp: (tool: string, payload: object, opts: object) => object,
 *   AGENT_TO_MODE: Record<string, string>,
 *   getLastBudgetMeta: () => object,
 * }} deps
 * @returns {Promise<{
 *   plan: { steps: object[] },
 *   summary: string,
 *   manualReview: boolean,
 *   skipMainOrchestrationLoop: boolean,
 *   currentMode: string,
 * }>}
 */
async function executePlanResolutionPhase(deps) {
  const {
    taskId,
    cwd,
    flowMode,
    goal,
    maxIterations,
    sessionEnv,
    skipStateMcp,
    credentialSessionMode,
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
  } = deps;

  let plan = deps.plan;
  let summary = deps.summary;
  let manualReview = deps.manualReview;
  let skipMainOrchestrationLoop = deps.skipMainOrchestrationLoop;
  let currentMode = deps.currentMode;

  log("orchestrator", "Planning...");
  const multiAgentPlanConstraint =
    flowMode === "multi_agent"
      ? `

Hard requirement for FLOW multi_agent: "steps" MUST include at least one implementation agent (agentId dev-backend, dev-frontend, or dev-devops) with a concrete code-edit task, and a later step with agentId qa that reviews that implementation. For goals that change source files, do NOT emit a plan with only owner or architect — those roles scope or design; implementation and QA review are mandatory in this flow.
${isQaSpecBeforeDevEnabled(flowMode) ? `
Acceptance-first (QA_SPEC before DEV): place a qa step BEFORE the first dev-* step to define acceptance_criteria, test_strategy (or required_tests), edge_cases, non_goals, and validation_commands. Tag that step with "qaPhase": "spec". The post-implementation qa review step must use "qaPhase": "exec" and run after dev-* completes.` : ""}

When the goal is a localized change to existing application code (bugfix, validation, small feature) in the working directory, prefer the MINIMAL pipeline only: dev-backend → qa → cerberus (in that order). The dev-backend task must name the file(s) to edit and require files_read[], files_modified:, and validation_run in the output. Omit owner and architect unless the goal explicitly asks for product scope, a written spec, architecture trade-offs, or diagrams before coding.`
      : "";
  const planPrompt = `MODE: ORCHESTRATOR
FLOW: ${flowMode}
GOAL: ${goal}
MAX_ITERATIONS: ${maxIterations}
Working directory: ${cwd}

Decompose this goal into ordered execution steps following the MODE protocol.
Assign one agent per step. Reply with JSON only.${multiAgentPlanConstraint}`;

  const { output: planResponse, context_stats: planCtxStats } = await askAgent("orchestrator", planPrompt, { cwd, sessionEnv, phase: "plan" });
  if (planCtxStats) {
    emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", planCtxStats, { iteration: 0, phase: "plan" });
    emitContextStatsRows(planCtxStats, "orchestrator", 0, {}, {}, { phase: "plan" });
  }
  maybeEmitBudgetWarning("plan");
  const planCost = checkCostGuard("plan", deps.getLastBudgetMeta());
  if (!planCost.ok) {
    summary = `Guardrail budget limit (${planCost.budget_scope}) exceeded: estimated spend ${roundUsd6(planCost.estimate)} USD exceeds limit ${planCost.limit} after plan phase.`;
    manualReview = true;
    traceEvent(taskId, {
      event: "budget_block",
      ...budgetEventFields(planCost),
    });
    traceEvent(taskId, {
      event: "budget_exhausted",
      ...budgetEventFields(planCost),
    });
    traceIterationDone(taskId, 0, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
      estimate_usd: roundUsd6(planCost.estimate),
      limit_usd: planCost.limit,
      guard_phase: "plan",
      budget_scope: planCost.budget_scope,
      triggered_budgets: planCost.triggered_budgets,
    });
    skipMainOrchestrationLoop = true;
  }
  const parsed = extractJson(planResponse);
  if (parsed && Array.isArray(parsed.steps)) {
    plan = parsed;
    if (flowMode === "multi_agent" && skipStateMcp) {
      const before = plan.steps.length;
      plan.steps = stripLeadingOwnerArchitectForDegradedMultiAgent(plan.steps);
      if (plan.steps.length !== before) {
        traceEvent(taskId, {
          event: "plan_normalized",
          removed_leading_steps: before - plan.steps.length,
        });
      }
    }
    if (isQaSpecBeforeDevEnabled(flowMode) && plan.steps.length) {
      const beforeQa = plan.steps.length;
      plan.steps = applyQaSpecBeforeDevPlan(plan.steps, { enabled: true });
      if (plan.steps.length !== beforeQa) {
        traceEvent(taskId, {
          event: "plan_normalized",
          reason: "qa_spec_before_dev",
          steps_added: plan.steps.length - beforeQa,
        });
      }
    }
    log("orchestrator", `Plan ready — ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => log(s.agentId || "?", `Step ${i + 1}: ${s.task}`));
    const capPlan = validatePlanStepsCapability(plan.steps, { sessionCredentialMode: credentialSessionMode });
    if (!capPlan.ok) {
      summary = `Plan rejected — ${capPlan.errors.join("; ")}`;
      manualReview = true;
      traceEvent(taskId, {
        event: "plan_capability_reject",
        capability_matrix_version: CAPABILITY_MATRIX_VERSION,
        errors: capPlan.errors,
      });
      skipMainOrchestrationLoop = true;
    }
  }

  if (!skipMainOrchestrationLoop) {
    const firstAgent = plan.steps[0]?.agentId;
    if (!skipStateMcp && firstAgent && AGENT_TO_MODE[firstAgent]) {
      try {
        callStateMcp("advance_mode", {
          task_id: taskId,
          to_mode: AGENT_TO_MODE[firstAgent],
          from_mode: "ORCHESTRATOR",
          handoff_yaml: "",
          iteration: -1,
        }, { cwd });
        currentMode = AGENT_TO_MODE[firstAgent];
      } catch (err) {
        log("gate", `WARNING: advance_mode failed (${err.message})`);
      }
    }
  }

  return {
    plan,
    summary,
    manualReview,
    skipMainOrchestrationLoop,
    currentMode,
  };
}

module.exports = {
  executePlanResolutionPhase,
};
