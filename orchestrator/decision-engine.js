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
 * Contract: abort is the sole discriminant; summary is always present when abort === true.
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
 * Contract: abort is the sole discriminant; summary is always present when abort === true.
 * @param {{ prevRetries: number, maxStepRetries: number | null, agentId: string }} p
 * @returns {{ abort: false } | { abort: true, reason_code: 'step_retry_guard', summary: string, agentId: string, retryNumber: number }}
 */
function decideStepRetryGuard({ prevRetries, maxStepRetries, agentId }) {
  if (maxStepRetries == null || maxStepRetries < 0 || !Number.isFinite(maxStepRetries)) return { abort: false };
  if (prevRetries == null || !Number.isFinite(prevRetries) || prevRetries <= maxStepRetries) return { abort: false };
  return {
    abort: true,
    reason_code: "step_retry_guard",
    summary: `Guardrail ORCH_MAX_RETRIES=${maxStepRetries}: agent ${agentId} exceeded max step retries (retry_number=${prevRetries}).`,
    agentId: agentId || "",
    retryNumber: prevRetries,
  };
}

module.exports = {
  decideFromOrchestratorDecide,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
  decideCorrectionsPlan,
  loopExhaustedDefaultSummary,
  decideCostGuard,
  decideStepRetryGuard,
};
