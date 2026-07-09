"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine } = require("../../modules/trace/trace-schema");
const {
  createContextHygieneTracker,
  emitContextHygieneSignal,
  DEFAULT_THRESHOLDS,
} = require("../../modules/trace/context-hygiene-signals");

function wrapTrace() {
  /** @type {Array<Record<string, unknown>>} */
  const lines = [];
  /** @param {string} _taskId @param {Record<string, unknown>} ev */
  function traceEvent(_taskId, ev) {
    const record = {
      ...ev,
      task_id: "t-hygiene",
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

test("context_growth_rate when prompt tokens jump between observations", () => {
  const tracker = createContextHygieneTracker({ ...DEFAULT_THRESHOLDS, largePromptTokens: 100 });
  const first = tracker.observeContextStats("dev-backend", 1, { ollama_prompt_tokens: 1000 });
  assert.equal(first.length, 0);
  const second = tracker.observeContextStats("dev-backend", 1, { ollama_prompt_tokens: 2000 });
  assert.ok(second.some((s) => s.signal_id === "context_growth_rate"));
});

test("repeated_large_input_detected on duplicate large fingerprint", () => {
  const tracker = createContextHygieneTracker({ ...DEFAULT_THRESHOLDS, largePromptTokens: 100 });
  const large = { ollama_prompt_tokens: 9000 };
  tracker.observeContextStats("qa", 2, large);
  const again = tracker.observeContextStats("qa", 2, large);
  assert.ok(again.some((s) => s.signal_id === "repeated_large_input_detected"));
});

test("compaction_recommended and fresh_run_recommended synthetic paths", () => {
  const tracker = createContextHygieneTracker({
    ...DEFAULT_THRESHOLDS,
    largePromptTokens: 100,
    freshRunIterationMin: 3,
    compactionIterationMin: 2,
  });
  tracker.observeContextStats("architect", 1, { ollama_prompt_tokens: 5000 });
  const mid = tracker.observeContextStats("dev-backend", 2, { ollama_prompt_tokens: 8500 });
  assert.ok(mid.some((s) => s.signal_id === "compaction_recommended"));
  const late = tracker.observeContextStats("qa", 3, { ollama_prompt_tokens: 8600 });
  assert.ok(late.some((s) => s.signal_id === "fresh_run_recommended"));
});

test("emitContextHygieneSignal produces schema-valid trace row", () => {
  const { traceEvent, lines } = wrapTrace();
  emitContextHygieneSignal(
    traceEvent,
    "t-hygiene",
    "qa",
    {
      signal_id: "context_growth_rate",
      severity: "warn",
      suggestion: "test",
      metrics: { growth_ratio: 2 },
    },
    { iteration: 1, step_id: "s1" },
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, "context_hygiene_signal");
  assert.equal(lines[0].signal_id, "context_growth_rate");
});

test("context_hygiene_signal without signal_id fails schema validation", () => {
  const v = validateTraceLine({
    ts: new Date(1).toISOString(),
    ts_ms: 1,
    trace_schema_version: "2",
    task_id: "t-hygiene",
    event: "context_hygiene_signal",
    agent: "qa",
    active_role: "qa",
    severity: "warn",
    suggestion: "missing signal_id",
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors?.length);
});
