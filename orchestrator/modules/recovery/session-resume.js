"use strict";

/**
 * Durable session resume semantics — evaluate checkpoints and explain blockers.
 * Detect/explain/resume-gate only; no auto-resume. See docs/orchestrator/session-resume-contract.md
 */

const { summarizeReviewRecordsFromRows } = require("../../review-record");
const { summarizeRecoveryFromRows } = require("./recovery-sweep");
const { aggregatePermissionChecksFromTraceRows } = require("../../security/permission-check-summary");
const {
  governanceOwnershipHandoffUnresolved,
  governanceRunnerShouldHold,
} = require("../../governance-gate");

const SESSION_RESUME_SCHEMA_VERSION = "1";
const MAX_BLOCKERS = 16;
const MAX_DESC_LEN = 300;

/** @typedef {"open_review_blockers"|"recovery_not_clean"|"stale_handoff_contract"|"incomplete_handoff_contract"|"governance_hold"|"permission_profile_changed"|"permission_policy_changed"|"incomplete_checkpoint"|"side_effects_require_revalidation"} ResumeBlockCode */

/**
 * @param {string} s
 * @returns {string}
 */
function truncateDesc(s) {
  const t = String(s || "").trim();
  if (t.length <= MAX_DESC_LEN) return t;
  return `${t.slice(0, MAX_DESC_LEN - 1)}…`;
}

/**
 * Interrupted runs expect no session_end; missing_session_end alone must not block resume.
 * @param {{ clean?: boolean, findings?: object[] }} recovery
 * @param {boolean} sessionComplete
 * @returns {boolean}
 */
function recoveryCleanForResume(recovery, sessionComplete) {
  if (!recovery || recovery.clean === true) return true;
  const findings = Array.isArray(recovery.findings) ? recovery.findings : [];
  const blocking = findings.filter((f) => {
    if (sessionComplete === false && f && (
      f.finding_kind === "missing_session_end"
      || f.finding_kind === "missing_iteration_done"
    )) return false;
    return true;
  });
  return blocking.length === 0;
}

/**
 * @param {object[]} rows
 * @returns {object | null}
 */
function lastSessionStart(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.event === "session_start") return r;
  }
  return null;
}

/**
 * @param {object[]} rows
 * @returns {object | null}
 */
function lastSessionEnd(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.event === "session_end") return r;
  }
  return null;
}

/**
 * @param {object[]} rows
 * @returns {string | null}
 */
function lastHandoffContractRef(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r) continue;
    if (typeof r.handoff_contract_ref === "string" && r.handoff_contract_ref.length) {
      return r.handoff_contract_ref;
    }
    if (r.event === "approval_granted" && typeof r.handoff_contract_ref === "string") {
      return r.handoff_contract_ref;
    }
  }
  return null;
}

/**
 * Build a resume checkpoint snapshot from trace rows (post-hoc / export).
 * @param {object[]} rows
 * @returns {object}
 */
function buildSessionCheckpointFromRows(rows) {
  const safe = Array.isArray(rows) ? rows : [];
  const ss = lastSessionStart(safe);
  const se = lastSessionEnd(safe);
  const review = summarizeReviewRecordsFromRows(safe);
  const recovery = summarizeRecoveryFromRows(safe);
  const perm = aggregatePermissionChecksFromTraceRows(safe);

  const iterDone = safe.filter((r) => r && r.event === "iteration_done");
  const lastIter = iterDone.length ? iterDone[iterDone.length - 1] : null;
  const lastAgentDone = [...safe].reverse().find((r) => r && r.event === "agent_done");

  const pEnd = se && typeof se.ollama_prompt_tokens_total === "number" ? se.ollama_prompt_tokens_total : null;
  const cEnd = se && typeof se.ollama_completion_tokens_total === "number"
    ? se.ollama_completion_tokens_total
    : null;

  const handoffRef = lastHandoffContractRef(safe);
  const ownershipUnresolved = governanceOwnershipHandoffUnresolved(safe);
  const governanceHold = governanceRunnerShouldHold(safe);

  /** @type {string[]} */
  const unresolved_blockers = [];
  for (const rec of review.records) {
    if (rec.verdict !== "block" && rec.verdict !== "request_changes") continue;
    for (const b of rec.blockers) {
      if (typeof b === "string" && b.length && unresolved_blockers.length < MAX_BLOCKERS) {
        unresolved_blockers.push(b);
      }
    }
  }

  return {
    session_resume_schema_version: SESSION_RESUME_SCHEMA_VERSION,
    task_id: ss && typeof ss.task_id === "string" ? ss.task_id : null,
    resume_of_task_id: ss && typeof ss.resume_of_task_id === "string" ? ss.resume_of_task_id : null,
    scenario_id: ss && typeof ss.scenario_id === "string" ? ss.scenario_id : null,
    active_goal: ss && typeof ss.goal === "string" ? ss.goal : null,
    active_step_id: lastAgentDone && typeof lastAgentDone.step_id === "string"
      ? lastAgentDone.step_id
      : (lastIter && typeof lastIter.step_id === "string" ? lastIter.step_id : null),
    active_role: lastAgentDone && typeof lastAgentDone.agent === "string" ? lastAgentDone.agent : null,
    iteration: typeof lastIter?.iteration === "number" ? lastIter.iteration : null,
    approved_artifact_ids: Array.isArray(se?.approved_artifact_ids)
      ? se.approved_artifact_ids.slice(0, 16)
      : [],
    compact_handoff_available: safe.some((r) => r && r.event === "compact_handoff_fallback")
      || safe.some((r) => r && r.event === "mcp_call" && r.tool === "compact_handoff"),
    handoff_contract: {
      ref: handoffRef,
      accepted: handoffRef != null && !ownershipUnresolved,
      stale: ownershipUnresolved || governanceHold,
      incomplete: handoffRef == null && ownershipUnresolved,
    },
    review_summary: {
      record_count: review.records.length,
      last_verdict: review.final_verdict,
      open_blockers: unresolved_blockers,
    },
    permission_checkpoint: {
      permission_profile: se?.permission_profile != null
        ? String(se.permission_profile)
        : (ss?.permission_profile != null ? String(ss.permission_profile) : null),
      policy_source: se?.policy_source != null ? String(se.policy_source) : null,
      permission_check_total: perm.permission_check_total,
    },
    cost_checkpoint: {
      ollama_prompt_tokens: pEnd,
      ollama_completion_tokens: cEnd,
      basis: pEnd != null || cEnd != null ? "session_end_totals" : "unknown",
    },
    recovery_clean: recoveryCleanForResume(recovery, se != null),
    recovery_summary: recovery.summary,
    session_complete: se != null,
  };
}

/**
 * @param {object} checkpoint
 * @param {{ current_permission_profile?: string | null, current_policy_source?: string | null, require_session_incomplete?: boolean }} [opts]
 * @returns {{ eligible: boolean, block_codes: ResumeBlockCode[], summary: string, side_effects_require_revalidation: boolean }}
 */
function evaluateResumeEligibility(checkpoint, opts = {}) {
  const cp = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
  /** @type {ResumeBlockCode[]} */
  const block_codes = [];

  if (!cp.task_id) {
    block_codes.push("incomplete_checkpoint");
  }

  if (opts.require_session_incomplete !== false && cp.session_complete === true) {
    block_codes.push("incomplete_checkpoint");
  }

  if (cp.recovery_clean === false) {
    block_codes.push("recovery_not_clean");
  }

  const openBlockers = cp.review_summary && Array.isArray(cp.review_summary.open_blockers)
    ? cp.review_summary.open_blockers
    : [];
  if (openBlockers.length > 0) {
    block_codes.push("open_review_blockers");
  }

  const hc = cp.handoff_contract && typeof cp.handoff_contract === "object" ? cp.handoff_contract : {};
  if (hc.incomplete === true) {
    block_codes.push("incomplete_handoff_contract");
  } else if (hc.stale === true) {
    block_codes.push("stale_handoff_contract");
  }

  if (governanceRunnerShouldHoldFromCheckpoint(cp)) {
    block_codes.push("governance_hold");
  }

  const profile = cp.permission_checkpoint && cp.permission_checkpoint.permission_profile;
  if (
    opts.current_permission_profile != null
    && profile != null
    && String(opts.current_permission_profile) !== String(profile)
  ) {
    block_codes.push("permission_profile_changed");
  }

  const policy = cp.permission_checkpoint && cp.permission_checkpoint.policy_source;
  if (
    opts.current_policy_source != null
    && policy != null
    && String(opts.current_policy_source) !== String(policy)
  ) {
    block_codes.push("permission_policy_changed");
  }

  const side_effects_require_revalidation = true;

  const eligible = block_codes.length === 0;

  let summary;
  if (eligible) {
    summary = "Resume allowed from checkpoint; re-evaluate permissions before side effects";
  } else {
    summary = `Resume blocked: ${block_codes.join(", ")}`;
  }

  return {
    eligible,
    block_codes,
    summary: truncateDesc(summary),
    side_effects_require_revalidation,
  };
}

/**
 * @param {object} cp
 * @returns {boolean}
 */
function governanceRunnerShouldHoldFromCheckpoint(cp) {
  if (!cp || typeof cp !== "object") return false;
  const hc = cp.handoff_contract;
  if (hc && hc.stale === true) return true;
  return false;
}

/**
 * @param {object[]} rows
 * @param {{ current_permission_profile?: string | null, current_policy_source?: string | null }} [opts]
 */
function summarizeSessionResumeFromRows(rows, opts = {}) {
  const safe = Array.isArray(rows) ? rows : [];
  const checkpoint = buildSessionCheckpointFromRows(safe);
  const evaluation = evaluateResumeEligibility(checkpoint, {
    ...opts,
    require_session_incomplete: true,
  });

  const resume_requested = safe.some((r) => r && r.event === "session_resume_requested");
  const resume_loaded = safe.some((r) => r && r.event === "session_resume_loaded");
  const resume_blocked = safe.some((r) => r && r.event === "session_resume_blocked");

  return {
    policy: "explicit_operator_resume_only",
    checkpoint,
    ...evaluation,
    trace_signals: {
      checkpoint_created: safe.some((r) => r && r.event === "session_checkpoint_created"),
      resume_requested,
      resume_loaded,
      resume_blocked,
      is_resume_run: checkpoint.resume_of_task_id != null,
    },
    computed_from: "full_trace",
  };
}

/**
 * @param {object} checkpoint
 * @returns {string}
 */
function requireCheckpointTaskId(checkpoint) {
  const taskId = checkpoint && typeof checkpoint.task_id === "string" ? checkpoint.task_id.trim() : "";
  if (!taskId.length) {
    throw new Error("session resume trace event requires checkpoint.task_id");
  }
  return taskId;
}

/**
 * @param {object} checkpoint
 * @param {object} evaluation from evaluateResumeEligibility
 * @returns {object}
 */
function buildSessionCheckpointCreatedEvent(checkpoint, evaluation) {
  const task_id = requireCheckpointTaskId(checkpoint);
  return {
    event: "session_checkpoint_created",
    session_resume_schema_version: SESSION_RESUME_SCHEMA_VERSION,
    task_id,
    eligible: evaluation.eligible,
    block_codes: evaluation.block_codes,
    summary: evaluation.summary,
  };
}

/**
 * @param {object} checkpoint
 * @param {object} evaluation
 * @returns {object}
 */
function buildSessionResumeBlockedEvent(checkpoint, evaluation) {
  const task_id = requireCheckpointTaskId(checkpoint);
  return {
    event: "session_resume_blocked",
    session_resume_schema_version: SESSION_RESUME_SCHEMA_VERSION,
    task_id,
    resume_of_task_id: checkpoint.resume_of_task_id ?? null,
    block_codes: evaluation.block_codes,
    summary: evaluation.summary,
  };
}

module.exports = {
  SESSION_RESUME_SCHEMA_VERSION,
  buildSessionCheckpointFromRows,
  evaluateResumeEligibility,
  summarizeSessionResumeFromRows,
  buildSessionCheckpointCreatedEvent,
  buildSessionResumeBlockedEvent,
};
