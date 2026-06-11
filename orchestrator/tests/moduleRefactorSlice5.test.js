"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 5 (trace core)", () => {
  it("physical modules/trace tree exists", () => {
    for (const rel of [
      "modules/trace/index.js",
      "modules/trace/trace-schema.js",
      "modules/trace/trace-writer.js",
      "modules/trace/trace-append.js",
      "modules/trace/trace-redact.js",
      "modules/trace/trace-lifecycle-events.js",
      "modules/trace/context-hygiene-signals.js",
      "modules/trace/run-outcome-summary.js",
      "modules/trace/otel-genai-trace-map.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same trace APIs", () => {
    const shimSchema = require("../trace-schema");
    const canonSchema = require("../modules/trace/trace-schema");
    assert.equal(shimSchema.TRACE_LINE_WRITER_VERSION, canonSchema.TRACE_LINE_WRITER_VERSION);
    assert.equal(typeof shimSchema.validateTraceLine, "function");

    const shimWriter = require("../trace-writer");
    const canonWriter = require("../modules/trace/trace-writer");
    assert.equal(shimWriter.TRACE_SCHEMA_VERSION, canonWriter.TRACE_SCHEMA_VERSION);
    assert.equal(typeof shimWriter.traceEvent, "function");

    const shimOutcome = require("../run-outcome-summary");
    const canonOutcome = require("../modules/trace/run-outcome-summary");
    assert.equal(typeof shimOutcome.buildRunOutcomeSummary, "function");
    assert.equal(typeof shimOutcome.formatRunOutcomeSummaryLines, "function");
  });

  it("modules/trace index aggregates core exports", () => {
    const trace = require("../modules/trace");
    assert.equal(typeof trace.validateTraceLine, "function");
    assert.equal(typeof trace.traceEvent, "function");
    assert.equal(typeof trace.buildRunOutcomeSummary, "function");
    assert.equal(typeof trace.mapTraceRowsToOtelSpans, "function");
  });

  it("trace-schema resolves bundled schema from modules/trace", () => {
    const { validateTraceLine } = require("../modules/trace/trace-schema");
    const row = {
      ts: "2026-04-15T12:00:00.000Z",
      ts_ms: 1713182400000,
      trace_schema_version: "2",
      task_id: "slice5-fixture",
      event: "session_start",
      flow_mode: "single_agent",
      max_iterations: 1,
      cwd: "/tmp",
      goal: "x",
    };
    const result = validateTraceLine(row);
    assert.equal(result.ok, true, result.errors?.join("; "));
  });
});
