"use strict";

/**
 * CERBERUS adversarial doubt cycle — structured trace events for claim review.
 * See docs/orchestrator/cerberus-doubt-cycle-contract.md
 */

const { randomUUID } = require("crypto");
const { parseCerberusTripleTemplate } = require("./agents/validate-output");

const DOUBT_REVIEW_SCHEMA_VERSION = "1";
const MAX_CLAIM_LEN = 300;
const MAX_FINDINGS = 12;
const MAX_EVIDENCE_REFS = 16;

/** @typedef {"runtime_contract"|"release_claim"|"security_posture"|"docs_positioning"|"handoff_authority"|"lint_only"} ClaimCategory */

const CLAIM_CATEGORIES = /** @type {const} */ ([
  "runtime_contract",
  "release_claim",
  "security_posture",
  "docs_positioning",
  "handoff_authority",
  "lint_only",
]);

const DOUBT_FINDING_KINDS = /** @type {const} */ ([
  "blocker",
  "improvement",
  "nice_to_have",
  "overclaim_risk",
  "evidence_gap",
]);

const DOUBT_VERDICTS = /** @type {const} */ (["approve", "request_changes", "block"]);

/**
 * Matrix: which claim categories require a doubt_review_* trace (vs lint/docs only).
 *
 * @param {ClaimCategory} category
 */
function claimRequiresDoubtReview(category) {
  return category !== "lint_only";
}

/**
 * Best-effort category from claim text — audit/TUI hint only; not an enforcement gate.
 *
 * @param {string} claim
 * @returns {ClaimCategory}
 */
function inferClaimCategory(claim) {
  const t = String(claim || "").toLowerCase();
  if (/\b(markdownlint|lint|typo|md00)\b/.test(t)) return "lint_only";
  if (/\b(release|alpha|beta|production|shipped|tag)\b/.test(t)) return "release_claim";
  if (/\b(secret|credential|permission|sandbox|security)\b/.test(t)) return "security_posture";
  if (/\b(positioning|open.?spec|langgraph|swarm|framework)\b/.test(t)) return "docs_positioning";
  if (/\b(handoff|approval|proposal|authority|gate)\b/.test(t)) return "handoff_authority";
  if (/\b(contract|trace|schema|runtime|orchestrator|test)\b/.test(t)) return "runtime_contract";
  return "runtime_contract";
}

/**
 * @param {string} s
 */
function truncateClaim(s) {
  const t = String(s || "").trim();
  if (t.length <= MAX_CLAIM_LEN) return t;
  return `${t.slice(0, MAX_CLAIM_LEN - 1)}…`;
}

/**
 * @param {object} opts
 * @param {string} opts.review_id
 * @param {number} [opts.iteration]
 * @param {string} [opts.agent]
 * @param {string} [opts.step_id]
 * @param {number} [opts.claim_count]
 */
function buildDoubtReviewStartedPayload(opts) {
  const review_id = String(opts.review_id || "").slice(0, 64);
  if (review_id.length < 8) throw new Error("review_id required (min 8 chars)");
  return {
    event: "doubt_review_started",
    doubt_review_schema_version: DOUBT_REVIEW_SCHEMA_VERSION,
    agent: String(opts.agent || "cerberus").slice(0, 128),
    iteration: Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0,
    review_id,
    claim_count: Number.isFinite(opts.claim_count)
      ? Math.max(0, Math.floor(/** @type {number} */ (opts.claim_count)))
      : 0,
    ...(opts.step_id ? { step_id: String(opts.step_id).slice(0, 240) } : {}),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.review_id
 * @param {string} opts.claim_id
 * @param {ClaimCategory} opts.claim_category
 * @param {string} opts.claim_summary
 * @param {(typeof DOUBT_FINDING_KINDS)[number]} opts.finding_kind
 * @param {boolean} [opts.evidence_required]
 * @param {string[]} [opts.evidence_refs]
 * @param {number} [opts.iteration]
 */
function buildDoubtReviewFindingPayload(opts) {
  const review_id = String(opts.review_id || "").slice(0, 64);
  const claim_id = String(opts.claim_id || "").slice(0, 64);
  if (review_id.length < 8 || claim_id.length < 8) {
    throw new Error("review_id and claim_id required (min 8 chars)");
  }
  const claim_category = opts.claim_category;
  if (!CLAIM_CATEGORIES.includes(claim_category)) {
    throw new Error(`invalid claim_category: ${claim_category}`);
  }
  const finding_kind = opts.finding_kind;
  if (!DOUBT_FINDING_KINDS.includes(finding_kind)) {
    throw new Error(`invalid finding_kind: ${finding_kind}`);
  }
  return {
    event: "doubt_review_finding",
    doubt_review_schema_version: DOUBT_REVIEW_SCHEMA_VERSION,
    review_id,
    claim_id,
    claim_category,
    claim_summary: truncateClaim(opts.claim_summary),
    finding_kind,
    evidence_required: opts.evidence_required !== false,
    iteration: Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0,
    ...(opts.evidence_refs && opts.evidence_refs.length
      ? { evidence_refs: opts.evidence_refs.map((r) => String(r).slice(0, 240)).slice(0, MAX_EVIDENCE_REFS) }
      : {}),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.review_id
 * @param {(typeof DOUBT_VERDICTS)[number]} opts.verdict
 * @param {number} opts.finding_count
 * @param {number} [opts.iteration]
 * @param {string} [opts.notes]
 */
function buildDoubtReviewVerdictPayload(opts) {
  const review_id = String(opts.review_id || "").slice(0, 64);
  if (review_id.length < 8) throw new Error("review_id required (min 8 chars)");
  const verdict = opts.verdict;
  if (!DOUBT_VERDICTS.includes(verdict)) throw new Error(`invalid doubt verdict: ${verdict}`);
  return {
    event: "doubt_review_verdict",
    doubt_review_schema_version: DOUBT_REVIEW_SCHEMA_VERSION,
    review_id,
    verdict,
    finding_count: Number.isFinite(opts.finding_count)
      ? Math.max(0, Math.floor(/** @type {number} */ (opts.finding_count)))
      : 0,
    iteration: Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0,
    ...(opts.notes ? { notes: truncateClaim(opts.notes) } : {}),
  };
}

/**
 * @param {string} text
 * @param {"blocker"|"improvement"|"nice"} kind
 */
function claimSummaryForTriple(text, kind) {
  const label = kind === "blocker" ? "blocker" : kind === "improvement" ? "improvement" : "nice-to-have";
  return truncateClaim(`${label}: ${text}`);
}

/**
 * Build doubt cycle rows from CERBERUS triple-template output (stub-friendly).
 * Empty output → approve, zero findings. Non-empty without triple → one evidence_gap finding.
 * claim_count on started row = emitted findings length (post-filter), not raw triple slots.
 *
 * @param {string} output
 * @param {object} opts
 * @param {number} opts.iteration
 * @param {string[]} [opts.reviewed_artifact_ids]
 */
function buildDoubtReviewCycleFromCerberusOutput(output, opts = {}) {
  const review_id = randomUUID();
  const iteration = Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0;
  /** @type {ReturnType<typeof buildDoubtReviewFindingPayload>[]} */
  const findings = [];

  const triple = parseCerberusTripleTemplate(output);
  if (triple) {
    const entries = [
      { kind: /** @type {const} */ ("blocker"), text: triple.blocker, finding: /** @type {const} */ ("blocker") },
      { kind: /** @type {const} */ ("improvement"), text: triple.improvement, finding: /** @type {const} */ ("improvement") },
      { kind: /** @type {const} */ ("nice"), text: triple.nice, finding: /** @type {const} */ ("nice_to_have") },
    ];
    for (const e of entries) {
      const val = String(e.text || "").trim();
      if (!val || /^\(none\)$/i.test(val)) continue;
      const summary = claimSummaryForTriple(val, e.kind);
      const category = inferClaimCategory(summary);
      if (!claimRequiresDoubtReview(category)) continue;
      findings.push(
        buildDoubtReviewFindingPayload({
          review_id,
          claim_id: randomUUID(),
          claim_category: category,
          claim_summary: summary,
          finding_kind: e.finding,
          evidence_required: e.finding === "blocker",
          iteration,
        }),
      );
      if (findings.length >= MAX_FINDINGS) break;
    }
  } else if (String(output || "").trim()) {
    findings.push(
      buildDoubtReviewFindingPayload({
        review_id,
        claim_id: randomUUID(),
        claim_category: "runtime_contract",
        claim_summary: truncateClaim("cerberus output missing triple template"),
        finding_kind: "evidence_gap",
        evidence_required: true,
        iteration,
      }),
    );
  }

  /** @type {(typeof DOUBT_VERDICTS)[number]} */
  let verdict = "approve";
  if (findings.some((f) => f.finding_kind === "blocker")) verdict = "block";
  else if (findings.some((f) => f.finding_kind !== "nice_to_have")) verdict = "request_changes";

  const started = buildDoubtReviewStartedPayload({
    review_id,
    iteration,
    claim_count: findings.length,
    ...(opts.reviewed_artifact_ids && opts.reviewed_artifact_ids.length
      ? { step_id: String(opts.reviewed_artifact_ids[0]).slice(0, 240) }
      : {}),
  });
  const verdictRow = buildDoubtReviewVerdictPayload({
    review_id,
    verdict,
    finding_count: findings.length,
    iteration,
    notes: verdict === "approve" ? "no material doubt findings" : undefined,
  });

  return { review_id, started, findings, verdict: verdictRow };
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {ReturnType<typeof buildDoubtReviewCycleFromCerberusOutput>} cycle
 */
function traceDoubtReviewCycle(traceEvent, taskId, cycle) {
  if (!cycle || !traceEvent) return;
  traceEvent(taskId, cycle.started);
  for (const f of cycle.findings) traceEvent(taskId, f);
  traceEvent(taskId, cycle.verdict);
}

module.exports = {
  DOUBT_REVIEW_SCHEMA_VERSION,
  CLAIM_CATEGORIES,
  DOUBT_FINDING_KINDS,
  DOUBT_VERDICTS,
  claimRequiresDoubtReview,
  inferClaimCategory,
  buildDoubtReviewStartedPayload,
  buildDoubtReviewFindingPayload,
  buildDoubtReviewVerdictPayload,
  buildDoubtReviewCycleFromCerberusOutput,
  traceDoubtReviewCycle,
};
