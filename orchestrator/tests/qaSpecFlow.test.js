"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,
  validateHandoffForMode,
  shouldEmitQaReviewRecord,
} = require("../qa-spec-flow");
const { validateHandoffStructure } = require("../orchestrator");
const { buildReviewRecord } = require("../review-record");

describe("qa-spec-flow", () => {
  it("isQaSpecBeforeDevEnabled only for multi_agent unless disabled", () => {
    const prev = process.env.ORCH_QA_SPEC_BEFORE_DEV;
    try {
      delete process.env.ORCH_QA_SPEC_BEFORE_DEV;
      assert.equal(isQaSpecBeforeDevEnabled("multi_agent"), true);
      assert.equal(isQaSpecBeforeDevEnabled("single_agent"), false);
      process.env.ORCH_QA_SPEC_BEFORE_DEV = "0";
      assert.equal(isQaSpecBeforeDevEnabled("multi_agent"), false);
    } finally {
      if (prev === undefined) delete process.env.ORCH_QA_SPEC_BEFORE_DEV;
      else process.env.ORCH_QA_SPEC_BEFORE_DEV = prev;
    }
  });

  it("applyQaSpecBeforeDevPlan inserts QA_SPEC before first dev", () => {
    const steps = [
      { agentId: "dev-backend", task: "implement" },
      { agentId: "qa", task: "review" },
      { agentId: "cerberus", task: "audit" },
    ];
    const out = applyQaSpecBeforeDevPlan(steps, { enabled: true });
    assert.equal(out.length, 4);
    assert.equal(out[0].agentId, "qa");
    assert.equal(out[0].qaPhase, "spec");
    assert.equal(out[1].agentId, "dev-backend");
    assert.equal(out[2].qaPhase, "exec");
  });

  it("forces qa after first dev to exec even if planner incorrectly marks spec", () => {
    const steps = [
      { agentId: "qa", qaPhase: "spec", task: "spec ok" },
      { agentId: "dev-backend", task: "implement" },
      { agentId: "qa", qaPhase: "spec", task: "wrong tag" },
      { agentId: "cerberus", task: "audit" },
    ];
    const out = applyQaSpecBeforeDevPlan(steps, { enabled: true });
    assert.equal(out[0].qaPhase, "spec");
    assert.equal(out[2].agentId, "qa");
    assert.equal(out[2].qaPhase, "exec");
    assert.equal(resolveHandoffMode("qa", out[2], "QA"), "QA_EXEC");
  });

  it("shouldEmitQaReviewRecord skips QA_SPEC and allows QA_EXEC", () => {
    const specOutput = [
      "test_strategy: unit",
      "acceptance_criteria:",
      "  - divide by zero throws",
      "validation_commands:",
      "  - npm test",
    ].join("\n");
    assert.equal(shouldEmitQaReviewRecord("qa", { qaPhase: "spec" }), false);
    assert.equal(shouldEmitQaReviewRecord("qa", { qaPhase: "exec" }), true);

    const specReview = buildReviewRecord({
      reviewerRole: "qa",
      output: specOutput,
      iteration: 1,
      stepId: "s-spec",
    });
    assert.equal(specReview.verdict, "block");

    const execReview = buildReviewRecord({
      reviewerRole: "qa",
      output: "blocker: none\nimprovement: tests pass\nnice-to-have: none",
      iteration: 1,
      stepId: "s-exec",
    });
    assert.equal(execReview.verdict, "request_changes");
  });

  it("resolveHandoffMode maps qa phases", () => {
    assert.equal(resolveHandoffMode("qa", { qaPhase: "spec" }, "QA"), "QA_SPEC");
    assert.equal(resolveHandoffMode("qa", { qaPhase: "exec" }, "QA"), "QA_EXEC");
    assert.equal(resolveHandoffMode("qa", {}, "QA"), "QA");
  });

  it("validateHandoffForMode QA_SPEC requires acceptance and validation_commands", () => {
    const bad = validateHandoffForMode("QA_SPEC", "test_strategy: x\n");
    assert.equal(bad.valid, false);
    const ok = validateHandoffForMode(
      "QA_SPEC",
      [
        "test_strategy: unit",
        "acceptance_criteria:",
        "  - works",
        "validation_commands:",
        "  - npm test",
      ].join("\n"),
    );
    assert.equal(ok.valid, true);
  });

  it("validateHandoffStructure DEV requires qa_spec_ref after QA_SPEC policy", () => {
    const devOnly = validateHandoffStructure("DEV", "files_modified:\n  - a.js\n", {
      requireQaSpecRef: false,
    });
    assert.equal(devOnly.valid, true);
    const devMissing = validateHandoffStructure("DEV", "files_modified:\n  - a.js\n", {
      requireQaSpecRef: true,
    });
    assert.equal(devMissing.valid, false);
    const devOk = validateHandoffStructure(
      "DEV",
      "files_modified:\n  - a.js\nacceptance_criteria:\n  - pass tests\n",
      { requireQaSpecRef: true },
    );
    assert.equal(devOk.valid, true);
  });
});
