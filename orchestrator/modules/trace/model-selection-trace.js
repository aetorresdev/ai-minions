'use strict';

/**
 * Model selection trace helpers — observable model choice per agent invocation.
 * Not auto-routing; emission only.
 */

/** @typedef {"cheap"|"standard"|"strong"|"frontier"} ModelTier */
/** @typedef {"default"|"policy"|"manual"|"escalation"} SelectionSource */
/** @typedef {"legacy_default"|"role_defaults"|"tier"|"role_routes"|"override"} RouteSource */
/** @typedef {"known"|"estimated"|"unavailable"|"unknown_provider_usage"} UsageAccountingStatus */

const MODEL_TIERS = /** @type {const} */ (["cheap", "standard", "strong", "frontier"]);
const SELECTION_SOURCES = /** @type {const} */ (["default", "policy", "manual", "escalation"]);
const TRACE_ROLES = /** @type {const} */ (["ORCHESTRATOR", "OWNER", "ARCHITECT", "DEV", "QA", "CERBERUS"]);
const ROUTE_SOURCES = /** @type {const} */ ([
  "legacy_default",
  "role_defaults",
  "tier",
  "role_routes",
  "override",
]);
const USAGE_ACCOUNTING_STATUSES = /** @type {const} */ ([
  "known",
  "estimated",
  "unavailable",
  "unknown_provider_usage",
]);
const ENDPOINT_SCOPES = /** @type {const} */ ([
  "localhost",
  "private_lan",
  "tailscale",
  "vpn",
  "public_endpoint",
]);

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
 * @param {unknown} value
 * @returns {ModelTier | null}
 */
function normalizePolicyTier(value) {
  if (value == null || value === "") return null;
  const t = String(value);
  return MODEL_TIERS.includes(/** @type {ModelTier} */ (t)) ? /** @type {ModelTier} */ (t) : null;
}

/**
 * Include a Phase A field only when the caller supplied a real value (no fabricated defaults).
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 */
function assignOptionalString(target, key, value) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  target[key] = trimmed;
}

/**
 * @param {{
 *   role: string,
 *   step_id: string,
 *   model: string,
 *   model_tier?: ModelTier,
 *   tier?: ModelTier | null,
 *   selection_source: SelectionSource,
 *   selection_reason: string,
 *   provider_id?: string,
 *   model_backend?: string,
 *   endpoint_ref?: string,
 *   endpoint_scope?: string,
 *   route_source?: RouteSource,
 *   usage_accounting_status?: UsageAccountingStatus,
 *   iteration?: number,
 *   agent?: string,
 *   estimated_input_tokens?: number,
 *   estimated_output_tokens?: number,
 *   estimated_cost_usd?: number,
 * }} fields
 * @returns {Record<string, unknown>}
 */
function buildModelSelectionPayload(fields) {
  const policyTierProvided = Object.prototype.hasOwnProperty.call(fields, "tier");
  const policyTier = policyTierProvided ? normalizePolicyTier(fields.tier) : undefined;
  const modelTier = policyTier ?? fields.model_tier ?? inferModelTier(fields.model);
  const reason = String(fields.selection_reason ?? "").trim().slice(0, 300);
  if (!reason) {
    throw new Error("model_selection: selection_reason is required");
  }
  if (modelTier === "frontier" && reason.length < 8) {
    throw new Error(
      "model_selection: frontier tier requires selection_reason of at least 8 characters",
    );
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    event: "model_selection",
    role: fields.role,
    step_id: fields.step_id,
    model: String(fields.model),
    model_tier: modelTier,
    selection_source: fields.selection_source,
    selection_reason: reason,
    estimated_input_tokens: fields.estimated_input_tokens ?? 0,
    estimated_output_tokens: fields.estimated_output_tokens ?? 0,
    estimated_cost_usd: fields.estimated_cost_usd ?? 0,
  };

  // Phase A fields are optional — emit only when the caller resolved them honestly.
  // Never invent provider_id=ollama, endpoint_scope=localhost, or route_source defaults.
  if (policyTierProvided) {
    payload.tier = policyTier;
  }
  assignOptionalString(payload, "provider_id", fields.provider_id);
  assignOptionalString(payload, "model_backend", fields.model_backend);
  assignOptionalString(payload, "endpoint_ref", fields.endpoint_ref);
  if (
    typeof fields.endpoint_scope === "string"
    && ENDPOINT_SCOPES.includes(/** @type {typeof ENDPOINT_SCOPES[number]} */ (fields.endpoint_scope))
  ) {
    payload.endpoint_scope = fields.endpoint_scope;
  }
  if (
    typeof fields.route_source === "string"
    && ROUTE_SOURCES.includes(/** @type {RouteSource} */ (fields.route_source))
  ) {
    payload.route_source = fields.route_source;
  }
  if (
    typeof fields.usage_accounting_status === "string"
    && USAGE_ACCOUNTING_STATUSES.includes(
      /** @type {UsageAccountingStatus} */ (fields.usage_accounting_status),
    )
  ) {
    payload.usage_accounting_status = fields.usage_accounting_status;
  }

  if (typeof fields.iteration === "number") payload.iteration = fields.iteration;
  if (fields.agent) payload.agent = fields.agent;

  // Never allow base_url / secrets on the payload surface.
  return payload;
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
  ROUTE_SOURCES,
  USAGE_ACCOUNTING_STATUSES,
  ENDPOINT_SCOPES,
  inferModelTier,
  isTraceRole,
  buildModelSelectionPayload,
  emitModelSelection,
};
