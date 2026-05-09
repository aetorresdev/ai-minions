"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cp = require("child_process");
cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });

const { validateTraceLine, parseTraceLine, getValidationMetrics, resetValidationMetrics, REJECTION_REASONS } = require("../trace-schema");
const { transitionReason, failureTypeForIterationDone, failureAxisForIterationDone } = require("../orchestrator");

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

function permissionCheckBase(overrides = {}) {
  return {
    ts: "2026-05-05T12:00:00.000Z",
    ts_ms: 1746446400000,
    trace_schema_version: "2",
    task_id: "task-perm",
    event: "permission_check",
    actor: "local",
    role: "DEV",
    tool: "acme.do_x",
    domain: "mcp",
    action_class: "external_side_effect",
    target_class: null,
    decision: "allow",
    reason_code: "mcp_trust_allow",
    policy_source: "built_in_profile",
    permission_profile: "dev-local",
    requires_approval: false,
    ...overrides,
  };
}

test("validateTraceLine accepts permission_check envelope", () => {
  const v = validateTraceLine(permissionCheckBase());
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("validateTraceLine rejects permission_check without permission_profile", () => {
  const row = permissionCheckBase();
  delete row.permission_profile;
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /permission_profile/i.test(e)), v.errors.join(" | "));
});

test("validateTraceLine rejects permission_check with invalid decision enum", () => {
  const v = validateTraceLine(permissionCheckBase({ decision: "warn" }));
  assert.equal(v.ok, false);
});

test("validateTraceLine accepts permission_check deny path", () => {
  const v = validateTraceLine(
    permissionCheckBase({
      decision: "deny",
      reason_code: "mcp_trust_warn_deny",
      requires_approval: false,
    }),
  );
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("validateTraceLine accepts permission_check requires_approval path", () => {
  const v = validateTraceLine(
    permissionCheckBase({
      decision: "requires_approval",
      reason_code: "external_side_effect_requires_allow",
      requires_approval: true,
      domain: "shell",
    }),
  );
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

function sessionEndBase(overrides = {}) {
  return {
    ts: "2026-05-05T12:00:00.000Z",
    ts_ms: 1746446400000,
    trace_schema_version: "2",
    task_id: "task-se",
    event: "session_end",
    ...overrides,
  };
}

test("validateTraceLine accepts session_end without permission_summary (legacy)", () => {
  const v = validateTraceLine(sessionEndBase({ summary: "done" }));
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("validateTraceLine accepts session_end with valid permission_summary", () => {
  const v = validateTraceLine(
    sessionEndBase({
      permission_summary: {
        permission_check_total: 1,
        by_decision: { allow: 1, deny: 0, requires_approval: 0 },
        reason_codes_top: [{ reason_code: "mcp_trust_allow", count: 1 }],
        repeated_denials: [],
      },
    }),
  );
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("validateTraceLine rejects session_end permission_summary with incomplete by_decision", () => {
  const v = validateTraceLine(
    sessionEndBase({
      permission_summary: {
        permission_check_total: 0,
        by_decision: { allow: 0, deny: 0 },
        reason_codes_top: [],
        repeated_denials: [],
      },
    }),
  );
  assert.equal(v.ok, false);
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

test("validateTraceLine rejects iteration_done non-done outcome without failure_type", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "iterate",
    ...transitionReason("GATE_BLOCK", "cerberus_blockers"),
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /failure_type/i.test(e)), v.errors.join(" | "));
});

test("validateTraceLine accepts iteration_done iterate with failure_type", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "iterate",
    failure_type: "contract_mismatch",
    ...transitionReason("GATE_BLOCK", "cerberus_blockers"),
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true);
});

test("validateTraceLine rejects iteration_done with invalid failure_type enum", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "stopped",
    failure_type: "not_a_taxonomy_value",
    ...transitionReason("CONTRACT_FAIL", "x"),
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, false);
});

test("validateTraceLine accepts iteration_done GUARD cost limit", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "guard_abort",
    failure_type: "cost_abort",
    ...transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }),
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("validateTraceLine accepts iteration_done with intent_ids and failure_axis", () => {
  const row = {
    ts: "2026-04-15T12:00:00.000Z",
    ts_ms: 1713182400000,
    trace_schema_version: "2",
    task_id: "task-abc",
    event: "iteration_done",
    iteration: 1,
    outcome: "iterate",
    failure_type: "contract_mismatch",
    failure_axis: "cerberus",
    intent_ids: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ...transitionReason("GATE_BLOCK", "cerberus_blockers"),
  };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
});

test("failureAxisForIterationDone maps reason codes and outcomes", () => {
  assert.equal(failureAxisForIterationDone("done", "RUN_COMPLETED"), "unknown");
  assert.equal(failureAxisForIterationDone("iterate", "CERBERUS_BLOCKERS_ITERATE"), "cerberus");
  assert.equal(failureAxisForIterationDone("iterate", "ORCHESTRATOR_DECIDE_CORRECTIONS"), "orchestrate");
  assert.equal(failureAxisForIterationDone("iterate_fallback", "ORCHESTRATOR_NO_CORRECTIONS_JSON"), "orchestrate");
  assert.equal(failureAxisForIterationDone("guard_abort", "GUARD_COST_LIMIT"), "guard");
  assert.equal(
    failureAxisForIterationDone("gate_blocked_iterate", "GATE_ARTIFACT_OR_HANDOFF", { gateKinds: ["compact_handoff"] }),
    "gate_tool",
  );
  assert.equal(
    failureAxisForIterationDone("gate_blocked_iterate", "GATE_ARTIFACT_OR_HANDOFF", { gateKinds: ["output_contract"] }),
    "gate_artifact",
  );
  assert.equal(failureAxisForIterationDone("loop_limit_stopped", "MAX_ITERATIONS_LOOP_EXHAUSTED"), "loop_cap");
});

test("failureTypeForIterationDone maps reason codes and gate kinds", () => {
  assert.equal(failureTypeForIterationDone("done", "RUN_COMPLETED"), null);
  assert.equal(failureTypeForIterationDone("iterate", "CERBERUS_BLOCKERS_ITERATE"), "contract_mismatch");
  assert.equal(failureTypeForIterationDone("max_iterations_with_blockers", "MAX_ITERATIONS_CERBERUS_BLOCKERS"), "retry_exceeded");
  assert.equal(failureTypeForIterationDone("guard_abort", "GUARD_COST_LIMIT"), "cost_abort");
  assert.equal(failureTypeForIterationDone("guard_abort", "GUARD_STEP_RETRY_LIMIT"), "retry_exceeded");
  assert.equal(failureTypeForIterationDone("loop_limit_stopped", "MAX_ITERATIONS_LOOP_EXHAUSTED"), "retry_exceeded");
  assert.equal(
    failureTypeForIterationDone("gate_blocked_iterate", "GATE_ARTIFACT_OR_HANDOFF", { gateKinds: ["compact_handoff"] }),
    "tool_error",
  );
  assert.equal(
    failureTypeForIterationDone("gate_blocked_iterate", "GATE_ARTIFACT_OR_HANDOFF", { gateKinds: ["output_contract"] }),
    "contract_mismatch",
  );
});

/** Keep in sync with `TRANSITION_REASON_CODES` + strict-mode.md § *Canonical dashboard mapping*. */
test("failure taxonomy matrix covers catalog reason_code × outcome paths", () => {
  /** @type {{ outcome: string, reasonCode: string, ctx?: object, ft: string | null, axis: string }[]} */
  const matrix = [
    { outcome: "done", reasonCode: "RUN_COMPLETED", ft: null, axis: "unknown" },
    { outcome: "iterate", reasonCode: "CERBERUS_BLOCKERS_ITERATE", ft: "contract_mismatch", axis: "cerberus" },
    { outcome: "iterate_fallback", reasonCode: "ORCHESTRATOR_NO_CORRECTIONS_JSON", ft: "contract_mismatch", axis: "orchestrate" },
    { outcome: "iterate", reasonCode: "ORCHESTRATOR_DECIDE_CORRECTIONS", ft: "contract_mismatch", axis: "orchestrate" },
    { outcome: "stopped", reasonCode: "CONTRACT_OR_DECIDE_FAILURE", ft: "contract_mismatch", axis: "contract" },
    { outcome: "iterate", reasonCode: "VALIDATION_FAILURE_GENERIC", ft: "contract_mismatch", axis: "unknown" },
    {
      outcome: "gate_blocked_iterate",
      reasonCode: "GATE_ARTIFACT_OR_HANDOFF",
      ctx: { gateKinds: ["compact_handoff"] },
      ft: "tool_error",
      axis: "gate_tool",
    },
    {
      outcome: "gate_blocked_iterate",
      reasonCode: "GATE_ARTIFACT_OR_HANDOFF",
      ctx: { gateKinds: ["handoff_structure"] },
      ft: "contract_mismatch",
      axis: "gate_artifact",
    },
    {
      outcome: "gate_blocked_iterate",
      reasonCode: "GATE_ARTIFACT_OR_HANDOFF",
      ctx: { gateKinds: [] },
      ft: "contract_mismatch",
      axis: "gate_artifact",
    },
    {
      outcome: "max_iterations_with_gate_blocks",
      reasonCode: "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS",
      ft: "retry_exceeded",
      axis: "gate_artifact",
    },
    {
      outcome: "max_iterations_with_blockers",
      reasonCode: "MAX_ITERATIONS_CERBERUS_BLOCKERS",
      ft: "retry_exceeded",
      axis: "cerberus",
    },
    {
      outcome: "loop_limit_stopped",
      reasonCode: "MAX_ITERATIONS_LOOP_EXHAUSTED",
      ft: "retry_exceeded",
      axis: "loop_cap",
    },
    { outcome: "guard_abort", reasonCode: "GUARD_COST_LIMIT", ft: "cost_abort", axis: "guard" },
    { outcome: "guard_abort", reasonCode: "GUARD_STEP_RETRY_LIMIT", ft: "retry_exceeded", axis: "guard" },
  ];
  for (const row of matrix) {
    assert.equal(
      failureTypeForIterationDone(row.outcome, row.reasonCode, row.ctx || {}),
      row.ft,
      `${row.outcome} / ${row.reasonCode}`,
    );
    assert.equal(
      failureAxisForIterationDone(row.outcome, row.reasonCode, row.ctx || {}),
      row.axis,
      `${row.outcome} / ${row.reasonCode}`,
    );
  }
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
    iteration: 1,
    outcome: "done",
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

test("REJECTION_REASONS covers all three counter types", () => {
  assert.ok(REJECTION_REASONS.includes("policy_missing_version"));
  assert.ok(REJECTION_REASONS.includes("policy_unsupported_version"));
  assert.ok(REJECTION_REASONS.includes("ajv_schema_error"));
  assert.equal(REJECTION_REASONS.length, 3);
});

test("rejection entry reason is always a member of REJECTION_REASONS", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE });                                      // policy_missing_version
  validateTraceLine({ ...BASE, trace_schema_version: "99" });         // policy_unsupported_version
  validateTraceLine({ ...BASE, trace_schema_version: "2", ts: "x" }); // ajv_schema_error
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 3);
  for (const r of m.rejections) {
    assert.ok(REJECTION_REASONS.includes(r.reason), `unexpected reason: ${r.reason}`);
  }
});

test("rejection entry fields are strings, never null", () => {
  resetValidationMetrics();
  validateTraceLine({ ...BASE, trace_schema_version: "99", step_id: "s1" });
  const m = getValidationMetrics();
  const entry = m.rejections[0];
  for (const [k, v] of Object.entries(entry)) {
    assert.notEqual(v, null, `field ${k} must not be null`);
    assert.equal(typeof v, "string", `field ${k} must be string`);
  }
});

test("rejection entry with non-string event/step_id is omitted, not coerced", () => {
  resetValidationMetrics();
  validateTraceLine({ trace_schema_version: "99", event: 42, step_id: { bad: true } });
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 1);
  assert.ok(!("event" in m.rejections[0]));
  assert.ok(!("step_id" in m.rejections[0]));
});

test("FIFO overflow at exactly 50: entry 51 drops entry 1", () => {
  resetValidationMetrics();
  for (let i = 1; i <= 51; i++) {
    validateTraceLine({ ...BASE, trace_schema_version: "99", step_id: `s${i}` });
  }
  const m = getValidationMetrics();
  assert.equal(m.rejections.length, 50);
  assert.equal(m.rejections[0].step_id, "s2");   // s1 was dropped
  assert.equal(m.rejections[49].step_id, "s51");
});

// validateTraceRunGraph — run-level graph consistency
const { validateTraceRunGraph } = require("../trace-schema");

test("validateTraceRunGraph passes on empty line array", () => {
  const r = validateTraceRunGraph([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
});

test("validateTraceRunGraph passes when all parent_step_ids reference earlier step_ids", () => {
  const lines = [
    { event: "agent_start", step_id: "s1", parent_step_id: null },
    { event: "agent_start", step_id: "s2", parent_step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
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

test("validateTraceRunGraph allows agent_done to reuse step_id from agent_start", () => {
  const lines = [
    { event: "agent_start", step_id: "s1", parent_step_id: null },
    { event: "agent_done", step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test("validateTraceRunGraph detects agent_done without prior agent_start", () => {
  const lines = [{ event: "agent_done", step_id: "orphan-done" }];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "agent_done_without_start"));
});

test("validateTraceRunGraph gate_result reuses registered step_id", () => {
  const lines = [
    { event: "agent_start", step_id: "s1" },
    { event: "gate_result", step_id: "s1", gate: "handoff_structure", passed: true },
    { event: "agent_done", step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test("validateTraceRunGraph step_id_unknown when event references unregistered step_id", () => {
  const lines = [{ event: "gate_result", step_id: "ghost", passed: false }];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "step_id_unknown"));
});

test("validateTraceRunGraph ignores lines without step_id or parent_step_id", () => {
  const lines = [
    { event: "session_start" },
    { event: "context_stats", ts_ms: 1 },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.warnings[0], { type: "no_steps_emitted", ok: true });
});

test("validateTraceRunGraph missing_event_with_step_id when step_id set but event empty", () => {
  const lines = [{ step_id: "s1", event: "" }];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.warnings.every((w) => w.type !== "no_steps_emitted"));
  assert.ok(r.violations.some((v) => v.type === "missing_event_with_step_id" && v.step_id === "s1"));
});

test("validateTraceRunGraph missing_event_with_step_id when event null", () => {
  const lines = [{ step_id: "s1", event: null }];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "missing_event_with_step_id"));
});

test("validateTraceRunGraph detects parent_step_id cycle A to B to A", () => {
  const lines = [
    { event: "agent_start", step_id: "a", parent_step_id: null },
    { event: "agent_start", step_id: "b", parent_step_id: "a" },
    { event: "agent_done", step_id: "a", parent_step_id: "b" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "cycle"));
});

test("validateTraceRunGraph detects self-loop parent_step_id equals step_id", () => {
  const lines = [
    { event: "agent_start", step_id: "s1", parent_step_id: null },
    { event: "gate_result", step_id: "s1", parent_step_id: "s1", passed: true },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.type === "cycle"));
});

test("validateTraceRunGraph no cycle on tree parent chain", () => {
  const lines = [
    { event: "agent_start", step_id: "r", parent_step_id: null },
    { event: "agent_start", step_id: "s1", parent_step_id: "r" },
    { event: "agent_start", step_id: "s2", parent_step_id: "s1" },
    { event: "agent_done", step_id: "s2", parent_step_id: "s1" },
  ];
  const r = validateTraceRunGraph(lines);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.ok(!r.violations.some((v) => v.type === "cycle"));
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
