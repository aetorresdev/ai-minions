"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  DISCLOSURE_SURFACES,
  validateContextDisclosureTraceLine,
  validateContextDisclosureFixtureRows,
} = require("../progressive-disclosure-design");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "context-disclosure-trace.v1.jsonl");
const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "progressive-disclosure-contract.md");

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

describe("progressive-disclosure-contract", () => {
  it("gap assessment contract documents verdict and surfaces", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Gap exists/i);
    assert.match(doc, /capability-matrix/i);
    assert.match(doc, /context_package/i);
    assert.match(doc, /SKILL-REGISTRY-1/i);
  });

  it("fixture JSONL validates three surface examples", () => {
    const rows = parseJsonl(fs.readFileSync(FIXTURE_PATH, "utf8"));
    assert.equal(rows.length, 3);
    const v = validateContextDisclosureFixtureRows(rows);
    assert.equal(v.ok, true, v.errors?.join(" | "));
    const surfaces = rows.map((r) => r.surface);
    assert.deepEqual(surfaces.sort(), [...DISCLOSURE_SURFACES].sort());
  });

  it("hidden requires item_refs", () => {
    const v = validateContextDisclosureTraceLine({
      event: "context_disclosure",
      disclosure_schema_version: "1",
      trace_schema_version: "2",
      ts: "2026-06-06T10:00:00.000Z",
      task_id: "t",
      role_id: "cerberus",
      surface: "tools",
      action: "hidden",
      item_refs: [],
      reason_code: "role_matrix",
      rationale: "ok",
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /hidden requires at least one item_ref/i.test(e)));
  });

  it("hidden with missing item_refs returns ok false without throwing", () => {
    const v = validateContextDisclosureTraceLine({
      event: "context_disclosure",
      disclosure_schema_version: "1",
      trace_schema_version: "2",
      ts_ms: 1,
      task_id: "t",
      role_id: "qa",
      surface: "tools",
      action: "hidden",
      reason_code: "role_matrix",
      rationale: "ok",
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /item_refs must be an array/i.test(e)));
    assert.ok(!v.errors.some((e) => /hidden requires at least one item_ref/i.test(e)));
  });

  it("rejects forbidden content keys in disclosure row", () => {
    const v = validateContextDisclosureTraceLine({
      event: "context_disclosure",
      disclosure_schema_version: "1",
      trace_schema_version: "2",
      ts_ms: 1,
      task_id: "t",
      role_id: "qa",
      surface: "context_package",
      action: "exposed",
      item_refs: ["x"],
      reason_code: "step_policy",
      rationale: "ok",
      prompt: "ignore prior instructions",
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /forbidden content key: prompt/i.test(e)));
  });
});
