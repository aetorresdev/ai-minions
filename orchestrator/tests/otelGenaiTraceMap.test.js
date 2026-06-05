"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  OTEL_GENAI_SEMCONV_PIN,
  traceIdForTask,
  mapTraceRowToOtelSpan,
  mapTraceRowsToOtelSpans,
  rowToSpanAttributes,
} = require("../otel-genai-trace-map");

describe("otel-genai-trace-map", () => {
  it("maps session_start to orchestrator.run root span with stable trace id", () => {
    const row = {
      ts_ms: 1713182400000,
      trace_schema_version: "2",
      task_id: "task-otel-1",
      event: "session_start",
      flow_mode: "single_agent",
      goal: "secret goal should drop by default",
    };
    const span = mapTraceRowToOtelSpan(row, 0);
    assert.ok(span);
    assert.equal(span.name, "orchestrator.run");
    assert.equal(span.kind, "SERVER");
    assert.equal(span.traceId, traceIdForTask("task-otel-1"));
    assert.equal(span.parentSpanId, undefined);
    const keys = span.attributes.map((a) => a.key);
    assert.ok(keys.includes("ai_minions.event"));
    assert.ok(!keys.includes("ai_minions.goal"));
  });

  it("maps permission_check and redacts secret-shaped values in attributes", () => {
    const token = `Bearer ${"z".repeat(24)}`;
    const attrs = rowToSpanAttributes({
      event: "permission_check",
      task_id: "task-otel-2",
      trace_schema_version: "2",
      decision: "deny",
      reason_code: "mcp_trust_warn_deny",
      detail: `blocked ${token}`,
    });
    const detail = attrs.find((a) => a.key === "ai_minions.detail");
    assert.ok(detail);
    assert.match(String(detail.value), /\[REDACTED:bearer\]/);
    assert.ok(!String(detail.value).includes(token));
  });

  it("maps context_stats with GenAI usage attributes", () => {
    const span = mapTraceRowToOtelSpan({
      event: "context_stats",
      task_id: "task-otel-3",
      trace_schema_version: "2",
      ts_ms: 1000,
      agent: "dev-backend",
      backend: "ollama",
      ollama_prompt_tokens: 11,
      ollama_completion_tokens: 22,
    }, 2);
    assert.ok(span);
    assert.equal(span.name, "gen_ai.chat");
    const byKey = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    assert.equal(byKey['gen_ai.usage.input_tokens'], 11);
    assert.equal(byKey['gen_ai.usage.output_tokens'], 22);
    assert.equal(byKey['gen_ai.system'], "ollama");
  });

  it("mapTraceRowsToOtelSpans wires parentSpanId to session_start root", () => {
    const rows = [
      { event: "session_start", task_id: "task-otel-4", trace_schema_version: "2", ts_ms: 1 },
      { event: "permission_check", task_id: "task-otel-4", trace_schema_version: "2", ts_ms: 2, decision: "allow" },
      { event: "unknown_event", task_id: "task-otel-4", trace_schema_version: "2", ts_ms: 3 },
    ];
    const out = mapTraceRowsToOtelSpans(rows);
    assert.equal(out.semconv_pin, OTEL_GENAI_SEMCONV_PIN);
    assert.equal(out.task_id, "task-otel-4");
    assert.equal(out.spans.length, 2);
    assert.equal(out.spans[0].name, "orchestrator.run");
    assert.ok(out.spans[1].parentSpanId);
    assert.equal(out.spans[1].parentSpanId, out.spans[0].spanId);
  });

  it("captureContent opt-in includes goal attribute", () => {
    const attrs = rowToSpanAttributes(
      { event: "session_start", task_id: "t", goal: "visible" },
      { captureContent: true },
    );
    assert.ok(attrs.some((a) => a.key === "ai_minions.goal" && a.value === "visible"));
  });
});
