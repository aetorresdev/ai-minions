"use strict";

/**
 * Control-plane decisions (orchestrator decision layer). Node rules — not LLM role output.
 * LLM JSON from orchestrator/decide is normalized here before the loop mutates `plan` / `done`.
 */

/**
 * Normalize orchestrator **decide** JSON (after `extractJson` on askAgent output).
 * @param {unknown} decideOut
 * @returns {{ action: 'finish' | 'iterate' | 'stop', reason: string, params: Record<string, unknown> }}
 */
function decideFromOrchestratorDecide(decideOut) {
  if (decideOut && typeof decideOut === "object" && decideOut.done === true) {
    const summary = typeof decideOut.summary === "string" ? decideOut.summary : "Completed.";
    return {
      action: "finish",
      reason: "orchestrator_decide_done",
      params: { summary },
    };
  }
  if (
    decideOut &&
    typeof decideOut === "object" &&
    Array.isArray(decideOut.corrections) &&
    decideOut.corrections.length > 0
  ) {
    return {
      action: "iterate",
      reason: "orchestrator_decide_corrections",
      params: { corrections: decideOut.corrections },
    };
  }
  return {
    action: "stop",
    reason: "invalid_orchestrator_decide_response",
    params: {},
  };
}

/**
 * Map **`decideFromOrchestratorDecide`** output to orchestrator loop fields (pure).
 * Caller still runs **`askAgent`**, **`traceIterationDone`**, and logging.
 *
 * @param {{ action: string, params?: Record<string, unknown> } | null | undefined} loopDecision
 * @returns {{
 *   variant: 'finish' | 'iterate' | 'stop',
 *   summary: string | null,
 *   planSteps: Array<{ agentId?: string, task?: string }>,
 * }}
 */
function mapDecideLoopToPlanOutcome(loopDecision) {
  const stopSummary = "Stopped (no corrections or invalid orchestrator response).";
  if (!loopDecision || typeof loopDecision !== "object") {
    return { variant: "stop", summary: stopSummary, planSteps: [] };
  }
  if (loopDecision.action === "finish") {
    const raw =
      loopDecision.params && typeof loopDecision.params.summary === "string"
        ? loopDecision.params.summary
        : "Completed.";
    const summary = raw.trim() ? raw : "Completed.";
    return { variant: "finish", summary, planSteps: [] };
  }
  if (loopDecision.action === "iterate") {
    const raw = loopDecision.params && loopDecision.params.corrections;
    const planSteps = Array.isArray(raw) ? raw : [];
    return { variant: "iterate", summary: null, planSteps };
  }
  return { variant: "stop", summary: stopSummary, planSteps: [] };
}

/**
 * After CERBERUS blockers: next **`plan.steps`** from orchestrator/correct JSON or DEV fallback (pure).
 *
 * @param {{
 *   corrPlan: { action: string, corrections?: Array<{ agentId?: string, task?: string }> },
 *   artifacts: ReadonlyArray<{ agentId?: string, task?: string }>,
 *   blockerItems: ReadonlyArray<string>,
 *   maxBlockersInTask?: number,
 * }} p
 * @returns {{ traceBranch: 'iterate_corrections_json' | 'iterate_fallback_dev', steps: Array<{ agentId?: string, task?: string }> }}
 */
function planStepsAfterCorrectionsResponse({ corrPlan, artifacts, blockerItems, maxBlockersInTask = 2 }) {
  if (
    corrPlan &&
    corrPlan.action === "use_json" &&
    Array.isArray(corrPlan.corrections) &&
    corrPlan.corrections.length > 0
  ) {
    return { traceBranch: "iterate_corrections_json", steps: corrPlan.corrections };
  }
  const steps = planStepsDevFallbackFromBlockers({
    artifacts,
    blockerItems,
    maxBlockersInTask,
  });
  return { traceBranch: "iterate_fallback_dev", steps };
}

/**
 * CERBERUS blocker count is > 0 — choose iterate vs manual-review cap (deterministic branch).
 * @returns {'iterate' | 'manual_cap' | 'skip'} skip when blockers === 0 (caller should not use)
 */
function decideCerberusBlockersBranch({ blockerCount, iterations, maxIterations }) {
  if (blockerCount <= 0) return "skip";
  if (iterations < maxIterations) return "iterate";
  return "manual_cap";
}

/**
 * Gate-blocked artifacts present — iterate with same worker tasks vs manual-review at cap.
 * @returns {'iterate' | 'manual_cap' | 'skip'}
 */
function decideGateBlockedArtifactsBranch({ artifactCount, iterations, maxIterations }) {
  if (artifactCount <= 0) return "skip";
  if (iterations < maxIterations) return "iterate";
  return "manual_cap";
}

/**
 * After CERBERUS blockers, orchestrator JSON with correction steps vs generic DEV fallback.
 * @param {unknown} correctionsOut — result of `extractJson` on orchestrator/correct output
 * @returns {{ action: 'use_json' | 'fallback_dev', corrections?: Array<{ agentId?: string, task: string }> }}
 */
function decideCorrectionsPlan(correctionsOut) {
  if (
    correctionsOut &&
    typeof correctionsOut === "object" &&
    Array.isArray(correctionsOut.corrections) &&
    correctionsOut.corrections.length > 0
  ) {
    return { action: "use_json", corrections: correctionsOut.corrections };
  }
  return { action: "fallback_dev" };
}

/** Default summary when the outer loop exits without `done` and no summary yet. */
function loopExhaustedDefaultSummary(maxIterations) {
  return `Stopped after ${maxIterations} iteration(s).`;
}

/**
 * Cost guard decision — pure, no side-effects.
 *
 * Contract (stable):
 *   - `abort` is the sole branching discriminant — callers MUST NOT branch on any other field.
 *   - When `abort === false`: no other fields are present; callers must not read them.
 *   - When `abort === true`: `reason_code` and `summary` are always present.
 *   - Remaining fields (estimateUsd, limitUsd, guardPhase) are informational — safe to log/trace,
 *     but must not drive control flow unless explicitly promoted to contract.
 *
 * @param {{ estimate: number | null, maxCostUsd: number | null, phase: string }} p
 * @returns {{ abort: false } | { abort: true, reason_code: 'cost_guard', summary: string, estimateUsd: number, limitUsd: number, guardPhase: string }}
 */
function decideCostGuard({ estimate, maxCostUsd, phase }) {
  if (maxCostUsd == null || maxCostUsd < 0 || !Number.isFinite(maxCostUsd)) return { abort: false };
  if (estimate == null || !Number.isFinite(estimate)) return { abort: false };
  if (estimate <= maxCostUsd) return { abort: false };
  return {
    abort: true,
    reason_code: "cost_guard",
    summary: `Guardrail ORCH_MAX_COST_USD=${maxCostUsd}: estimated spend ${Math.round(estimate * 1e6) / 1e6} USD exceeds limit (${phase}).`,
    estimateUsd: Math.round(estimate * 1e6) / 1e6,
    limitUsd: maxCostUsd,
    guardPhase: phase,
  };
}

/**
 * Step retry guard decision — pure, no side-effects.
 *
 * Contract (stable):
 *   - `abort` is the sole branching discriminant — callers MUST NOT branch on any other field.
 *   - When `abort === false`: no other fields are present; callers must not read them.
 *   - When `abort === true`: `reason_code` and `summary` are always present.
 *   - `agentId` in the abort result is decorative (used only for the summary message);
 *     the retry decision does not depend on agentId being valid.
 *   - Remaining fields (agentId, retryNumber) are informational — safe to log/trace,
 *     but must not drive control flow unless explicitly promoted to contract.
 *
 * @param {{ prevRetries: number, maxStepRetries: number | null, agentId: string }} p
 * @returns {{ abort: false } | { abort: true, reason_code: 'step_retry_guard', summary: string, agentId: string, retryNumber: number }}
 */
function decideStepRetryGuard({ prevRetries, maxStepRetries, agentId }) {
  if (maxStepRetries == null || maxStepRetries < 0 || !Number.isFinite(maxStepRetries)) return { abort: false };
  if (prevRetries == null || !Number.isFinite(prevRetries) || prevRetries <= maxStepRetries) return { abort: false };
  const safeAgentId = typeof agentId === "string" ? agentId : "";
  return {
    abort: true,
    reason_code: "step_retry_guard",
    summary: `Guardrail ORCH_MAX_RETRIES=${maxStepRetries}: agent ${safeAgentId} exceeded max step retries (retry_number=${prevRetries}).`,
    agentId: safeAgentId,
    retryNumber: prevRetries,
  };
}

/**
 * One line per gate-blocked artifact for logs and manual-review summaries.
 * Mirrors prior inline: `${a.agentId}: ${a.gateReason || "gate blocked"}`.
 * @param {ReadonlyArray<{ agentId?: string, gateReason?: string }>} artifacts
 * @returns {string[]}
 */
function formatGateBlockedReasonLines(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map((a) => `${a?.agentId}: ${a?.gateReason || "gate blocked"}`);
}

/**
 * Replay plan: same worker steps as the gate-blocked artifacts (deterministic iteration).
 * @param {ReadonlyArray<{ agentId?: string, task?: string }>} artifacts
 * @returns {Array<{ agentId?: string, task?: string }>}
 */
function planStepsReplayFromGateBlockedArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map((a) => ({ agentId: a.agentId, task: a.task }));
}

/**
 * When orchestrator/correct JSON is empty — retry last DEV steps with a fixed task prefix.
 * @param {{ artifacts: ReadonlyArray<{ agentId?: string, task?: string }>, blockerItems: ReadonlyArray<string>, maxBlockersInTask?: number }} p
 * @returns {Array<{ agentId: string, task: string }>}
 */
function planStepsDevFallbackFromBlockers({ artifacts, blockerItems, maxBlockersInTask = 2 }) {
  const items = Array.isArray(blockerItems) ? blockerItems : [];
  const n = typeof maxBlockersInTask === "number" && maxBlockersInTask > 0 ? Math.floor(maxBlockersInTask) : 2;
  const snippet = items.slice(0, n).join("; ");
  const taskSuffix = `Fix blockers: ${snippet}`;
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .filter((a) => typeof a?.agentId === "string" && a.agentId.startsWith("dev-"))
    .map((a) => ({ agentId: a.agentId, task: taskSuffix }));
}

/**
 * Summary line when max iterations hit with gate-blocked artifacts (manual review).
 * @param {{ count: number, reasonLines: ReadonlyArray<string> }} p
 * @returns {string}
 */
function summaryMaxIterationsGateBlocked({ count, reasonLines }) {
  const c = typeof count === "number" && count >= 0 ? count : 0;
  const lines = Array.isArray(reasonLines) ? reasonLines.filter((s) => typeof s === "string") : [];
  const blocked = lines.length > 0 ? lines.join("; ") : "(no detail)";
  return `Max iterations reached with ${c} gate-blocked artifact(s). Manual review required. Blocked: ${blocked}`;
}

module.exports = {
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
  planStepsDevFallbackFromBlockers,
  summaryMaxIterationsGateBlocked,
};
