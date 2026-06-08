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

  return row;
}

module.exports = {
  buildProductionBoundaryCheckPayload,
};
