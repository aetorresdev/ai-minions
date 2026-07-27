'use strict';

/**
 * Framework-neutral adapters / view-models for the fullscreen operator TUI shell.
 * Operator modules remain authoritative. Adapters never parse CLI presentation text,
 * invent run truth, or coerce absent/unavailable into zero/success/unlimited/not_configured.
 */

const { COCKPIT_ACTIONS, formatNonTtyGuidance } = require('./operator-cockpit-tui');

const ADAPTER_SCHEMA = '1';

/** @typedef {'available'|'absent'|'unavailable'|'unknown'|'not_configured'|'unlimited'} FieldAvailability */

/**
 * Provenance-aware scalar. Distinguishes absent vs 0 vs unavailable vs not_configured vs unlimited.
 * @param {unknown} raw
 * @param {string} [source]
 * @returns {{ value: unknown, availability: FieldAvailability, source: string }}
 */
function provenanceField(raw, source = 'operator') {
  if (raw === undefined || raw === null) {
    return { value: null, availability: 'absent', source: 'none' };
  }
  if (typeof raw === 'object' && raw !== null && 'availability' in /** @type {object} */ (raw)) {
    const obj = /** @type {{ value?: unknown, availability?: string, source?: string }} */ (raw);
    const availability = normalizeAvailability(obj.availability);
    return {
      value: obj.value === undefined ? null : obj.value,
      availability,
      source: obj.source == null ? source : String(obj.source),
    };
  }
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (token === 'unavailable') {
      return { value: null, availability: 'unavailable', source };
    }
    if (token === 'unknown') {
      return { value: null, availability: 'unknown', source };
    }
    if (token === 'not_configured') {
      return { value: null, availability: 'not_configured', source };
    }
    if (token === 'unlimited') {
      return { value: null, availability: 'unlimited', source };
    }
  }
  return { value: raw, availability: 'available', source };
}

/**
 * @param {unknown} raw
 * @returns {FieldAvailability}
 */
function normalizeAvailability(raw) {
  const token = String(raw ?? 'absent').trim().toLowerCase();
  if (
    token === 'available'
    || token === 'absent'
    || token === 'unavailable'
    || token === 'unknown'
    || token === 'not_configured'
    || token === 'unlimited'
  ) {
    return token;
  }
  return 'unknown';
}

/**
 * @param {{ value: unknown, availability: FieldAvailability, source: string }} field
 * @returns {string}
 */
function formatProvenanceField(field) {
  if (field.availability === 'available') {
    if (field.value === null || field.value === undefined || field.value === '') return '(empty)';
    return String(field.value);
  }
  return field.availability;
}

/**
 * Home / cockpit readiness view-model (explicit fields; no CLI text parsing).
 * @param {{
 *   aboutInfo?: object,
 *   credentials?: object,
 *   pathActivation?: object,
 * }} [input]
 */
function adaptHomeReadiness(input = {}) {
  const about = input.aboutInfo && typeof input.aboutInfo === 'object' ? input.aboutInfo : {};
  const credentials = input.credentials && typeof input.credentials === 'object' ? input.credentials : {};
  const pathActivation = input.pathActivation && typeof input.pathActivation === 'object'
    ? input.pathActivation
    : {};
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'home_readiness',
    version: about.version == null ? null : String(about.version),
    git_commit: about.git_commit == null ? null : String(about.git_commit),
    model_policy: about.model_policy == null ? null : String(about.model_policy),
    path_status: pathActivation.status == null ? null : String(pathActivation.status),
    cli_on_path: pathActivation.on_path == null ? null : Boolean(pathActivation.on_path),
    credential_sufficiency: credentials.credential_sufficiency == null
      ? null
      : String(credentials.credential_sufficiency),
    remote_tokens_required: credentials.remote_tokens_required == null
      ? null
      : Boolean(credentials.remote_tokens_required),
    providers: Array.isArray(credentials.providers)
      ? credentials.providers.map((p) => ({
        provider: p.provider == null ? null : String(p.provider),
        env_var: p.env_var == null ? null : String(p.env_var),
        status: p.status == null ? null : String(p.status),
        required_for_policy: p.required_for_policy == null ? null : Boolean(p.required_for_policy),
      }))
      : [],
  };
}

/**
 * Adapt `runOperatorRuns` payload (operator remains authoritative).
 * @param {{ ok?: boolean, runs?: object[], result_code?: string, next_safe_action?: string, json?: object }} payload
 */
function adaptRunsList(payload) {
  const body = payload?.json && typeof payload.json === 'object' && Array.isArray(payload.json.runs)
    ? payload.json
    : payload;
  const runs = Array.isArray(body?.runs)
    ? body.runs.map((run) => ({
      run_id: String(run.run_id ?? ''),
      status: run.status ?? null,
      outcome: run.outcome ?? null,
      result_code: run.result_code ?? null,
      reason_code: run.reason_code ?? null,
      current_phase: run.current_phase ?? null,
    }))
    : [];
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'runs_list',
    runs,
    result_code: String(body?.result_code ?? payload?.result_code ?? 'RUNS_EMPTY'),
    next_safe_action: (body?.next_safe_action ?? payload?.next_safe_action) == null
      ? null
      : String(body?.next_safe_action ?? payload?.next_safe_action),
  };
}

/**
 * Selected-run status view-model from `runOperatorStatus` / status JSON (no CLI text parsing).
 * @param {object | null | undefined} statusResult
 */
function adaptSelectedRunStatus(statusResult) {
  if (!statusResult || typeof statusResult !== 'object') {
    return {
      schema: ADAPTER_SCHEMA,
      kind: 'selected_run_status',
      run_id: null,
      result_code: null,
      status: null,
      outcome: null,
      reason_code: null,
      next_safe_action: null,
      available: false,
    };
  }
  const json = statusResult.json && typeof statusResult.json === 'object' ? statusResult.json : {};
  const summary = json.operator_trace_summary && typeof json.operator_trace_summary === 'object'
    ? json.operator_trace_summary
    : {};
  const runState = json.run_state_visibility && typeof json.run_state_visibility === 'object'
    ? json.run_state_visibility
    : {};
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'selected_run_status',
    run_id: String(json.run_id ?? statusResult.run_id ?? '') || null,
    result_code: statusResult.result_code == null && json.result_code == null
      ? null
      : String(statusResult.result_code ?? json.result_code),
    status: json.status == null ? null : String(json.status),
    outcome: summary.outcome == null ? null : String(summary.outcome),
    reason_code: statusResult.reason_code == null && runState.blocking_reason_code == null
      ? null
      : String(statusResult.reason_code ?? runState.blocking_reason_code),
    next_safe_action: statusResult.next_safe_action == null && summary.next_safe_action == null
      ? null
      : String(statusResult.next_safe_action ?? summary.next_safe_action),
    available: true,
  };
}

/**
 * Evidence / attach state from evidence-pane model or artifact probe (no invented attach truth).
 * @param {object | null | undefined} paneModel
 */
function adaptEvidenceAttachState(paneModel) {
  if (!paneModel || typeof paneModel !== 'object') {
    return {
      schema: ADAPTER_SCHEMA,
      kind: 'evidence_attach',
      run_id: null,
      result_code: null,
      attach_available: null,
      attach_bundle_available: null,
      attach_action_available: null,
      reason_code: null,
      next_safe_action: null,
      available: false,
    };
  }
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'evidence_attach',
    run_id: paneModel.run_id == null ? null : String(paneModel.run_id),
    result_code: paneModel.result_code == null ? null : String(paneModel.result_code),
    status: paneModel.status == null ? null : String(paneModel.status),
    outcome: paneModel.outcome == null ? null : String(paneModel.outcome),
    attach_available: paneModel.attach_available == null ? null : Boolean(paneModel.attach_available),
    attach_bundle_available: paneModel.attach_bundle_available == null
      ? null
      : Boolean(paneModel.attach_bundle_available),
    attach_action_available: paneModel.attach_action_available == null
      ? null
      : Boolean(paneModel.attach_action_available),
    reason_code: paneModel.reason_code == null ? null : String(paneModel.reason_code),
    next_safe_action: paneModel.next_safe_action == null ? null : String(paneModel.next_safe_action),
    available: true,
  };
}

/**
 * Configuration / credential readiness from config pane / doctor surfaces.
 * @param {object | null | undefined} paneModel
 */
function adaptConfigReadiness(paneModel) {
  if (!paneModel || typeof paneModel !== 'object') {
    return {
      schema: ADAPTER_SCHEMA,
      kind: 'config_readiness',
      available: false,
      path_status: null,
      model_policy: null,
      next_safe_action: null,
      credential_sufficiency: null,
    };
  }
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'config_readiness',
    available: true,
    path_status: paneModel.path_status == null ? null : String(paneModel.path_status),
    model_policy: paneModel.model_policy == null ? null : String(paneModel.model_policy),
    doctor_ok: paneModel.doctor_ok == null ? null : Boolean(paneModel.doctor_ok),
    credential_sufficiency: paneModel.credential_sufficiency == null
      ? null
      : String(paneModel.credential_sufficiency),
    next_safe_action: paneModel.next_safe_action == null ? null : String(paneModel.next_safe_action),
    remediations: Array.isArray(paneModel.remediations)
      ? paneModel.remediations.map((r) => String(r))
      : [],
  };
}

/**
 * Action result + reason-code display (machine-readable codes preserved).
 * @param {{
 *   action_id?: string,
 *   ok?: boolean,
 *   exitCode?: number,
 *   reason_code?: string | null,
 *   next_safe_action?: string | null,
 *   text?: string | null,
 *   error?: string | null,
 * }} [result]
 */
function adaptActionResult(result = {}) {
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'action_result',
    action_id: result.action_id == null ? null : String(result.action_id),
    ok: result.ok === true,
    exit_code: Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1),
    reason_code: result.reason_code == null ? null : String(result.reason_code),
    next_safe_action: result.next_safe_action == null ? null : String(result.next_safe_action),
    text: result.text == null ? null : String(result.text),
    error: result.error == null ? null : String(result.error),
  };
}

/**
 * Lifecycle / loop summary extension point.
 * Establishes stable missing-value semantics for a later live monitor — does not invent defaults.
 *
 * @param {object | null | undefined} source
 * @returns {object}
 */
function adaptLifecycleSummary(source) {
  const src = source && typeof source === 'object' ? source : {};
  const runState = src.run_state_visibility && typeof src.run_state_visibility === 'object'
    ? src.run_state_visibility
    : (src.run_state && typeof src.run_state === 'object' ? src.run_state : src);
  const summary = src.operator_trace_summary && typeof src.operator_trace_summary === 'object'
    ? src.operator_trace_summary
    : (src.summary && typeof src.summary === 'object' ? src.summary : {});
  const cost = src.cost_token_run_summary && typeof src.cost_token_run_summary === 'object'
    ? src.cost_token_run_summary
    : (src.cost_token_summary && typeof src.cost_token_summary === 'object'
      ? src.cost_token_summary
      : {});
  const runCost = cost.run && typeof cost.run === 'object' ? cost.run : cost;

  const goalRaw = src.goal_summary ?? summary.goal ?? summary.goal_summary;
  const currentIter = src.current_iteration ?? src.iteration ?? runState.current_iteration;
  const maxIter = src.max_iteration ?? src.max_iterations ?? runState.max_iterations;
  const rolePhase = src.current_role ?? src.current_phase ?? runState.current_phase
    ?? summary.current_phase;
  const gate = src.latest_gate ?? src.latest_verifier ?? runState.latest_gate;
  const verdict = src.latest_verdict ?? runState.latest_verdict ?? summary.outcome;
  const blocker = src.latest_blocker ?? runState.blocking_reason_code ?? summary.blocking_reason_code;
  const retryCount = src.retry_count ?? runState.retry_count;
  const retryLimit = src.retry_limit ?? runState.retry_limit;
  const measuredCost = Object.prototype.hasOwnProperty.call(src, 'measured_cost')
    ? src.measured_cost
    : (Object.prototype.hasOwnProperty.call(runCost, 'estimated_cost_usd')
      ? (runCost.estimated_cost_usd == null
        ? (runCost.cost_status === 'unavailable' || runCost.cost_status === 'not_billing'
          ? runCost.cost_status === 'not_billing' ? 'not_configured' : 'unavailable'
          : null)
        : runCost.estimated_cost_usd)
      : undefined);
  const configuredBudget = src.configured_budget ?? runState.configured_budget;
  const elapsed = src.elapsed ?? runState.elapsed_ms ?? runState.elapsed;
  const timeLimit = src.time_limit ?? runState.time_limit;
  const stopReason = src.terminal_stop_reason ?? runState.stop_reason ?? summary.stop_reason;
  const humanAction = src.human_action_required ?? runState.human_action_required;

  return {
    schema: ADAPTER_SCHEMA,
    kind: 'lifecycle_summary',
    goal_summary: provenanceField(goalRaw, 'operator_trace_summary'),
    current_iteration: provenanceField(currentIter, 'run_state'),
    max_iteration: provenanceField(maxIter, 'run_state'),
    current_role_phase: provenanceField(rolePhase, 'run_state'),
    latest_gate: provenanceField(gate, 'run_state'),
    latest_verdict: provenanceField(verdict, 'operator_trace_summary'),
    latest_blocker: provenanceField(blocker, 'run_state'),
    retry_count: provenanceField(retryCount, 'run_state'),
    retry_limit: provenanceField(retryLimit, 'run_state'),
    measured_cost: provenanceField(measuredCost, 'cost_token_run_summary'),
    configured_budget: provenanceField(configuredBudget, 'run_state'),
    elapsed: provenanceField(elapsed, 'run_state'),
    time_limit: provenanceField(timeLimit, 'run_state'),
    terminal_stop_reason: provenanceField(stopReason, 'run_state'),
    human_action_required: provenanceField(humanAction, 'run_state'),
  };
}

/**
 * Navigation items from authoritative cockpit action table.
 * @returns {ReadonlyArray<{ key: string, id: string, label: string }>}
 */
function adaptNavigationActions() {
  return COCKPIT_ACTIONS.map((a) => ({ key: a.key, id: a.id, label: a.label }));
}

module.exports = {
  ADAPTER_SCHEMA,
  provenanceField,
  normalizeAvailability,
  formatProvenanceField,
  adaptHomeReadiness,
  adaptRunsList,
  adaptSelectedRunStatus,
  adaptEvidenceAttachState,
  adaptConfigReadiness,
  adaptActionResult,
  adaptLifecycleSummary,
  adaptNavigationActions,
  formatNonTtyGuidance,
};
