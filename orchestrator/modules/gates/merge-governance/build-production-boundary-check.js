"use strict";

const { DEFAULT_MODE } = require("./constants");

/**
 * Build `production_boundary_check` trace body (without envelope ts/task_id).
 *
 * @param {object} input
 * @returns {Record<string, unknown>}
 */
function buildProductionBoundaryCheckPayload(input) {
  const evidence_refs = Array.isArray(input.evidence_refs)
    ? input.evidence_refs.map((r) => String(r).slice(0, 240)).filter(Boolean).slice(0, 16)
    : [];

  /** @type {Record<string, unknown>} */
  const row = {
    event: "production_boundary_check",
    check_schema_version: "1",
    mode: input.mode != null ? String(input.mode) : DEFAULT_MODE,
    repository: input.repository != null ? String(input.repository).slice(0, 200) : null,
    pr_number:
      input.pr_number != null && Number.isFinite(Number(input.pr_number))
        ? Math.max(0, Math.floor(Number(input.pr_number)))
        : null,
    source_branch: input.source_branch != null ? String(input.source_branch).slice(0, 200) : null,
    target_branch: input.target_branch != null ? String(input.target_branch).slice(0, 200) : null,
    default_branch: input.default_branch != null ? String(input.default_branch).slice(0, 200) : null,
    protected_status: input.protected_status || "unknown",
    rulesets_visible: Boolean(input.rulesets_visible),
    required_checks_visible: Boolean(input.required_checks_visible),
    required_reviews_visible: Boolean(input.required_reviews_visible),
    actor_class: input.actor_class != null ? String(input.actor_class).slice(0, 64) : "unknown",
    permission_visibility: input.permission_visibility || "unknown",
    direct_merge_allowed:
      input.direct_merge_allowed === true || input.direct_merge_allowed === false
        ? input.direct_merge_allowed
        : null,
    direct_push_protected_allowed:
      input.direct_push_protected_allowed === true || input.direct_push_protected_allowed === false
        ? input.direct_push_protected_allowed
        : null,
    tag_create_allowed:
      input.tag_create_allowed === true || input.tag_create_allowed === false
        ? input.tag_create_allowed
        : null,
    release_publish_allowed:
      input.release_publish_allowed === true || input.release_publish_allowed === false
        ? input.release_publish_allowed
        : null,
    decision: input.decision,
    reason_code: input.reason_code != null ? String(input.reason_code).slice(0, 160) : null,
    evidence_refs,
    gate_id: input.gate_id != null ? String(input.gate_id).slice(0, 64) : "pr_boundary_governance",
    workflow_state: input.workflow_state != null ? String(input.workflow_state).slice(0, 96) : null,
    attempted_action:
      input.attempted_action != null ? String(input.attempted_action).slice(0, 64) : null,
  };

  if (input.agent != null) row.agent = String(input.agent).slice(0, 128);
  if (Number.isFinite(input.iteration)) row.iteration = Math.max(0, Math.floor(input.iteration));
  if (input.step_id != null && String(input.step_id).trim()) {
    row.step_id = String(input.step_id).slice(0, 240);
  }

  if (input.review_evidence && typeof input.review_evidence === "object") {
    const re = input.review_evidence;
    /** @type {Record<string, unknown>} */
    const review_evidence = {
      cerberus_verdict:
        re.cerberus_verdict === "approve" ||
        re.cerberus_verdict === "request_changes" ||
        re.cerberus_verdict === "block"
          ? re.cerberus_verdict
          : null,
      qa_verdict:
        re.qa_verdict === "approve" ||
        re.qa_verdict === "request_changes" ||
        re.qa_verdict === "block"
          ? re.qa_verdict
          : null,
      final_verdict:
        re.final_verdict === "approve" ||
        re.final_verdict === "request_changes" ||
        re.final_verdict === "block"
          ? re.final_verdict
          : null,
      open_blocker_count:
        Number.isFinite(re.open_blocker_count) && re.open_blocker_count >= 0
          ? Math.min(8, Math.floor(re.open_blocker_count))
          : 0,
      review_record_count:
        Number.isFinite(re.review_record_count) && re.review_record_count >= 0
          ? Math.min(16, Math.floor(re.review_record_count))
          : 0,
      has_cerberus_record: Boolean(re.has_cerberus_record),
      has_qa_record: Boolean(re.has_qa_record),
      browser_verification_pending: Boolean(re.browser_verification_pending),
    };
    if (Array.isArray(re.open_blockers)) {
      review_evidence.open_blockers = re.open_blockers
        .map((b) => String(b).slice(0, 300))
        .filter(Boolean)
        .slice(0, 8);
    }
    row.review_evidence = review_evidence;
  }

  return row;
}

module.exports = {
  buildProductionBoundaryCheckPayload,
};
