"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,
  validateHandoffForMode,
} = require("../qa-spec-flow");
const { validateHandoffStructure } = require("../orchestrator");

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
