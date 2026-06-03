"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateApprovalGate,
  evaluateDevExecutionGate,
  buildApprovalSkippedPayload,
  parseGateFieldsFromHandoffYaml,
  buildGateContextFromArtifacts,
  cerberusDetectInvalidApprovalBypass,
  normalizeGateContext,
} = require("../approval-policy-gate");

test("vague idea requires human approval for product_scope (risk_based)", () => {
  const ctx = normalizeGateContext({ input_type: "idea" });
  const ev = evaluateApprovalGate("product_scope", ctx, "risk_based");
  assert.equal(ev.human_required, true);
  assert.equal(ev.validation_required, true);
});

test("well-defined epic may skip human product_scope when validations pass", () => {
  const ctx = normalizeGateContext({
    input_type: "epic",
    required_fields_present: true,
    unresolved_assumptions: 0,
    risk_level: "low",
    scope_validation_passed: true,
    human_product_scope_granted: false,
  });
  const ev = evaluateApprovalGate("product_scope", ctx, "risk_based");
  assert.equal(ev.human_required, false);
  assert.equal(ev.skip_reason_code, "POLICY_EPIC_LOW_RISK");
  const dev = evaluateDevExecutionGate(ctx, {
    product_scope: "risk_based",
    architecture_plan: "risk_based",
    dev_execution: "auto",
  });
  assert.equal(dev.allowed, false);
});

test("dev execution allowed with traced skips for low-risk epic", () => {
  const ctx = normalizeGateContext({
    input_type: "epic",
    required_fields_present: true,
    unresolved_assumptions: 0,
    risk_level: "low",
    scope_validation_passed: true,
    architecture_validation_passed: true,
  });
  const dev = evaluateDevExecutionGate(ctx, {
    product_scope: "risk_based",
    architecture_plan: "risk_based",
    dev_execution: "risk_based",
  });
  assert.equal(dev.allowed, true);
  assert.ok(dev.traceSkips.length >= 1);
});

test("dev fail-closed when validation missing", () => {
  const ctx = normalizeGateContext({
    input_type: "epic",
    required_fields_present: true,
    unresolved_assumptions: 0,
    risk_level: "low",
  });
  const dev = evaluateDevExecutionGate(ctx, {
    product_scope: "risk_based",
    architecture_plan: "risk_based",
    dev_execution: "risk_based",
  });
  assert.equal(dev.allowed, false);
  assert.match(dev.reason, /validation not passed/);
});

test("buildApprovalSkippedPayload validates enums", () => {
  const row = buildApprovalSkippedPayload({
    gate_id: "dev_execution",
    policy_mode: "auto",
    reason_code: "POLICY_AUTO_MODE",
    risk_level: "low",
  });
  assert.equal(row.event, "approval_skipped");
  assert.equal(row.gate_id, "dev_execution");
});

test("parseGateFieldsFromHandoffYaml extracts epic hints", () => {
  const yaml = `
input_type: epic
required_fields_present: true
unresolved_assumptions: 0
risk_level: low
scope_validation_passed: true
architecture_validation_passed: true
`;
  const partial = parseGateFieldsFromHandoffYaml(yaml);
  const ctx = normalizeGateContext(partial);
  assert.equal(ctx.input_type, "epic");
  assert.equal(ctx.scope_validation_passed, true);
});

test("buildGateContextFromArtifacts merges owner and architect handoffs", () => {
  const ctx = buildGateContextFromArtifacts([
    {
      agentId: "owner",
      handoffYaml: "input_type: epic\nscope_validation_passed: true\n",
    },
    {
      agentId: "architect",
      handoffYaml: "architecture_validation_passed: true\naffected_area: docs\n",
    },
  ]);
  assert.equal(ctx.scope_validation_passed, true);
  assert.equal(ctx.architecture_validation_passed, true);
});

test("cerberusDetectInvalidApprovalBypass flags missing policy traces", () => {
  const r = cerberusDetectInvalidApprovalBypass([]);
  assert.equal(r.invalid, true);
  assert.ok(r.findings.length > 0);
});
