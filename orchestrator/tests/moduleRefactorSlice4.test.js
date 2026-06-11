"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 4 (gates remainder)", () => {
  it("physical modules/gates tree includes policy and review gate files", () => {
    for (const rel of [
      "modules/gates/approval-policy-gate.js",
      "modules/gates/doubt-review.js",
      "modules/gates/review-record.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same gate APIs", () => {
    const shimPolicy = require("../approval-policy-gate");
    const canonPolicy = require("../modules/gates/approval-policy-gate");
    assert.deepEqual(shimPolicy.APPROVAL_GATE_IDS, canonPolicy.APPROVAL_GATE_IDS);
    assert.equal(typeof shimPolicy.evaluateApprovalGate, "function");

    const shimDoubt = require("../doubt-review");
    const canonDoubt = require("../modules/gates/doubt-review");
    assert.equal(shimDoubt.DOUBT_REVIEW_SCHEMA_VERSION, canonDoubt.DOUBT_REVIEW_SCHEMA_VERSION);
    assert.equal(typeof shimDoubt.traceDoubtReviewCycle, "function");

    const shimReview = require("../review-record");
    const canonReview = require("../modules/gates/review-record");
    assert.equal(shimReview.REVIEW_SCHEMA_VERSION, canonReview.REVIEW_SCHEMA_VERSION);
    assert.equal(typeof shimReview.buildReviewRecord, "function");
  });

  it("modules/gates index aggregates remainder exports", () => {
    const gates = require("../modules/gates");
    assert.equal(typeof gates.evaluateApprovalGate, "function");
    assert.equal(typeof gates.traceDoubtReviewCycle, "function");
    assert.equal(typeof gates.buildReviewRecord, "function");
  });
});
