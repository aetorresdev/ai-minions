"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const { validateTraceLine, parseTraceLine, getValidationMetrics, resetValidationMetrics } = require("../trace-schema");
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

test("policy error does not expose raw value of trace_schema_version", () => {
  const sensitiveValue = '{"injected":"payload","secret":"abc123"}';
  const record = { trace_schema_version: sensitiveValue };
  const v = validateTraceLine(record);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.every((e) => !e.includes(sensitiveValue)),
    `error must not contain raw value; got: ${v.errors.join(" | ")}`,
  );
  assert.ok(
    v.errors.some((e) => e.includes("<string>")),
    `error should include type hint; got: ${v.errors.join(" | ")}`,
  );
});

test("policy error for non-string trace_schema_version does not expose raw value", () => {
  const record = { trace_schema_version: { nested: "object", secret: "leak" } };
  const v = validateTraceLine(record);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.every((e) => !e.includes("leak") && !e.includes("nested")),
    `error must not contain raw object fields; got: ${v.errors.join(" | ")}`,
  );
  assert.ok(
    v.errors.some((e) => e.includes("<object>")),
    `error should include type hint; got: ${v.errors.join(" | ")}`,
  );
});

test("Ajv validation error exposes only root field path, not nested subpath", () => {
  const record = {
    trace_schema_version: "2",
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    task_id: "task-abc",
    event: "iteration_done",
    flow_mode: "single_agent",
    max_iterations: 1,
    iteration: 1,
    outcome: "done",
    cwd: "/tmp",
    goal: "x",
    transition_reason: { type: "done", details: { secret_key: "/home/user/.aws/credentials" } },
  };
  const v = validateTraceLine(record);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.every((e) => !e.includes("secret_key") && !e.includes("credentials")),
    `error must not expose nested path or values; got: ${v.errors.join(" | ")}`,
  );
  assert.ok(
    v.errors.some((e) => e.startsWith("/transition_reason")),
    `error should reference root field only; got: ${v.errors.join(" | ")}`,
  );
});

test("Ajv validation error does not expose raw field value", () => {
  const sensitiveGoal = "sensitive payload: token=abc123&secret=xyz";
  const record = {
    trace_schema_version: "2",
    ts: "not-a-date",
    ts_ms: "not-a-number",
    task_id: "task-abc",
    event: "session_start",
    flow_mode: "single_agent",
    max_iterations: 1,
    cwd: "/tmp",
    goal: sensitiveGoal,
  };
  const v = validateTraceLine(record);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.every((e) => !e.includes(sensitiveGoal)),
    `Ajv error must not contain raw goal value; got: ${v.errors.join(" | ")}`,
  );
});

// validation metrics
const BASE = {
  ts: "2026-04-15T12:00:00.000Z",
  ts_ms: 1713182400000,
  task_id: "task-abc",
  event: "session_start",
  flow_mode: "single_agent",
  max_iterations: 1,
  cwd: "/tmp",
  goal: "x",
};

test("getValidationMetrics increments policy_missing_version on missing/non-string version", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE });
  validateTraceLine({ ...BASE, trace_schema_version: 2 });
  validateTraceLine({ ...BASE, trace_schema_version: null });
  const m = getValidationMetrics();
  assert.equal(m.policy_missing_version, 3);
  assert.equal(m.policy_unsupported_version, 0);
  assert.equal(m.ajv_schema_error, 0);
});

test("getValidationMetrics increments policy_unsupported_version on unknown string version", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "99" });
  validateTraceLine({ ...BASE, trace_schema_version: "1" });
  const m = getValidationMetrics();
  assert.equal(m.policy_unsupported_version, 2);
  assert.equal(m.policy_missing_version, 0);
  assert.equal(m.ajv_schema_error, 0);
});

test("getValidationMetrics increments ajv_schema_error on schema violation", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "2", ts: "not-a-date" });
  const m = getValidationMetrics();
  assert.equal(m.ajv_schema_error, 1);
  assert.equal(m.policy_missing_version, 0);
  assert.equal(m.policy_unsupported_version, 0);
});

test("getValidationMetrics does not increment on valid record", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "2" });
  const m = getValidationMetrics();
  assert.equal(m.policy_missing_version, 0);
  assert.equal(m.policy_unsupported_version, 0);
  assert.equal(m.ajv_schema_error, 0);
});

test("getValidationMetrics returns a snapshot copy, not a live reference", () => {
  resetValidationMetrics();
  const snap = getValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "99" });
  assert.equal(snap.policy_unsupported_version, 0, "snapshot must not reflect later increments");
});

test("rejections includes event and step_id context when available", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "99", step_id: "s1" });
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 1);
  assert.equal(m.rejections[0].reason, "policy_unsupported_version");
  assert.equal(m.rejections[0].event, "session_start");
  assert.equal(m.rejections[0].step_id, "s1");
});

test("rejections includes reason_code from transition_reason when present", () => {
  resetValidationMetrics();
  validateTraceLine({
    ...BASE,
    trace_schema_version: "99",
    event: "iteration_done",
    transition_reason: { type: "DONE", reason_code: "RUN_COMPLETED" },
  });
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 1);
  assert.equal(m.rejections[0].reason_code, "RUN_COMPLETED");
});

test("rejections omits missing context fields", () => {
  resetValidationMetrics();
  validateTraceLine({ trace_schema_version: "99" });
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 1);
  assert.ok(!("event" in m.rejections[0]));
  assert.ok(!("step_id" in m.rejections[0]));
  assert.ok(!("reason_code" in m.rejections[0]));
});

test("rejections caps at 50 entries (FIFO)", () => {
  resetValidationMetrics();
  for (let i = 0; i < 55; i++) {
    validateTraceLine({ ...BASE, trace_schema_version: "99", step_id: `s${i}` });
  }
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 50);
  assert.equal(m.rejections[0].step_id, "s5");
  assert.equal(m.rejections[49].step_id, "s54");
});

test("rejections snapshot is independent of subsequent resets", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "99" });
  const snap = getValidationMetrics();
  resetValidationMetrics();
  assert.equal(snap.rejections.length, 1);
  assert.equal(getValidationMetrics().rejections.length, 0);
});

// validateTraceRunGraph — run-level graph consistency
const { validateTraceRunGraph } = require("../trace-schema");

test("validateTraceRunGraph passes on empty line array", () => {
  const r = validateTraceRunGraph([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("validateTraceRunGraph passes when all parent_step_ids reference earlier step_ids", () => {
  const lines = [
    { event: "agent_start", step_id: "s1", parent_step_id: null },
    { event: "agent_start", step_id: "s2", parent_step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("validateTraceRunGraph detects orphan parent_step_id", () => {
  const lines = [
    { event: "agent_start", step_id: "s2", parent_step_id: "s_missing" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].type, "orphan_parent");
  assert.equal(r.violations[0].parent_step_id, "s_missing");
});

test("validateTraceRunGraph detects duplicate step_id", () => {
  const lines = [
    { event: "agent_start", step_id: "s1" },
    { event: "agent_done",  step_id: "s1" },
    { event: "agent_start", step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "duplicate_step_id" && v.step_id === "s1"));
});

test("validateTraceRunGraph ignores lines without step_id or parent_step_id", () => {
  const lines = [
    { event: "session_start" },
    { event: "context_stats", ts_ms: 1 },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true);
});

test("validateTraceRunGraph reports multiple violations independently", () => {
  const lines = [
    { event: "agent_start", step_id: "s1", parent_step_id: "ghost" },
    { event: "agent_start", step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "orphan_parent"));
  assert.ok(r.violations.some((v) => v.type === "duplicate_step_id"));
});
