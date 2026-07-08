"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRunStateVisibility,
  deriveModelSelectionContext,
  deriveBlockingReasonCode,
  deriveLastSuccessfulPhase,
} = require("../../modules/operator/operator-trace-summary");
const { buildOperatorTraceSummary } = require("../../modules/operator/operator-trace-summary");

test("deriveModelSelectionContext reads latest model_selection row", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "m1",
      model_backend: "ollama",
    },
    {
      event: "model_selection",
      model: "qwen2.5-coder:7b",
      model_tier: "cheap",
      selection_reason: "default_model from .ai-minions/model-policy.yaml",
    },
  ];
  const ctx = deriveModelSelectionContext(rows);
  assert.equal(ctx.availability, "available");
  assert.equal(ctx.model, "qwen2.5-coder:7b");
  assert.equal(ctx.model_backend, "ollama");
  assert.match(ctx.selection_reason, /default_model/);
});

test("deriveModelSelectionContext unavailable without model_selection", () => {
  const ctx = deriveModelSelectionContext([
    { event: "session_start", model_backend: "ollama" },
  ]);
  assert.equal(ctx.availability, "unavailable");
  assert.equal(ctx.model, null);
  assert.equal(ctx.model_backend, "ollama");
});

test("buildRunStateVisibility includes run state visibility contract fields", () => {
  const rows = [
    { event: "session_start", task_id: "rsv-1", flow_mode: "single_agent" },
    {
      event: "model_selection",
      model: "llama3",
      model_tier: "standard",
      selection_reason: "policy:local_only",
      model_backend: "ollama",
    },
    { event: "session_end", task_id: "rsv-1", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/traces/rsv-1.jsonl" });
  const runState = buildRunStateVisibility(summary, rows, {
    attach_bundle: "/bundles/rsv-1",
    report_path: "/bundles/rsv-1/inspect-report.json",
    privacy_notice_status: "privacy_scan_present",
  });
  assert.equal(runState.result_code, "RUN_FOUND");
  assert.equal(runState.model, "llama3");
  assert.equal(runState.attach_available, true);
  assert.equal(runState.attach_result_code, "RUN_ATTACH_AVAILABLE");
  assert.equal(runState.privacy_notice_status, "privacy_scan_present");
  assert.ok(runState.evidence_paths.includes("/traces/rsv-1.jsonl"));
});

test("deriveBlockingReasonCode prefers model_tier_gate_denied reason_code", () => {
  const rows = [
    {
      event: "model_tier_gate_denied",
      reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
    },
  ];
  const summary = buildOperatorTraceSummary(rows, { trace_file: "/t.jsonl" });
  assert.equal(
    deriveBlockingReasonCode(summary, rows),
    "FRONTIER_UNAUTHORIZED_SOURCE",
  );
});

test("deriveLastSuccessfulPhase returns complete phase for successful run", () => {
  const rows = [
    { event: "session_start", task_id: "ok" },
    { event: "agent_done", agent: "dev-backend", phase: "execute" },
    { event: "session_end", done: true },
  ];
  assert.equal(deriveLastSuccessfulPhase(rows), "complete");
});
