"use strict";

const {
  classifyContextAuthority,
  buildContextAuthorityTrace,
  ATTEMPTED_ACTIONS,
} = require("./untrusted-context-eval");

const RUNTIME_EVIDENCE_SOURCE = "runtime_gate";
const RUNTIME_EVIDENCE_TRUST = "deterministic_classifier";

const UNKNOWN_OPERATOR_SURFACE = Object.freeze({
  operator_explanation: "Context authority could not classify untrusted context type.",
  next_safe_action: "escalate_to_operator",
});

const BENIGN_OPERATOR_SURFACE = Object.freeze({
  operator_explanation: "Untrusted context accepted as non-sovereign data only.",
  next_safe_action: "continue_with_trace_review",
});

const INJECTION_OPERATOR_SURFACE = Object.freeze({
  operator_explanation:
    "Tool action derived from untrusted context attempted a non-sovereign instruction.",
  next_safe_action: "escalate_to_operator",
});

/**
 * @param {object} input
 * @returns {{ allowed: boolean, decision: string, reason_code: string, failure_type: string, operator_explanation: string, next_safe_action: string }}
 */
function evaluateContextAuthorityDecision(input) {
  const derived =
    input && input.context_authority && input.context_authority.derived_from_untrusted === true;
  if (!derived) {
    return {
      allowed: true,
      skipped: true,
      decision: "not_applicable",
      reason_code: "context_authority_not_required",
      failure_type: "none",
      operator_explanation: "Tool call not derived from untrusted context.",
      next_safe_action: "continue",
    };
  }

  const ca = input.context_authority;
  const context_type = ca.context_type != null ? String(ca.context_type) : "";
  const classified = classifyContextAuthority({ context_type });

  if (!classified.ok) {
    return {
      allowed: false,
      skipped: false,
      decision: "block_unclassified",
      reason_code: "context_authority_unknown",
      failure_type: "unclassified_context",
      failure_axis: "context_authority",
      authority_tier: null,
      instruction_source: null,
      operator_explanation: UNKNOWN_OPERATOR_SURFACE.operator_explanation,
      next_safe_action: UNKNOWN_OPERATOR_SURFACE.next_safe_action,
      injection_detected: false,
      attempted_action: null,
      variant: "unknown",
    };
  }

  const variant = ca.variant === "injected" ? "injected" : "benign";
  const injection_detected = variant === "injected" || ca.injection_detected === true;
  const attempted_action =
    injection_detected && ca.attempted_action != null ? String(ca.attempted_action) : null;

  if (injection_detected) {
    const action =
      attempted_action && ATTEMPTED_ACTIONS.includes(attempted_action) ? attempted_action : "unknown";
    return {
      allowed: false,
      skipped: false,
      decision: "ignore_instruction",
      reason_code: `injection_not_sovereign:${action}`,
      failure_type: "injection_not_sovereign",
      failure_axis: "context_authority",
      authority_tier: classified.authority_tier,
      instruction_source: classified.instruction_source,
      operator_explanation: INJECTION_OPERATOR_SURFACE.operator_explanation,
      next_safe_action: INJECTION_OPERATOR_SURFACE.next_safe_action,
      injection_detected: true,
      attempted_action: action === "unknown" ? null : action,
      variant,
    };
  }

  return {
    allowed: true,
    skipped: false,
    decision: "accept_as_data",
    reason_code: "untrusted_context_data_only",
    failure_type: "none",
    failure_axis: "context_authority",
    authority_tier: classified.authority_tier,
    instruction_source: classified.instruction_source,
    operator_explanation: BENIGN_OPERATOR_SURFACE.operator_explanation,
    next_safe_action: BENIGN_OPERATOR_SURFACE.next_safe_action,
    injection_detected: false,
    attempted_action: null,
    variant,
  };
}

/**
 * Build runtime context_authority_check trace payload (no raw retrieved text).
 *
 * @param {object} decisionResult from evaluateContextAuthorityDecision
 * @param {object} [meta]
 */
function buildContextAuthorityRuntimeTrace(decisionResult, meta = {}) {
  const base = buildContextAuthorityTrace({
    context_type: meta.context_type != null ? String(meta.context_type) : "",
    authority_tier: decisionResult.authority_tier || "",
    instruction_source: decisionResult.instruction_source || "",
    decision: decisionResult.decision,
    reason_code: decisionResult.reason_code,
    injection_detected: decisionResult.injection_detected === true,
    attempted_action: decisionResult.attempted_action,
    variant: decisionResult.variant || "benign",
  });

  return {
    ...base,
    failure_axis: decisionResult.failure_axis || "context_authority",
    failure_type: decisionResult.failure_type || "none",
    source: RUNTIME_EVIDENCE_SOURCE,
    trust: RUNTIME_EVIDENCE_TRUST,
    operator_explanation: decisionResult.operator_explanation,
    next_safe_action: decisionResult.next_safe_action,
    evidence_path: meta.evidence_path != null ? String(meta.evidence_path) : "",
    tool: meta.tool != null ? String(meta.tool) : null,
  };
}

/**
 * Runtime gate for tool/MCP/shell invocations derived from untrusted context tiers.
 *
 * @param {object} input
 * @param {object} [input.context_authority]
 * @param {boolean} [input.context_authority.derived_from_untrusted]
 * @param {string} [input.context_authority.context_type]
 * @param {string} [input.context_authority.variant]
 * @param {string} [input.context_authority.attempted_action]
 * @param {string} [input.tool] — label for trace (e.g. server.tool)
 */
function runContextAuthorityGate(input = {}) {
  const decisionResult = evaluateContextAuthorityDecision(input);
  const ca = input.context_authority || {};
  const tracePayload = buildContextAuthorityRuntimeTrace(decisionResult, {
    context_type: ca.context_type,
    tool: input.tool,
    evidence_path: input.evidence_path,
  });

  return {
    allowed: decisionResult.allowed === true,
    skipped: decisionResult.skipped === true,
    decision: decisionResult.decision,
    reason_code: decisionResult.reason_code,
    tracePayload,
  };
}

/**
 * Fail-closed enforcement — throws when context authority blocks invocation.
 *
 * @param {object} input — same shape as runContextAuthorityGate
 */
function enforceContextAuthorityGate(input = {}) {
  const result = runContextAuthorityGate(input);
  if (result.allowed) {
    return result;
  }
  const msg = `Context authority denied (${result.reason_code})`;
  const err = new Error(msg);
  err.code = "CONTEXT_AUTHORITY_DENIED";
  err.context_authority_decision = result;
  throw err;
}

module.exports = {
  RUNTIME_EVIDENCE_SOURCE,
  RUNTIME_EVIDENCE_TRUST,
  evaluateContextAuthorityDecision,
  buildContextAuthorityRuntimeTrace,
  runContextAuthorityGate,
  enforceContextAuthorityGate,
};
