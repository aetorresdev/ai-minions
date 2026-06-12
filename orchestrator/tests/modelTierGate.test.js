"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  cloneDefaultModelPolicy,
  validateModelPolicy,
} = require("../modules/model-runtime/model-policy-config");
const {
  evaluateModelTierGate,
  buildModelTierGateDeniedPayload,
  GATE_ID,
} = require("../modules/model-runtime/model-tier-gate");
const { summarizeModelTierGateFromRows } = require("../modules/trace/model-tier-gate-summary");
const { validateTraceLine } = require("../trace-schema");

function traceEnvelopeBase(overrides = {}) {
  return {
    ts: "2026-05-18T12:00:00.000Z",
    ts_ms: 1747574400000,
    trace_schema_version: "2",
    task_id: "task-tier-gate",
    ...overrides,
  };
}

describe("model-tier-gate", () => {
  const policy = cloneDefaultModelPolicy();

  it("allows non-frontier tiers with default selection_source", () => {
    const verdict = evaluateModelTierGate(
      {
        model: "claude-sonnet-4-6",
        selection_source: "default",
        selection_reason: "model_routing_primary",
      },
      policy,
    );
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.model_tier, "standard");
  });

  it("denies frontier tier with default selection_source", () => {
    const verdict = evaluateModelTierGate(
      {
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "model_routing_primary",
      },
      policy,
    );
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason_code, "FRONTIER_UNAUTHORIZED_SOURCE");
    assert.match(verdict.denial_reason ?? "", /selection_source=default/);
  });

  it("denies frontier tier with short selection_reason", () => {
    const verdict = evaluateModelTierGate(
      {
        model: "claude-opus-4",
        selection_source: "manual",
        selection_reason: "short",
      },
      policy,
    );
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason_code, "FRONTIER_REASON_TOO_SHORT");
  });

  it("allows frontier tier with manual source and substantive reason", () => {
    const verdict = evaluateModelTierGate(
      {
        model: "claude-opus-4",
        selection_source: "manual",
        selection_reason: "operator_manual_frontier_override",
      },
      policy,
    );
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.model_tier, "frontier");
  });

  it("validateModelPolicy rejects frontier default_tier", () => {
    const raw = cloneDefaultModelPolicy();
    raw.default_tier = "frontier";
    assert.throws(() => validateModelPolicy(raw), /default_tier cannot be frontier/);
  });

  it("validateModelPolicy rejects frontier role_defaults", () => {
    const raw = cloneDefaultModelPolicy();
    raw.role_defaults.ARCHITECT = "frontier";
    assert.throws(() => validateModelPolicy(raw), /role_defaults\.ARCHITECT cannot be frontier/);
  });

  it("buildModelTierGateDeniedPayload validates against trace schema", () => {
    const verdict = evaluateModelTierGate(
      {
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "model_routing_primary",
      },
      policy,
    );
    const payload = buildModelTierGateDeniedPayload(verdict, {
      role: "DEV",
      agent: "dev-backend",
      step_id: "s1",
      model: "claude-opus-4",
      selection_source: "default",
      selection_reason: "model_routing_primary",
      policy_source: "default",
    });
    const row = traceEnvelopeBase(payload);
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
    assert.equal(payload.gate_id, GATE_ID);
  });

  it("summarizeModelTierGateFromRows counts denials and allowed frontier selections", () => {
    const summary = summarizeModelTierGateFromRows([
      {
        event: "model_tier_gate_denied",
        gate_id: GATE_ID,
        reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
        denial_reason: "blocked",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s1",
      },
      {
        event: "model_selection",
        model_tier: "frontier",
        role: "CERBERUS",
      },
    ]);
    assert.equal(summary.denied_count, 1);
    assert.equal(summary.allowed_frontier_count, 1);
    assert.equal(summary.findings[0].reason_code, "FRONTIER_UNAUTHORIZED_SOURCE");
  });
});
