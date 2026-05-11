"use strict";

/**
 * Runtime precheck: permission domain must be declared for the active agent (or MODE union)
 * in capability-matrix.v1.json before the permission evaluator runs.
 */

const { DOMAIN_ENUM, getDomainsForRole, KNOWN_ROLE_IDS } = require("../agents/capability-matrix");

const DOMAIN_SET = new Set(DOMAIN_ENUM);

/** MODE label (trace `role`) → matrix role ids that share that MODE. */
const MODE_TO_AGENT_IDS = Object.freeze({
  ORCHESTRATOR: ["orchestrator"],
  OWNER: ["owner"],
  ARCHITECT: ["architect"],
  DEV: ["dev-backend", "dev-frontend", "dev-devops"],
  QA: ["qa"],
  CERBERUS: ["cerberus"],
});

/**
 * @param {unknown} traceRole
 */
function normalizeModeKey(traceRole) {
  const s = String(traceRole == null ? "" : traceRole).trim().toUpperCase();
  return s || "ORCHESTRATOR";
}

/**
 * @param {{ traceRole?: string, agentId?: string | null, domain?: string }} ctx
 * @returns {{ ok: true } | { ok: false, reason_code: string }}
 */
function isDomainAllowedForCapabilityContext(ctx) {
  const d = ctx.domain != null ? String(ctx.domain).trim() : "";
  if (!DOMAIN_SET.has(d)) {
    return { ok: false, reason_code: "role_capability_unknown_domain" };
  }

  const aidRaw = ctx.agentId != null && String(ctx.agentId).trim() ? String(ctx.agentId).trim() : null;
  if (aidRaw) {
    if (!KNOWN_ROLE_IDS.includes(aidRaw)) {
      return { ok: false, reason_code: "role_capability_unknown_agent_id" };
    }
    if (!getDomainsForRole(aidRaw).has(d)) {
      return { ok: false, reason_code: "role_capability_domain_denied" };
    }
    return { ok: true };
  }

  const mode = normalizeModeKey(ctx.traceRole);
  const ids = MODE_TO_AGENT_IDS[mode];
  if (!ids || ids.length === 0) {
    return { ok: false, reason_code: "role_capability_unknown_trace_role" };
  }
  for (const id of ids) {
    if (getDomainsForRole(id).has(d)) return { ok: true };
  }
  return { ok: false, reason_code: "role_capability_domain_denied" };
}

/**
 * @param {object} input — same shape as evaluatePermission input (subset used in trace)
 * @param {string} reasonCode
 */
function syntheticDenyOutput(input, reasonCode) {
  return {
    decision: "deny",
    reason_code: reasonCode,
    action_class: input.action_class,
    target_class: input.target_class != null ? input.target_class : null,
    policy_source: input.policy_source,
    permission_profile: input.permission_profile,
    requires_approval: false,
    safe_to_continue: false,
  };
}

/**
 * Claude CLI transport: matrix uses `remote_model` for Claude-using roles; evaluator domain stays `shell`.
 * Pass if either `remote_model` or `shell` is declared for the role.
 *
 * @param {{ traceRole?: string, agentId?: string | null }} ctx
 */
function isClaudeCliTransportAllowedForRole(ctx) {
  const rm = isDomainAllowedForCapabilityContext({ ...ctx, domain: "remote_model" });
  if (rm.ok) return rm;
  return isDomainAllowedForCapabilityContext({ ...ctx, domain: "shell" });
}

module.exports = {
  isDomainAllowedForCapabilityContext,
  syntheticDenyOutput,
  MODE_TO_AGENT_IDS,
  normalizeModeKey,
  isClaudeCliTransportAllowedForRole,
};
