'use strict';

/**
 * Loop envelope extraction + monitor phase / guard classification.
 * No adapter or cockpit imports — keeps status JSON enrichment free of circular deps.
 */

const MONITOR_SCHEMA = '1';

/** @typedef {'planning'|'running'|'verifying'|'iterating'|'evidence_ready'|'done'|'failed'|'blocked'|'exhausted'|'cancelled'|'unavailable'} MonitorPhase */

/** @typedef {'none'|'retry_exhausted'|'max_iterations'|'cost_abort'|'timeout'|'cancelled'|'cerberus_block'|'output_contract'|'generic_guard'} GuardClass */

const MONITOR_PHASES = Object.freeze([
  'planning',
  'running',
  'verifying',
  'iterating',
  'evidence_ready',
  'done',
  'failed',
  'blocked',
  'exhausted',
  'cancelled',
  'unavailable',
]);

const GUARD_REASON_CODES = Object.freeze({
  retry_exhausted: Object.freeze([
    'GUARD_STEP_RETRY_LIMIT',
    'MAX_ITERATIONS_LOOP_EXHAUSTED',
  ]),
  max_iterations: Object.freeze([
    'MAX_ITERATIONS_CERBERUS_BLOCKERS',
    'MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS',
    'MAX_ITERATIONS_LOOP_EXHAUSTED',
  ]),
  cost_abort: Object.freeze(['GUARD_COST_LIMIT']),
  timeout: Object.freeze(['timeout', 'TIMEOUT', 'GUARD_TIMEOUT']),
  cancelled: Object.freeze(['cancelled', 'CANCELLED', 'RUN_CANCELLED', 'operator_cancel']),
  cerberus_block: Object.freeze([
    'CERBERUS_BLOCK',
    'CERBERUS_BLOCKERS_ITERATE',
    'CERBERUS_REJECT',
  ]),
  output_contract: Object.freeze([
    'orchestrator_json',
    'CONTRACT_OR_DECIDE_FAILURE',
    'ORCHESTRATOR_NO_CORRECTIONS_JSON',
  ]),
});

/**
 * @param {unknown} code
 * @param {readonly string[]} list
 * @returns {boolean}
 */
function reasonMatches(code, list) {
  if (code == null || code === '') return false;
  const token = String(code);
  return list.some((c) => c === token || token.includes(c));
}

/**
 * Extract loop envelope from authoritative trace rows + explain/summary/cost.
 * Missing fields stay absent — never default to 0 / unlimited / fabricated budgets.
 *
 * @param {object[]} rows
 * @param {{
 *   explain?: object | null,
 *   summary?: object | null,
 *   cost?: object | null,
 *   run_state?: object | null,
 *   status_label?: string | null,
 * }} [meta]
 * @returns {object}
 */
function buildLoopEnvelopeFromRows(rows, meta = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const explain = meta.explain && typeof meta.explain === 'object' ? meta.explain : {};
  const summary = meta.summary && typeof meta.summary === 'object' ? meta.summary : {};
  const runState = meta.run_state && typeof meta.run_state === 'object' ? meta.run_state : {};
  const cost = meta.cost && typeof meta.cost === 'object' ? meta.cost : {};
  const runCost = cost.run && typeof cost.run === 'object' ? cost.run : cost;

  /** @type {object | null} */
  let sessionStart = null;
  /** @type {object | null} */
  let sessionEnd = null;
  let iterateCount = 0;
  /** @type {Map<string, number>} */
  const blockerCounts = new Map();
  /** @type {string | null} */
  let latestEventSummary = null;
  /** @type {number | null} */
  let latestIteration = null;
  /** @type {string | null} */
  let latestStopReason = null;
  /** @type {string | null} */
  let latestFailureType = null;
  /** @type {string | null} */
  let latestGate = null;
  /** @type {string | null} */
  let latestVerdict = null;

  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const ev = r.event;

    if (ev === 'session_start' && !sessionStart) sessionStart = r;
    if (ev === 'session_end') sessionEnd = r;

    if (ev === 'iteration_done' && r.outcome === 'iterate') iterateCount += 1;

    if (typeof r.iteration === 'number' && Number.isFinite(r.iteration)) {
      latestIteration = r.iteration;
    }

    if (r.transition_reason && typeof r.transition_reason === 'object') {
      const tr = r.transition_reason;
      if (typeof tr.reason_code === 'string' && tr.reason_code) {
        latestStopReason = tr.reason_code;
        const prev = blockerCounts.get(tr.reason_code) ?? 0;
        if (
          r.outcome === 'iterate'
          || r.outcome === 'abort'
          || tr.type === 'GATE_BLOCK'
          || tr.type === 'MAX_ITERATIONS'
          || tr.type === 'GUARD'
          || tr.type === 'CONTRACT_FAIL'
        ) {
          blockerCounts.set(tr.reason_code, prev + 1);
        }
      }
    }

    if (typeof r.failure_type === 'string' && r.failure_type) {
      latestFailureType = r.failure_type;
    }

    if (typeof r.gate_id === 'string' && r.gate_id) latestGate = r.gate_id;
    else if (typeof r.gate === 'string' && r.gate) latestGate = r.gate;

    if (r.event === 'review_record' || r.event === 'cerberus_verdict') {
      if (typeof r.verdict === 'string') latestVerdict = r.verdict;
    }

    if (typeof r.reason_code === 'string' && r.reason_code) {
      const prev = blockerCounts.get(r.reason_code) ?? 0;
      if (
        ev === 'gate_block'
        || ev === 'contract_fail'
        || ev === 'budget_block'
        || ev === 'model_tier_gate_denied'
      ) {
        blockerCounts.set(r.reason_code, prev + 1);
      }
    }

    // Latest safe event summary — event name + optional phase/agent; never model prose.
    if (typeof ev === 'string' && ev) {
      const bits = [ev];
      if (typeof r.phase === 'string' && r.phase) bits.push(`phase=${r.phase}`);
      else if (typeof r.agent === 'string' && r.agent) bits.push(`agent=${r.agent}`);
      if (typeof r.outcome === 'string' && r.outcome) bits.push(`outcome=${r.outcome}`);
      latestEventSummary = bits.join(' ');
    }
  }

  const blocking = runState.blocking_reason_code
    ?? summary.blocking_reason_code
    ?? null;
  if (typeof blocking === 'string' && blocking.length) {
    if (!blockerCounts.has(blocking)) blockerCounts.set(blocking, 1);
  }

  const maxIterations = typeof sessionStart?.max_iterations === 'number'
    ? sessionStart.max_iterations
    : undefined;

  let currentIteration = undefined;
  if (typeof latestIteration === 'number') currentIteration = latestIteration;
  else if (sessionEnd && typeof sessionEnd.iterations === 'number') {
    currentIteration = sessionEnd.iterations;
  } else if (iterateCount > 0 || list.some((r) => r && r.event === 'iteration_done')) {
    currentIteration = iterateCount
      + list.filter((r) => r && r.event === 'iteration_done' && r.outcome === 'done').length;
  }

  const goalRaw = explain.goal
    ?? (explain.run_snapshot && typeof explain.run_snapshot.goal === 'string'
      ? explain.run_snapshot.goal
      : undefined);

  let elapsed = undefined;
  if (sessionStart && typeof sessionStart.ts_ms === 'number') {
    const endTs = sessionEnd && typeof sessionEnd.ts_ms === 'number'
      ? sessionEnd.ts_ms
      : null;
    if (endTs != null) elapsed = Math.max(0, endTs - sessionStart.ts_ms);
    // Live elapsed without session_end stays unavailable — do not invent wall-clock "now".
    else elapsed = 'unavailable';
  }

  let measuredCost = undefined;
  if (Object.prototype.hasOwnProperty.call(runCost, 'estimated_cost_usd')) {
    if (runCost.estimated_cost_usd == null) {
      measuredCost = runCost.cost_status === 'not_billing'
        ? 'not_configured'
        : (runCost.cost_status === 'unavailable' ? 'unavailable' : null);
    } else {
      measuredCost = runCost.estimated_cost_usd;
    }
  }

  const cerberus = summary.cerberus && typeof summary.cerberus === 'object'
    ? summary.cerberus
    : {};
  if (latestVerdict == null && typeof cerberus.verdict === 'string') {
    latestVerdict = cerberus.verdict;
  }

  const attachReady = runState.attach_action_available === true
    || runState.attach_bundle_available === true
    || runState.attach_available === true;

  /** @type {{ reason_code: string, count: number }[]} */
  const blockerHistory = [...blockerCounts.entries()]
    .map(([reason_code, count]) => ({ reason_code, count }))
    .sort((a, b) => b.count - a.count || a.reason_code.localeCompare(b.reason_code));

  return {
    schema: MONITOR_SCHEMA,
    kind: 'loop_envelope',
    goal_summary: goalRaw,
    current_iteration: currentIteration,
    max_iterations: maxIterations,
    current_phase: runState.current_phase ?? summary.current_phase ?? undefined,
    latest_gate: latestGate
      ?? (Array.isArray(summary.blocked_gates) && summary.blocked_gates[0]
        ? summary.blocked_gates[0]
        : undefined),
    latest_verdict: latestVerdict,
    latest_blocker: blocking ?? undefined,
    retry_count: iterateCount > 0 ? iterateCount : (explain.retries != null ? explain.retries : undefined),
    retry_limit: undefined, // only when proven configured — never invent
    measured_cost: measuredCost,
    configured_budget: undefined,
    elapsed,
    time_limit: undefined,
    terminal_stop_reason: latestStopReason
      ?? (typeof explain.final_status === 'string' ? explain.final_status : undefined),
    human_action_required: summary.outcome === 'blocked'
      || cerberus.verdict === 'block'
      || cerberus.verdict === 'request_changes'
      || undefined,
    outcome: summary.outcome ?? undefined,
    status_label: meta.status_label ?? undefined,
    failure_type: latestFailureType
      ?? (typeof explain.failure_type === 'string' ? explain.failure_type : undefined),
    latest_event_summary: latestEventSummary,
    blocker_history: blockerHistory,
    attach_ready: attachReady,
    has_session_start: Boolean(sessionStart),
    has_session_end: Boolean(sessionEnd),
  };
}

/**
 * @param {string | null | undefined} phase
 * @returns {boolean}
 */
function isPlanningPhase(phase) {
  const p = String(phase ?? '').toLowerCase();
  return p === 'planning'
    || p === 'plan'
    || p === 'owner'
    || p === 'architect'
    || p === 'orquestador'
    || p === 'orchestrator';
}

/**
 * @param {string | null | undefined} phase
 * @returns {boolean}
 */
function isVerifyingPhase(phase) {
  const p = String(phase ?? '').toLowerCase();
  return p === 'qa'
    || p === 'cerberus'
    || p === 'verifying'
    || p === 'gated'
    || p === 'gate'
    || p.includes('verify');
}

/**
 * Classify high-level monitor phase from authoritative fields only.
 * Never derives completion percentage.
 *
 * @param {object} input
 * @returns {MonitorPhase}
 */
function classifyMonitorPhase(input = {}) {
  const liveUnavailable = input.live_unavailable === true
    || input.available === false;
  if (liveUnavailable && !input.outcome && !input.status_label && !input.current_phase) {
    return 'unavailable';
  }

  const blocker = input.latest_blocker ?? input.blocking_reason_code ?? null;
  const stop = input.terminal_stop_reason ?? input.stop_reason ?? null;
  const failureType = input.failure_type ?? null;
  const outcome = input.outcome ?? null;
  const status = input.status_label ?? input.status ?? null;
  const phase = input.current_phase ?? input.current_role_phase ?? null;

  if (
    reasonMatches(blocker, GUARD_REASON_CODES.output_contract)
    || reasonMatches(stop, GUARD_REASON_CODES.output_contract)
    || failureType === 'contract_mismatch'
  ) {
    // Output-contract / local-cap failures must never remain visually "running".
    return 'failed';
  }

  if (
    reasonMatches(blocker, GUARD_REASON_CODES.cancelled)
    || reasonMatches(stop, GUARD_REASON_CODES.cancelled)
    || String(outcome).toLowerCase() === 'cancelled'
    || String(status).toLowerCase() === 'cancelled'
  ) {
    return 'cancelled';
  }

  if (
    reasonMatches(stop, GUARD_REASON_CODES.max_iterations)
    || reasonMatches(blocker, GUARD_REASON_CODES.max_iterations)
    || reasonMatches(stop, GUARD_REASON_CODES.retry_exhausted)
    || reasonMatches(blocker, GUARD_REASON_CODES.retry_exhausted)
    || failureType === 'retry_exceeded'
    || String(stop).toLowerCase() === 'max_iterations'
  ) {
    return 'exhausted';
  }

  if (
    reasonMatches(blocker, GUARD_REASON_CODES.cost_abort)
    || reasonMatches(stop, GUARD_REASON_CODES.cost_abort)
    || failureType === 'cost_abort'
  ) {
    return 'failed';
  }

  if (
    reasonMatches(blocker, GUARD_REASON_CODES.timeout)
    || reasonMatches(stop, GUARD_REASON_CODES.timeout)
    || failureType === 'timeout'
  ) {
    return 'failed';
  }

  if (
    outcome === 'blocked'
    || status === 'blocked'
    || reasonMatches(blocker, GUARD_REASON_CODES.cerberus_block)
    || (typeof blocker === 'string' && blocker.length > 0 && input.has_session_end === true)
  ) {
    if (outcome === 'failed') return 'failed';
    if (outcome === 'blocked' || status === 'blocked' || reasonMatches(blocker, GUARD_REASON_CODES.cerberus_block)) {
      return 'blocked';
    }
  }

  if (outcome === 'failed' || status === 'failed') return 'failed';
  if (outcome === 'complete' || status === 'complete' || String(phase).toLowerCase() === 'complete') {
    if (input.attach_ready === true) return 'evidence_ready';
    return 'done';
  }

  if (input.has_session_end === true && outcome === 'degraded') return 'failed';

  // Mid-run / post-rejection iteration
  if (
    input.retry_count != null
    && Number(input.retry_count) > 0
    && input.has_session_end !== true
    && (typeof blocker === 'string' && blocker.length > 0)
  ) {
    return 'iterating';
  }

  if (isVerifyingPhase(phase) && input.has_session_end !== true) return 'verifying';
  if (isPlanningPhase(phase) && input.has_session_end !== true) return 'planning';

  if (input.has_session_start === true && input.has_session_end !== true) {
    if (status === 'running' || outcome === 'unknown' || status == null) return 'running';
  }

  if (liveUnavailable) return 'unavailable';
  if (outcome === 'blocked') return 'blocked';
  if (outcome === 'failed') return 'failed';
  if (outcome === 'complete') return 'done';
  return 'unavailable';
}

/**
 * @param {object} input
 * @returns {{ guard_class: GuardClass, reason_code: string | null, visually_distinct: boolean }}
 */
function classifyGuardExit(input = {}) {
  const blocker = input.latest_blocker ?? input.blocking_reason_code ?? null;
  const stop = input.terminal_stop_reason ?? input.stop_reason ?? null;
  const failureType = input.failure_type ?? null;
  const code = (typeof stop === 'string' && stop) ? stop
    : ((typeof blocker === 'string' && blocker) ? blocker : null);

  if (
    reasonMatches(code, GUARD_REASON_CODES.cancelled)
    || String(input.outcome).toLowerCase() === 'cancelled'
  ) {
    return { guard_class: 'cancelled', reason_code: code, visually_distinct: true };
  }
  if (
    reasonMatches(code, GUARD_REASON_CODES.max_iterations)
    || String(stop).toLowerCase() === 'max_iterations'
  ) {
    return { guard_class: 'max_iterations', reason_code: code, visually_distinct: true };
  }
  if (
    reasonMatches(code, GUARD_REASON_CODES.retry_exhausted)
    || failureType === 'retry_exceeded'
  ) {
    return { guard_class: 'retry_exhausted', reason_code: code, visually_distinct: true };
  }
  if (
    reasonMatches(code, GUARD_REASON_CODES.cost_abort)
    || failureType === 'cost_abort'
  ) {
    return { guard_class: 'cost_abort', reason_code: code, visually_distinct: true };
  }
  if (
    reasonMatches(code, GUARD_REASON_CODES.timeout)
    || failureType === 'timeout'
  ) {
    return { guard_class: 'timeout', reason_code: code, visually_distinct: true };
  }
  if (reasonMatches(code, GUARD_REASON_CODES.cerberus_block)) {
    return { guard_class: 'cerberus_block', reason_code: code, visually_distinct: true };
  }
  if (
    reasonMatches(code, GUARD_REASON_CODES.output_contract)
    || failureType === 'contract_mismatch'
  ) {
    return { guard_class: 'output_contract', reason_code: code, visually_distinct: true };
  }
  if (code && (input.monitor_phase === 'exhausted' || input.monitor_phase === 'failed'
    || input.monitor_phase === 'blocked' || input.monitor_phase === 'cancelled')) {
    return { guard_class: 'generic_guard', reason_code: code, visually_distinct: true };
  }
  return { guard_class: 'none', reason_code: code, visually_distinct: false };
}

module.exports = {
  MONITOR_SCHEMA,
  MONITOR_PHASES,
  GUARD_REASON_CODES,
  buildLoopEnvelopeFromRows,
  classifyMonitorPhase,
  classifyGuardExit,
};
