"use strict";

/** @typedef {"ready_for_human_review"|"blocked"|"requires_manual_policy_input"} ProductionBoundaryDecision */

/** @typedef {"agent_as_contributor"} MergeGovernanceMode */

const DEFAULT_MODE = "agent_as_contributor";

const DECISIONS = /** @type {const} */ ([
  "ready_for_human_review",
  "blocked",
  "requires_manual_policy_input",
]);

const PROHIBITED_AGENT_ACTIONS = /** @type {const} */ ([
  "direct_merge",
  "push_protected",
  "create_production_tag",
  "publish_production_release",
  "bypass_checks",
  "bypass_reviews",
]);

const PROHIBITED_WORKFLOW_STATES = /** @type {const} */ ([
  "agent_merged_protected_branch",
  "agent_created_production_tag",
  "agent_published_production_release",
]);

const REASON_CODES = /** @type {const} */ ([
  "AGENT_PRIVILEGED_OP_DENIED",
  "POLICY_VISIBILITY_UNKNOWN",
  "TARGET_BRANCH_UNRESOLVED",
  "MERGE_SAFETY_CLAIM_DENIED",
  "REVIEW_RECORD_BLOCKERS",
  "REVIEW_CHANGES_PENDING",
  "REVIEW_EVIDENCE_MISSING",
]);

const GATE_ID = "pr_boundary_governance";

const DEFAULT_AGENT_PERMISSIONS = Object.freeze({
  allow_direct_merge: false,
  allow_direct_push_protected: false,
  allow_production_tag_create: false,
  allow_release_publish: false,
  allow_bypass_checks: false,
  allow_bypass_reviews: false,
});

module.exports = {
  DEFAULT_MODE,
  DECISIONS,
  PROHIBITED_AGENT_ACTIONS,
  PROHIBITED_WORKFLOW_STATES,
  REASON_CODES,
  GATE_ID,
  DEFAULT_AGENT_PERMISSIONS,
};
