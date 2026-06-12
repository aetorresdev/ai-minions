"use strict";

/**
 * Fail-closed gate for expensive model tiers (frontier first).
 * Uses versioned model_policy.json rules; does not mutate selection.
 */

const { inferModelTier, MODEL_TIERS } = require("../trace/model-selection-trace");

const GATE_ID = "model_tier_gate";
const FRONTIER_MIN_REASON_LENGTH = 8;
const FRONTIER_ALLOWED_SOURCES = /** @type {const} */ (["policy", "manual", "escalation"]);

/** @typedef {typeof MODEL_TIERS[number]} ModelTier */
/** @typedef {typeof FRONTIER_ALLOWED_SOURCES[number]} FrontierAllowedSource */

/**
 * @param {{
 *   model: string,
 *   model_tier?: ModelTier,
 *   selection_source: string,
 *   selection_reason?: string,
 *   role?: string,
 *   agent?: string,
 *   step_id?: string,
 *   iteration?: number,
 * }} fields
 * @param {import("./model-policy-config").ModelPolicyConfig} policy
 * @returns {{
 *   allowed: boolean,
 *   model_tier: ModelTier,
 *   gate_id: string,
 *   reason_code?: string,
 *   denial_reason?: string,
 *   rule_name?: string,
 * }}
 */
function evaluateModelTierGate(fields, policy) {
  const modelTier = fields.model_tier ?? inferModelTier(fields.model);
  const base = {
    allowed: true,
    model_tier: modelTier,
    gate_id: GATE_ID,
  };

  if (modelTier !== "frontier") {
    return base;
  }

  const reason = String(fields.selection_reason ?? "").trim();
  const source = String(fields.selection_source ?? "");

  if (!reason) {
    return {
      ...base,
      allowed: false,
      reason_code: "FRONTIER_MISSING_REASON",
      denial_reason:
        "Frontier tier requires selection_reason (min 8 characters). Provide manual override or policy justification.",
    };
  }

  if (reason.length < FRONTIER_MIN_REASON_LENGTH) {
    return {
      ...base,
      allowed: false,
      reason_code: "FRONTIER_REASON_TOO_SHORT",
      denial_reason:
        `Frontier tier selection_reason must be at least ${FRONTIER_MIN_REASON_LENGTH} characters.`,
    };
  }

  if (!FRONTIER_ALLOWED_SOURCES.includes(/** @type {FrontierAllowedSource} */ (source))) {
    return {
      ...base,
      allowed: false,
      reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
      denial_reason:
        "Frontier tier cannot use selection_source=default. Use policy, manual override, or escalation with documented reason.",
    };
  }

  for (const rule of policy.rules.filter((r) => r.when.model_tier === "frontier")) {
    if (rule.requires.includes("selection_reason") && reason.length < FRONTIER_MIN_REASON_LENGTH) {
      return {
        ...base,
        allowed: false,
        reason_code: "FRONTIER_POLICY_RULE",
        rule_name: rule.name,
        denial_reason: `Policy rule "${rule.name}" requires selection_reason for frontier tier.`,
      };
    }
  }

  return base;
}

/**
 * @param {ReturnType<typeof evaluateModelTierGate>} verdict
 * @param {Record<string, unknown>} context
 * @returns {Record<string, unknown>}
 */
function buildModelTierGateDeniedPayload(verdict, context) {
  return {
    ...context,
    event: "model_tier_gate_denied",
    gate_id: GATE_ID,
    model_tier: verdict.model_tier,
    reason_code: verdict.reason_code,
    denial_reason: verdict.denial_reason,
    ...(verdict.rule_name ? { rule_name: verdict.rule_name } : {}),
  };
}

module.exports = {
  GATE_ID,
  FRONTIER_MIN_REASON_LENGTH,
  FRONTIER_ALLOWED_SOURCES,
  evaluateModelTierGate,
  buildModelTierGateDeniedPayload,
};
