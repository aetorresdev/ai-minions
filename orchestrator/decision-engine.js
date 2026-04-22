"use strict";

/**
 * Control-plane decisions (DECISION-1). Node rules — not LLM role output.
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

module.exports = {
  decideFromOrchestratorDecide,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
};
