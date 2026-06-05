'use strict';

/**
 * Design-only helpers for BV-REVIEWER-1 — value/outcome gate trace shape.
 * No orchestrator runtime wiring in this slice.
 */

const VALUE_REVIEW_SCHEMA_VERSION = '1';

const VALUE_VERDICTS = Object.freeze(['proceed', 'defer', 'reject']);

const SUBJECT_TYPES = Object.freeze(['backlog_ticket', 'epic_slice', 'pr_scope']);

const QUALITATIVE_SCORES = Object.freeze(['none', 'low', 'medium', 'high']);

const HIGH_PRIORITY_BANDS = Object.freeze(['P0', 'P1', 'alpha_blocker']);

const MAX_RATIONALE_LEN = 500;
const MAX_EVIDENCE_REFS = 16;
const MAX_EVIDENCE_REF_LEN = 200;

/**
 * @param {unknown} row
 * @returns {{ ok: true, row: object } | { ok: false, errors: string[] }}
 */
function validateValueReviewTraceLine(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['value_review row must be an object'] };
  }

  if (row.event !== 'value_review') errors.push('event must be value_review');
  if (row.value_review_schema_version !== VALUE_REVIEW_SCHEMA_VERSION) {
    errors.push(`value_review_schema_version must be "${VALUE_REVIEW_SCHEMA_VERSION}"`);
  }
  if (!row.task_id || typeof row.task_id !== 'string') errors.push('task_id required');

  if (!SUBJECT_TYPES.includes(row.subject_type)) {
    errors.push(`subject_type must be one of: ${SUBJECT_TYPES.join(', ')}`);
  }
  if (!row.subject_id || typeof row.subject_id !== 'string') errors.push('subject_id required');

  if (!VALUE_VERDICTS.includes(row.value_verdict)) {
    errors.push(`value_verdict must be one of: ${VALUE_VERDICTS.join(', ')}`);
  }

  if (!row.rationale || typeof row.rationale !== 'string') {
    errors.push('rationale required');
  } else if (row.rationale.length > MAX_RATIONALE_LEN) {
    errors.push(`rationale exceeds ${MAX_RATIONALE_LEN} chars`);
  }

  if (!Array.isArray(row.evidence_refs)) {
    errors.push('evidence_refs must be an array');
  } else {
    if (row.evidence_refs.length > MAX_EVIDENCE_REFS) {
      errors.push(`evidence_refs max ${MAX_EVIDENCE_REFS}`);
    }
    for (const ref of row.evidence_refs) {
      if (typeof ref !== 'string' || !ref.trim()) errors.push('evidence_refs entries must be non-empty strings');
      else if (ref.length > MAX_EVIDENCE_REF_LEN) errors.push(`evidence_ref exceeds ${MAX_EVIDENCE_REF_LEN} chars`);
    }
  }

  if (typeof row.outcome_verifiable !== 'boolean') {
    errors.push('outcome_verifiable must be boolean');
  }

  if (row.requires_human_confirmation != null && typeof row.requires_human_confirmation !== 'boolean') {
    errors.push('requires_human_confirmation must be boolean when present');
  }

  if (row.heuristic_scores != null) {
    if (typeof row.heuristic_scores !== 'object' || Array.isArray(row.heuristic_scores)) {
      errors.push('heuristic_scores must be an object');
    } else {
      for (const [key, val] of Object.entries(row.heuristic_scores)) {
        if (!QUALITATIVE_SCORES.includes(val)) {
          errors.push(`heuristic_scores.${key} must be one of: ${QUALITATIVE_SCORES.join(', ')}`);
        }
      }
    }
  }

  if (row.value_verdict === 'proceed' && row.outcome_verifiable !== true) {
    errors.push('proceed requires outcome_verifiable: true');
  }

  if (row.value_verdict === 'reject'
    && HIGH_PRIORITY_BANDS.includes(row.priority_band)
    && row.requires_human_confirmation !== true) {
    errors.push('reject on P0/P1/alpha_blocker requires requires_human_confirmation: true');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, row };
}

/**
 * @param {object[]} rows
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateValueReviewFixtureRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, errors: ['fixture must contain at least one value_review row'] };
  }
  rows.forEach((row, i) => {
    const v = validateValueReviewTraceLine(row);
    if (!v.ok) errors.push(`row ${i}: ${v.errors.join('; ')}`);
  });
  return { ok: errors.length === 0, errors };
}

module.exports = {
  VALUE_REVIEW_SCHEMA_VERSION,
  VALUE_VERDICTS,
  SUBJECT_TYPES,
  QUALITATIVE_SCORES,
  HIGH_PRIORITY_BANDS,
  validateValueReviewTraceLine,
  validateValueReviewFixtureRows,
};
