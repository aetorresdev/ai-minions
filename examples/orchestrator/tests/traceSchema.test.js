"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const { validateTraceLine, parseTraceLine } = require("../trace-schema");
const { transitionReason } = require("../orchestrator");

test("validateTraceLine accepts session_start v2 envelope", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: "x",
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true);
});

test("validateTraceLine rejects iteration_done without reason_code", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "done",
    transition_reason: { type: "DONE" },
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("reason_code")));
});

test("validateTraceLine accepts iteration_done from transitionReason()", () => {
  const base = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "done",
    summary: "ok",
  };
  const row = { ...base, ...transitionReason("DONE") };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true);
  assert.equal(row.transition_reason.reason_code, "RUN_COMPLETED");
});

test("parseTraceLine strict throws on invalid iteration_done", () => {
  const line = JSON.stringify({
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1,
    trace_schema_version: "2",
    task_id: "t",
    event: "iteration_done",
    iteration: 1,
    outcome: "done",
    transition_reason: { type: "DONE" },
  });
  assert.throws(() => parseTraceLine(line, { strict: true }), /reason_code|schema/i);
});

test("validateTraceLine rejects unsupported trace_schema_version string (policy before Ajv)", () => {
  const base = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    task_id: "task-abc",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: "x",
  };
  for (const trace_schema_version of ["99", "3", "2.0", "v2", ""]) {
    const v = validateTraceLine({ ...base, trace_schema_version });
    assert.equal(v.ok, false, `expected invalid version: ${JSON.stringify(trace_schema_version)}`);
    assert.ok(
      v.errors.some((e) => /this binary only accepts|trace_schema_version/i.test(e)),
      `errors should include policy or field: ${v.errors.join(" | ")}`,
    );
  }
});

test("validateTraceLine rejects missing trace_schema_version (policy)", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    task_id: "task-abc",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: "x",
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /missing|this binary only accepts/i.test(e)), v.errors.join(" | "));
});

test("validateTraceLine rejects trace_schema_version wrong JSON type", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: 2,
    task_id: "task-abc",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: "x",
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /trace_schema_version/i.test(e)));
});

test("parseTraceLine strict throws on unsupported trace_schema_version", () => {
  const line = JSON.stringify({
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1,
    trace_schema_version: "99",
    task_id: "t",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: "x",
  });
  assert.throws(() => parseTraceLine(line, { strict: true }), /this binary only accepts|trace_schema_version|schema/i);
});
