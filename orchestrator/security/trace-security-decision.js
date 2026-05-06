"use strict";

/**
 * Build a trace-safe payload for permission decisions (no secrets, no raw payloads).
 *
 * @param {object} input evaluator input (subset)
 * @param {object} output evaluator output from evaluatePermission
 * @param {{ event?: string }} [opts]
 */
function traceSecurityDecision(input, output, opts = {}) {
  const event = opts.event || "permission_check";
  return {
    event,
    actor: input.actor != null ? String(input.actor) : "",
    role: input.role != null ? String(input.role) : "",
    tool: input.tool != null ? String(input.tool) : "",
    domain: input.domain != null ? String(input.domain) : "",
    action_class: output.action_class,
    target_class: output.target_class,
    decision: output.decision,
    reason_code: output.reason_code,
    policy_source: output.policy_source,
    permission_profile: output.permission_profile,
    requires_approval: output.requires_approval,
  };
}

module.exports = { traceSecurityDecision };
