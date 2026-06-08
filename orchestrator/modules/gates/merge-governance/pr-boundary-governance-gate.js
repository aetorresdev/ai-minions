"use strict";

const { discoverBranchPolicyPosture } = require("./branch-policy-discovery");
const { inspectActorCapabilities } = require("./actor-capability-check");
const { buildProductionBoundaryCheckPayload } = require("./build-production-boundary-check");
const { assessReviewEvidenceForGovernance } = require("./assess-review-evidence");
const {
  DEFAULT_MODE,
  PROHIBITED_AGENT_ACTIONS,
  PROHIBITED_WORKFLOW_STATES,
  GATE_ID,
} = require("./constants");

const PROHIBITED_ACTION_SET = new Set(PROHIBITED_AGENT_ACTIONS);

const ACTION_TO_WORKFLOW_STATE = Object.freeze({
  direct_merge: "agent_merged_protected_branch",
  create_production_tag: "agent_created_production_tag",
  publish_production_release: "agent_published_production_release",
});

/**
 * @param {string} attemptedAction
 * @returns {string | null}
 */
function prohibitedWorkflowState(attemptedAction) {
  return ACTION_TO_WORKFLOW_STATE[attemptedAction] || null;
}

/**
 * @param {string} attemptedAction
 * @returns {boolean}
 */
function isProhibitedAgentAction(attemptedAction) {
  return PROHIBITED_ACTION_SET.has(attemptedAction);
}

/**
 * Evaluate PR-boundary governance (dry-run gate). Does not call GitHub APIs.
 *
 * @param {object} input
 * @returns {{
 *   decision: string,
 *   reason_code: string | null,
 *   workflow_state: string | null,
 *   gate_id: string,
 *   trace_payload: Record<string, unknown>,
 *   merge_safety_claim_allowed: boolean,
 * }}
 */
function evaluatePrBoundaryGovernance(input) {
  const attemptedAction = input.attempted_action != null ? String(input.attempted_action) : "pr_ready";
  const targetBranch = input.target_branch != null ? String(input.target_branch).trim() : "";
  const explicitConfig = input.explicit_config || null;
  const mode = explicitConfig?.mode || DEFAULT_MODE;

  const posture = discoverBranchPolicyPosture({
    target_branch: targetBranch,
    explicit_config: explicitConfig,
    github_discovery: input.github_discovery || null,
  });
  const actor = inspectActorCapabilities({
    actor_class: input.actor_class,
    explicit_config: explicitConfig,
  });

  /** @type {string} */
  let decision = "requires_manual_policy_input";
  /** @type {string | null} */
  let reason_code = null;
  /** @type {string | null} */
  let workflow_state = null;

  if (!targetBranch) {
    decision = "blocked";
    reason_code = "TARGET_BRANCH_UNRESOLVED";
  } else if (isProhibitedAgentAction(attemptedAction)) {
    decision = "blocked";
    reason_code = "AGENT_PRIVILEGED_OP_DENIED";
    workflow_state = prohibitedWorkflowState(attemptedAction);
    if (workflow_state && !PROHIBITED_WORKFLOW_STATES.includes(workflow_state)) {
      workflow_state = null;
    }
  } else if (attemptedAction === "claim_merge_safe") {
    decision = "blocked";
    reason_code = "MERGE_SAFETY_CLAIM_DENIED";
  } else if (posture.permission_visibility === "unknown") {
    decision = "requires_manual_policy_input";
    reason_code = "POLICY_VISIBILITY_UNKNOWN";
  } else {
    decision = "ready_for_human_review";
    workflow_state = "ready_for_human_review";
  }

  const reviewAssessment = assessReviewEvidenceForGovernance({
    attempted_action: attemptedAction,
    release_sensitive: posture.release_sensitive,
    review_records: input.review_records,
    require_review_evidence: input.require_review_evidence,
  });

  if (
    reviewAssessment.gate &&
    (decision === "ready_for_human_review" || decision === "requires_manual_policy_input")
  ) {
    decision = reviewAssessment.gate.decision;
    reason_code = reviewAssessment.gate.reason_code;
    if (reviewAssessment.gate.workflow_state != null) {
      workflow_state = reviewAssessment.gate.workflow_state;
    } else if (decision !== "ready_for_human_review") {
      workflow_state = null;
    }
  }

  const mergedEvidenceRefs = [
    ...(Array.isArray(input.evidence_refs) ? input.evidence_refs : []),
    ...reviewAssessment.evidence_refs,
  ].filter(Boolean);

  const merge_safety_claim_allowed =
    posture.permission_visibility === "full" &&
    decision === "ready_for_human_review" &&
    actor.direct_merge_allowed !== true &&
    (reviewAssessment.evidence == null ||
      reviewAssessment.evidence.cerberus_verdict === "approve");

  const trace_payload = buildProductionBoundaryCheckPayload({
    mode,
    repository: input.repository,
    pr_number: input.pr_number,
    source_branch: input.source_branch,
    target_branch: targetBranch || null,
    default_branch: posture.default_branch,
    protected_status: posture.protected_status,
    rulesets_visible: posture.rulesets_visible,
    required_checks_visible: posture.required_checks_visible,
    required_reviews_visible: posture.required_reviews_visible,
    actor_class: actor.actor_class,
    permission_visibility: posture.permission_visibility,
    direct_merge_allowed: actor.direct_merge_allowed,
    direct_push_protected_allowed: actor.direct_push_protected_allowed,
    tag_create_allowed: actor.tag_create_allowed,
    release_publish_allowed: actor.release_publish_allowed,
    decision,
    reason_code,
    evidence_refs: mergedEvidenceRefs,
    review_evidence: reviewAssessment.evidence,
    gate_id: GATE_ID,
    workflow_state,
    attempted_action: attemptedAction,
    agent: input.agent,
    iteration: input.iteration,
    step_id: input.step_id,
  });

  return {
    decision,
    reason_code,
    workflow_state,
    gate_id: GATE_ID,
    trace_payload,
    merge_safety_claim_allowed,
    release_sensitive: posture.release_sensitive,
    policy_source: posture.policy_source,
  };
}

module.exports = {
  evaluatePrBoundaryGovernance,
  isProhibitedAgentAction,
};
