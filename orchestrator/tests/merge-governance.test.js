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
} = require("../merge-governance");

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

  it("blocks prohibited direct_merge for agent_as_contributor", () => {
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      actor_class: "agent_pat",
      attempted_action: "direct_merge",
      github_discovery: JSON.parse(
        fs.readFileSync(path.join(FIXTURES, "github-discovery-main-protected.json"), "utf8"),
      ),
    });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason_code, "AGENT_PRIVILEGED_OP_DENIED");
    assert.equal(result.workflow_state, "agent_merged_protected_branch");
  });

  it("requires manual policy input when visibility unknown", () => {
    const result = evaluatePrBoundaryGovernance({
      target_branch: "main",
      attempted_action: "pr_ready",
    });
    assert.equal(result.decision, "requires_manual_policy_input");
    assert.equal(result.reason_code, "POLICY_VISIBILITY_UNKNOWN");
    assert.equal(result.trace_payload.permission_visibility, "unknown");
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
