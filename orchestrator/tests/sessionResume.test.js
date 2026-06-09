"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionCheckpointFromRows,
  evaluateResumeEligibility,
  summarizeSessionResumeFromRows,
  buildSessionResumeBlockedEvent,
  buildSessionCheckpointCreatedEvent,
} = require("../session-resume");
const { summarizeRecoveryFromRows } = require("../recovery-sweep");

const VALID_INTERRUPTED = [
  { event: "session_start", task_id: "t-resume-1", goal: "ship feature", permission_profile: "dev-local" },
  { event: "agent_start", step_id: "s1", agent: "DEV", iteration: 1 },
  { event: "agent_done", step_id: "s1", agent: "DEV", iteration: 1 },
  { event: "recovery_completed", recovery_schema_version: "1", policy: "no_auto_retry", finding_count: 0, clean: true, summary: "clean" },
];

const WITH_BLOCKER = [
  ...VALID_INTERRUPTED,
  {
    event: "review_record",
    review_schema_version: "1",
    reviewer_role: "cerberus",
    verdict: "block",
    blockers: ["missing tests"],
    non_blocking_notes: [],
    evidence_refs: [],
    reviewed_artifact_ids: [],
    iteration: 1,
  },
];

const COMPLETE_SESSION = [
  ...VALID_INTERRUPTED,
  { event: "session_end", task_id: "t-resume-1", done: true, iterations: 1, permission_profile: "dev-local" },
];

const STALE_HANDOFF = [
  ...VALID_INTERRUPTED,
  {
    event: "approval_required",
    gate_id: "governance_human",
    approval_id: "ap-stale-1",
    ownership_change: true,
    handoff_contract_ref: "hc-1",
  },
];

describe("session-resume — checkpoint and eligibility", () => {
  it("valid interrupted run: resume eligible", () => {
    const cp = buildSessionCheckpointFromRows(VALID_INTERRUPTED);
    assert.equal(cp.task_id, "t-resume-1");
    assert.equal(cp.session_complete, false);
    assert.equal(cp.recovery_clean, true);
    const ev = evaluateResumeEligibility(cp, { require_session_incomplete: true });
    assert.equal(ev.eligible, true);
    assert.equal(ev.side_effects_require_revalidation, true);
  });

  it("incomplete session: missing_iteration_done does not block resume", () => {
    const rows = [
      { event: "session_start", task_id: "t-miss-iter", goal: "ship feature", permission_profile: "dev-local" },
      { event: "agent_start", step_id: "s1", agent: "DEV", iteration: 1 },
      { event: "agent_done", step_id: "s1", agent: "DEV", iteration: 1 },
    ];
    const recovery = summarizeRecoveryFromRows(rows);
    assert.equal(recovery.clean, false);
    assert.ok(recovery.findings.some((f) => f.finding_kind === "missing_iteration_done"));

    const cp = buildSessionCheckpointFromRows(rows);
    assert.equal(cp.session_complete, false);
    assert.equal(cp.recovery_clean, true);

    const ev = evaluateResumeEligibility(cp, { require_session_incomplete: true });
    assert.equal(ev.eligible, true);
    assert.ok(!ev.block_codes.includes("recovery_not_clean"));
  });

  it("complete session: missing_iteration_done blocks resume", () => {
    const rows = [
      { event: "session_start", task_id: "t-miss-iter-done", goal: "ship feature", permission_profile: "dev-local" },
      { event: "agent_start", step_id: "s1", agent: "DEV", iteration: 1 },
      { event: "agent_done", step_id: "s1", agent: "DEV", iteration: 1 },
      { event: "session_end", task_id: "t-miss-iter-done", done: true, iterations: 1, permission_profile: "dev-local" },
    ];
    const cp = buildSessionCheckpointFromRows(rows);
    assert.equal(cp.session_complete, true);
    assert.equal(cp.recovery_clean, false);

    const ev = evaluateResumeEligibility(cp);
    assert.equal(ev.eligible, false);
    assert.ok(ev.block_codes.includes("recovery_not_clean"));
  });

  it("blocked by open review blockers", () => {
    const cp = buildSessionCheckpointFromRows(WITH_BLOCKER);
    const ev = evaluateResumeEligibility(cp);
    assert.equal(ev.eligible, false);
    assert.ok(ev.block_codes.includes("open_review_blockers"));
  });

  it("blocked when permission profile changed", () => {
    const cp = buildSessionCheckpointFromRows(VALID_INTERRUPTED);
    const ev = evaluateResumeEligibility(cp, {
      current_permission_profile: "ci-safe",
    });
    assert.equal(ev.eligible, false);
    assert.ok(ev.block_codes.includes("permission_profile_changed"));
  });

  it("preserves cost checkpoint from session_end when present", () => {
    const rows = [
      ...VALID_INTERRUPTED,
      {
        event: "session_end",
        task_id: "t-resume-1",
        done: false,
        iterations: 1,
        ollama_prompt_tokens_total: 100,
        ollama_completion_tokens_total: 40,
      },
    ];
    const cp = buildSessionCheckpointFromRows(rows);
    assert.equal(cp.cost_checkpoint.ollama_prompt_tokens, 100);
    assert.equal(cp.cost_checkpoint.ollama_completion_tokens, 40);
  });

  it("blocked for stale handoff contract", () => {
    const cp = buildSessionCheckpointFromRows(STALE_HANDOFF);
    assert.equal(cp.handoff_contract.stale, true);
    const ev = evaluateResumeEligibility(cp);
    assert.equal(ev.eligible, false);
    assert.ok(
      ev.block_codes.includes("stale_handoff_contract")
        || ev.block_codes.includes("governance_hold"),
    );
  });

  it("blocked when session already complete", () => {
    const cp = buildSessionCheckpointFromRows(COMPLETE_SESSION);
    assert.equal(cp.session_complete, true);
    const ev = evaluateResumeEligibility(cp, { require_session_incomplete: true });
    assert.equal(ev.eligible, false);
    assert.ok(ev.block_codes.includes("incomplete_checkpoint"));
  });

  it("summarizeSessionResumeFromRows detects resume run", () => {
    const rows = [
      { event: "session_start", task_id: "t-new", resume_of_task_id: "t-old", goal: "continue" },
      ...VALID_INTERRUPTED.slice(1),
    ];
    const s = summarizeSessionResumeFromRows(rows);
    assert.equal(s.checkpoint.resume_of_task_id, "t-old");
    assert.equal(s.trace_signals.is_resume_run, true);
  });

  it("buildSessionResumeBlockedEvent includes block codes", () => {
    const cp = buildSessionCheckpointFromRows(WITH_BLOCKER);
    const ev = evaluateResumeEligibility(cp);
    const row = buildSessionResumeBlockedEvent(cp, ev);
    assert.equal(row.event, "session_resume_blocked");
    assert.ok(row.block_codes.includes("open_review_blockers"));
  });

  it("trace event builders require checkpoint.task_id", () => {
    const cp = buildSessionCheckpointFromRows([]);
    const ev = evaluateResumeEligibility(cp);
    assert.throws(
      () => buildSessionCheckpointCreatedEvent(cp, ev),
      /requires checkpoint\.task_id/,
    );
    assert.throws(
      () => buildSessionResumeBlockedEvent(cp, ev),
      /requires checkpoint\.task_id/,
    );
  });
});
