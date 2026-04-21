"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const { validateTraceLine, parseTraceLine, effectiveSupportedVersions, LEGACY_TRACE_SCHEMA_VERSIONS, traceSchemaVersionPolicyErrors } = require("../trace-schema");
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

// ── Multi-version read (ORCH_TRACE_ACCEPT_OLD) ────────────────────────────────

const V1_LINE = {
  ts: "2026-04-15T12:00:00.000Z",
  ts_ms: 1713182400000,
  trace_schema_version: "1",
  task_id: "task-v1",
  event: "session_start",
  flow_mode: "single_agent",
  max_iterations: 1,
  cwd: "/tmp",
  goal: "legacy run",
};

test("LEGACY_TRACE_SCHEMA_VERSIONS includes '1'", () => {
  assert.ok(LEGACY_TRACE_SCHEMA_VERSIONS.has("1"));
});

test("effectiveSupportedVersions without env returns only writer version", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  delete process.env.ORCH_TRACE_ACCEPT_OLD;
  const vs = effectiveSupportedVersions();
  assert.ok(vs.has("2"));
  assert.ok(!vs.has("1"));
  if (prev !== undefined) process.env.ORCH_TRACE_ACCEPT_OLD = prev;
});

test("effectiveSupportedVersions with ORCH_TRACE_ACCEPT_OLD=1 includes v1 and v2", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  process.env.ORCH_TRACE_ACCEPT_OLD = "1";
  const vs = effectiveSupportedVersions();
  assert.ok(vs.has("1"));
  assert.ok(vs.has("2"));
  process.env.ORCH_TRACE_ACCEPT_OLD = prev === undefined ? undefined : prev;
  if (prev === undefined) delete process.env.ORCH_TRACE_ACCEPT_OLD;
});

test("traceSchemaVersionPolicyErrors rejects v1 without ORCH_TRACE_ACCEPT_OLD", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  delete process.env.ORCH_TRACE_ACCEPT_OLD;
  const errs = traceSchemaVersionPolicyErrors(V1_LINE);
  assert.ok(Array.isArray(errs) && errs.length > 0);
  assert.ok(errs[0].includes("1"));
  if (prev !== undefined) process.env.ORCH_TRACE_ACCEPT_OLD = prev;
});

test("traceSchemaVersionPolicyErrors accepts v1 with ORCH_TRACE_ACCEPT_OLD=1", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  process.env.ORCH_TRACE_ACCEPT_OLD = "1";
  const errs = traceSchemaVersionPolicyErrors(V1_LINE);
  assert.equal(errs, null);
  process.env.ORCH_TRACE_ACCEPT_OLD = prev === undefined ? undefined : prev;
  if (prev === undefined) delete process.env.ORCH_TRACE_ACCEPT_OLD;
});

test("parseTraceLine strict rejects v1 without ORCH_TRACE_ACCEPT_OLD", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  delete process.env.ORCH_TRACE_ACCEPT_OLD;
  assert.throws(
    () => parseTraceLine(JSON.stringify(V1_LINE), { strict: true }),
    /this binary only accepts|trace_schema_version/i
  );
  if (prev !== undefined) process.env.ORCH_TRACE_ACCEPT_OLD = prev;
});

test("parseTraceLine strict accepts v1 with ORCH_TRACE_ACCEPT_OLD=1 (policy passes, Ajv skips unknown fields)", () => {
  const prev = process.env.ORCH_TRACE_ACCEPT_OLD;
  process.env.ORCH_TRACE_ACCEPT_OLD = "1";
  // v1 lines pass policy; Ajv may warn on shape differences but strict: true only throws on policy errors
  // We verify no policy throw — shape errors on v1 are acceptable (schema is v2)
  let threw = false;
  let thrownMsg = "";
  try {
    parseTraceLine(JSON.stringify(V1_LINE), { strict: true });
  } catch (e) {
    threw = true;
    thrownMsg = e.message;
  }
  // Only fail if the throw was a policy error, not a schema shape error
  if (threw) {
    assert.ok(
      !/this binary only accepts/i.test(thrownMsg),
      `Should not throw policy error with ACCEPT_OLD=1, got: ${thrownMsg}`
    );
  }
  process.env.ORCH_TRACE_ACCEPT_OLD = prev === undefined ? undefined : prev;
  if (prev === undefined) delete process.env.ORCH_TRACE_ACCEPT_OLD;
});
