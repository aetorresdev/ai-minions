'use strict';

/**
 * Steering handler policy gate — operator guidance must follow trace → visibility → CERBERUS.
 * Read-only surfaces cannot emit mutation steering; missing trace fails closed.
 */

const STEERING_HANDLER_POLICY_GATE_SCHEMA = '1';

/** @typedef {'tui'|'report'|'attach'|'status'|'explain'|'evidence'|'doctor'|'guided'} SteeringSurface */

const READ_ONLY_SURFACES = new Set(['tui', 'report', 'attach', 'status', 'explain', 'evidence']);

const MUTATION_ACTION_PREFIXES = [
  'approve',
  'rerun',
  'mutate',
  'merge',
  'override',
  'resume',
  'restart',
];

/**
 * @param {string | null | undefined} action
 * @returns {boolean}
 */
function isMutationSteeringAction(action) {
  if (!action || typeof action !== 'string') return false;
  const norm = action.trim().toLowerCase();
  if (/^(approve|rerun|mutate|merge|override|resume|restart)\b/.test(norm)) return true;
  return /\b(please|must|should)\s+(approve|rerun|mutate|merge|override|resume|restart)\b/.test(norm);
}

/**
 * @param {string} action
 * @returns {boolean}
 */
function suggestsBlockedAdvance(action) {
  const norm = action.trim().toLowerCase();
  if (/do not|don't|cannot|must not|avoid|until|before/.test(norm)) return false;
  return /advance|merge|approve|ship|release/i.test(norm);
}

/**
 * @param {{
 *   surface: SteeringSurface | string,
 *   proposed_action?: string | null,
 *   trace_loaded?: boolean,
 *   outcome?: string | null,
 *   blocked?: boolean,
 *   read_only?: boolean,
 *   trace_ref?: string | null,
 * }} input
 * @returns {{
 *   schema_version: string,
 *   allowed: boolean,
 *   reason_code: string,
 *   policy_source: string,
 *   message: string,
 * }}
 */
function evaluateSteeringHandlerPolicy(input) {
  const surface = String(input.surface || 'unknown').toLowerCase();
  const traceLoaded = input.trace_loaded === true;
  const outcome = input.outcome != null ? String(input.outcome) : null;
  const blocked = input.blocked === true || outcome === 'blocked' || outcome === 'failed';
  const readOnly = input.read_only === true || READ_ONLY_SURFACES.has(surface);
  const proposed = input.proposed_action != null ? String(input.proposed_action) : '';
  const traceRef = input.trace_ref != null ? String(input.trace_ref) : null;

  if (!traceLoaded) {
    return {
      schema_version: STEERING_HANDLER_POLICY_GATE_SCHEMA,
      allowed: false,
      reason_code: 'STEERING_TRACE_REQUIRED',
      policy_source: 'steering_handler_policy_gate',
      message: 'Steering requires a loaded trace context; missing trace fails closed.',
    };
  }

  if (readOnly && isMutationSteeringAction(proposed)) {
    return {
      schema_version: STEERING_HANDLER_POLICY_GATE_SCHEMA,
      allowed: false,
      reason_code: 'STEERING_READ_ONLY_SURFACE',
      policy_source: 'steering_handler_policy_gate',
      message: `Surface ${surface} is read-only; mutation steering is not allowed.`,
    };
  }

  if (blocked && suggestsBlockedAdvance(proposed)) {
    return {
      schema_version: STEERING_HANDLER_POLICY_GATE_SCHEMA,
      allowed: false,
      reason_code: 'STEERING_BLOCKED_ADVANCE',
      policy_source: 'steering_handler_policy_gate',
      message: 'Blocked or failed runs cannot be steered toward advance/merge without remediation.',
    };
  }

  if (!readOnly && proposed.length > 0 && !traceRef) {
    return {
      schema_version: STEERING_HANDLER_POLICY_GATE_SCHEMA,
      allowed: false,
      reason_code: 'STEERING_TRACE_REF_REQUIRED',
      policy_source: 'steering_handler_policy_gate',
      message: 'Mutable steering actions require an explicit trace_ref.',
    };
  }

  return {
    schema_version: STEERING_HANDLER_POLICY_GATE_SCHEMA,
    allowed: true,
    reason_code: 'STEERING_ALLOWED',
    policy_source: 'steering_handler_policy_gate',
    message: 'Steering action is consistent with trace-backed visibility policy.',
  };
}

module.exports = {
  STEERING_HANDLER_POLICY_GATE_SCHEMA,
  READ_ONLY_SURFACES,
  isMutationSteeringAction,
  suggestsBlockedAdvance,
  evaluateSteeringHandlerPolicy,
};
