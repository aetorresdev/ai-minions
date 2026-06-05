"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveMaxIterations,
  detectBlockers,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  validateStepGraph,
  edgeMeta,
  EDGE_TYPE_CATEGORY,
  extractJson,
  roundUsd6,
  parseOptionalRatioWithInvalid,
  AGENT_TO_MODE,
  VALID_WORKER_AGENTS,
} = require("../run-loop-helpers");

describe("run-loop-helpers — characterization", () => {
  it("resolveMaxIterations honors options then env default", () => {
    const prev = process.env.ORCH_MAX_ITERATIONS;
    delete process.env.ORCH_MAX_ITERATIONS;
    try {
      assert.equal(resolveMaxIterations({ maxIterations: 5 }), 5);
      assert.equal(resolveMaxIterations({}), 3);
    } finally {
      if (prev !== undefined) process.env.ORCH_MAX_ITERATIONS = prev;
    }
  });

  it("detectBlockers finds blocker lines deterministically", () => {
    const r = detectBlockers("- blocker: missing auth");
    assert.equal(r.count, 1);
    assert.match(r.items[0], /blocker/);
  });

  it("stripLeadingOwnerArchitectForDegradedMultiAgent trims leading owner/architect when dev follows", () => {
    const steps = [
      { agentId: "owner", task: "a" },
      { agentId: "architect", task: "b" },
      { agentId: "dev-backend", task: "c" },
    ];
    const out = stripLeadingOwnerArchitectForDegradedMultiAgent(steps);
    assert.equal(out.length, 1);
    assert.equal(out[0].agentId, "dev-backend");
  });

  it("validateStepGraph rejects missing agentId", () => {
    const r = validateStepGraph([{ task: "x" }], VALID_WORKER_AGENTS);
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /missing agentId/);
  });

  it("edgeMeta maps known edge types", () => {
    assert.deepEqual(edgeMeta("success"), { edge_type: "success", edge_category: "control_flow" });
    assert.equal(EDGE_TYPE_CATEGORY.gate_block, "policy");
  });

  it("extractJson parses fenced JSON", () => {
    assert.deepEqual(extractJson('```json\n{"steps":[]}\n```'), { steps: [] });
  });

  it("roundUsd6 rounds to six decimal places", () => {
    assert.equal(roundUsd6(1.23456789), 1.234568);
  });

  it("parseOptionalRatioWithInvalid rejects out-of-range values", () => {
    const prev = process.env.ORCH_BUDGET_WARNING_RATIO;
    process.env.ORCH_BUDGET_WARNING_RATIO = "2";
    try {
      const r = parseOptionalRatioWithInvalid("ORCH_BUDGET_WARNING_RATIO");
      assert.equal(r.value, null);
      assert.equal(r.invalid.reason, "out_of_range");
    } finally {
      if (prev === undefined) delete process.env.ORCH_BUDGET_WARNING_RATIO;
      else process.env.ORCH_BUDGET_WARNING_RATIO = prev;
    }
  });

  it("AGENT_TO_MODE covers worker agents used by run loop", () => {
    for (const id of ["dev-backend", "qa", "cerberus"]) {
      assert.ok(AGENT_TO_MODE[id]);
      assert.ok(VALID_WORKER_AGENTS.has(id));
    }
  });

  it("orchestrator re-exports run-loop helper surface", () => {
    const orch = require("../orchestrator");
    const rl = require("../run-loop-helpers");
    assert.equal(orch.resolveMaxIterations, rl.resolveMaxIterations);
    assert.equal(orch.detectBlockers, rl.detectBlockers);
    assert.equal(orch.validateHandoffStructure, rl.validateHandoffStructure);
    assert.equal(orch.stripLeadingOwnerArchitectForDegradedMultiAgent, rl.stripLeadingOwnerArchitectForDegradedMultiAgent);
    assert.equal(orch.validateStepGraph, rl.validateStepGraph);
    assert.equal(orch.edgeMeta, rl.edgeMeta);
    assert.equal(orch.EDGE_TYPE_CATEGORY, rl.EDGE_TYPE_CATEGORY);
  });
});
