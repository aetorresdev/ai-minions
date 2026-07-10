"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  FAILURE_MODES,
  FAILURE_MODE_TAXONOMY,
  UNKNOWN_FAILURE,
  simulateToolFailure,
  classifyToolFailure,
  loadChaosToolFailureFixtures,
  runAllChaosToolFailureFixtures,
  assertFixtureFailureModeCoverage,
  evaluateChaosToolFailureScenario,
} = require("../security/chaos-tool-failure-eval");

describe("chaos-tool-failure-eval — fixture harness", () => {
  it("loads versioned fixture matrix", () => {
    const fx = loadChaosToolFailureFixtures();
    assert.equal(fx.version, "chaos-tool-failure-fixtures.orchestrator.v1");
    assert.equal(fx.scenarios.length, 6);
    const coverage = assertFixtureFailureModeCoverage(fx.scenarios);
    assert.equal(coverage.ok, true, `missing failure modes: ${coverage.missing.join(", ")}`);
  });

  it("all default fixtures pass", () => {
    const summary = runAllChaosToolFailureFixtures();
    if (summary.failed > 0) {
      const detail = summary.results
        .filter((r) => !r.pass)
        .map((r) => `${r.id}: ${JSON.stringify(r.mismatches)}`)
        .join("\n");
      assert.fail(`${summary.failed} fixture(s) failed:\n${detail}`);
    }
    assert.equal(summary.failed, 0);
    assert.equal(summary.passed, summary.total);
  });

  it("each scenario emits tool_failure_eval trace payload", () => {
    const summary = runAllChaosToolFailureFixtures();
    for (const r of summary.results) {
      assert.equal(r.tool_failure_eval_emitted, true, `${r.id} missing tool_failure_eval`);
      assert.equal(r.tracePayload.event, "tool_failure_eval");
      assert.equal(r.tracePayload.failure_axis, "tool");
      assert.equal(r.tracePayload.decision, "fail_closed");
      assert.ok(r.tracePayload.reason_code.startsWith("TOOL_FAILURE_"), `${r.id} reason_code`);
      assert.equal(r.tracePayload.evidence_path, `fixture:${r.id}`);
    }
  });

  it("failure modes map to locked reason codes", () => {
    for (const mode of FAILURE_MODES) {
      const scenario = { id: mode, failure_mode: mode, tool_id: "stub_mcp" };
      const sim = simulateToolFailure(scenario);
      const cls = classifyToolFailure(scenario, sim);
      const taxonomy = FAILURE_MODE_TAXONOMY[mode];
      assert.equal(cls.reason_code, taxonomy.reason_code, mode);
      assert.equal(cls.failure_type, taxonomy.failure_type, mode);
      assert.equal(cls.decision, "fail_closed", mode);
    }
  });

  it("unknown failure_mode fails closed with TOOL_FAILURE_UNKNOWN", () => {
    const scenario = { id: "unknown_mode", failure_mode: "not_a_real_mode", tool_id: "stub_mcp" };
    const sim = simulateToolFailure(scenario);
    const cls = classifyToolFailure(scenario, sim);
    assert.equal(cls.reason_code, UNKNOWN_FAILURE.reason_code);
    assert.equal(cls.failure_type, UNKNOWN_FAILURE.failure_type);
    assert.equal(cls.decision, "fail_closed");
    assert.equal(sim.unclassified, true);
  });

  it("simulation stubs never report ok:true for chaos scenarios", () => {
    const fx = loadChaosToolFailureFixtures();
    for (const s of fx.scenarios) {
      const sim = simulateToolFailure(s);
      assert.notEqual(sim.ok, true, `${s.id} must simulate failure`);
    }
  });

  it("evaluateChaosToolFailureScenario matches fixture expected block", () => {
    const fx = loadChaosToolFailureFixtures();
    for (const s of fx.scenarios) {
      const r = evaluateChaosToolFailureScenario(s);
      assert.equal(r.pass, true, `${s.id}: ${JSON.stringify(r.mismatches)}`);
      assert.equal(r.reason_code, s.expected.reason_code);
      assert.equal(r.failure_type, s.expected.failure_type);
      assert.equal(r.decision, s.expected.decision);
    }
  });
});
