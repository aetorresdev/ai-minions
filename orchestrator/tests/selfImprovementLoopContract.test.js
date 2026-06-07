"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  PROPOSAL_TYPES,
  UNSAFE_FLAGS,
  validateImprovementProposalTraceLine,
  validateImprovementProposalDecisionTraceLine,
  validateImprovementProposalFixtureRows,
  validateImprovementProposalDryRunGate,
} = require("../self-improvement-loop-design");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "improvement-proposal-trace.v1.jsonl");
const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "self-improvement-loop-contract.md");

/**
 * @param {string} text
 * @returns {object[]}
 */
function parseJsonl(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** @param {Partial<object>} overrides */
function minimalValidProposal(overrides = {}) {
  return {
    ts: "2026-05-18T14:00:00.000Z",
    ts_ms: 1747576800000,
    trace_schema_version: "2",
    task_id: "t",
    event: "improvement_proposal",
    improvement_proposal_schema_version: "1",
    proposal_id: "prop-001",
    proposal_type: "contract",
    source_pattern: "recurring_failure",
    title: "Update contract",
    rationale: "Evidence-backed fix",
    evidence_refs: ["orchestrator/tests/example.test.js"],
    affected_paths: ["docs/orchestrator/example-contract.md"],
    risk_level: "low",
    validation_plan: "cd orchestrator && npm test",
    rollback_plan: "Revert commit",
    human_approval_required: true,
    approval_status: "pending",
    proposed_by_role: "planner",
    ...overrides,
  };
}

describe("self-improvement-loop-contract", () => {
  it("fixture JSONL validates proposals and dry-run approval gate", () => {
    const rows = parseJsonl(fs.readFileSync(FIXTURE_PATH, "utf8"));
    assert.equal(rows.length, 3);
    const v = validateImprovementProposalFixtureRows(rows);
    assert.equal(v.ok, true, v.errors?.join(" | "));
    const gate = validateImprovementProposalDryRunGate(rows);
    assert.equal(gate.ok, true, gate.errors?.join(" | "));
    const proposals = rows.filter((r) => r.event === "improvement_proposal");
    assert.equal(proposals.length, 2);
    assert.ok(proposals.some((p) => p.unsafe_flags?.includes("unbounded_tool_add")));
  });

  it("requires evidence_refs and affected_paths", () => {
    const v = validateImprovementProposalTraceLine(minimalValidProposal({
      evidence_refs: [],
      affected_paths: [],
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /evidence_refs/i.test(e)));
    assert.ok(v.errors.some((e) => /affected_paths/i.test(e)));
  });

  it("requires human_approval_required true", () => {
    const v = validateImprovementProposalTraceLine(minimalValidProposal({
      human_approval_required: false,
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /human_approval_required/i.test(e)));
  });

  it("unsafe permission flags require cerberus_review_required", () => {
    const v = validateImprovementProposalTraceLine(minimalValidProposal({
      unsafe_flags: ["permission_loosening"],
      cerberus_review_required: false,
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /cerberus_review_required/i.test(e)));
  });

  it("rejects forbidden apply keys (no silent application path)", () => {
    const v = validateImprovementProposalTraceLine(minimalValidProposal({ auto_apply: true }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /forbidden apply key: auto_apply/i.test(e)));
  });

  it("rejects nested forbidden content keys", () => {
    const v = validateImprovementProposalTraceLine(minimalValidProposal({
      risk_notes: "see nested",
      meta: { notes: { raw_response: "full model output" } },
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /forbidden content key: meta\.notes\.raw_response/i.test(e)));
  });

  it("validates improvement_proposal_decision rows", () => {
    const v = validateImprovementProposalDecisionTraceLine({
      ts: "2026-05-18T14:10:00.000Z",
      trace_schema_version: "2",
      task_id: "t",
      event: "improvement_proposal_decision",
      improvement_proposal_schema_version: "1",
      proposal_id: "prop-001",
      decision: "approved",
      decided_by: "operator",
      decision_rationale: "ok",
    });
    assert.equal(v.ok, true);
  });

  it("PROPOSAL_TYPES and UNSAFE_FLAGS enums are stable", () => {
    assert.deepEqual([...PROPOSAL_TYPES], [
      "contract",
      "validation_rule",
      "tool_manifest",
      "doc",
      "test",
      "process",
    ]);
    assert.ok(UNSAFE_FLAGS.includes("bypass_gate"));
  });

  it("contract doc states loop stages and human approval gate", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /improvement_proposal/);
    assert.match(doc, /improvement_proposal_decision/);
    assert.match(doc, /human_approval_required/);
    assert.match(doc, /not claimed/i);
    assert.match(doc, /review-record-contract\.md/);
    assert.match(doc, /failure-semantics-contract\.md/);
    assert.match(doc, /planner/i);
    assert.match(doc, /cerberus/i);
  });
});
