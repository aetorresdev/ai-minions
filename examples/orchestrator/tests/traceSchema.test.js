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
