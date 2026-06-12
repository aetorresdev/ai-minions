"use strict";

const assert = require("node:assert/strict");
const cp = require("child_process");
const { describe, it } = require("node:test");

cp.spawnSync = () => ({
  error: null,
  status: 0,
  stdout: "files_read:\n  - utils.js\nfiles_modified:\n  - utils.js\nvalidation_run: node -c utils.js → exit 0\n",
  stderr: "",
});

const { validateTraceLine } = require("../trace-schema");
const {
  inferModelTier,
  buildModelSelectionPayload,
  emitModelSelection,
} = require("../modules/trace/model-selection-trace");
const {
  askAgent,
  setModelSelectionTraceReporter,
  describeModelSelectionSource,
  clearDegradedAgents,
  MODEL_ROUTING,
} = require("../agents");

function traceEnvelopeBase(overrides = {}) {
  return {
    ts: "2026-05-18T12:00:00.000Z",
    ts_ms: 1747574400000,
    trace_schema_version: "2",
    task_id: "task-model-gov",
    ...overrides,
  };
}

function modelSelectionBase(overrides = {}) {
  return traceEnvelopeBase({
    event: "model_selection",
    role: "DEV",
    step_id: "s-dev-1",
    model: "claude-sonnet-4-6",
    model_tier: "standard",
    selection_source: "default",
    selection_reason: "model_routing_primary",
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    estimated_cost_usd: 0,
    agent: "dev-backend",
    iteration: 1,
    ...overrides,
  });
}

describe("model-selection trace", () => {
  it("inferModelTier maps known model ids", () => {
    assert.equal(inferModelTier("claude-haiku-4-5-20251001"), "cheap");
    assert.equal(inferModelTier("claude-sonnet-4-6"), "standard");
    assert.equal(inferModelTier("claude-opus-4-20250514"), "frontier");
  });

  it("validateTraceLine accepts model_selection envelope", () => {
    const v = validateTraceLine(modelSelectionBase());
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("validateTraceLine rejects model_selection without model_tier", () => {
    const row = modelSelectionBase();
    delete row.model_tier;
    const v = validateTraceLine(row);
    assert.equal(v.ok, false);
  });

  it("validateTraceLine rejects frontier tier without substantive selection_reason", () => {
    const v = validateTraceLine(
      modelSelectionBase({
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_reason: "x",
      }),
    );
    assert.equal(v.ok, false);
  });

  it("validateTraceLine accepts frontier tier with selection_reason", () => {
    const v = validateTraceLine(
      modelSelectionBase({
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_reason: "operator_manual_frontier_override",
      }),
    );
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("buildModelSelectionPayload rejects frontier without explicit selection_reason", () => {
    assert.throws(
      () => buildModelSelectionPayload({
        role: "DEV",
        step_id: "s1",
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "",
      }),
      /selection_reason is required/,
    );
    assert.throws(
      () => buildModelSelectionPayload({
        role: "DEV",
        step_id: "s1",
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "short",
      }),
      /at least 8 characters/,
    );
  });

  it("buildModelSelectionPayload supplies default cost estimates as zero", () => {
    const payload = buildModelSelectionPayload({
      role: "QA",
      step_id: "s-qa",
      model: "claude-sonnet-4-6",
      selection_source: "default",
      selection_reason: "model_routing_primary",
    });
    assert.equal(payload.estimated_cost_usd, 0);
    assert.equal(payload.model_tier, "standard");
  });

  it("emitModelSelection writes schema-valid trace rows", () => {
    const lines = [];
    emitModelSelection((_taskId, payload) => {
      const row = traceEnvelopeBase(payload);
      const v = validateTraceLine(row);
      assert.equal(v.ok, true, (v.errors || []).join(" | "));
      lines.push(row);
    }, "task-model-gov", {
      role: "ORCHESTRATOR",
      step_id: "phase:plan",
      model: "qwen2.5-coder:7b",
      selection_source: "default",
      selection_reason: "model_routing_primary",
      agent: "orchestrator",
      iteration: 0,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].event, "model_selection");
  });

  it("describeModelSelectionSource returns default without overrides", () => {
    const src = describeModelSelectionSource("dev-backend");
    assert.equal(src.selection_source, "default");
    assert.match(src.selection_reason, /model_routing/);
  });

  it("askAgent enforces frontier gate even without trace reporter", async () => {
    clearDegradedAgents();
    const originalPrimary = MODEL_ROUTING["dev-backend"].primary;
    const originalHarness = process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;
    setModelSelectionTraceReporter(null);
    process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = "1";
    MODEL_ROUTING["dev-backend"].primary = "claude-opus-4-20250514";
    try {
      await assert.rejects(
        () => askAgent("dev-backend", "test", { cwd: process.cwd() }),
        (err) => err && err.gate_id === "model_tier_gate"
          && /FRONTIER_UNAUTHORIZED_SOURCE|selection_source=default/.test(String(err.message)),
      );
    } finally {
      MODEL_ROUTING["dev-backend"].primary = originalPrimary;
      if (originalHarness === undefined) delete process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;
      else process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = originalHarness;
    }
  });

  it("askAgent emits model_selection when reporter is wired", async () => {
    clearDegradedAgents();
    const events = [];
    setModelSelectionTraceReporter((payload) => events.push(payload));
    try {
      const { output } = await askAgent("dev-backend", "implement X", {
        traceContext: { step_id: "s1", iteration: 1 },
      });
      assert.ok(output);
      assert.equal(events.length, 1);
      assert.equal(events[0].event, "model_selection");
      assert.equal(events[0].role, "DEV");
      assert.equal(events[0].step_id, "s1");
      const v = validateTraceLine(traceEnvelopeBase(events[0]));
      assert.equal(v.ok, true, (v.errors || []).join(" | "));
    } finally {
      setModelSelectionTraceReporter(null);
    }
  });
});
