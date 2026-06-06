"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "skill-registry-contract.md");

describe("skill-registry-contract", () => {
  it("documents registry path, policy, and trace event", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /skill-registry\.v1\.json/);
    assert.match(doc, /deny_unlisted/);
    assert.match(doc, /skill_registry_check/);
    assert.match(doc, /ORCH_SKILL_REGISTRY_ENFORCE/);
  });

  it("references workflow skill and progressive disclosure contracts", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /workflow-skill-contract\.md/);
    assert.match(doc, /progressive-disclosure-contract\.md/);
    assert.match(doc, /orchestrator-token-report/);
  });
});
