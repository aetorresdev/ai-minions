/**
 * Role → permission-domain capability matrix (design contract; not PERM_* enforcement).
 * sync: docs/orchestrator/capability-flow-contract.md §4
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { effectiveMode } = require("./permissions");

const MATRIX_PATH = path.join(__dirname, "capability-matrix.v1.json");
/** @type {{ version: string, domains: string[], roles: Record<string, { domains: string[], notes?: string }> }} */
const raw = JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));

const CAPABILITY_MATRIX_VERSION = raw.version;
const DOMAIN_ENUM = Object.freeze([...raw.domains].sort());
const DOMAIN_SET = new Set(DOMAIN_ENUM);

/** @type {Readonly<Record<string, ReadonlySet<string>>>} */
const ROLE_DOMAIN_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(raw.roles).map(([roleId, row]) => [
      roleId,
      new Set((row.domains || []).filter((d) => DOMAIN_SET.has(d))),
    ]),
  ),
);

const KNOWN_ROLE_IDS = Object.freeze(Object.keys(raw.roles).sort());

/** Domains that need session write credential ceiling (aligns with permissions.js + capability-flow). */
const DOMAINS_REQUIRING_WRITE_CEILING = new Set(["shell", "network", "git"]);

/** Plan-time handoff key hints; execution still uses validateHandoffStructure on real YAML. */
const ALLOWED_PLAN_HANDOFF_KEYS = new Set([
  "blockers",
  "corrections",
  "design_summary",
  "files_modified",
  "files_read",
  "findings",
  "issues",
  "summary",
  "validation_run",
  "verdict",
]);

/**
 * @param {string} agentId
 * @returns {ReadonlySet<string>}
 */
function getDomainsForRole(agentId) {
  return ROLE_DOMAIN_SETS[agentId] ?? new Set();
}

/**
 * @param {string} agentId
 * @param {string[]} requiredDomains
 * @returns {{ ok: boolean, reason?: string }}
 */
function roleCanUseDomains(agentId, requiredDomains) {
  const needed = [...new Set(requiredDomains)].filter(Boolean);
  const allowed = ROLE_DOMAIN_SETS[agentId];
  if (!allowed) {
    return { ok: false, reason: `unknown role "${agentId}"` };
  }
  for (const d of needed) {
    if (!DOMAIN_SET.has(d)) {
      return { ok: false, reason: `unknown domain "${d}"` };
    }
    if (!allowed.has(d)) {
      return { ok: false, reason: `role "${agentId}" cannot use domain "${d}"` };
    }
  }
  return { ok: true };
}

/**
 * Ensure every plan/correction step references a role present in the matrix (same surface as AGENTS).
 * Steps must use **agentId** only — legacy `agent` is rejected (capability-flow-contract shape).
 * Optional **`requiredDomains`**: when present (array of domain strings), each must be allowed for that role per the matrix.
 * @param {{ agentId?: string, agent?: string, task?: string, requiredDomains?: string[] }[] | null | undefined} steps
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlanStepRoles(steps) {
  const errors = [];
  if (!Array.isArray(steps)) {
    return { ok: false, errors: ["steps must be an array"] };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object") {
      errors.push(`step[${i}] invalid`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(step, "agent")) {
      errors.push(`step[${i}] must use agentId only (remove legacy "agent" field)`);
      continue;
    }
    const agentId = step.agentId;
    if (agentId == null || !String(agentId).trim()) {
      errors.push(`step[${i}] missing agentId`);
      continue;
    }
    const id = String(agentId).trim();
    if (!ROLE_DOMAIN_SETS[id]) {
      errors.push(
        `step[${i}] unknown role "${id}" (capability matrix ${CAPABILITY_MATRIX_VERSION})`,
      );
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(step, "requiredDomains")) {
      const rd = step.requiredDomains;
      if (!Array.isArray(rd)) {
        errors.push(`step[${i}] requiredDomains must be an array when present`);
        continue;
      }
      const domains = rd.map((x) => String(x).trim()).filter(Boolean);
      const dc = roleCanUseDomains(id, domains);
      if (!dc.ok) {
        errors.push(`step[${i}] ${dc.reason}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Reject plan steps that declare `requiredDomains` including shell/network/git when the session
 * credential ceiling is read-only (effectiveMode !== write for that role).
 * @param {{ agentId?: string, requiredDomains?: string[] }[]} steps
 * @param {'read'|'write'} [sessionCredentialMode]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlanCredentialCeiling(steps, sessionCredentialMode = "write") {
  const errors = [];
  const mode = sessionCredentialMode === "read" ? "read" : "write";
  if (!Array.isArray(steps)) {
    return { ok: false, errors: ["steps must be an array"] };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object") continue;
    const agentId = step.agentId != null ? String(step.agentId).trim() : "";
    if (!agentId || !ROLE_DOMAIN_SETS[agentId]) continue;
    const rd = step.requiredDomains;
    if (!Array.isArray(rd) || rd.length === 0) continue;
    const domains = rd.map((x) => String(x).trim()).filter(Boolean);
    const needsWrite = domains.some((d) => DOMAINS_REQUIRING_WRITE_CEILING.has(d));
    if (!needsWrite) continue;
    const em = effectiveMode(agentId, mode);
    if (em !== "write") {
      const needList = domains.filter((d) => DOMAINS_REQUIRING_WRITE_CEILING.has(d)).join(", ");
      errors.push(
        `step[${i}] domain(s) ${needList} require write-capable session; effective credential mode is "${em}" for role "${agentId}"`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Optional per-step `requiredHandoffKeys` — validates known key names only (plan contract).
 * @param {object[] | null | undefined} steps
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlanStepHandoffDeclarations(steps) {
  const errors = [];
  if (!Array.isArray(steps)) {
    return { ok: false, errors: ["steps must be an array"] };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(step, "requiredHandoffKeys")) continue;
    const keys = step.requiredHandoffKeys;
    if (!Array.isArray(keys)) {
      errors.push(`step[${i}] requiredHandoffKeys must be an array when present`);
      continue;
    }
    for (const k of keys) {
      const key = String(k).trim();
      if (!key) continue;
      if (!ALLOWED_PLAN_HANDOFF_KEYS.has(key)) {
        errors.push(`step[${i}] unknown requiredHandoffKeys entry "${key}"`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Full plan/corrections validation: matrix roles, optional domains, credential ceiling, handoff key names.
 * @param {object[] | null | undefined} steps
 * @param {{ sessionCredentialMode?: 'read'|'write' }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlanStepsCapability(steps, options = {}) {
  const sessionCredentialMode = options.sessionCredentialMode === "read" ? "read" : "write";
  const errors = [];
  const a = validatePlanStepRoles(steps);
  errors.push(...a.errors);
  const b = validatePlanCredentialCeiling(steps, sessionCredentialMode);
  errors.push(...b.errors);
  const c = validatePlanStepHandoffDeclarations(steps);
  errors.push(...c.errors);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  CAPABILITY_MATRIX_VERSION,
  DOMAIN_ENUM,
  KNOWN_ROLE_IDS,
  getDomainsForRole,
  roleCanUseDomains,
  validatePlanStepRoles,
  validatePlanCredentialCeiling,
  validatePlanStepHandoffDeclarations,
  validatePlanStepsCapability,
};
