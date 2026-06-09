"use strict";

/**
 * Durable review records for QA/CERBERUS — structured trace events (no raw prompt/output).
 * See docs/orchestrator/review-record-contract.md
 */

const { parseCerberusTripleTemplate, cerberusFindingHasAnchor } = require("../../agents/validate-output");

const REVIEW_SCHEMA_VERSION = "1";
const MAX_NOTE_LEN = 300;
const MAX_BLOCKERS = 8;
const MAX_EVIDENCE_REFS = 16;
const FINDING_KEYWORD_RE = /\b(blocker|improvement|nice-to-have)\b/i;
const NOTE_MISSING_TRIPLE = "review output did not match required triple template";
const NOTE_UNSTRUCTURED_FINDING = "review output not in triple template; structured verdict unavailable";
const QA_BROWSER_VERIFIED_RE = /browser[_\s-]?verified|playwright|browser execution/i;
const QA_BROWSER_NEGATIVE_RE =
  /browser (?:qa|execution|verification).{0,80}(?:not performed|pending|required|manual|skipped|missing)/i;

function qaBrowserEvidenceClaimed(output) {
  const text = String(output || "");
  if (QA_BROWSER_NEGATIVE_RE.test(text)) return false;
  return QA_BROWSER_VERIFIED_RE.test(text);
}

function deriveQaVerificationLevel(reviewerRole, output, gateBlocked, verdict) {
  if (reviewerRole !== "qa" || gateBlocked || verdict === "block") return null;
  if (qaBrowserEvidenceClaimed(output)) return "browser_verified";
  if (verdict === "approve") return "static_pass_browser_pending";
  return null;
}

function normalizeFindingVal(s) {
  return String(s || "").trim().toLowerCase().replace(/[()]/g, "");
}

function isVacuousFindingVal(val) {
  const n = normalizeFindingVal(val);
  if (!n) return true;
  return ["none", "n/a", "na", "n.a.", "no", "...", "-"].includes(n);
}

function truncateNote(s) {
  const t = String(s || "").trim();
  if (t.length <= MAX_NOTE_LEN) return t;
  return `${t.slice(0, MAX_NOTE_LEN - 1)}…`;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractEvidenceRefs(text) {
  const refs = [];
  const patterns = [
    /\b[\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|tf|yaml|yml|json|md)\b/gi,
    /\/[\w.-]+(?:\/[\w.-]+)+/g,
  ];
  for (const re of patterns) {
    for (const m of String(text || "").matchAll(re)) {
      const v = m[0];
      if (v && !refs.includes(v) && refs.length < MAX_EVIDENCE_REFS) refs.push(v);
    }
  }
  return refs;
}

/**
 * @param {{
 *   reviewerRole: string,
 *   output?: string,
 *   iteration: number,
 *   stepId?: string | null,
 *   reviewedArtifactIds?: string[],
 *   gateBlocked?: boolean,
 *   gateReason?: string,
 * }} input
 * @returns {object}
 */
function buildReviewRecord(input) {
  const {
    reviewerRole,
    output = "",
    iteration,
    stepId = null,
    reviewedArtifactIds = [],
    gateBlocked = false,
    gateReason = "",
  } = input;

  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const nonBlockingNotes = [];

  if (gateBlocked) {
    const reason = truncateNote(gateReason || "output contract or gate failure");
    if (reason) blockers.push(reason);
  } else {
    const triple = parseCerberusTripleTemplate(output);
    if (triple) {
      if (!isVacuousFindingVal(triple.blocker)) blockers.push(truncateNote(triple.blocker));
      if (!isVacuousFindingVal(triple.improvement)) {
        nonBlockingNotes.push(truncateNote(`improvement: ${triple.improvement}`));
      }
      if (!isVacuousFindingVal(triple.nice)) {
        nonBlockingNotes.push(truncateNote(`nice-to-have: ${triple.nice}`));
      }
    } else {
      const trimmed = String(output).trim();
      if (!trimmed) {
        blockers.push("review output empty or missing");
      } else if (FINDING_KEYWORD_RE.test(output)) {
        nonBlockingNotes.push(truncateNote(NOTE_UNSTRUCTURED_FINDING));
      } else {
        blockers.push(truncateNote(NOTE_MISSING_TRIPLE));
      }
    }
  }

  /** @type {"approve"|"request_changes"|"block"} */
  let verdict = "approve";
  if (gateBlocked || blockers.length > 0) verdict = "block";
  else if (nonBlockingNotes.length > 0) verdict = "request_changes";

  const qa_verification_level = deriveQaVerificationLevel(reviewerRole, output, gateBlocked, verdict);

  const evidenceText = [...blockers, ...nonBlockingNotes].join("\n");
  const evidence_refs = extractEvidenceRefs(evidenceText).filter(
    (ref) => cerberusFindingHasAnchor(ref) || ref.includes("/"),
  );

  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    reviewer_role: reviewerRole,
    verdict,
    blockers: blockers.slice(0, MAX_BLOCKERS),
    non_blocking_notes: nonBlockingNotes.slice(0, MAX_BLOCKERS),
    evidence_refs,
    reviewed_artifact_ids: reviewedArtifactIds.slice(0, MAX_BLOCKERS),
    iteration,
    step_id: stepId,
    ...(qa_verification_level ? { qa_verification_level } : {}),
  };
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {ReturnType<typeof buildReviewRecord>} record
 */
function traceReviewRecord(traceEvent, taskId, record) {
  if (!record || typeof record !== "object") return;
  traceEvent(taskId, {
    event: "review_record",
    review_schema_version: record.schema_version,
    reviewer_role: record.reviewer_role,
    verdict: record.verdict,
    blockers: record.blockers,
    non_blocking_notes: record.non_blocking_notes,
    evidence_refs: record.evidence_refs,
    reviewed_artifact_ids: record.reviewed_artifact_ids,
    iteration: record.iteration,
    ...(record.step_id ? { step_id: record.step_id } : {}),
    ...(record.qa_verification_level ? { qa_verification_level: record.qa_verification_level } : {}),
  });
}

/**
 * @param {object[]} rows
 * @returns {{ records: object[], final_verdict: string | null, cerberus_verdict: string | null, qa_verdict: string | null }}
 */
function summarizeReviewRecordsFromRows(rows) {
  /** @type {object[]} */
  const records = [];
  for (const r of rows) {
    if (!r || r.event !== "review_record") continue;
    records.push({
      reviewer_role: r.reviewer_role,
      verdict: r.verdict,
      blockers: Array.isArray(r.blockers) ? r.blockers : [],
      non_blocking_notes: Array.isArray(r.non_blocking_notes) ? r.non_blocking_notes : [],
      evidence_refs: Array.isArray(r.evidence_refs) ? r.evidence_refs : [],
      reviewed_artifact_ids: Array.isArray(r.reviewed_artifact_ids) ? r.reviewed_artifact_ids : [],
      iteration: typeof r.iteration === "number" ? r.iteration : null,
      step_id: typeof r.step_id === "string" ? r.step_id : null,
      ...(typeof r.qa_verification_level === "string" ? { qa_verification_level: r.qa_verification_level } : {}),
    });
  }

  let cerberus_verdict = null;
  let qa_verdict = null;
  let qa_verification_level = null;
  for (const rec of records) {
    if (rec.reviewer_role === "cerberus") cerberus_verdict = rec.verdict;
    if (rec.reviewer_role === "qa") {
      qa_verdict = rec.verdict;
      if (rec.qa_verification_level) qa_verification_level = rec.qa_verification_level;
    }
  }
  const final_verdict = cerberus_verdict ?? qa_verdict;
  const browser_verification_pending = qa_verification_level === "static_pass_browser_pending";
  const all_p0_p1_verified_claim_safe = cerberus_verdict === "approve" && !browser_verification_pending;

  return {
    records,
    final_verdict,
    cerberus_verdict,
    qa_verdict,
    qa_verification_level,
    browser_verification_pending,
    all_p0_p1_verified_claim_safe,
  };
}

module.exports = {
  REVIEW_SCHEMA_VERSION,
  buildReviewRecord,
  traceReviewRecord,
  summarizeReviewRecordsFromRows,
  isVacuousFindingVal,
};
