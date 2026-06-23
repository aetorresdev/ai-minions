"use strict";

const { flattenSessionEndDeps } = require("./phase-deps");

/**
 * Session end phase (slice 6): loop-limit stop, run state finalize, session summary
 * artifact, close_task, recovery sweep, session_end trace.
 *
 * @param {ReturnType<import("./phase-context").createPhaseContext>} ctx
 * @param {{
 *   done: boolean,
 *   summary: string,
 *   manualReview: boolean,
 *   iterations: number,
 *   maxIterations: number,
 *   skipStateMcp: boolean,
 *   runState: object,
 *   artifacts: object[],
 *   goal: string,
 *   degradedInRun: Set<string>,
 *   runScope: { scope: string, scope_unknown_reason?: string },
 *   scenarioId: string | null,
 *   ollamaTokenTotals: { prompt: number, completion: number },
 *   loopExhaustedDefaultSummary: (max: number) => string,
 *   traceIterationDone: (...args: unknown[]) => void,
 *   transitionReason: (...args: unknown[]) => object,
 *   finalizeRunState: (runState: object, opts: object) => void,
 *   callStateMcp: (tool: string, payload: object, opts: object) => object,
 *   AGENT_STATE_FILE: string,
 *   fsUnlinkSync: (path: string) => void,
 *   loadTraceRowsForTask: (taskId: string) => object[],
 *   runRecoverySweepAndTrace: (...args: unknown[]) => void,
 *   getRunStatePublicView: (runState: object) => object,
 *   aggregateMcpUsage: (calls: unknown[]) => object,
 *   getMcpAuditCalls: () => unknown[],
 *   aggregatePermissionCheckRows: (buf: unknown[]) => object,
 *   getPermissionCheckAuditBuffer: () => unknown[],
 * } | ReturnType<import("./phase-deps").buildSessionEndDeps>} deps
 * @returns {{
 *   done: boolean,
 *   summary: string,
 *   artifacts: object[],
 *   iterations: number,
 *   taskId: string,
 *   runState: object,
 * }}
 */
function executeSessionEndPhase(ctx, deps) {
  const flat = deps.sessionEndDeps ? flattenSessionEndDeps(deps) : deps;
  const {
    done: initialDone,
    summary: initialSummary,
    manualReview,
    iterations,
    maxIterations,
    skipStateMcp,
    runState,
    artifacts,
    goal,
    degradedInRun,
    runScope,
    scenarioId,
    ollamaTokenTotals,
    loopExhaustedDefaultSummary,
    traceIterationDone,
    transitionReason,
    finalizeRunState,
    callStateMcp,
    AGENT_STATE_FILE,
    fsUnlinkSync,
    loadTraceRowsForTask,
    runRecoverySweepAndTrace,
    getRunStatePublicView,
    aggregateMcpUsage,
    getMcpAuditCalls,
    aggregatePermissionCheckRows,
    getPermissionCheckAuditBuffer,
  } = flat;

  let done = initialDone;
  let summary = initialSummary;

  if (!done && !summary) {
    summary = loopExhaustedDefaultSummary(maxIterations);
    ctx.log("orchestrator", summary);
    traceIterationDone(
      ctx.taskId,
      iterations,
      "loop_limit_stopped",
      transitionReason("MAX_ITERATIONS", "loop_exhausted_without_done"),
      { iterations, max_iterations: maxIterations },
    );
  }

  finalizeRunState(runState, { done, manualReview });

  const handoffFallbackArtifacts = artifacts.filter((a) => a.handoff_fallback_used === true);
  if (handoffFallbackArtifacts.length > 0) {
    const agents = [...new Set(handoffFallbackArtifacts.map((a) => a.agentId))].join(", ");
    const err0 = handoffFallbackArtifacts[0].handoff_error || "unknown";
    const note = `[handoff compression unavailable for ${agents} — continued without compact_handoff; error: ${String(err0).slice(0, 120)}]`;
    summary = summary ? `${summary}\n${note}` : note;
  }

  if (!skipStateMcp) {
    try {
      const sessionSummary = [
        `goal: ${goal}`,
        `iterations: ${iterations}/${maxIterations}`,
        `agents_run: ${[...new Set(artifacts.map((a) => a.agentId))].join(", ")}`,
        `outcome: ${summary}`,
        artifacts.length > 0
          ? `last_artifacts:\n${artifacts.slice(-3).map((a) => `  - ${a.agentId}: ${a.task.slice(0, 80)}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      callStateMcp(
        "record_artifact",
        {
          task_id: ctx.taskId,
          artifact_id: "session-summary",
          content: sessionSummary,
          agent_id: "orchestrator",
        },
        { cwd: ctx.cwd },
      );
      ctx.log("gate", "Session summary recorded in envelope.");
    } catch (err) {
      ctx.log("gate", `WARNING: record_artifact failed (${err.message})`);
    }
  }

  if (!skipStateMcp) {
    try {
      callStateMcp("close_task", { task_id: ctx.taskId, reason: summary }, { cwd: ctx.cwd });
      ctx.log("gate", `Task "${ctx.taskId}" closed in state store.`);
    } catch (err) {
      ctx.log("gate", `WARNING: close_task failed (${err.message})`);
    }
  }

  try {
    fsUnlinkSync(AGENT_STATE_FILE);
  } catch {
    /* already gone */
  }

  const qaDegraded = degradedInRun.has("qa");
  if (qaDegraded) {
    ctx.log("qa", "⚠ QA ran in degraded mode (fallback model) — coverage may be reduced. Manual review recommended.");
  }
  const manualReviewRecommended = qaDegraded || manualReview;
  const handoffFallbackAny = artifacts.some((a) => a.handoff_fallback_used === true);
  const mcpSummary = aggregateMcpUsage(getMcpAuditCalls());
  const permission_summary = aggregatePermissionCheckRows(getPermissionCheckAuditBuffer());
  const traceRows = loadTraceRowsForTask(ctx.taskId);
  runRecoverySweepAndTrace(ctx.traceEvent, ctx.taskId, traceRows, {
    lifecycleMode: "live_before_session_end",
  });
  ctx.traceEvent(ctx.taskId, {
    event: "session_end",
    session_id: ctx.taskId,
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

  return {
    done,
    summary,
    artifacts,
    iterations,
    taskId: ctx.taskId,
    runState: getRunStatePublicView(runState),
  };
}

module.exports = {
  executeSessionEndPhase,
};
