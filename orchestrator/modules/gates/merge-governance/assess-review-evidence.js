"use strict";

const { summarizeReviewRecordsFromRows } = require("../../../review-record");

const REVIEW_GATED_ACTIONS = new Set(["pr_ready", "attach_evidence"]);
const MAX_OPEN_BLOCKERS = 8;
const MAX_BLOCKER_LEN = 300;

/**
 * @param {unknown} input
 * @returns {object[]}
 */
function normalizeReviewRows(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((row) => row && typeof row === "object");
}

/**
 * @param {ReturnType<typeof summarizeReviewRecordsFromRows>} summary
 * @returns {string[]}
 */
function collectOpenBlockers(summary) {
  /** @type {string[]} */
  const blockers = [];
  for (const rec of summary.records || []) {
    if (rec.verdict !== "block" && rec.verdict !== "request_changes") continue;
    for (const b of rec.blockers || []) {
      const t = String(b || "").trim();
      if (!t || blockers.length >= MAX_OPEN_BLOCKERS) continue;
      blockers.push(t.length <= MAX_BLOCKER_LEN ? t : `${t.slice(0, MAX_BLOCKER_LEN - 1)}…`);
    }
  }
  return blockers;
}

/**
 * @param {object[]} rows
 * @returns {Record<string, unknown>}
 */
function buildReviewEvidencePayload(rows) {
  const summary = summarizeReviewRecordsFromRows(rows);
  const open_blockers = collectOpenBlockers(summary);

  return {
    cerberus_verdict: summary.cerberus_verdict,
    qa_verdict: summary.qa_verdict,
    final_verdict: summary.final_verdict,
    open_blocker_count: open_blockers.length,
    open_blockers,
    review_record_count: summary.records.length,
    has_cerberus_record: summary.records.some((r) => r.reviewer_role === "cerberus"),
    has_qa_record: summary.records.some((r) => r.reviewer_role === "qa"),
    browser_verification_pending: Boolean(summary.browser_verification_pending),
  };
}

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
function reviewEvidenceRefs(rows) {
  /** @type {string[]} */
  const refs = [];
  for (const row of rows) {
    if (!row || row.event !== "review_record") continue;
    const role = row.reviewer_role != null ? String(row.reviewer_role) : "unknown";
    const verdict = row.verdict != null ? String(row.verdict) : "unknown";
    const iter = Number.isFinite(row.iteration) ? Math.floor(row.iteration) : "?";
    refs.push(`review_record:${role}:${verdict}:i${iter}`);
  }
  return refs.slice(0, 16);
}

/**
 * Pure assessment: durable review_record rows → governance evidence + optional gate override.
 *
 * @param {object} input
 * @returns {{ evidence: Record<string, unknown>, gate: { decision: string, reason_code: string, workflow_state: string | null } | null, evidence_refs: string[] }}
 */
function assessReviewEvidenceForGovernance(input) {
  const attemptedAction = input.attempted_action != null ? String(input.attempted_action) : "pr_ready";

  if (input.review_records == null && input.require_review_evidence !== true) {
    return { evidence: null, gate: null, evidence_refs: [] };
  }

  const rows = normalizeReviewRows(input.review_records);
  const evidence = buildReviewEvidencePayload(rows);
  const evidence_refs = reviewEvidenceRefs(rows);

  if (!REVIEW_GATED_ACTIONS.has(attemptedAction)) {
    return { evidence, gate: null, evidence_refs };
  }

  const governedTarget = Boolean(input.release_sensitive) || input.require_review_evidence === true;

  if (!governedTarget && rows.length === 0) {
    return { evidence, gate: null, evidence_refs };
  }

  if (rows.length === 0 && governedTarget) {
    return {
      evidence,
      gate: {
        decision: "requires_manual_policy_input",
        reason_code: "REVIEW_EVIDENCE_MISSING",
        workflow_state: null,
      },
      evidence_refs,
    };
  }

  if (evidence.cerberus_verdict === "block") {
    return {
      evidence,
      gate: {
        decision: "blocked",
        reason_code: "REVIEW_RECORD_BLOCKERS",
        workflow_state: null,
      },
      evidence_refs,
    };
  }

  if (evidence.cerberus_verdict === "request_changes" && attemptedAction === "pr_ready") {
    return {
      evidence,
      gate: {
        decision: "blocked",
        reason_code: "REVIEW_CHANGES_PENDING",
        workflow_state: null,
      },
      evidence_refs,
    };
  }

  if (
    attemptedAction === "pr_ready" &&
    governedTarget &&
    !evidence.has_cerberus_record
  ) {
    return {
      evidence,
      gate: {
        decision: "requires_manual_policy_input",
        reason_code: "REVIEW_EVIDENCE_MISSING",
        workflow_state: null,
      },
      evidence_refs,
    };
  }

  return { evidence, gate: null, evidence_refs };
}

module.exports = {
  REVIEW_GATED_ACTIONS,
  assessReviewEvidenceForGovernance,
  buildReviewEvidencePayload,
  reviewEvidenceRefs,
};
