"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine } = require("../../trace-schema");
const {
  emitModelFallbackLifecycleIfNeeded,
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
} = require("../../trace-lifecycle-events");

function wrapTrace() {
  /** @type {Array<Record<string, unknown>>} */
  const lines = [];
  /** @param {string} _taskId @param {Record<string, unknown>} ev */
  function traceEvent(_taskId, ev) {
    const record = {
      ...ev,
      task_id: "t-fixture",
      trace_schema_version: "2",
      ts: new Date(1).toISOString(),
      ts_ms: 1,
    };
    const v = validateTraceLine(record);
    assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
    lines.push(record);
  }
  return { traceEvent, lines };
}

test("emitModelFallbackLifecycleIfNeeded emits three schema-valid events", () => {
  const { traceEvent, lines } = wrapTrace();
  const stats = {
    model_fallback_segments: [
      {
        model_name: "m-a",
        model_backend: "claude",
        ollama_prompt_tokens: 0,
        ollama_completion_tokens: 0,
        status: "fallback_triggered",
        fallback_reason: "model_error",
        fallback_target: "m-b",
      },
      {
        model_name: "m-b",
        model_backend: "claude",
        ollama_prompt_tokens: 1,
        ollama_completion_tokens: 2,
        status: "completed",
        fallback_from: "m-a",
      },
    ],
  };
  emitModelFallbackLifecycleIfNeeded(traceEvent, "t-fixture", "qa", stats, { iteration: 2, step_id: "s-qa" });
  assert.equal(lines.length, 3);
  assert.equal(lines[0].event, "model_fallback_required");
  assert.equal(lines[1].event, "model_fallback_started");
  assert.equal(lines[2].event, "model_fallback_completed");
  assert.equal(lines[0].active_role, "qa");
  assert.equal(lines[0].target_model_name, "m-b");
  assert.equal(lines[2].target_ollama_prompt_tokens, 1);
});

test("emitModelFallbackLifecycleIfNeeded is a no-op without segments", () => {
  const { traceEvent, lines } = wrapTrace();
  emitModelFallbackLifecycleIfNeeded(traceEvent, "t-fixture", "qa", {}, { iteration: 0 });
  assert.equal(lines.length, 0);
});

test("context compaction started + completed validate", () => {
  const { traceEvent, lines } = wrapTrace();
  emitContextCompactionStarted(traceEvent, "t-fixture", "qa", { iteration: 1, step_id: "s1" });
  emitContextCompactionCompleted(
    traceEvent,
    "t-fixture",
    "qa",
    { iteration: 1, step_id: "s1" },
    { ollama_prompt_tokens: 10, ollama_completion_tokens: 20 },
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, "context_compaction_started");
  assert.equal(lines[1].event, "context_compaction_completed");
  assert.equal(lines[1].ollama_prompt_tokens, 10);
});
