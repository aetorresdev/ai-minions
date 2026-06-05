'use strict';

/**
 * Design-only helpers for S5 — progressive disclosure trace shape.
 * No orchestrator runtime wiring in this slice.
 */

const {
  collectForbiddenContentKeyPaths,
} = require('./bv-reviewer-design');

const DISCLOSURE_SCHEMA_VERSION = '1';
const TRACE_SCHEMA_VERSION = '2';

const DISCLOSURE_SURFACES = Object.freeze(['tools', 'skills', 'context_package']);
const DISCLOSURE_ACTIONS = Object.freeze(['hidden', 'exposed', 'partial']);

const MAX_RATIONALE_LEN = 300;
const MAX_ITEM_REFS = 32;
const MAX_ITEM_REF_LEN = 200;

/**
 * @param {unknown} row
 * @returns {{ ok: true, row: object } | { ok: false, errors: string[] }}
 */
function validateContextDisclosureTraceLine(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['context_disclosure row must be an object'] };
  }

  if (row.event !== 'context_disclosure') errors.push('event must be context_disclosure');
  if (row.disclosure_schema_version !== DISCLOSURE_SCHEMA_VERSION) {
    errors.push(`disclosure_schema_version must be "${DISCLOSURE_SCHEMA_VERSION}"`);
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
  if (!row.role_id || typeof row.role_id !== 'string') errors.push('role_id required');

  if (!DISCLOSURE_SURFACES.includes(row.surface)) {
    errors.push(`surface must be one of: ${DISCLOSURE_SURFACES.join(', ')}`);
  }
  if (!DISCLOSURE_ACTIONS.includes(row.action)) {
    errors.push(`action must be one of: ${DISCLOSURE_ACTIONS.join(', ')}`);
  }

  if (!row.reason_code || typeof row.reason_code !== 'string') {
    errors.push('reason_code required');
  }

  if (!row.rationale || typeof row.rationale !== 'string') {
    errors.push('rationale required');
  } else if (row.rationale.length > MAX_RATIONALE_LEN) {
    errors.push(`rationale exceeds ${MAX_RATIONALE_LEN} chars`);
  }

  if (!Array.isArray(row.item_refs)) {
    errors.push('item_refs must be an array');
  } else {
    if (row.item_refs.length > MAX_ITEM_REFS) errors.push(`item_refs max ${MAX_ITEM_REFS}`);
    for (const ref of row.item_refs) {
      if (typeof ref !== 'string' || !ref.trim()) errors.push('item_refs entries must be non-empty strings');
      else if (ref.length > MAX_ITEM_REF_LEN) errors.push(`item_ref exceeds ${MAX_ITEM_REF_LEN} chars`);
    }
    if (row.action === 'hidden' && row.item_refs.length === 0) {
      errors.push('hidden requires at least one item_ref');
    }
  }

  for (const keyPath of collectForbiddenContentKeyPaths(row)) {
    errors.push(`forbidden content key: ${keyPath}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, row };
}

/**
 * @param {object[]} rows
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateContextDisclosureFixtureRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length < 3) {
    return { ok: false, errors: ['fixture must contain at least three context_disclosure rows'] };
  }
  rows.forEach((row, i) => {
    const v = validateContextDisclosureTraceLine(row);
    if (!v.ok) errors.push(`row ${i}: ${v.errors.join('; ')}`);
  });
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DISCLOSURE_SCHEMA_VERSION,
  TRACE_SCHEMA_VERSION,
  DISCLOSURE_SURFACES,
  DISCLOSURE_ACTIONS,
  validateContextDisclosureTraceLine,
  validateContextDisclosureFixtureRows,
};
