'use strict';

/**
 * Framework-neutral adapters / view-models for the fullscreen operator TUI shell.
 * Operator modules remain authoritative. Adapters never parse CLI presentation text,
 * invent run truth, or coerce absent/unavailable into zero/success/unlimited/not_configured.
 */

const { COCKPIT_ACTIONS, formatNonTtyGuidance } = require('./operator-cockpit-tui');
const { adaptShellNavigation } = require('./operator-tui-landing');

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
      last_event_at: run.last_event_at == null ? null : String(run.last_event_at),
      created_at: run.created_at == null ? null : String(run.created_at),
      // Pass through only when operator list already provided them — never invent.
      goal_summary: run.goal_summary == null && run.goal == null
        ? null
        : String(run.goal_summary ?? run.goal),
      agent_count: run.agent_count == null && run.agents_count == null
        ? null
        : Number(run.agent_count ?? run.agents_count),
      next_safe_action: run.next_safe_action == null ? null : String(run.next_safe_action),
      action_eligibility: run.action_eligibility == null ? null : String(run.action_eligibility),
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
 * Selected-run status view-model from `runOperatorStatus` JSON or flat `status_pane`
 * (run-selector) — no CLI text parsing.
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
      current_phase: null,
      goal_summary: null,
      created_at: null,
      last_event_at: null,
      action_eligibility: null,
      available: false,
    };
  }
  const json = statusResult.json && typeof statusResult.json === 'object' ? statusResult.json : null;
  const summary = json && json.operator_trace_summary && typeof json.operator_trace_summary === 'object'
    ? json.operator_trace_summary
    : {};
  const runState = json && json.run_state_visibility && typeof json.run_state_visibility === 'object'
    ? json.run_state_visibility
    : {};
  // Flat status_pane fields apply when operator status JSON wrapper is absent.
  const runId = (json && json.run_id != null ? json.run_id : undefined) ?? statusResult.run_id;
  const status = (json && json.status != null ? json.status : undefined) ?? statusResult.status;
  const outcome = (summary.outcome != null ? summary.outcome : undefined) ?? statusResult.outcome;
  const resultCode = statusResult.result_code
    ?? (json && json.result_code != null ? json.result_code : undefined)
    ?? null;
  const reasonCode = statusResult.reason_code
    ?? (runState.blocking_reason_code != null ? runState.blocking_reason_code : undefined)
    ?? null;
  const nextSafe = statusResult.next_safe_action
    ?? (summary.next_safe_action != null ? summary.next_safe_action : undefined)
    ?? null;
  const currentPhase = statusResult.current_phase
    ?? (summary.current_phase != null ? summary.current_phase : undefined)
    ?? (runState.current_phase != null ? runState.current_phase : undefined)
    ?? null;
  const goalSummary = statusResult.goal_summary
    ?? (summary.goal != null ? summary.goal : undefined)
    ?? (summary.goal_summary != null ? summary.goal_summary : undefined)
    ?? null;
  const createdAt = statusResult.created_at == null ? null : String(statusResult.created_at);
  const lastEventAt = statusResult.last_event_at == null ? null : String(statusResult.last_event_at);
  const actionEligibility = statusResult.action_eligibility == null
    ? null
    : String(statusResult.action_eligibility);
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'selected_run_status',
    run_id: runId == null || runId === '' ? null : String(runId),
    result_code: resultCode == null ? null : String(resultCode),
    status: status == null ? null : String(status),
    outcome: outcome == null ? null : String(outcome),
    reason_code: reasonCode == null ? null : String(reasonCode),
    next_safe_action: nextSafe == null ? null : String(nextSafe),
    current_phase: currentPhase == null ? null : String(currentPhase),
    goal_summary: goalSummary == null || goalSummary === '' ? null : String(goalSummary),
    created_at: createdAt,
    last_event_at: lastEventAt,
    action_eligibility: actionEligibility,
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
 * Accepts flat synthetic adapter fields or nested operator pane
 * (`path_activation`, `credentials`, `remediation_candidates`).
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
      snapshot_ok: null,
      doctor_ok: null,
      doctor_status: 'unavailable',
    };
  }
  const pathActivation = paneModel.path_activation && typeof paneModel.path_activation === 'object'
    ? paneModel.path_activation
    : {};
  const credentials = paneModel.credentials && typeof paneModel.credentials === 'object'
    ? paneModel.credentials
    : {};
  const pathStatus = paneModel.path_status != null
    ? paneModel.path_status
    : pathActivation.status;
  const credentialSufficiency = paneModel.credential_sufficiency != null
    ? paneModel.credential_sufficiency
    : credentials.credential_sufficiency;
  // Presentation seeds set snapshot_ok without claiming doctor ran.
  // Real doctor panes may still use `ok` / `doctor_ok` as the doctor result.
  const isPresentationSeed = paneModel.snapshot_ok === true
    || String(paneModel.doctor_status ?? '').toLowerCase() === 'not_run';
  let doctorStatus = paneModel.doctor_status == null
    ? null
    : String(paneModel.doctor_status).toLowerCase();
  let doctorOk = null;
  if (doctorStatus === 'ok' || doctorStatus === 'passed') {
    doctorOk = true;
    doctorStatus = 'ok';
  } else if (doctorStatus === 'failed' || doctorStatus === 'fail' || doctorStatus === 'error') {
    doctorOk = false;
    doctorStatus = 'failed';
  } else if (doctorStatus === 'not_run' || doctorStatus === 'unavailable') {
    doctorOk = null;
  } else if (paneModel.doctor_ok != null) {
    doctorOk = Boolean(paneModel.doctor_ok);
    doctorStatus = doctorOk ? 'ok' : 'failed';
  } else if (!isPresentationSeed && paneModel.ok != null) {
    // Legacy operator config pane: `ok` means doctor/config probe result.
    doctorOk = Boolean(paneModel.ok);
    doctorStatus = doctorOk ? 'ok' : 'failed';
  } else {
    doctorStatus = doctorStatus || 'not_run';
    doctorOk = null;
  }
  const snapshotOk = paneModel.snapshot_ok != null
    ? Boolean(paneModel.snapshot_ok)
    : true;
  const remediationRaw = Array.isArray(paneModel.remediations)
    ? paneModel.remediations
    : (Array.isArray(paneModel.remediation_candidates)
      ? paneModel.remediation_candidates
      : []);
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'config_readiness',
    available: true,
    path_status: pathStatus == null ? null : String(pathStatus),
    model_policy: paneModel.model_policy == null ? null : String(paneModel.model_policy),
    snapshot_ok: snapshotOk,
    doctor_ok: doctorOk,
    doctor_status: doctorStatus,
    credential_sufficiency: credentialSufficiency == null
      ? null
      : String(credentialSufficiency),
    next_safe_action: paneModel.next_safe_action == null ? null : String(paneModel.next_safe_action),
    remediations: remediationRaw.map((r) => String(r)),
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
 * Lifecycle / loop summary fields for the live run monitor.
 * Stable missing-value semantics — does not invent defaults or completion percentages.
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
  // Verdict must be explicit — never fabricate from outcome/success provenance.
  const verdict = Object.prototype.hasOwnProperty.call(src, 'latest_verdict')
    ? src.latest_verdict
    : (Object.prototype.hasOwnProperty.call(runState, 'latest_verdict')
      ? runState.latest_verdict
      : (Object.prototype.hasOwnProperty.call(summary, 'verdict')
        ? summary.verdict
        : undefined));
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
 * Guided launcher summary for shell content (from launcher model / pane).
 * @param {object | null | undefined} source
 */
function adaptGuidedLauncher(source) {
  if (!source || typeof source !== 'object') {
    return {
      schema: ADAPTER_SCHEMA,
      kind: 'guided_launcher',
      available: false,
    };
  }
  const summary = source.execution_summary && typeof source.execution_summary === 'object'
    ? source.execution_summary
    : {};
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'guided_launcher',
    available: true,
    agent_flow: source.agent_flow == null ? null : String(source.agent_flow),
    inference_lane: source.inference_lane == null ? null : String(source.inference_lane),
    inference_policy: source.inference_policy == null ? null : String(source.inference_policy),
    gate_posture: source.gate_posture == null ? null : String(source.gate_posture),
    goal_source: source.goal_source == null ? null : String(source.goal_source),
    readiness: source.readiness == null ? null : String(source.readiness),
    can_launch: source.can_launch === true,
    blocked_reason_code: source.blocked_reason_code == null
      ? null
      : String(source.blocked_reason_code),
    remediation: source.remediation == null ? null : String(source.remediation),
    equivalent_command: source.equivalent_command == null
      ? null
      : String(source.equivalent_command),
    goal_summary: provenanceField(summary.goal_summary ?? source.goal),
    max_iterations: provenanceField(summary.max_iterations),
    max_retries: provenanceField(summary.max_retries),
    cost_limit_usd: provenanceField(summary.cost_limit_usd),
    time_limit: provenanceField(summary.time_limit),
    approved_artifacts: provenanceField(summary.approved_artifacts),
    deterministic_verifiers: provenanceField(summary.deterministic_verifiers),
    cerberus_gate: provenanceField(summary.cerberus_gate),
    local_backend: provenanceField(summary.local_backend),
    credential_sufficiency: provenanceField(summary.credential_sufficiency),
  };
}

/**
 * Legacy cockpit navigation (readline rollback) — mirrors COCKPIT_ACTIONS.
 * @returns {ReadonlyArray<{ key: string, id: string, label: string }>}
 */
function adaptCockpitNavigationActions() {
  return COCKPIT_ACTIONS.map((a) => ({ key: a.key, id: a.id, label: a.label }));
}

/**
 * Fullscreen shell navigation — task-first goals (+ contextual selected-run views).
 * Prefer this over the legacy cockpit action table for Ink chrome.
 * @param {{ selectedRunId?: string | null }} [options]
 * @returns {ReadonlyArray<{ key: string, id: string, label: string, description?: string, group?: string }>}
 */
function adaptNavigationActions(options = {}) {
  return adaptShellNavigation(options);
}

/**
 * Live harness row evidence → TUI view-model (shared with matrix --execute-live).
 * Does not invent PASS from readiness or a model "done" statement.
 * @param {object | null | undefined} rowEvidence
 */
function adaptLiveHarnessEvidence(rowEvidence) {
  if (!rowEvidence || typeof rowEvidence !== 'object') {
    return {
      schema: ADAPTER_SCHEMA,
      kind: 'live_harness_evidence',
      available: false,
      fixture_id: null,
      row_id: null,
      outcome: null,
      reason_code: null,
      run_id: null,
      task_id: null,
      model_policy: null,
      agent_mode: null,
      verifier_ok: null,
      privacy_ok: null,
      status_ok: null,
      attach_ok: null,
    };
  }
  return {
    schema: ADAPTER_SCHEMA,
    kind: 'live_harness_evidence',
    available: true,
    fixture_id: rowEvidence.fixture_id == null ? null : String(rowEvidence.fixture_id),
    row_id: rowEvidence.row_id == null ? null : String(rowEvidence.row_id),
    outcome: rowEvidence.outcome == null ? null : String(rowEvidence.outcome),
    reason_code: rowEvidence.reason_code == null ? null : String(rowEvidence.reason_code),
    run_id: rowEvidence.run_id == null ? null : String(rowEvidence.run_id),
    task_id: rowEvidence.task_id == null ? null : String(rowEvidence.task_id),
    model_policy: rowEvidence.model_policy == null
      ? (rowEvidence.model_policy_resolved == null ? null : String(rowEvidence.model_policy_resolved))
      : String(rowEvidence.model_policy),
    agent_mode: rowEvidence.agent_mode == null ? null : String(rowEvidence.agent_mode),
    verifier_ok: rowEvidence.verifier && typeof rowEvidence.verifier === 'object'
      ? Boolean(rowEvidence.verifier.ok)
      : null,
    privacy_ok: rowEvidence.privacy && typeof rowEvidence.privacy === 'object'
      ? Boolean(rowEvidence.privacy.ok)
      : null,
    status_ok: rowEvidence.status && typeof rowEvidence.status === 'object'
      ? Boolean(rowEvidence.status.ok)
      : null,
    attach_ok: rowEvidence.attach && typeof rowEvidence.attach === 'object'
      ? Boolean(rowEvidence.attach.ok)
      : null,
    artifact_paths: Array.isArray(rowEvidence.artifact_paths) ? rowEvidence.artifact_paths : [],
    message: rowEvidence.message == null ? null : String(rowEvidence.message),
  };
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
  adaptGuidedLauncher,
  adaptLiveHarnessEvidence,
  adaptNavigationActions,
  adaptCockpitNavigationActions,
  adaptShellNavigation,
  formatNonTtyGuidance,
};
