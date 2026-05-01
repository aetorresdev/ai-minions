/**
 * Role → permission-domain capability matrix (design contract; not PERM_* enforcement).
 * sync: docs/orchestrator/capability-flow-contract.md §4
 */

"use strict";

const fs = require("fs");
const path = require("path");

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
 * @param {{ agentId?: string, agent?: string, task?: string }[] | null | undefined} steps
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlanStepRoles(steps) {
  const errors = [];
  if (!Array.isArray(steps)) {
    return { ok: false, errors: ["steps must be an array"] };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = step && (step.agentId || step.agent);
    if (!agentId || !String(agentId).trim()) {
      errors.push(`step[${i}] missing agentId`);
      continue;
    }
    const id = String(agentId).trim();
    if (!ROLE_DOMAIN_SETS[id]) {
      errors.push(
        `step[${i}] unknown role "${id}" (capability matrix ${CAPABILITY_MATRIX_VERSION})`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  CAPABILITY_MATRIX_VERSION,
  DOMAIN_ENUM,
  KNOWN_ROLE_IDS,
  getDomainsForRole,
  roleCanUseDomains,
  validatePlanStepRoles,
};
