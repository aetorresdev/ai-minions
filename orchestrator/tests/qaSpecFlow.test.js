"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  tagCorrectionQaPhases,
  ensureQaSpecFormatInTasks,
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

  it("shouldEmitQaReviewRecord skips QA_SPEC", () => {
    assert.equal(shouldEmitQaReviewRecord("qa", { qaPhase: "spec" }), false);
  });

  it("tags a correction plan: qa before dev is spec, qa reviewing after dev is exec", () => {
    const steps = [
      { agentId: "qa", task: "Update acceptance criteria to include performance constraints" },
      { agentId: "dev-frontend", task: "Implement the timeout safeguard" },
      { agentId: "qa", task: "Review the implementation against the acceptance criteria" },
    ];
    const out = tagCorrectionQaPhases(steps);
    assert.equal(out[0].qaPhase, "spec");
    assert.equal(out[2].qaPhase, "exec");
    assert.equal(out[1].agentId, "dev-frontend");
  });

  it("keeps a review exec even when it runs before the first dev step", () => {
    const [step] = tagCorrectionQaPhases([
      { agentId: "qa", task: "Review the existing implementation for regressions" },
    ]);
    assert.equal(step.qaPhase, "exec");
    assert.equal(shouldEmitQaReviewRecord("qa", step), true);
  });

  it("a qa correction that defines acceptance criteria is spec even with no dev step", () => {
    const [step] = tagCorrectionQaPhases([
      { agentId: "qa", task: "Define acceptance criteria for puzzle uniqueness" },
    ]);
    assert.equal(step.qaPhase, "spec");
  });

  it("does not retag a step that already declares its phase", () => {
    const [step] = tagCorrectionQaPhases([{ agentId: "qa", qaPhase: "exec", task: "Define acceptance criteria" }]);
    assert.equal(step.qaPhase, "exec");
  });

  it("appends the literal contract keys to spec tasks and leaves other tasks untouched", () => {
    const out = ensureQaSpecFormatInTasks([
      { agentId: "qa", qaPhase: "spec", task: "Define acceptance criteria." },
      { agentId: "dev-frontend", task: "Implement it." },
    ]);
    assert.match(out[0].task, /acceptance_criteria:/);
    assert.match(out[0].task, /test_strategy:/);
    assert.match(out[0].task, /validation_commands:/);
    assert.equal(out[1].task, "Implement it.");
    const again = ensureQaSpecFormatInTasks(out);
    assert.equal(again[0].task, out[0].task);
  });

  it("appends the suffix when a spec task only names acceptance_criteria", () => {
    const [step] = ensureQaSpecFormatInTasks([
      { agentId: "qa", qaPhase: "spec", task: "Output acceptance_criteria: for the feature." },
    ]);
    assert.match(step.task, /test_strategy:/);
    assert.match(step.task, /validation_commands:/);
    const again = ensureQaSpecFormatInTasks([step]);
    assert.equal(again[0].task, step.task);
  });

  it("shouldEmitQaReviewRecord allows QA_EXEC", () => {
    assert.equal(shouldEmitQaReviewRecord("qa", { qaPhase: "exec" }), true);
  });

  it("buildReviewRecord for QA_EXEC", () => {
    const specOutput = [
      "test_strategy: unit",
      "acceptance_criteria:",
      "  - divide by zero throws",
      "validation_commands:",
      "  - npm test",
    ].join("\n");
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
