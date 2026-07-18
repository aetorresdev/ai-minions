'use strict';

/**
 * Deterministic capability probes for critical roles (ARCHITECT / QA / CERBERUS).
 * Fixtures exercise validateOutput contracts without live inference.
 */

const path = require('path');
const fs = require('fs');
const { validateOutput } = require('../../agents/validate-output');
const {
  getRoleCapabilityProfile,
  isCriticalCapabilityRole,
  MODEL_CAPABILITY_INSUFFICIENT,
  normalizeRoleKey,
} = require('./role-capability-profile');

/** Deterministic pass fixtures (canonical contract shapes). */
const PROBE_FIXTURES_PASS = Object.freeze({
  planning_json: JSON.stringify({
    steps: [{ agentId: 'dev-backend', task: 'Apply the fix described in the goal.' }],
  }),
  architect_files_read: [
    'files_read:',
    '  - docs/design.md',
    'design_summary: Prefer a small local adapter over a new remote dependency.',
  ].join('\n'),
  qa_spec: [
    'acceptance_criteria:',
    '  - Capability probe fixtures remain deterministic',
    'test_strategy:',
    '  - Unit tests for probe evaluation',
    'validation_commands:',
    '  - npm run test:unit',
  ].join('\n'),
  qa_findings: [
    'finding: blocker — missing validation_run in DEV handoff',
    'finding: improvement — tighten next_safe_action copy',
  ].join('\n'),
  cerberus_review: [
    'finding: blocker — contract gap in gate transport messaging',
    'verdict: request_changes',
    'anchor: modules/tools/mcp-client.js',
  ].join('\n'),
});

/** Deterministic fail fixtures (must not pass validateOutput). */
const PROBE_FIXTURES_FAIL = Object.freeze({
  planning_json: 'not-json',
  architect_files_read: 'No files declared.',
  qa_spec: 'missing all QA_SPEC fields',
  qa_findings: 'Looks fine to me.',
  cerberus_review: 'Approve without findings.',
});

/**
 * @param {string} probeId
 * @param {string} output
 * @param {{ num_predict?: number, min_num_predict?: number }} [meta]
 * @returns {{ ok: boolean, probe_id: string, gate_id?: string, reason?: string }}
 */
function evaluateCapabilityProbe(probeId, output, meta = {}) {
  const id = String(probeId || '').trim();
  if (id === 'output_budget') {
    const min = Number(meta.min_num_predict ?? 4096);
    const got = Number(meta.num_predict);
    if (!Number.isFinite(got) || got < min) {
      return {
        ok: false,
        probe_id: id,
        gate_id: 'output_budget',
        reason: `num_predict ${Number.isFinite(got) ? got : 'unset'} < required ${min}`,
      };
    }
    return { ok: true, probe_id: id };
  }

  /** @type {Record<string, { agentId: string, phase?: string, qaPhase?: string }>} */
  const map = {
    planning_json: { agentId: 'orchestrator', phase: 'plan' },
    architect_files_read: { agentId: 'architect' },
    qa_spec: { agentId: 'qa', qaPhase: 'spec' },
    qa_findings: { agentId: 'qa' },
    cerberus_review: { agentId: 'cerberus' },
  };
  const spec = map[id];
  if (!spec) {
    return { ok: false, probe_id: id, reason: `unknown probe_id "${id}"` };
  }
  const check = validateOutput(spec.agentId, String(output ?? ''), {
    phase: spec.phase,
    qaPhase: spec.qaPhase,
  });
  if (!check.valid) {
    return {
      ok: false,
      probe_id: id,
      gate_id: check.gate_id,
      reason: check.reason,
    };
  }
  return { ok: true, probe_id: id };
}

/**
 * Evaluate a role profile against probe outputs (+ optional num_predict).
 * @param {string} role
 * @param {{
 *   probe_outputs?: Record<string, string>,
 *   num_predict?: number,
 *   use_pass_fixtures?: boolean,
 * }} [opts]
 */
function evaluateRoleCapability(role, opts = {}) {
  const profile = getRoleCapabilityProfile(role);
  if (!profile) {
    return {
      ok: true,
      role: normalizeRoleKey(role),
      critical: false,
      passed_probes: [],
      failed_probes: [],
      reason_code: null,
    };
  }

  const outputs = opts.use_pass_fixtures
    ? { ...PROBE_FIXTURES_PASS, ...(opts.probe_outputs || {}) }
    : { ...(opts.probe_outputs || {}) };

  /** @type {string[]} */
  const passed = [];
  /** @type {Array<{ probe_id: string, gate_id?: string, reason?: string }>} */
  const failed = [];

  for (const probeId of profile.required_probes) {
    const result = evaluateCapabilityProbe(probeId, outputs[probeId], {
      num_predict: opts.num_predict,
      min_num_predict: profile.min_num_predict,
    });
    if (result.ok) passed.push(probeId);
    else failed.push({
      probe_id: probeId,
      gate_id: result.gate_id,
      reason: result.reason,
    });
  }

  const ok = failed.length === 0;
  return {
    ok,
    role: normalizeRoleKey(role),
    critical: true,
    passed_probes: passed,
    failed_probes: failed,
    reason_code: ok ? null : MODEL_CAPABILITY_INSUFFICIENT,
    min_num_predict: profile.min_num_predict,
  };
}

/**
 * @param {string} cwd
 * @returns {string}
 */
function capabilityCachePath(cwd) {
  return path.join(cwd, '.ai-minions', 'model_capability.json');
}

/**
 * @param {string} cwd
 * @returns {Record<string, Record<string, { ok: boolean, failed_probes?: unknown[], passed_probes?: string[] }>>}
 */
function loadModelCapabilityCache(cwd) {
  const p = capabilityCachePath(cwd);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const models = raw.models && typeof raw.models === 'object' ? raw.models : raw;
    return /** @type {Record<string, Record<string, { ok: boolean }>>} */ (models);
  } catch {
    return {};
  }
}

/**
 * Lookup role capability for a model from inject map or on-disk cache.
 * @param {string} model
 * @param {string} role
 * @param {{
 *   cwd?: string,
 *   capabilityByModel?: Record<string, Record<string, { ok: boolean }>>,
 * }} [opts]
 * @returns {{ ok: boolean } | null} null = unknown / no evidence
 */
function lookupModelRoleCapability(model, role, opts = {}) {
  const roleKey = normalizeRoleKey(role);
  if (!isCriticalCapabilityRole(roleKey)) return { ok: true };

  const fromInject = opts.capabilityByModel?.[model]?.[roleKey];
  if (fromInject && typeof fromInject.ok === 'boolean') {
    return { ok: fromInject.ok === true, ...fromInject };
  }

  if (opts.cwd) {
    const cache = loadModelCapabilityCache(opts.cwd);
    const row = cache[model]?.[roleKey];
    if (row && typeof row.ok === 'boolean') {
      return { ok: row.ok === true, ...row };
    }
  }
  return null;
}

/**
 * @param {string} model
 * @param {string} role
 * @param {{
 *   cwd?: string,
 *   capabilityByModel?: Record<string, Record<string, { ok: boolean }>>,
 * }} [opts]
 */
function assertModelMeetsRoleCapability(model, role, opts = {}) {
  const evidence = lookupModelRoleCapability(model, role, opts);
  if (evidence == null) return; // no evidence → do not block (backward compatible)
  if (evidence.ok) return;
  const err = new Error(
    `[local-only] ${MODEL_CAPABILITY_INSUFFICIENT} for role "${normalizeRoleKey(role)}": `
      + `model "${model}" failed capability profile probes `
      + `(not selected by brand/size). Re-run probes or choose a capable model.`,
  );
  err.code = MODEL_CAPABILITY_INSUFFICIENT;
  err.gate_id = 'model_capability';
  err.role = normalizeRoleKey(role);
  err.model = model;
  err.failed_probes = evidence.failed_probes ?? null;
  throw err;
}

/**
 * First inventory candidate that passes role capability (skips known failures).
 * @param {string[]} candidates
 * @param {Set<string>} inventory
 * @param {string} role
 * @param {object} [opts]
 * @returns {string | null}
 */
function pickCapableModel(candidates, inventory, role, opts = {}) {
  /** @type {string | null} */
  let firstUnknown = null;
  for (const m of candidates) {
    if (!inventory.has(m)) continue;
    const evidence = lookupModelRoleCapability(m, role, opts);
    if (evidence == null) {
      if (firstUnknown == null) firstUnknown = m;
      continue;
    }
    if (evidence.ok) return m;
  }
  return firstUnknown;
}

module.exports = {
  PROBE_FIXTURES_PASS,
  PROBE_FIXTURES_FAIL,
  evaluateCapabilityProbe,
  evaluateRoleCapability,
  capabilityCachePath,
  loadModelCapabilityCache,
  lookupModelRoleCapability,
  assertModelMeetsRoleCapability,
  pickCapableModel,
  MODEL_CAPABILITY_INSUFFICIENT,
};
