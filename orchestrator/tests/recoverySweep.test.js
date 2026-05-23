"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine } = require("../trace-schema");
const {
  analyzeRecoveryFromRows,
  summarizeRecoveryFromRows,
  runRecoverySweepAndTrace,
  traceRecoveryDetected,
} = require("../recovery-sweep");
const { buildRunOutcomeSummary } = require("../run-outcome-summary");

const COMPLETE_RUN = [
  { event: "session_start", task_id: "t-complete", flow_mode: "single_agent" },
  { event: "agent_start", task_id: "t-complete", step_id: "s1", agent: "dev", iteration: 1 },
  { event: "agent_done", task_id: "t-complete", step_id: "s1", agent: "dev", iteration: 1 },
  { event: "session_end", task_id: "t-complete", done: true, iterations: 1, gate_blocks: 0 },
];

const INCOMPLETE_RUN = [
  { event: "session_start", task_id: "t-inc", flow_mode: "single_agent" },
  { event: "agent_start", task_id: "t-inc", step_id: "s1", agent: "dev", iteration: 1 },
];

const STRANDED_STEP = [
  { event: "session_start", task_id: "t-str", flow_mode: "multi_agent" },
  { event: "agent_start", task_id: "t-str", step_id: "s1", agent: "dev", iteration: 1 },
  { event: "agent_done", task_id: "t-str", step_id: "s1", agent: "dev", iteration: 1 },
  { event: "agent_start", task_id: "t-str", step_id: "s2", agent: "qa", iteration: 1 },
  { event: "session_end", task_id: "t-str", done: false, iterations: 1, gate_blocks: 0 },
];

test("analyzeRecoveryFromRows: complete run is clean", () => {
  const r = analyzeRecoveryFromRows(COMPLETE_RUN);
  assert.equal(r.clean, true);
  assert.equal(r.finding_count, 0);
  assert.equal(r.blocks_auto_recovery, false);
});

test("analyzeRecoveryFromRows: missing session_end and stranded step", () => {
  const r = analyzeRecoveryFromRows(INCOMPLETE_RUN);
  assert.equal(r.clean, false);
  assert.ok(r.findings.some((f) => f.finding_kind === "missing_session_end"));
  assert.ok(r.findings.some((f) => f.finding_kind === "stranded_step"));
  assert.equal(r.blocks_auto_recovery, true);
});

test("analyzeRecoveryFromRows: stranded step with session_end", () => {
  const r = analyzeRecoveryFromRows(STRANDED_STEP);
  assert.equal(r.clean, false);
  assert.equal(r.findings.filter((f) => f.finding_kind === "stranded_step").length, 1);
  assert.equal(r.findings.find((f) => f.finding_kind === "stranded_step").step_id, "s2");
});

test("analyzeRecoveryFromRows: unresolved ownership handoff", () => {
  const rows = [
    { event: "session_start", task_id: "t-gov" },
    {
      event: "approval_required",
      approval_id: "ap-1",
      ownership_change: true,
      tool: "orchestrator-state",
      action: "advance_mode",
    },
    { event: "session_end", task_id: "t-gov", done: false, iterations: 1 },
  ];
  const r = analyzeRecoveryFromRows(rows);
  assert.ok(r.findings.some((f) => f.finding_kind === "unresolved_ownership_handoff"));
  assert.ok(r.findings.some((f) => f.finding_kind === "pending_governance_approval"));
});

test("runRecoverySweepAndTrace emits single completed on clean run", () => {
  /** @type {object[]} */
  const emitted = [];
  runRecoverySweepAndTrace((_id, ev) => emitted.push(ev), "t-complete", COMPLETE_RUN);
  assert.equal(emitted.filter((e) => e.event === "recovery_detected").length, 0);
  assert.equal(emitted.filter((e) => e.event === "recovery_blocked").length, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "recovery_completed");
  assert.equal(emitted[0].clean, true);
});

test("runRecoverySweepAndTrace emits detected + blocked + completed on incomplete run", () => {
  /** @type {object[]} */
  const emitted = [];
  runRecoverySweepAndTrace((_id, ev) => emitted.push(ev), "t-inc", INCOMPLETE_RUN);
  assert.ok(emitted.some((e) => e.event === "recovery_detected"));
  assert.ok(emitted.some((e) => e.event === "recovery_blocked"));
  const completed = emitted.find((e) => e.event === "recovery_completed");
  assert.ok(completed);
  assert.equal(completed.clean, false);
  assert.equal(completed.policy, "no_auto_retry");
});

test("runRecoverySweepAndTrace does not emit duplicate sweeps when called once", () => {
  /** @type {object[]} */
  const emitted = [];
  runRecoverySweepAndTrace((_id, ev) => emitted.push(ev), "t1", INCOMPLETE_RUN);
  const firstCount = emitted.length;
  runRecoverySweepAndTrace((_id, ev) => emitted.push(ev), "t1", INCOMPLETE_RUN);
  assert.equal(emitted.length, firstCount * 2);
});

test("traceRecoveryDetected validates against schema", () => {
  /** @type {object[]} */
  const lines = [];
  traceRecoveryDetected((_id, ev) => {
    const row = {
      ...ev,
      ts: new Date(1).toISOString(),
      ts_ms: 1,
      trace_schema_version: "2",
      task_id: "t1",
    };
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
    lines.push(row);
  }, "t1", {
    finding_kind: "stranded_step",
    severity: "error",
    blocks_auto_recovery: true,
    step_id: "s9",
    agent: "dev",
    iteration: 2,
    description: "Step s9 has agent_start without matching agent_done",
  });
  assert.equal(lines.length, 1);
});

test("buildRunOutcomeSummary includes recovery section", () => {
  const summary = buildRunOutcomeSummary(INCOMPLETE_RUN);
  assert.ok(summary.recovery);
  assert.equal(summary.recovery.clean, false);
  assert.ok(summary.recovery.findings.length >= 2);
  assert.equal(summary.recovery.policy, "no_auto_retry");
});

test("summarizeRecoveryFromRows: recompute is SoT; historical sweep kept when present", () => {
  const rows = [
    ...INCOMPLETE_RUN,
    {
      event: "recovery_completed",
      recovery_schema_version: "1",
      policy: "no_auto_retry",
      finding_count: 2,
      clean: false,
      summary: "Recovery sweep found 2 issue(s): missing_session_end, stranded_step",
    },
  ];
  const s = summarizeRecoveryFromRows(rows);
  assert.equal(s.computed_from, "full_trace");
  assert.equal(s.clean, false);
  assert.equal(s.finding_count, 2);
  assert.ok(s.sweep_event);
  assert.equal(s.sweep_event.clean, false);
});

test("summarizeRecoveryFromRows: full trace with session_end overrides false historical sweep", () => {
  const rowsBeforeEnd = [
    { event: "session_start", task_id: "t-live" },
    { event: "agent_start", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
    { event: "agent_done", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
  ];
  const rows = [
    ...rowsBeforeEnd,
    {
      event: "recovery_completed",
      policy: "no_auto_retry",
      finding_count: 1,
      clean: false,
      summary: "false positive from live_before_session_end era",
    },
    { event: "session_end", task_id: "t-live", done: true, iterations: 1 },
  ];
  const s = summarizeRecoveryFromRows(rows);
  assert.equal(s.clean, true);
  assert.equal(s.sweep_event.clean, false);
});

const ROWS_BEFORE_SESSION_END = [
  { event: "session_start", task_id: "t-live" },
  { event: "agent_start", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
  { event: "agent_done", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
];

test("live_before_session_end: healthy run does not false-flag missing_session_end", () => {
  /** @type {object[]} */
  const emitted = [];
  runRecoverySweepAndTrace(
    (_id, ev) => emitted.push(ev),
    "t-live",
    ROWS_BEFORE_SESSION_END,
    { lifecycleMode: "live_before_session_end" },
  );
  assert.equal(
    emitted.filter((e) => e.event === "recovery_detected" && e.finding_kind === "missing_session_end").length,
    0,
  );
  assert.equal(emitted.filter((e) => e.event === "recovery_blocked").length, 0);
  const completed = emitted.find((e) => e.event === "recovery_completed");
  assert.ok(completed);
  assert.equal(completed.clean, true);
  assert.equal(completed.finding_count, 0);
});

test("live_before_session_end: still detects stranded_step", () => {
  const rows = [
    { event: "session_start", task_id: "t-live" },
    { event: "agent_start", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
    { event: "agent_done", task_id: "t-live", step_id: "s1", agent: "dev", iteration: 1 },
    { event: "agent_start", task_id: "t-live", step_id: "s2", agent: "qa", iteration: 1 },
  ];
  /** @type {object[]} */
  const emitted = [];
  runRecoverySweepAndTrace(
    (_id, ev) => emitted.push(ev),
    "t-live",
    rows,
    { lifecycleMode: "live_before_session_end" },
  );
  assert.ok(emitted.some((e) => e.event === "recovery_detected" && e.finding_kind === "stranded_step"));
  assert.ok(emitted.some((e) => e.event === "recovery_blocked"));
});
