"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "handoff-contract.md");

describe("handoff-contract", () => {
  it("defines delegated ownership vs bounded invocation", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Delegated ownership handoff/i);
    assert.match(doc, /Bounded specialist invocation/i);
    assert.match(doc, /Phase transition/i);
    assert.match(doc, /transfer_kind/i);
    assert.match(doc, /delegated_ownership/i);
  });

  it("includes minimum envelope fields and JSON example", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    for (const field of [
      "contract_version",
      "handoff_id",
      "ownership_scope",
      "approved_artifacts",
      "forbidden_changes",
      "permission_context",
      "budget_context",
      "trace_refs",
    ]) {
      assert.match(doc, new RegExp(field));
    }
    assert.match(doc, /"contract_version": "handoff_contract.v1"/);
    assert.match(doc, /Invalid examples/i);
  });

  it("cross-links ancestry, governance, session resume, security", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /governance-gates-contract\.md/);
    assert.match(doc, /goal-ancestry-contract\.md/);
    assert.match(doc, /session-resume-contract\.md/);
    assert.match(doc, /security-posture\.md/);
    assert.match(doc, /harness-engineering-positioning\.md/);
  });

  it("states design-only — no runtime enforcement claim", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Design-only/i);
    assert.match(doc, /No runtime/i);
  });
});
