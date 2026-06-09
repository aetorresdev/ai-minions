"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 2 (contracts)", () => {
  it("physical modules/contracts tree exists with design validators", () => {
    for (const rel of [
      "modules/contracts/index.js",
      "modules/contracts/bv-reviewer-design.js",
      "modules/contracts/progressive-disclosure-design.js",
      "modules/contracts/self-improvement-loop-design.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same contract validator APIs", () => {
    const shimBv = require("../bv-reviewer-design");
    const canonBv = require("../modules/contracts/bv-reviewer-design");
    assert.equal(shimBv.VALUE_REVIEW_SCHEMA_VERSION, canonBv.VALUE_REVIEW_SCHEMA_VERSION);
    assert.equal(typeof shimBv.validateValueReviewTraceLine, "function");

    const shimPd = require("../progressive-disclosure-design");
    const canonPd = require("../modules/contracts/progressive-disclosure-design");
    assert.equal(shimPd.DISCLOSURE_SCHEMA_VERSION, canonPd.DISCLOSURE_SCHEMA_VERSION);
    assert.equal(typeof shimPd.validateContextDisclosureTraceLine, "function");

    const shimSi = require("../self-improvement-loop-design");
    const canonSi = require("../modules/contracts/self-improvement-loop-design");
    assert.equal(shimSi.IMPROVEMENT_PROPOSAL_SCHEMA_VERSION, canonSi.IMPROVEMENT_PROPOSAL_SCHEMA_VERSION);
    assert.equal(typeof shimSi.validateImprovementProposalTraceLine, "function");
  });

  it("modules/contracts index aggregates contracts-owned validators only", () => {
    const contracts = require("../modules/contracts");
    assert.equal(typeof contracts.validateValueReviewTraceLine, "function");
    assert.equal(typeof contracts.validateImprovementProposalTraceLine, "function");
    assert.equal(contracts.validateContextDisclosureTraceLine, undefined);
  });

  it("progressive disclosure remains reachable via shim and canonical path", () => {
    assert.equal(typeof require("../progressive-disclosure-design").validateContextDisclosureTraceLine, "function");
    assert.equal(
      typeof require("../modules/contracts/progressive-disclosure-design").validateContextDisclosureTraceLine,
      "function",
    );
  });
});
