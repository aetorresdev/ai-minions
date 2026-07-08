#!/usr/bin/env node
/**
 * Operator-facing trace summary — critical decision fields for status/explain/doctor/evidence.
 * Read-only consumption over existing trace JSONL; wraps run_outcome_summary (no second SoT).
 */

"use strict";

const { buildRunOutcomeSummary } = require("../trace/run-outcome-summary");

const OPERATOR_TRACE_SUMMARY_SCHEMA = "1";
const RUN_STATE_VISIBILITY_SCHEMA = "1";

/** @typedef {'RUN_FOUND'|'RUN_NOT_FOUND'|'RUN_TRACE_INVALID'|'RUN_STATE_UNKNOWN'} RunStateResultCode */

/**
 * @param {{ trace_file?: string | null, report_path?: string | null, attach_bundle_path?: string | null }} meta
 * @returns {object}
 */
function buildEmptyOperatorTraceSummary(meta = {}) {
  return {
    schema_version: OPERATOR_TRACE_SUMMARY_SCHEMA,
    run_id: null,
    outcome: "unknown",
    current_phase: null,
    applicable_contract: null,
    risk_category: "unknown",
    blocked_gates: [],
    permission_denials: [],
    degraded_mode: { active: false, reason_codes: [] },
    cerberus: { verdict: null, evidence_ref: null },
    policy_decision: { decision: null, reason_code: null, policy_source: null },
    budget: { tokens: null, estimated_cost: null, confidence: null },
    artifacts: {
      trace: meta.trace_file != null ? meta.trace_file : null,
      report: meta.report_path != null ? meta.report_path : null,
      attach_bundle: meta.attach_bundle_path != null ? meta.attach_bundle_path : null,
    },
    missing_evidence: ["trace_absent_or_empty"],
    next_safe_action: "Provide --run-id or --file pointing to a completed trace JSONL, then re-run status.",
  };
}

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
function hasSessionEnd(rows) {
  return rows.some((r) => r && r.event === "session_end");
}

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
function hasSessionStart(rows) {
  return rows.some((r) => r && r.event === "session_start");
}

/**
 * @param {object[]} rows
 * @returns {string | null}
 */
function deriveCurrentPhase(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r) continue;
    if (r.event === "session_end" && r.done === true) return "complete";
    if (typeof r.phase === "string" && r.phase.length) return r.phase;
    if (r.event === "mode_advanced" && typeof r.to_mode === "string") return r.to_mode;
    if (r.event === "agent_done" && typeof r.agent === "string") return r.agent;
  }
  return hasSessionEnd(rows) ? "session_end" : null;
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {string | null}
 */
function deriveApplicableContract(ros) {
  const flow = ros.where.flow_mode;
  if (typeof flow !== "string" || !flow.length) return "agent-contract";
  return `${flow} / agent-contract`;
}

/**
 * @param {object} summary
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {"unknown"|"standard"|"elevated"|"degraded"|"blocked"}
 */
function deriveRiskCategory(summary, ros) {
  if (summary.outcome === "blocked") return "blocked";
  if (summary.outcome === "degraded" || summary.degraded_mode.active) return "degraded";
  if (summary.permission_denials.length > 0) return "elevated";
  if (typeof ros.why.gate_blocks === "number" && ros.why.gate_blocks > 0) return "elevated";
  if (summary.outcome === "unknown") return "unknown";
  return "standard";
}

/**
 * @param {object[]} rows
 * @returns {{ active: boolean, reason_codes: string[] }}
 */
function deriveDegradedMode(rows, ros) {
  /** @type {string[]} */
  const reason_codes = [];
  for (const r of rows) {
    if (r && r.event === "degraded_mode") {
      const code = typeof r.reason === "string" && r.reason.length
        ? r.reason
        : (typeof r.reason_code === "string" ? r.reason_code : "degraded_mode");
      if (!reason_codes.includes(code)) reason_codes.push(code);
    }
  }
  if (ros.qa.qa_degraded && !reason_codes.includes("qa_degraded")) reason_codes.push("qa_degraded");
  if (ros.qa.handoff_fallback_used && !reason_codes.includes("handoff_fallback_used")) {
    reason_codes.push("handoff_fallback_used");
  }
  return { active: reason_codes.length > 0, reason_codes };
}

/**
 * @param {object[]} rows
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {string[]}
 */
function deriveBlockedGates(rows, ros) {
  /** @type {string[]} */
  const gates = [];
  if (typeof ros.why.gate_blocks === "number" && ros.why.gate_blocks > 0) {
    gates.push(`gate_blocks:${ros.why.gate_blocks}`);
  }
  for (const f of ros.model_tier_gate?.findings || []) {
    const id = ros.model_tier_gate?.gate_id || "model_tier_gate";
    const rc = typeof f.reason_code === "string" ? f.reason_code : "denied";
    const label = `${id}:${rc}`;
    if (!gates.includes(label)) gates.push(label);
  }
  for (const r of rows) {
    if (r && r.event === "budget_block" && typeof r.reason_code === "string") {
      const label = `budget_block:${r.reason_code}`;
      if (!gates.includes(label)) gates.push(label);
    }
  }
  if (ros.review?.cerberus_verdict === "block") gates.push("cerberus:block");
  else if (ros.review?.cerberus_verdict === "request_changes") gates.push("cerberus:request_changes");
  return gates;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function derivePermissionDenials(rows) {
  /** @type {object[]} */
  const denials = [];
  for (const r of rows) {
    if (!r || r.event !== "permission_check") continue;
    if (r.decision !== "deny" && r.decision !== "requires_approval") continue;
    denials.push({
      tool: typeof r.tool === "string" ? r.tool : null,
      role: typeof r.role === "string" ? r.role : null,
      decision: r.decision,
      reason_code: typeof r.reason_code === "string" ? r.reason_code : null,
      policy_source: typeof r.policy_source === "string" ? r.policy_source : null,
    });
  }
  return denials;
}

/**
 * @param {object[]} rows
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {{ decision: string | null, reason_code: string | null, policy_source: string | null }}
 */
function derivePolicyDecision(rows, ros) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || r.event !== "permission_check") continue;
    if (r.decision === "deny" || r.decision === "requires_approval") {
      return {
        decision: r.decision,
        reason_code: typeof r.reason_code === "string" ? r.reason_code : null,
        policy_source: typeof r.policy_source === "string" ? r.policy_source : null,
      };
    }
  }
  const tr = ros.what.last_transition_reason;
  if (tr && typeof tr.reason_code === "string" && tr.reason_code.length) {
    return {
      decision: tr.type != null ? String(tr.type).toLowerCase() : "transition",
      reason_code: tr.reason_code,
      policy_source: "iteration_transition",
    };
  }
  const mtg = ros.model_tier_gate?.findings?.[0];
  if (mtg && typeof mtg.reason_code === "string") {
    return {
      decision: "deny",
      reason_code: mtg.reason_code,
      policy_source: "model_tier_gate",
    };
  }
  return { decision: null, reason_code: null, policy_source: null };
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {{ tokens: number | null, estimated_cost: number | null, confidence: string | null }}
 */
function deriveBudget(ros) {
  const tokens = typeof ros.cost.ollama_total_tokens === "number" ? ros.cost.ollama_total_tokens : null;
  const usd = ros.cost.usd_estimate;
  const estimated_cost = usd && typeof usd.usd_total_estimate === "number"
    ? usd.usd_total_estimate
    : null;
  const confidence = estimated_cost != null
    ? (typeof ros.cost.basis === "string" ? ros.cost.basis : "estimate")
    : null;
  return { tokens, estimated_cost, confidence };
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @param {object[]} rows
 * @returns {string[]}
 */
function deriveMissingEvidence(ros, rows) {
  /** @type {string[]} */
  const missing = [];
  if (!hasSessionEnd(rows)) missing.push("session_end");
  if (ros.review?.browser_verification_pending) missing.push("browser_verification");
  if (ros.qa.manual_review_recommended) missing.push("manual_review");
  if (ros.recovery && ros.recovery.clean === false) {
    const hasErrorFinding = (ros.recovery.findings || []).some((f) => f.severity === "error");
    if (hasErrorFinding || (ros.recovery.blocks_auto_recovery && ros.what.done !== true)) {
      missing.push("recovery_findings");
    }
  }
  if (ros.review?.cerberus_verdict === "block" && !(ros.review.records || []).some(
    (rec) => rec.reviewer_role === "cerberus" && rec.evidence_refs && rec.evidence_refs.length,
  )) {
    missing.push("cerberus_evidence_refs");
  }
  return missing;
}

/**
 * @param {string} outcome
 * @param {object} summary
 * @returns {string}
 */
function deriveNextSafeAction(outcome, summary) {
  if (outcome === "unknown") {
    return "Inspect trace path and ensure run finished with session_end; use explain-run or doctor.";
  }
  if (outcome === "blocked") {
    if (summary.cerberus.verdict === "block" || summary.cerberus.verdict === "request_changes") {
      return "Read explain output for blockers; fix findings; do not merge until CERBERUS evidence is satisfied.";
    }
    if (summary.blocked_gates.length) {
      return "Resolve blocked gates listed above; re-run with gates enabled or fix policy/config.";
    }
    return "Review blocked_gates and permission_denials; remediate before advancing the run.";
  }
  if (outcome === "degraded") {
    return "Treat run as degraded: inspect reason_codes, attach trace to issue, avoid claiming full gate coverage.";
  }
  if (outcome === "failed") {
    return "Run explain-run for failure taxonomy; fix root cause; start a new run with corrected goal/config.";
  }
  if (summary.missing_evidence.length) {
    return "Complete missing evidence checks before external beta claims; see missing_evidence list.";
  }
  return "Run may advance; attach trace and report bundle if handing off to review.";
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @param {object[]} rows
 * @param {{ active: boolean, reason_codes: string[] }} degraded
 * @returns {"complete"|"failed"|"blocked"|"degraded"|"unknown"}
 */
function deriveOutcome(ros, rows, degraded) {
  if (!rows.length || !rows.some((r) => r && r.event === "session_start")) return "unknown";
  if (!hasSessionEnd(rows)) return "unknown";

  const blockedGates = deriveBlockedGates(rows, ros);
  const cerb = ros.review?.cerberus_verdict;
  const hardBlock = blockedGates.length > 0
    || cerb === "block"
    || ros.what.last_iteration_outcome === "abort"
    || (typeof ros.why.gate_blocks === "number" && ros.why.gate_blocks > 0);

  if (hardBlock) return "blocked";
  if (degraded.active || ros.qa.qa_degraded) return "degraded";
  if (ros.what.done === true) return "complete";
  if (ros.what.done === false) return "failed";
  return "unknown";
}

/**
 * @param {ReturnType<typeof buildRunOutcomeSummary>} ros
 * @returns {{ verdict: string | null, evidence_ref: string | null }}
 */
function deriveCerberus(ros) {
  const verdict = ros.review?.cerberus_verdict != null ? ros.review.cerberus_verdict : null;
  const records = ros.review?.records || [];
  let evidence_ref = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (rec.reviewer_role !== "cerberus") continue;
    const refs = Array.isArray(rec.evidence_refs) ? rec.evidence_refs : [];
    if (refs.length) {
      evidence_ref = refs[0];
      break;
    }
  }
  return { verdict, evidence_ref };
}

/**
 * @param {object[]} rows
 * @returns {string | null}
 */
function deriveLastSuccessfulPhase(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  /** @type {string | null} */
  let lastSuccess = null;
  for (const r of rows) {
    if (!r) continue;
    if (r.event === "iteration_done" && r.outcome === "done") {
      if (typeof r.phase === "string" && r.phase.length) {
        lastSuccess = r.phase;
      } else if (typeof r.agent === "string" && r.agent.length) {
        lastSuccess = r.agent;
      }
    }
    if (r.event === "agent_done") {
      if (typeof r.phase === "string" && r.phase.length) {
        lastSuccess = r.phase;
      } else if (typeof r.agent === "string" && r.agent.length) {
        lastSuccess = r.agent;
      }
    }
  }

  const ended = rows.find((r) => r && r.event === "session_end");
  if (ended && ended.done === true) {
    return deriveCurrentPhase(rows) ?? lastSuccess;
  }
  return lastSuccess;
}

/**
 * @param {object[]} rows
 * @returns {{
 *   model: string | null,
 *   model_tier: string | null,
 *   model_backend: string | null,
 *   selection_reason: string | null,
 *   availability: 'available' | 'unavailable',
 * }}
 */
function deriveModelSelectionContext(rows) {
  /** @type {object | null} */
  let lastSelection = null;
  /** @type {string | null} */
  let sessionBackend = null;

  for (const r of rows) {
    if (!r) continue;
    if (r.event === "session_start" && typeof r.model_backend === "string" && r.model_backend.length) {
      sessionBackend = r.model_backend;
    }
    if (r.event === "model_selection") {
      lastSelection = r;
    }
  }

  if (!lastSelection) {
    return {
      model: null,
      model_tier: null,
      model_backend: sessionBackend,
      selection_reason: null,
      availability: "unavailable",
    };
  }

  return {
    model: typeof lastSelection.model === "string" ? lastSelection.model : null,
    model_tier: typeof lastSelection.model_tier === "string" ? lastSelection.model_tier : null,
    model_backend: typeof lastSelection.model_backend === "string" && lastSelection.model_backend.length
      ? lastSelection.model_backend
      : sessionBackend,
    selection_reason: typeof lastSelection.selection_reason === "string"
      ? lastSelection.selection_reason
      : null,
    availability: "available",
  };
}

/**
 * @param {object} summary
 * @param {object[]} rows
 * @returns {string | null}
 */
function deriveBlockingReasonCode(summary, rows) {
  if (summary.policy_decision?.reason_code) {
    return summary.policy_decision.reason_code;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || typeof r.reason_code !== "string" || !r.reason_code.length) continue;
    if (
      r.event === "model_tier_gate_denied"
      || r.event === "budget_block"
      || (r.event === "permission_check" && (r.decision === "deny" || r.decision === "requires_approval"))
    ) {
      return r.reason_code;
    }
  }
  if (summary.blocked_gates?.length) {
    const gate = String(summary.blocked_gates[0]);
    const idx = gate.lastIndexOf(":");
    return idx >= 0 ? gate.slice(idx + 1) : gate;
  }
  if (summary.outcome === "failed") return "RUN_FAILED";
  return null;
}

/**
 * @param {object} summary
 * @param {object[]} rows
 * @param {{
 *   attach_bundle?: string | null,
 *   report_path?: string | null,
 *   attach_md?: string | null,
 *   privacy_notice_status?: string | null,
 *   result_code?: RunStateResultCode,
 * }} [meta]
 * @returns {object}
 */
function buildRunStateVisibility(summary, rows, meta = {}) {
  const modelCtx = deriveModelSelectionContext(rows);
  /** @type {string[]} */
  const evidence_paths = [];
  if (summary.artifacts?.trace) evidence_paths.push(summary.artifacts.trace);
  if (meta.report_path) evidence_paths.push(meta.report_path);
  if (meta.attach_md) evidence_paths.push(meta.attach_md);
  if (meta.attach_bundle) evidence_paths.push(meta.attach_bundle);
  if (summary.artifacts?.report && !evidence_paths.includes(summary.artifacts.report)) {
    evidence_paths.push(summary.artifacts.report);
  }

  const attach_available = Boolean(meta.attach_bundle);
  /** @type {RunStateResultCode} */
  let result_code = meta.result_code ?? "RUN_FOUND";
  if (summary.outcome === "unknown" && hasSessionStart(rows) && !hasSessionEnd(rows)) {
    result_code = "RUN_STATE_UNKNOWN";
  }

  return {
    schema_version: RUN_STATE_VISIBILITY_SCHEMA,
    result_code,
    run_id: summary.run_id,
    current_phase: summary.current_phase,
    last_successful_phase: deriveLastSuccessfulPhase(rows),
    blocking_reason_code: deriveBlockingReasonCode(summary, rows),
    next_safe_action: summary.next_safe_action,
    evidence_paths,
    attach_available,
    attach_result_code: attach_available ? "RUN_ATTACH_AVAILABLE" : "RUN_ATTACH_MISSING",
    privacy_notice_status: meta.privacy_notice_status ?? "unknown",
    model: modelCtx.model,
    model_tier: modelCtx.model_tier,
    model_backend: modelCtx.model_backend,
    selection_reason: modelCtx.selection_reason,
    model_selection_availability: modelCtx.availability,
  };
}

/**
 * @param {ReturnType<typeof buildRunStateVisibility>} runState
 * @returns {string[]}
 */
function formatRunStateVisibilityLines(runState) {
  const lines = [
    "-- run_state_visibility --",
    `  result_code:           ${runState.result_code}`,
    `  run_id:                ${runState.run_id ?? "?"}`,
    `  current_phase:         ${runState.current_phase ?? "-"}`,
    `  last_successful_phase: ${runState.last_successful_phase ?? "-"}`,
    `  blocking_reason_code:  ${runState.blocking_reason_code ?? "-"}`,
    `  attach_available:      ${runState.attach_available}`,
    `  attach_result_code:    ${runState.attach_result_code}`,
    `  privacy_notice_status: ${runState.privacy_notice_status}`,
    `  model:                 ${runState.model ?? "unavailable"}`,
    `  model_backend:         ${runState.model_backend ?? "unavailable"}`,
    `  selection_reason:      ${runState.selection_reason ?? "unavailable"}`,
    `  evidence_paths:        ${runState.evidence_paths.length ? runState.evidence_paths.join("; ") : "(none)"}`,
    `  next_safe_action:      ${runState.next_safe_action}`,
    "",
  ];
  return lines;
}

/**
 * @param {object[]} rows — sanitized trace rows
 * @param {{ trace_file?: string | null, report_path?: string | null, attach_bundle_path?: string | null, ollama_usd_estimate?: object | null }} [meta]
 * @returns {object}
 */
function buildOperatorTraceSummary(rows, meta = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return buildEmptyOperatorTraceSummary(meta);
  }

  const ros = buildRunOutcomeSummary(rows, meta);
  const degraded_mode = deriveDegradedMode(rows, ros);
  const blocked_gates = deriveBlockedGates(rows, ros);
  const permission_denials = derivePermissionDenials(rows);
  const cerberus = deriveCerberus(ros);
  const policy_decision = derivePolicyDecision(rows, ros);
  const outcome = deriveOutcome(ros, rows, degraded_mode);
  const missing_evidence = deriveMissingEvidence(ros, rows);

  /** @type {object} */
  const summary = {
    schema_version: OPERATOR_TRACE_SUMMARY_SCHEMA,
    run_id: ros.where.task_id,
    outcome,
    current_phase: deriveCurrentPhase(rows),
    applicable_contract: deriveApplicableContract(ros),
    risk_category: "standard",
    blocked_gates,
    permission_denials,
    degraded_mode,
    cerberus,
    policy_decision,
    budget: deriveBudget(ros),
    artifacts: {
      trace: ros.where.trace_file,
      report: meta.report_path != null ? meta.report_path : null,
      attach_bundle: meta.attach_bundle_path != null ? meta.attach_bundle_path : null,
    },
    missing_evidence,
    next_safe_action: "",
  };

  summary.risk_category = deriveRiskCategory(summary, ros);
  summary.next_safe_action = deriveNextSafeAction(outcome, summary);
  return summary;
}

/**
 * @param {ReturnType<typeof buildOperatorTraceSummary>} summary
 * @returns {string[]}
 */
function formatOperatorTraceSummaryLines(summary) {
  const lines = [];
  lines.push("-- operator_trace_summary (critical decision) --");
  lines.push(`run_id: ${summary.run_id ?? "?"}`);
  lines.push(`outcome: ${summary.outcome}  phase: ${summary.current_phase ?? "-"}  risk: ${summary.risk_category}`);
  lines.push(`contract: ${summary.applicable_contract ?? "-"}`);
  const pd = summary.policy_decision;
  if (pd.reason_code) {
    lines.push(`policy: ${pd.decision ?? "-"}  reason_code: ${pd.reason_code}  source: ${pd.policy_source ?? "-"}`);
  }
  if (summary.degraded_mode.active) {
    lines.push(`degraded: ${summary.degraded_mode.reason_codes.join(", ")}`);
  }
  if (summary.blocked_gates.length) {
    lines.push(`blocked_gates: ${summary.blocked_gates.join("; ")}`);
  }
  if (summary.permission_denials.length) {
    const d0 = summary.permission_denials[0];
    lines.push(`permission_denials: ${summary.permission_denials.length} (first: ${d0.reason_code ?? d0.decision})`);
  }
  lines.push(`cerberus: ${summary.cerberus.verdict ?? "-"}  evidence_ref: ${summary.cerberus.evidence_ref ?? "-"}`);
  const b = summary.budget;
  lines.push(`budget: tokens=${b.tokens ?? "?"}  cost~=${b.estimated_cost ?? "?"}  confidence=${b.confidence ?? "-"}`);
  lines.push(`artifacts: trace=${summary.artifacts.trace ?? "-"}  report=${summary.artifacts.report ?? "-"}  bundle=${summary.artifacts.attach_bundle ?? "-"}`);
  if (summary.missing_evidence.length) {
    lines.push(`missing_evidence: ${summary.missing_evidence.join(", ")}`);
  }
  lines.push(`next_safe_action: ${summary.next_safe_action}`);
  lines.push("");
  return lines;
}

module.exports = {
  OPERATOR_TRACE_SUMMARY_SCHEMA,
  RUN_STATE_VISIBILITY_SCHEMA,
  buildOperatorTraceSummary,
  buildEmptyOperatorTraceSummary,
  buildRunStateVisibility,
  deriveLastSuccessfulPhase,
  deriveModelSelectionContext,
  deriveBlockingReasonCode,
  formatOperatorTraceSummaryLines,
  formatRunStateVisibilityLines,
};
