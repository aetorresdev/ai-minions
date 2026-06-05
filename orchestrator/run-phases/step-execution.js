"use strict";

/**
 * Step execution phase: agent_start → optional gate hook → askAgent →
 * contract_fail | agent_done → worker cost guard.
 * Gate handling (approval, handoff, alignment) stays in orchestrator until slice 4.
 *
 * @param {ReturnType<import("./phase-context").createPhaseContext>} ctx
 * @param {{
 *   agentId: string,
 *   step: { task: string, qaPhase?: string },
 *   stepId: string,
 *   stepIndex: number,
 *   retryNumber: number,
 *   graphMeta: object,
 *   intentStep: object,
 *   contextBlock: string,
 *   writeAgentState: (agentId: string, goal: string) => void,
 *   setStepRunning: (runState: object, stepId: string, agentId: string) => void,
 *   setStepFailedAndClear: (runState: object) => void,
 *   setStepCompleted: (runState: object) => void,
 *   runState: object,
 *   askAgent: (agentId: string, prompt: string, opts: object) => Promise<{ output: string, context_stats?: object }>,
 *   getDegradedAgents: () => Iterable<string>,
 *   clearDegradedAgents: () => void,
 *   degradedInRun: Set<string>,
 *   edgeMeta: (edgeType: string) => object,
 *   qaAgentDoneTraceExtras: (output: string) => object,
 *   shouldEmitQaReviewRecord: (agentId: string, step: object) => boolean,
 *   traceReviewRecord: (...args: unknown[]) => void,
 *   buildReviewRecord: (opts: object) => object,
 *   onAfterAgentStart: () => Promise<"proceed" | "skip_step">,
 * }} step
 * @returns {Promise<{
 *   action: "continue" | "break_iteration" | "break_orchestration",
 *   result?: string,
 *   emittedStepId?: string,
 *   previousStepId?: string,
 *   artifact?: object,
 * }>}
 */
async function executeStepAgentInvocation(ctx, step) {
  const {
    agentId,
    step: stepDef,
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
    onAfterAgentStart,
  } = step;

  writeAgentState(agentId, ctx.goal);
  ctx.log(agentId, `Executing: ${stepDef.task.slice(0, 80)}${stepDef.task.length > 80 ? "..." : ""}`);
  const stepStart = Date.now();
  ctx.traceEvent(ctx.taskId, {
    event: "agent_start",
    agent: agentId,
    iteration: ctx.iterations(),
    step_id: stepId,
    step_index: stepIndex,
    retry_number: retryNumber,
    ...graphMeta,
    ...intentStep,
    task: stepDef.task.slice(0, 200),
  });
  setStepRunning(runState, stepId, agentId);

  const afterStart = await onAfterAgentStart();
  if (afterStart === "skip_step") {
    return { action: "continue" };
  }

  let result;
  let contextStats;
  try {
    const agentResult = await askAgent(
      agentId,
      `Working directory: ${ctx.cwd}\n\nContext:\n${contextBlock}\n\nYour task:\n${stepDef.task}`,
      { cwd: ctx.cwd, sessionEnv: ctx.sessionEnv, qaPhase: stepDef.qaPhase },
    );
    result = agentResult.output;
    contextStats = agentResult.context_stats || null;
  } catch (err) {
    const duration_ms = Date.now() - stepStart;
    const isCritical = ["architect", "qa", "cerberus"].includes(agentId);
    const gateId = err.gate_id || null;
    ctx.traceEvent(ctx.taskId, {
      event: "contract_fail",
      agent: agentId,
      iteration: ctx.iterations(),
      step_id: stepId,
      step_index: stepIndex,
      retry_number: retryNumber,
      ...graphMeta,
      ...intentStep,
      ...edgeMeta("fail"),
      duration_ms,
      reason: err.message.slice(0, 300),
      critical: isCritical,
      ...(gateId ? { gate_id: gateId } : {}),
    });
    setStepFailedAndClear(runState);
    ctx.log(agentId, `🟥 Output contract failed: ${err.message}`);
    const artifact = {
      agentId,
      task: stepDef.task,
      result: typeof err.rawModelOutput === "string" ? err.rawModelOutput : "",
      gateBlocked: true,
      gateReason: err.message,
      step_id: stepId,
      intent_id: intentStep.intent_id,
      gate_kind: gateId || "output_contract",
    };
    if (isCritical) {
      ctx.log(agentId, "🟥 Critical role contract fail — stopping iteration (no QA/CERBERUS/ARCHITECT degradation allowed)");
      return {
        action: "break_iteration",
        artifact,
        emittedStepId: stepId,
        previousStepId: stepId,
      };
    }
    return {
      action: "continue",
      artifact,
      emittedStepId: stepId,
      previousStepId: stepId,
    };
  }

  for (const id of getDegradedAgents()) degradedInRun.add(id);
  clearDegradedAgents();
  const stepDegraded = degradedInRun.has(agentId);
  const edgeType = retryNumber > 0 ? "retry" : "success";
  /** @type {Record<string, unknown>} */
  const donePayload = {
    event: "agent_done",
    agent: agentId,
    iteration: ctx.iterations(),
    step_id: stepId,
    step_index: stepIndex,
    retry_number: retryNumber,
    ...graphMeta,
    ...intentStep,
    ...edgeMeta(edgeType),
    duration_ms: Date.now() - stepStart,
    output_chars: result.length,
    ...(stepDegraded ? { degraded: true } : {}),
  };
  if (agentId === "qa") {
    Object.assign(donePayload, qaAgentDoneTraceExtras(result));
  }
  ctx.traceEvent(ctx.taskId, donePayload);
  if (shouldEmitQaReviewRecord(agentId, stepDef)) {
    traceReviewRecord(
      ctx.traceEvent,
      ctx.taskId,
      buildReviewRecord({
        reviewerRole: "qa",
        output: result,
        iteration: ctx.iterations(),
        stepId,
        reviewedArtifactIds: [stepId],
      }),
    );
  }
  setStepCompleted(runState);
  if (contextStats) {
    ctx.emitModelFallbackLifecycleIfNeeded(
      ctx.traceEvent,
      ctx.taskId,
      agentId,
      contextStats,
      { iteration: ctx.iterations(), step_id: stepId, step_index: stepIndex, ...graphMeta, ...intentStep },
    );
    ctx.emitContextStatsRows(
      contextStats,
      agentId,
      ctx.iterations(),
      graphMeta,
      intentStep,
      { step_id: stepId, step_index: stepIndex },
    );
  }
  if (ctx.costGuardAbort("worker")) {
    return { action: "break_orchestration", result, emittedStepId: stepId, previousStepId: stepId };
  }

  return {
    action: "continue",
    result,
    emittedStepId: stepId,
    previousStepId: stepId,
  };
}

module.exports = {
  executeStepAgentInvocation,
};
