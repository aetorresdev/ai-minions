'use strict';

/**
 * Design-only helpers for governed harness improvement loop — proposal trace shape.
 * No orchestrator runtime wiring or auto-apply in this slice.
 */

const IMPROVEMENT_PROPOSAL_SCHEMA_VERSION = '1';
const TRACE_SCHEMA_VERSION = '2';

const PROPOSAL_TYPES = Object.freeze([
  'contract',
  'validation_rule',
  'tool_manifest',
  'doc',
  'test',
  'process',
]);

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

const PROPOSED_BY_ROLES = Object.freeze(['planner', 'architect', 'qa', 'owner', 'dev']);

const UNSAFE_FLAGS = Object.freeze([
  'permission_loosening',
  'unbounded_tool_add',
  'security_policy_change',
  'bypass_gate',
]);

const DECISIONS = Object.freeze(['approved', 'rejected']);

const CERBERUS_VERDICTS = Object.freeze(['approve', 'request_changes', 'block']);

const MAX_TITLE_LEN = 200;
const MAX_RATIONALE_LEN = 500;
const MAX_PLAN_LEN = 500;
const MAX_EVIDENCE_REFS = 16;
const MAX_EVIDENCE_REF_LEN = 200;
const MAX_AFFECTED_PATHS = 16;
const MAX_AFFECTED_PATH_LEN = 200;
const MAX_UNSAFE_FLAGS = 8;
const MAX_FORBIDDEN_KEY_SCAN_DEPTH = 32;

/** Fields that imply silent or autonomous application — must not appear. */
const FORBIDDEN_APPLY_KEYS = Object.freeze([
  'auto_apply',
  'apply_patch',
  'merged',
  'applied_at',
  'deployed',
]);

/** Raw prompt/response bodies — must not appear in proposal rows. */
const FORBIDDEN_CONTENT_KEYS = Object.freeze([
  'prompt',
  'response',
  'messages',
  'input',
  'output',
  'raw_prompt',
  'raw_response',
]);

/**
 * @param {unknown} value
 * @param {string} [path]
 * @param {number} [depth]
 * @param {readonly string[]} keys
 * @returns {string[]}
 */
function collectForbiddenKeyPaths(value, path = '', depth = 0, keys = FORBIDDEN_CONTENT_KEYS) {
  if (depth > MAX_FORBIDDEN_KEY_SCAN_DEPTH) return [];
  const hits = [];
  if (!value || typeof value !== 'object') return hits;

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      hits.push(...collectForbiddenKeyPaths(item, `${path}[${i}]`, depth + 1, keys));
    });
    return hits;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (keys.includes(key)) {
      hits.push(childPath);
    }
    hits.push(...collectForbiddenKeyPaths(child, childPath, depth + 1, keys));
  }
  return hits;
}

/**
 * @param {unknown} refs
 * @param {string} label
 * @param {number} maxCount
 * @param {number} maxLen
 * @param {string[]} errors
 * @param {{ min?: number }} [opts]
 */
function validateStringRefArray(refs, label, maxCount, maxLen, errors, opts = {}) {
  if (!Array.isArray(refs)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (opts.min != null && refs.length < opts.min) {
    errors.push(`${label} requires at least ${opts.min} entry`);
  }
  if (refs.length > maxCount) {
    errors.push(`${label} max ${maxCount}`);
  }
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref.trim()) {
      errors.push(`${label} entries must be non-empty strings`);
    } else if (ref.length > maxLen) {
      errors.push(`${label} entry exceeds ${maxLen} chars`);
    }
  }
}

/**
 * @param {unknown} row
 * @returns {{ ok: true, row: object } | { ok: false, errors: string[] }}
 */
function validateImprovementProposalTraceLine(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['improvement_proposal row must be an object'] };
  }

  if (row.event !== 'improvement_proposal') errors.push('event must be improvement_proposal');
  if (row.improvement_proposal_schema_version !== IMPROVEMENT_PROPOSAL_SCHEMA_VERSION) {
    errors.push(`improvement_proposal_schema_version must be "${IMPROVEMENT_PROPOSAL_SCHEMA_VERSION}"`);
  }
  if (row.trace_schema_version !== TRACE_SCHEMA_VERSION) {
    errors.push(`trace_schema_version must be "${TRACE_SCHEMA_VERSION}"`);
  }

  const hasTs = typeof row.ts === 'string' && row.ts.trim().length > 0;
  const hasTsMs = typeof row.ts_ms === 'number' && Number.isFinite(row.ts_ms);
  if (!hasTs && !hasTsMs) {
    errors.push('at least one of ts (non-empty string) or ts_ms (finite number) is required');
  }

  if (!row.task_id || typeof row.task_id !== 'string') errors.push('task_id required');
  if (!row.proposal_id || typeof row.proposal_id !== 'string') errors.push('proposal_id required');

  if (!PROPOSAL_TYPES.includes(row.proposal_type)) {
    errors.push(`proposal_type must be one of: ${PROPOSAL_TYPES.join(', ')}`);
  }

  if (!row.source_pattern || typeof row.source_pattern !== 'string') {
    errors.push('source_pattern required');
  }

  if (!row.title || typeof row.title !== 'string') {
    errors.push('title required');
  } else if (row.title.length > MAX_TITLE_LEN) {
    errors.push(`title exceeds ${MAX_TITLE_LEN} chars`);
  }

  if (!row.rationale || typeof row.rationale !== 'string') {
    errors.push('rationale required');
  } else if (row.rationale.length > MAX_RATIONALE_LEN) {
    errors.push(`rationale exceeds ${MAX_RATIONALE_LEN} chars`);
  }

  validateStringRefArray(row.evidence_refs, 'evidence_refs', MAX_EVIDENCE_REFS, MAX_EVIDENCE_REF_LEN, errors, { min: 1 });
  validateStringRefArray(row.affected_paths, 'affected_paths', MAX_AFFECTED_PATHS, MAX_AFFECTED_PATH_LEN, errors, { min: 1 });

  if (!RISK_LEVELS.includes(row.risk_level)) {
    errors.push(`risk_level must be one of: ${RISK_LEVELS.join(', ')}`);
  }

  if (row.risk_notes != null) {
    if (typeof row.risk_notes !== 'string') errors.push('risk_notes must be a string when present');
    else if (row.risk_notes.length > MAX_RATIONALE_LEN) errors.push(`risk_notes exceeds ${MAX_RATIONALE_LEN} chars`);
  }

  if (!row.validation_plan || typeof row.validation_plan !== 'string') {
    errors.push('validation_plan required');
  } else if (row.validation_plan.length > MAX_PLAN_LEN) {
    errors.push(`validation_plan exceeds ${MAX_PLAN_LEN} chars`);
  }

  if (!row.rollback_plan || typeof row.rollback_plan !== 'string') {
    errors.push('rollback_plan required');
  } else if (row.rollback_plan.length > MAX_PLAN_LEN) {
    errors.push(`rollback_plan exceeds ${MAX_PLAN_LEN} chars`);
  }

  if (row.human_approval_required !== true) {
    errors.push('human_approval_required must be true');
  }

  if (row.approval_status !== 'pending') {
    errors.push('approval_status must be "pending" on improvement_proposal emit — use improvement_proposal_decision for approved/rejected');
  }

  if (!PROPOSED_BY_ROLES.includes(row.proposed_by_role)) {
    errors.push(`proposed_by_role must be one of: ${PROPOSED_BY_ROLES.join(', ')}`);
  }

  if (row.proposed_by_role === 'cerberus') {
    errors.push('proposed_by_role cannot be cerberus — planner/scorer separation');
  }

  if (row.unsafe_flags != null) {
    if (!Array.isArray(row.unsafe_flags)) {
      errors.push('unsafe_flags must be an array when present');
    } else {
      if (row.unsafe_flags.length > MAX_UNSAFE_FLAGS) errors.push(`unsafe_flags max ${MAX_UNSAFE_FLAGS}`);
      for (const flag of row.unsafe_flags) {
        if (!UNSAFE_FLAGS.includes(flag)) errors.push(`unknown unsafe_flag: ${flag}`);
      }
    }
  }

  const unsafe = Array.isArray(row.unsafe_flags) ? row.unsafe_flags : [];
  const CERBERUS_REQUIRED_FLAGS = Object.freeze([
    'permission_loosening',
    'unbounded_tool_add',
    'security_policy_change',
    'bypass_gate',
  ]);
  const needsCerberus = unsafe.some((f) => CERBERUS_REQUIRED_FLAGS.includes(f));
  if (needsCerberus && row.cerberus_review_required !== true) {
    errors.push('cerberus_review_required must be true when unsafe_flags include permission_loosening, unbounded_tool_add, security_policy_change, or bypass_gate');
  }

  if (row.cerberus_review_required != null && typeof row.cerberus_review_required !== 'boolean') {
    errors.push('cerberus_review_required must be boolean when present');
  }

  for (const keyPath of collectForbiddenKeyPaths(row, '', 0, FORBIDDEN_CONTENT_KEYS)) {
    errors.push(`forbidden content key: ${keyPath}`);
  }
  for (const keyPath of collectForbiddenKeyPaths(row, '', 0, FORBIDDEN_APPLY_KEYS)) {
    errors.push(`forbidden apply key: ${keyPath}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, row };
}

/**
 * @param {unknown} row
 * @returns {{ ok: true, row: object } | { ok: false, errors: string[] }}
 */
function validateImprovementProposalDecisionTraceLine(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['improvement_proposal_decision row must be an object'] };
  }

  if (row.event !== 'improvement_proposal_decision') errors.push('event must be improvement_proposal_decision');
  if (row.improvement_proposal_schema_version !== IMPROVEMENT_PROPOSAL_SCHEMA_VERSION) {
    errors.push(`improvement_proposal_schema_version must be "${IMPROVEMENT_PROPOSAL_SCHEMA_VERSION}"`);
  }
  if (row.trace_schema_version !== TRACE_SCHEMA_VERSION) {
    errors.push(`trace_schema_version must be "${TRACE_SCHEMA_VERSION}"`);
  }

  const hasTs = typeof row.ts === 'string' && row.ts.trim().length > 0;
  const hasTsMs = typeof row.ts_ms === 'number' && Number.isFinite(row.ts_ms);
  if (!hasTs && !hasTsMs) {
    errors.push('at least one of ts (non-empty string) or ts_ms (finite number) is required');
  }

  if (!row.task_id || typeof row.task_id !== 'string') errors.push('task_id required');
  if (!row.proposal_id || typeof row.proposal_id !== 'string') errors.push('proposal_id required');

  if (!DECISIONS.includes(row.decision)) {
    errors.push(`decision must be one of: ${DECISIONS.join(', ')}`);
  }

  if (!row.decided_by || typeof row.decided_by !== 'string') errors.push('decided_by required');

  if (!row.decision_rationale || typeof row.decision_rationale !== 'string') {
    errors.push('decision_rationale required');
  } else if (row.decision_rationale.length > MAX_RATIONALE_LEN) {
    errors.push(`decision_rationale exceeds ${MAX_RATIONALE_LEN} chars`);
  }

  if (row.cerberus_verdict != null && !CERBERUS_VERDICTS.includes(row.cerberus_verdict)) {
    errors.push(`cerberus_verdict must be one of: ${CERBERUS_VERDICTS.join(', ')}`);
  }

  if (row.evidence_refs != null) {
    validateStringRefArray(row.evidence_refs, 'evidence_refs', MAX_EVIDENCE_REFS, MAX_EVIDENCE_REF_LEN, errors);
  }

  for (const keyPath of collectForbiddenKeyPaths(row, '', 0, FORBIDDEN_CONTENT_KEYS)) {
    errors.push(`forbidden content key: ${keyPath}`);
  }
  for (const keyPath of collectForbiddenKeyPaths(row, '', 0, FORBIDDEN_APPLY_KEYS)) {
    errors.push(`forbidden apply key: ${keyPath}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, row };
}

/**
 * @param {object[]} rows
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateImprovementProposalFixtureRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, errors: ['fixture must contain at least one trace row'] };
  }
  rows.forEach((row, i) => {
    if (!row || typeof row.event !== 'string') {
      errors.push(`row ${i}: missing event`);
      return;
    }
    const v = row.event === 'improvement_proposal_decision'
      ? validateImprovementProposalDecisionTraceLine(row)
      : validateImprovementProposalTraceLine(row);
    if (!v.ok) errors.push(`row ${i}: ${v.errors.join('; ')}`);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Dry-run human approval gate: pending proposal + matching approved decision.
 * @param {object[]} rows
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateImprovementProposalDryRunGate(rows) {
  const errors = [];
  const proposals = rows.filter((r) => r && r.event === 'improvement_proposal');
  const decisions = rows.filter((r) => r && r.event === 'improvement_proposal_decision');

  const dryRunId = proposals.find((p) => p.approval_status === 'pending' && p.proposal_id)?.proposal_id;
  if (!dryRunId) {
    errors.push('dry-run fixture requires at least one pending improvement_proposal');
  }

  const approved = decisions.find((d) => d.proposal_id === dryRunId && d.decision === 'approved');
  if (!approved) {
    errors.push('dry-run fixture requires improvement_proposal_decision with decision approved for pending proposal');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
  TRACE_SCHEMA_VERSION,
  PROPOSAL_TYPES,
  RISK_LEVELS,
  APPROVAL_STATUSES,
  PROPOSED_BY_ROLES,
  UNSAFE_FLAGS,
  DECISIONS,
  CERBERUS_VERDICTS,
  FORBIDDEN_APPLY_KEYS,
  FORBIDDEN_CONTENT_KEYS,
  collectForbiddenKeyPaths,
  validateImprovementProposalTraceLine,
  validateImprovementProposalDecisionTraceLine,
  validateImprovementProposalFixtureRows,
  validateImprovementProposalDryRunGate,
};
