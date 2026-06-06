"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTEXT_TYPES,
  FORBIDDEN_SOVEREIGN_FOR_UNTRUSTED,
  classifyContextAuthority,
  loadUntrustedContextFixtures,
  runAllUntrustedContextFixtures,
  assertFixtureContextTypeCoverage,
  evaluateUntrustedContextScenario,
} = require("../security/untrusted-context-eval");

describe("untrusted-context-eval — fixture harness", () => {
  it("loads versioned fixture matrix", () => {
    const fx = loadUntrustedContextFixtures();
    assert.equal(fx.version, "untrusted-context-fixtures.orchestrator.v1");
    assert.ok(fx.scenarios.length >= 10);
    const coverage = assertFixtureContextTypeCoverage(fx.scenarios);
    assert.equal(coverage.ok, true, `missing context types: ${coverage.missing.join(", ")}`);
  });

  it("all default fixtures pass", () => {
    const summary = runAllUntrustedContextFixtures();
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

  it("each scenario emits context_authority_check trace payload", () => {
    const summary = runAllUntrustedContextFixtures();
    for (const r of summary.results) {
      assert.equal(r.context_authority_check_emitted, true, `${r.id} missing context_authority_check`);
      assert.equal(r.tracePayload.event, "context_authority_check");
      assert.ok(r.tracePayload.authority_tier);
      assert.ok(r.tracePayload.instruction_source);
    }
  });

  it("untrusted context types never classify as system_policy or user_instruction", () => {
    for (const context_type of CONTEXT_TYPES) {
      const c = classifyContextAuthority({ context_type });
      assert.equal(c.ok, true);
      for (const forbidden of FORBIDDEN_SOVEREIGN_FOR_UNTRUSTED) {
        assert.notEqual(
          c.authority_tier,
          forbidden,
          `${context_type} must not map to ${forbidden}`,
        );
      }
      assert.equal(c.is_sovereign_instruction, false);
    }
  });

  it("injected fixtures always ignore_instruction", () => {
    const fx = loadUntrustedContextFixtures();
    const injected = fx.scenarios.filter((s) => s.variant === "injected");
    assert.ok(injected.length >= 5);
    for (const s of injected) {
      const r = evaluateUntrustedContextScenario(s);
      assert.equal(r.pass, true, `${s.id}: ${JSON.stringify(r.mismatches)}`);
      assert.equal(r.decision, "ignore_instruction");
      assert.equal(r.injection_detected, true);
    }
  });

  it("benign fixtures accept_as_data without promoting authority", () => {
    const fx = loadUntrustedContextFixtures();
    const benign = fx.scenarios.filter((s) => s.variant === "benign");
    assert.ok(benign.length >= 5);
    for (const s of benign) {
      const r = evaluateUntrustedContextScenario(s);
      assert.equal(r.pass, true, `${s.id}: ${JSON.stringify(r.mismatches)}`);
      assert.equal(r.decision, "accept_as_data");
      assert.equal(r.injection_detected, false);
    }
  });

  it("trace distinguishes instruction_source tiers", () => {
    const fx = loadUntrustedContextFixtures();
    const sources = new Set(
      fx.scenarios.map((s) => evaluateUntrustedContextScenario(s).instruction_source),
    );
    assert.ok(sources.has("retrieved_context"));
    assert.ok(sources.has("tool_output"));
    assert.equal(sources.has("system_policy"), false);
  });
});
