'use strict';

/**
 * Critical-role model capability profiles (provider-neutral).
 * Selection must use validated probe evidence — not brand, RAM, or parameter count.
 */

const CRITICAL_ROLES = Object.freeze(['ARCHITECT', 'QA', 'CERBERUS']);

/** @type {Readonly<Record<string, { required_probes: readonly string[], min_num_predict: number }>>} */
const ROLE_CAPABILITY_PROFILES = Object.freeze({
  ARCHITECT: Object.freeze({
    required_probes: Object.freeze(['planning_json', 'architect_files_read', 'output_budget']),
    min_num_predict: 4096,
  }),
  QA: Object.freeze({
    required_probes: Object.freeze(['qa_spec', 'qa_findings', 'output_budget']),
    min_num_predict: 4096,
  }),
  CERBERUS: Object.freeze({
    required_probes: Object.freeze(['cerberus_review', 'output_budget']),
    min_num_predict: 4096,
  }),
});

const MODEL_CAPABILITY_INSUFFICIENT = 'MODEL_CAPABILITY_INSUFFICIENT';

/**
 * @param {unknown} role
 * @returns {string}
 */
function normalizeRoleKey(role) {
  return String(role ?? '').trim().toUpperCase().replace(/-/g, '_');
}

/**
 * @param {unknown} role
 * @returns {boolean}
 */
function isCriticalCapabilityRole(role) {
  return CRITICAL_ROLES.includes(normalizeRoleKey(role));
}

/**
 * @param {unknown} role
 * @returns {{ required_probes: readonly string[], min_num_predict: number } | null}
 */
function getRoleCapabilityProfile(role) {
  const key = normalizeRoleKey(role);
  return ROLE_CAPABILITY_PROFILES[key] ?? null;
}

module.exports = {
  CRITICAL_ROLES,
  ROLE_CAPABILITY_PROFILES,
  MODEL_CAPABILITY_INSUFFICIENT,
  normalizeRoleKey,
  isCriticalCapabilityRole,
  getRoleCapabilityProfile,
};
