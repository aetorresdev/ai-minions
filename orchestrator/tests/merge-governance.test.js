"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const { validateTraceLine } = require("../trace-schema");
const {
  validateMergeGovernanceConfig,
  loadMergeGovernanceConfig,
  discoverBranchPolicyPosture,
  evaluatePrBoundaryGovernance,
  buildProductionBoundaryCheckPayload,
  branchMatchesPattern,
  PROHIBITED_AGENT_ACTIONS,
} = require("../merge-governance");
const { buildReviewRecord } = require("../review-record");

const FIXTURES = path.join(__dirname, "fixtures", "merge-governance");

function traceEnvelope(body) {
  return {
    ts: "2026-06-08T12:00:00.000Z",
    ts_ms: 1749384000000,
    trace_schema_version: "2",
    task_id: "task-merge-gov",
    agent: "orchestrator",
    iteration: 0,
    ...body,
  };
}

describe("merge-governance config", () => {
  it("validates config-fallback fixture", () => {
    const raw = fs.readFileSync(path.join(FIXTURES, "config-fallback.yaml"), "utf8");
    const yaml = require("js-yaml");
    const validated = validateMergeGovernanceConfig(yaml.load(raw));
    assert.equal(validated.ok, true);
    assert.equal(validated.config.mode, "agent_as_contributor");
    assert.equal(validated.config.agent_permissions.allow_direct_merge, false);
  });

  it("loadMergeGovernanceConfig returns null when file missing", () => {
    const loaded = loadMergeGovernanceConfig(path.join(__dirname, "fixtures", "nonexistent-repo"));
    assert.equal(loaded.ok, true);
    assert.equal(loaded.config, null);
  });
});

describe("branch policy discovery", () => {
  it("uses github discovery with full visibility", () => {
    const discovery = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "github-discovery-main-protected.json"), "utf8"),
    );
    const posture = discoverBranchPolicyPosture({
      target_branch: "main",
      github_discovery: discovery,
    });
    assert.equal(posture.permission_visibility, "full");
    assert.equal(posture.protected_status, "known");
    assert.equal(posture.rulesets_visible, true);
    assert.equal(posture.release_sensitive, true);
  });

  it("uses explicit config with limited visibility", () => {
    const yaml = require("js-yaml");
    const raw = fs.readFileSync(path.join(FIXTURES, "config-fallback.yaml"), "utf8");
    const { config } = validateMergeGovernanceConfig(yaml.load(raw));
    const posture = discoverBranchPolicyPosture({
      target_branch: "release/v0.7",
      explicit_config: config,
    });
    assert.equal(posture.permission_visibility, "limited");
    assert.equal(posture.release_sensitive, true);
    assert.equal(posture.policy_source, "config");
  });

  it("fail-closed unknown visibility without config or discovery", () => {
    const posture = discoverBranchPolicyPosture({ target_branch: "main" });
    assert.equal(posture.permission_visibility, "unknown");
    assert.equal(posture.protected_status, "unknown");
  });

  it("fail-closed when github discovery is partial", () => {
    const posture = discoverBranchPolicyPosture({
      target_branch: "main",
      github_discovery: { default_branch: "main" },
    });
    assert.equal(posture.permission_visibility, "unknown");
    assert.equal(posture.protected_status, "unknown");
    assert.equal(posture.policy_source, "github_api");
  });

  it("matches release/* branch patterns", () => {
    assert.equal(branchMatchesPattern("release/v0.7", "release/*"), true);
    assert.equal(branchMatchesPattern("feature/x", "release/*"), false);
  });
});

describe("pr-boundary governance gate", () => {
  it("returns ready_for_human_review for governed PR on protected target", () => {
    const yaml = require("js-yaml");
    const raw = fs.readFileSync(path.join(FIXTURES, "config-fallback.yaml"), "utf8");
    const { config } = validateMergeGovernanceConfig(yaml.load(raw));
    const result = evaluatePrBoundaryGovernance({
      repository: "acme/widgets",
      pr_number: 150,
      source_branch: "feat/g1",
      target_branch: "main",
      actor_class: "agent_pat",
      attempted_action: "pr_ready",
      explicit_config: config,
      evidence_refs: ["https://github.com/acme/widgets/pull/150"],
    });
    assert.equal(result.decision, "ready_for_human_review");
    assert.equal(result.workflow_state, "ready_for_human_review");
    assert.equal(result.trace_payload.decision, "ready_for_human_review");
    assert.equal(result.merge_safety_claim_allowed, false);
  });

  for (const attemptedAction of PROHIBITED_AGENT_ACTIONS) {
    it(`blocks prohibited ${attemptedAction} for agent_as_contributor`, () => {
      const result = evaluatePrBoundaryGovernance({
        target_branch: "main",
        actor_class: "agent_pat",
        attempted_action: attemptedAction,
        github_discovery: JSON.parse(
          fs.readFileSync(path.join(FIXTURES, "github-discovery-main-protected.json"), "utf8"),
        ),
      });
      assert.equal(result.decision, "blocked");
      assert.equal(result.reason_code, "AGENT_PRIVILEGED_OP_DENIED");
      if (attemptedAction === "direct_merge") {
        assert.equal(result.workflow_state, "agent_merged_protected_branch");
      }
      if (attemptedAction === "create_production_tag") {
        assert.equal(result.workflow_state, "agent_created_production_tag");
      }
      if (attemptedAction === "publish_production_release") {
        assert.equal(result.workflow_state, "agent_published_production_release");
      }
    });
  }

  it("requires manual policy input when visibility unknown", () => {
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
    });
    assert.equal(result.decision, "requires_manual_policy_input");
    assert.equal(result.reason_code, "POLICY_VISIBILITY_UNKNOWN");
    assert.equal(result.trace_payload.permission_visibility, "unknown");
  });

  it("fails closed when github discovery is partial at gate", () => {
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
      github_discovery: { default_branch: "main" },
    });
    assert.equal(result.decision, "requires_manual_policy_input");
    assert.equal(result.reason_code, "POLICY_VISIBILITY_UNKNOWN");
    assert.equal(result.trace_payload.permission_visibility, "unknown");
    assert.equal(result.trace_payload.protected_status, "unknown");
  });

  it("blocks claim_merge_safe even when visibility unknown", () => {
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "claim_merge_safe",
    });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason_code, "MERGE_SAFETY_CLAIM_DENIED");
  });

  it("blocks merge-safety claim attempts", () => {
    const discovery = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "github-discovery-main-protected.json"), "utf8"),
    );
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "claim_merge_safe",
      github_discovery: discovery,
    });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason_code, "MERGE_SAFETY_CLAIM_DENIED");
  });

  it("production_boundary_check validates against trace schema", () => {
    const row = traceEnvelope(
      buildProductionBoundaryCheckPayload({
        repository: "acme/widgets",
        target_branch: "main",
        decision: "ready_for_human_review",
        permission_visibility: "limited",
        protected_status: "known",
        actor_class: "agent_pat",
        evidence_refs: ["pr:150"],
      }),
    );
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });
});

describe("merge-governance review evidence", () => {
  function loadConfig() {
    const yaml = require("js-yaml");
    const raw = fs.readFileSync(path.join(FIXTURES, "config-fallback.yaml"), "utf8");
    return validateMergeGovernanceConfig(yaml.load(raw)).config;
  }

  function reviewTraceRowsFromBuilt(records) {
    return records.map((record) => ({
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
    }));
  }

  it("embeds durable review_record summary when review_records supplied", () => {
    const config = loadConfig();
    const review_records = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "review-records-cerberus-approve.json"), "utf8"),
    );
    const result = evaluatePrBoundaryGovernance({
      repository: "acme/widgets",
      pr_number: 153,
      source_branch: "feat/r1",
      target_branch: "main",
      actor_class: "agent_pat",
      attempted_action: "pr_ready",
      explicit_config: config,
      review_records,
      evidence_refs: ["https://github.com/acme/widgets/pull/153"],
    });
    assert.equal(result.decision, "ready_for_human_review");
    assert.equal(result.trace_payload.review_evidence.cerberus_verdict, "approve");
    assert.equal(result.trace_payload.review_evidence.has_cerberus_record, true);
    assert.ok(
      result.trace_payload.evidence_refs.some((r) => r.startsWith("review_record:cerberus:")),
    );
    const v = validateTraceLine(traceEnvelope(result.trace_payload));
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("blocks pr_ready when cerberus review_record has blockers", () => {
    const config = loadConfig();
    const review_records = reviewTraceRowsFromBuilt([
      buildReviewRecord({
        reviewerRole: "cerberus",
        output: "blocker: schema drift in orchestrator/foo.js\nimprovement: none\nnice-to-have: none",
        iteration: 2,
      }),
    ]);
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
      explicit_config: config,
      review_records,
    });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason_code, "REVIEW_RECORD_BLOCKERS");
    assert.equal(result.trace_payload.review_evidence.cerberus_verdict, "block");
    assert.ok(result.trace_payload.review_evidence.open_blocker_count >= 1);
  });

  it("blocks pr_ready when cerberus requested changes", () => {
    const config = loadConfig();
    const review_records = reviewTraceRowsFromBuilt([
      buildReviewRecord({
        reviewerRole: "cerberus",
        output: "blocker: none\nimprovement: add matrix negative test\nnice-to-have: none",
        iteration: 1,
      }),
    ]);
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
      explicit_config: config,
      review_records,
    });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason_code, "REVIEW_CHANGES_PENDING");
    assert.equal(result.trace_payload.review_evidence.cerberus_verdict, "request_changes");
  });

  it("requires manual input when review_records is empty on governed target", () => {
    const config = loadConfig();
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
      explicit_config: config,
      review_records: [],
    });
    assert.equal(result.decision, "requires_manual_policy_input");
    assert.equal(result.reason_code, "REVIEW_EVIDENCE_MISSING");
  });

  it("keeps legacy behavior when review_records omitted", () => {
    const config = loadConfig();
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
      explicit_config: config,
      evidence_refs: ["https://github.com/acme/widgets/pull/1"],
    });
    assert.equal(result.decision, "ready_for_human_review");
    assert.equal(result.trace_payload.review_evidence, undefined);
  });
});
