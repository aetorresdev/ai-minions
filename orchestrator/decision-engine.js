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

module.exports = {
  decideFromOrchestratorDecide,
};
