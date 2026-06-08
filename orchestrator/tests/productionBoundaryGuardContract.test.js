"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const CONTRACT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "orchestrator",
  "production-boundary-guard.md",
);

describe("production-boundary-guard contract", () => {
  it("defines agent_as_contributor default mode and security model", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /agent_as_contributor/);
    assert.match(doc, /Least privilege/i);
    assert.match(doc, /Separation of duties/i);
    assert.match(doc, /Deny by default/i);
    assert.match(doc, /Privileged operation boundary/i);
  });

  it("states prompt is not a security boundary and PAT is necessary but insufficient", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Prompt instructions are not a security boundary/i);
    assert.match(doc, /necessary but not sufficient/i);
    assert.match(doc, /CERBERUS must reject/i);
  });

  it("defines production_boundary_check trace contract and fail-closed behavior", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /production_boundary_check/);
    assert.match(doc, /check_schema_version/);
    assert.match(doc, /ready_for_human_review/);
    assert.match(doc, /permission_visibility/);
    assert.match(doc, /Fail-closed behavior/i);
    assert.match(doc, /do not.*claim the production boundary is safe/i);
  });

  it("lists CERBERUS rejection rules and cross-links security posture", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /CERBERUS rejection rules/i);
    assert.match(doc, /Instruction-only boundary/i);
    assert.match(doc, /PAT-only governance/i);
    assert.match(doc, /security-posture\.md/);
    assert.match(doc, /doc-runtime-drift-check\.md/);
  });

  it("states design-only trace emission until PR-boundary governance ships", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /not emitted/i);
    assert.match(doc, /What this document is not/i);
  });
});
