'use strict';

/**
 * Live run monitor view-model for the fullscreen TUI shell.
 * Reads operator status / trace fields only — never invents progress %, success, or limits.
 * Cancel/return-to-menu is detach-only; this module never mutates traces or run control.
 */

const {
  ADAPTER_SCHEMA,
  provenanceField,
  formatProvenanceField,
  adaptLifecycleSummary,
  adaptSelectedRunStatus,
} = require('./operator-tui-adapters');
const {
  MONITOR_SCHEMA,
  MONITOR_PHASES,
  GUARD_REASON_CODES,
  buildLoopEnvelopeFromRows,
  classifyMonitorPhase,
  classifyGuardExit,
} = require('./operator-tui-loop-envelope');

/**
 * Build monitor view-model from status JSON, loop envelope, or synthetic fixture.
 *
 * @param {object | null | undefined} source
 * @returns {object}
 */
function adaptLiveMonitor(source) {
  if (!source || typeof source !== 'object' || source.available === false) {
    return {
      schema: MONITOR_SCHEMA,
      kind: 'live_monitor',
      adapter_schema: ADAPTER_SCHEMA,
      available: false,
      live_state: provenanceField('unavailable', 'live_monitor'),
      fallback_source: 'unavailable',
      monitor_phase: 'unavailable',
      guard_class: 'none',
      guard_reason_code: provenanceField(undefined),
      guard_visually_distinct: false,
      progress_percent: provenanceField(undefined), // always absent — never invent
      latest_event_summary: provenanceField(undefined),
      outcome: provenanceField(undefined),
      status_label: provenanceField(undefined),
      blocker_history: [],
      loop: adaptLifecycleSummary(null),
      status: adaptSelectedRunStatus(null),
      detach_safe: true,
    };
  }

  const json = source.json && typeof source.json === 'object' ? source.json : source;
  const envelope = json.loop_envelope && typeof json.loop_envelope === 'object'
    ? json.loop_envelope
    : (source.loop_envelope && typeof source.loop_envelope === 'object'
      ? source.loop_envelope
      : json);

  const lifecycleSource = {
    ...envelope,
    run_state_visibility: json.run_state_visibility ?? source.run_state_visibility ?? envelope,
    operator_trace_summary: json.operator_trace_summary ?? source.operator_trace_summary,
    cost_token_run_summary: json.cost_token_run_summary ?? source.cost_token_run_summary,
    goal_summary: envelope.goal_summary,
    current_iteration: envelope.current_iteration,
    max_iterations: envelope.max_iterations ?? envelope.max_iteration,
    current_phase: envelope.current_phase,
    latest_gate: envelope.latest_gate,
    latest_verdict: envelope.latest_verdict,
    latest_blocker: envelope.latest_blocker,
    retry_count: envelope.retry_count,
    retry_limit: envelope.retry_limit,
    measured_cost: envelope.measured_cost,
    configured_budget: envelope.configured_budget,
    elapsed: envelope.elapsed,
    time_limit: envelope.time_limit,
    terminal_stop_reason: envelope.terminal_stop_reason,
    human_action_required: envelope.human_action_required,
  };

  const loop = adaptLifecycleSummary(lifecycleSource);
  const status = adaptSelectedRunStatus(
    source.json ? source : { json, result_code: source.result_code, reason_code: source.reason_code },
  );

  // Live-trace availability is independent of status JSON availability.
  // Do not fold status.available or status-derived lifecycle fields into hasLiveTrace —
  // that mislabels status_fallback as "available" and can drop status-only running
  // into unavailable once classification lacks session_start.
  const hasLiveTrace = envelope.has_session_start === true;
  const hasStatus = status.available === true;
  const available = hasLiveTrace || hasStatus;

  const fallbackSource = hasLiveTrace
    ? (envelope.has_session_end === false
      ? 'live'
      : 'status')
    : (hasStatus ? 'status' : 'unavailable');

  const classifyInput = {
    available,
    live_unavailable: !available,
    latest_blocker: loop.latest_blocker.availability === 'available'
      ? loop.latest_blocker.value
      : (envelope.latest_blocker ?? null),
    terminal_stop_reason: loop.terminal_stop_reason.availability === 'available'
      ? loop.terminal_stop_reason.value
      : (envelope.terminal_stop_reason ?? null),
    failure_type: envelope.failure_type ?? null,
    outcome: envelope.outcome ?? status.outcome ?? null,
    status_label: envelope.status_label ?? status.status ?? null,
    current_phase: loop.current_role_phase.availability === 'available'
      ? loop.current_role_phase.value
      : (envelope.current_phase ?? null),
    retry_count: loop.retry_count.availability === 'available' ? loop.retry_count.value : null,
    attach_ready: envelope.attach_ready === true,
    has_session_start: envelope.has_session_start === true,
    has_session_end: envelope.has_session_end === true,
  };

  const monitorPhase = classifyMonitorPhase(classifyInput);
  const guard = classifyGuardExit({ ...classifyInput, monitor_phase: monitorPhase });

  const rawHistory = Array.isArray(envelope.blocker_history) ? envelope.blocker_history : [];
  const blockerHistory = rawHistory.map((entry) => ({
    reason_code: String(entry.reason_code ?? ''),
    count: Number.isFinite(Number(entry.count)) ? Number(entry.count) : 1,
  })).filter((e) => e.reason_code.length > 0);

  if (
    blockerHistory.length === 0
    && loop.latest_blocker.availability === 'available'
    && loop.latest_blocker.value != null
  ) {
    blockerHistory.push({ reason_code: String(loop.latest_blocker.value), count: 1 });
  }

  return {
    schema: MONITOR_SCHEMA,
    kind: 'live_monitor',
    adapter_schema: ADAPTER_SCHEMA,
    available,
    live_state: provenanceField(
      hasLiveTrace ? 'available' : (hasStatus ? 'status_fallback' : 'unavailable'),
      'live_monitor',
    ),
    fallback_source: fallbackSource,
    monitor_phase: monitorPhase,
    guard_class: guard.guard_class,
    guard_reason_code: provenanceField(guard.reason_code, 'run_state'),
    guard_visually_distinct: guard.visually_distinct,
    progress_percent: provenanceField(undefined),
    latest_event_summary: provenanceField(envelope.latest_event_summary, 'trace'),
    outcome: provenanceField(envelope.outcome ?? status.outcome, 'operator_trace_summary'),
    status_label: provenanceField(envelope.status_label ?? status.status, 'operator_status'),
    blocker_history: blockerHistory,
    loop,
    status,
    detach_safe: true,
  };
}

/**
 * @param {ReturnType<typeof adaptLiveMonitor>} model
 * @returns {string[]}
 */
function formatLiveMonitorLines(model) {
  if (!model || model.available === false) {
    return [
      'monitor_phase: unavailable',
      'live_state: unavailable',
      'fallback: unavailable',
      '(no authoritative live or status snapshot — use status / select a run)',
    ];
  }

  const lc = model.loop;
  const lines = [
    `monitor_phase: ${model.monitor_phase}`,
    `live_state: ${formatProvenanceField(model.live_state)}  fallback=${model.fallback_source}`,
    `outcome: ${formatProvenanceField(model.outcome)}  status=${formatProvenanceField(model.status_label)}`,
    `goal: ${formatProvenanceField(lc.goal_summary)}`,
    `iteration: ${formatProvenanceField(lc.current_iteration)} / ${formatProvenanceField(lc.max_iteration)}`,
    `phase: ${formatProvenanceField(lc.current_role_phase)}`,
    `gate: ${formatProvenanceField(lc.latest_gate)}  verdict=${formatProvenanceField(lc.latest_verdict)}`,
    `blocker: ${formatProvenanceField(lc.latest_blocker)}`,
    `retry: ${formatProvenanceField(lc.retry_count)} / ${formatProvenanceField(lc.retry_limit)}`,
    `cost: ${formatProvenanceField(lc.measured_cost)}  budget=${formatProvenanceField(lc.configured_budget)}`,
    `elapsed: ${formatProvenanceField(lc.elapsed)}  limit=${formatProvenanceField(lc.time_limit)}`,
    `stop: ${formatProvenanceField(lc.terminal_stop_reason)}  human=${formatProvenanceField(lc.human_action_required)}`,
    `event: ${formatProvenanceField(model.latest_event_summary)}`,
    `progress_percent: ${formatProvenanceField(model.progress_percent)}`,
  ];

  if (model.guard_visually_distinct) {
    lines.push(
      `GUARD_EXIT: class=${model.guard_class} reason=${formatProvenanceField(model.guard_reason_code)}`,
    );
  } else {
    lines.push('guard: none');
  }

  if (model.blocker_history.length) {
    lines.push('blocker_history:');
    for (const entry of model.blocker_history) {
      lines.push(`  - ${entry.reason_code} ×${entry.count}`);
    }
  } else {
    lines.push('blocker_history: (none)');
  }

  lines.push('detach: menu/quit does not cancel or mutate the authoritative run');
  return lines;
}

/**
 * Build monitor model from `runOperatorStatus` result (json:true preferred).
 * @param {object | null | undefined} statusResult
 */
function buildLiveMonitorFromStatusResult(statusResult) {
  if (!statusResult || typeof statusResult !== 'object') {
    return adaptLiveMonitor(null);
  }
  if (statusResult.ok === false && !statusResult.json) {
    return adaptLiveMonitor(null);
  }
  return adaptLiveMonitor(statusResult);
}

module.exports = {
  MONITOR_SCHEMA,
  MONITOR_PHASES,
  GUARD_REASON_CODES,
  buildLoopEnvelopeFromRows,
  classifyMonitorPhase,
  classifyGuardExit,
  adaptLiveMonitor,
  formatLiveMonitorLines,
  buildLiveMonitorFromStatusResult,
  formatProvenanceField,
};
