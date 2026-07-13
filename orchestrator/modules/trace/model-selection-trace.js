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
  const policyTier = normalizePolicyTier(fields.tier);
  const tier = policyTier ?? fields.model_tier ?? inferModelTier(fields.model);
  const reason = String(fields.selection_reason ?? "").trim().slice(0, 300);
  if (!reason) {
    throw new Error("model_selection: selection_reason is required");
  }
  if (tier === "frontier" && reason.length < 8) {
    throw new Error(
      "model_selection: frontier tier requires selection_reason of at least 8 characters",
    );
  }

  const providerId = String(fields.provider_id ?? "ollama").trim() || "ollama";
  const modelBackend = String(
    fields.model_backend
      ?? (providerId === "ollama" ? "ollama" : "claude"),
  ).trim() || "ollama";
  const endpointRef = String(fields.endpoint_ref ?? "default").trim() || "default";
  const endpointScope = String(fields.endpoint_scope ?? "localhost").trim() || "localhost";
  const routeSource = /** @type {RouteSource} */ (
    ROUTE_SOURCES.includes(/** @type {RouteSource} */ (fields.route_source))
      ? fields.route_source
      : "legacy_default"
  );
  const usageStatus = /** @type {UsageAccountingStatus} */ (
    USAGE_ACCOUNTING_STATUSES.includes(
      /** @type {UsageAccountingStatus} */ (fields.usage_accounting_status),
    )
      ? fields.usage_accounting_status
      : "unavailable"
  );

  // Never allow base_url / secrets on the payload surface.
  return {
    event: "model_selection",
    role: fields.role,
    step_id: fields.step_id,
    model: String(fields.model),
    model_tier: tier,
    tier: policyTier,
    selection_source: fields.selection_source,
    selection_reason: reason,
    provider_id: providerId,
    model_backend: modelBackend,
    endpoint_ref: endpointRef,
    endpoint_scope: endpointScope,
    route_source: routeSource,
    usage_accounting_status: usageStatus,
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
  ROUTE_SOURCES,
  USAGE_ACCOUNTING_STATUSES,
  ENDPOINT_SCOPES,
  inferModelTier,
  isTraceRole,
  buildModelSelectionPayload,
  emitModelSelection,
};
