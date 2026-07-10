"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  RUNTIME_EVIDENCE_SOURCE,
  RUNTIME_EVIDENCE_TRUST,
  runContextAuthorityGate,
  enforceContextAuthorityGate,
} = require("../security/context-authority-runtime-gate");
const {
  loadUntrustedContextFixtures,
  evaluateUntrustedContextScenario,
} = require("../security/untrusted-context-eval");

describe("context-authority-runtime-gate", () => {
  it("skips gate when tool call is not derived from untrusted context", () => {
    const result = runContextAuthorityGate({});
    assert.equal(result.skipped, true);
    assert.equal(result.allowed, true);
    assert.equal(result.reason_code, "context_authority_not_required");
  });

  it("unknown context_type fails closed with context_authority_unknown", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "not_a_channel",
      },
      tool: "stub_mcp.test_tool",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.decision, "block_unclassified");
    assert.equal(result.reason_code, "context_authority_unknown");
    assert.equal(result.tracePayload.event, "context_authority_check");
    assert.equal(result.tracePayload.failure_axis, "context_authority");
    assert.equal(result.tracePayload.source, RUNTIME_EVIDENCE_SOURCE);
    assert.equal(result.tracePayload.trust, RUNTIME_EVIDENCE_TRUST);
    assert.equal(result.tracePayload.next_safe_action, "escalate_to_operator");
  });

  it("benign untrusted context allows invocation and emits trace", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "document_text",
        variant: "benign",
      },
      tool: "stub_mcp.list_boards",
    });
    assert.equal(result.allowed, true);
    assert.equal(result.skipped, false);
    assert.equal(result.decision, "accept_as_data");
    assert.equal(result.reason_code, "untrusted_context_data_only");
    assert.equal(result.tracePayload.instruction_source, "retrieved_context");
  });

  it("injected untrusted context blocks invocation", () => {
    const result = runContextAuthorityGate({
      context_authority: {
        derived_from_untrusted: true,
        context_type: "fetched_web",
        variant: "injected",
        attempted_action: "invoke_shell",
      },
      tool: "stub_mcp.run_shell",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.decision, "ignore_instruction");
    assert.equal(result.reason_code, "injection_not_sovereign:invoke_shell");
    assert.equal(result.tracePayload.injection_detected, true);
    assert.equal(result.tracePayload.next_safe_action, "escalate_to_operator");
  });

  it("enforceContextAuthorityGate throws CONTEXT_AUTHORITY_DENIED on block", () => {
    assert.throws(
      () =>
        enforceContextAuthorityGate({
          context_authority: {
            derived_from_untrusted: true,
            context_type: "memory_entry",
            variant: "injected",
            attempted_action: "skip_cerberus",
          },
        }),
      (err) => err.code === "CONTEXT_AUTHORITY_DENIED",
    );
  });

  it("redteam fixture corpus aligns runtime gate with fixture harness", () => {
    const fx = loadUntrustedContextFixtures();
    for (const scenario of fx.scenarios) {
      const fixtureResult = evaluateUntrustedContextScenario(scenario);
      assert.equal(fixtureResult.pass, true, `${scenario.id}: ${JSON.stringify(fixtureResult.mismatches)}`);

      const runtimeResult = runContextAuthorityGate({
        context_authority: {
          derived_from_untrusted: true,
          context_type: scenario.context_type,
          variant: scenario.variant,
          attempted_action: scenario.attempted_action,
        },
        tool: "stub_mcp.test",
      });

      if (scenario.variant === "injected") {
        assert.equal(runtimeResult.allowed, false, scenario.id);
        assert.equal(runtimeResult.decision, "ignore_instruction", scenario.id);
      } else {
        assert.equal(runtimeResult.allowed, true, scenario.id);
        assert.equal(runtimeResult.decision, "accept_as_data", scenario.id);
      }

      assert.equal(runtimeResult.reason_code, fixtureResult.reason_code, scenario.id);
      assert.equal(runtimeResult.tracePayload.event, "context_authority_check", scenario.id);
      assert.equal(runtimeResult.tracePayload.authority_tier, fixtureResult.authority_tier, scenario.id);
      assert.equal(
        runtimeResult.tracePayload.instruction_source,
        fixtureResult.instruction_source,
        scenario.id,
      );
    }
  });
});
