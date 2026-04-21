"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
const _realSpawnSync = cp.spawnSync.bind(cp);
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

// ORCH_TRACE_SUPPORTED_VERSIONS env override
test("ORCH_TRACE_SUPPORTED_VERSIONS overrides supported versions at module load", () => {
  // Re-require with env set — use a subprocess to avoid module cache pollution
  const result = _realSpawnSync(process.execPath, ["-e", `
    process.env.ORCH_TRACE_SUPPORTED_VERSIONS = '2,3';
    const { SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ } = require('./trace-schema');
    const assert = require('node:assert/strict');
    assert.ok(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has('2'));
    assert.ok(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has('3'));
    assert.equal(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.size, 2);
    console.log('ok');
  `], { cwd: __dirname + "/..", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});

test("ORCH_TRACE_SUPPORTED_VERSIONS with whitespace is trimmed", () => {
  const result = _realSpawnSync(process.execPath, ["-e", `
    process.env.ORCH_TRACE_SUPPORTED_VERSIONS = ' 2 , 3 ';
    const { SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ } = require('./trace-schema');
    const assert = require('node:assert/strict');
    assert.ok(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has('2'));
    assert.ok(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has('3'));
    console.log('ok');
  `], { cwd: __dirname + "/..", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});

test("ORCH_TRACE_SUPPORTED_VERSIONS with only commas throws at startup", () => {
  const result = _realSpawnSync(process.execPath, ["-e", `
    process.env.ORCH_TRACE_SUPPORTED_VERSIONS = ',,,';
    require('./trace-schema');
  `], { cwd: __dirname + "/..", encoding: "utf8" });
  assert.notEqual(result.status, 0, "should exit non-zero on invalid config");
  assert.ok(result.stderr.includes("no valid version tokens"), result.stderr);
});

test("without ORCH_TRACE_SUPPORTED_VERSIONS defaults to writer version", () => {
  const result = _realSpawnSync(process.execPath, ["-e", `
    delete process.env.ORCH_TRACE_SUPPORTED_VERSIONS;
    const { SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ, TRACE_LINE_WRITER_VERSION } = require('./trace-schema');
    const assert = require('node:assert/strict');
    assert.ok(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has(TRACE_LINE_WRITER_VERSION));
    assert.equal(SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.size, 1);
    console.log('ok');
  `], { cwd: __dirname + "/..", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});
