"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 1 (gates)", () => {
  it("physical modules/gates tree exists with governance-gate and merge-governance", () => {
    for (const rel of [
      "modules/gates/index.js",
      "modules/gates/governance-gate.js",
      "modules/gates/merge-governance/index.js",
      "modules/gates/merge-governance/pr-boundary-governance-gate.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same gate APIs", () => {
    const shimGov = require("../governance-gate");
    const canonGov = require("../modules/gates/governance-gate");
    assert.equal(shimGov.GOVERNANCE_GATE_ID, canonGov.GOVERNANCE_GATE_ID);
    assert.equal(typeof shimGov.buildApprovalGrantedPayload, "function");

    const shimMerge = require("../merge-governance");
    const canonMerge = require("../modules/gates/merge-governance");
    assert.equal(shimMerge.GATE_ID, canonMerge.GATE_ID);
    assert.equal(typeof shimMerge.evaluatePrBoundaryGovernance, "function");
  });

  it("modules/gates index aggregates exports", () => {
    const gates = require("../modules/gates");
    assert.equal(typeof gates.evaluatePrBoundaryGovernance, "function");
    assert.equal(typeof gates.governanceRunnerShouldHold, "function");
  });
});
