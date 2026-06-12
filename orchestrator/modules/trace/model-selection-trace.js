"use strict";

/**
 * Model selection trace helpers — observable model choice per agent invocation.
 * Not auto-routing; emission only.
 */

/** @typedef {"cheap"|"standard"|"strong"|"frontier"} ModelTier */
/** @typedef {"default"|"policy"|"manual"|"escalation"} SelectionSource */

const MODEL_TIERS = /** @type {const} */ (["cheap", "standard", "strong", "frontier"]);
const SELECTION_SOURCES = /** @type {const} */ (["default", "policy", "manual", "escalation"]);
const TRACE_ROLES = /** @type {const} */ (["ORCHESTRATOR", "OWNER", "ARCHITECT", "DEV", "QA", "CERBERUS"]);

/**
 * @param {string} modelName
 * @returns {ModelTier}
 */
function inferModelTier(modelName) {
  const m = String(modelName ?? "").toLowerCase();
  if (!m) return "standard";
  if (/opus|o1-|o3-|gpt-4|frontier|claude-4-opus/.test(m)) return "frontier";
  if (/haiku|mini|small|:7b|:8b|qwen2\.5-coder:7b/.test(m)) return "cheap";
  if (/sonnet|gpt-3\.5|medium|:13b/.test(m)) return "standard";
  if (/codellama|:70b|large|strong/.test(m)) return "strong";
  return "standard";
}

/**
 * @param {string} role
 * @returns {boolean}
 */
function isTraceRole(role) {
  return TRACE_ROLES.includes(/** @type {typeof TRACE_ROLES[number]} */ (role));
}

/**
 * @param {{
 *   role: string,
 *   step_id: string,
 *   model: string,
 *   model_tier?: ModelTier,
 *   selection_source: SelectionSource,
 *   selection_reason: string,
 *   iteration?: number,
 *   agent?: string,
 *   estimated_input_tokens?: number,
 *   estimated_output_tokens?: number,
 *   estimated_cost_usd?: number,
 * }} fields
 * @returns {Record<string, unknown>}
 */
function buildModelSelectionPayload(fields) {
  const tier = fields.model_tier ?? inferModelTier(fields.model);
  const reason =
    tier === "frontier" && !String(fields.selection_reason ?? "").trim()
      ? "frontier_tier_requires_explicit_reason"
      : String(fields.selection_reason ?? "").slice(0, 300);

  return {
    event: "model_selection",
    role: fields.role,
    step_id: fields.step_id,
    model: String(fields.model),
    model_tier: tier,
    selection_source: fields.selection_source,
    selection_reason: reason,
    estimated_input_tokens: fields.estimated_input_tokens ?? 0,
    estimated_output_tokens: fields.estimated_output_tokens ?? 0,
    estimated_cost_usd: fields.estimated_cost_usd ?? 0,
    ...(typeof fields.iteration === "number" ? { iteration: fields.iteration } : {}),
    ...(fields.agent ? { agent: fields.agent } : {}),
  };
}

/**
 * @param {(taskId: string, payload: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {Parameters<typeof buildModelSelectionPayload>[0]} fields
 */
function emitModelSelection(traceEvent, taskId, fields) {
  if (typeof traceEvent !== "function") return;
  traceEvent(taskId, buildModelSelectionPayload(fields));
}

module.exports = {
  MODEL_TIERS,
  SELECTION_SOURCES,
  TRACE_ROLES,
  inferModelTier,
  isTraceRole,
  buildModelSelectionPayload,
  emitModelSelection,
};
