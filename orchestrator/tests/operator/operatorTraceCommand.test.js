"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  deriveOperatorStatusLabel,
  loadOperatorTraceContext,
  runOperatorStatus,
  runOperatorExplain,
} = require("../../modules/operator/operator-trace-command");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

describe("operator-trace-command status labels", () => {
  it("maps complete fixture to complete status", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "complete.v1.jsonl"),
      existsSync: () => true,
      readFileSync: (p) => loadFixture(path.basename(p)),
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.status_label, "complete");
    assert.equal(ctx.summary.outcome, "complete");
  });

  it("maps blocked fixture to blocked status", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "blocked.v1.jsonl"),
      existsSync: () => true,
      readFileSync: (p) => loadFixture(path.basename(p)),
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.status_label, "blocked");
    assert.equal(ctx.summary.outcome, "blocked");
  });

  it("maps running trace without session_end", () => {
    const rows = [
      { event: "session_start", task_id: "open-run", flow_mode: "single_agent", ts_ms: 1 },
      { event: "agent_done", task_id: "open-run", agent: "dev-backend", ts_ms: 2 },
    ];
    const text = rows.map((r) => JSON.stringify(r)).join("\n");
    const ctx = loadOperatorTraceContext({
      filePath: "/tmp/open-run.jsonl",
      existsSync: () => true,
      readFileSync: () => text,
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.status_label, "running");
    assert.equal(ctx.summary.outcome, "unknown");
    assert.equal(ctx.run_state.result_code, "RUN_STATE_UNKNOWN");
  });

  it("maps degraded fixture to degraded status", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "degraded.v1.jsonl"),
      existsSync: () => true,
      readFileSync: (p) => loadFixture(path.basename(p)),
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.status_label, "degraded");
    assert.equal(ctx.summary.outcome, "degraded");
  });

  it("maps failed session_end to failed status", () => {
    const rows = [
      { event: "session_start", task_id: "fail-run", flow_mode: "single_agent", ts_ms: 1 },
      { event: "session_end", task_id: "fail-run", done: false, iterations: 2, gate_blocks: 0, ts_ms: 2 },
    ];
    const text = rows.map((r) => JSON.stringify(r)).join("\n");
    const ctx = loadOperatorTraceContext({
      filePath: "/tmp/fail-run.jsonl",
      existsSync: () => true,
      readFileSync: () => text,
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.status_label, "failed");
    assert.equal(ctx.summary.outcome, "failed");
  });

  it("returns RUN_NOT_FOUND when trace missing", () => {
    const ctx = loadOperatorTraceContext({
      runId: "missing-task",
      existsSync: () => false,
    });
    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason_code, "OPERATOR_TRACE_NOT_FOUND");
    assert.equal(ctx.result_code, "RUN_NOT_FOUND");
    assert.match(ctx.next_safe_action, /--run-id|--file/);
  });

  it("returns RUN_TRACE_INVALID for empty trace file", () => {
    const ctx = loadOperatorTraceContext({
      filePath: "/tmp/empty.jsonl",
      existsSync: () => true,
      readFileSync: () => "\n",
    });
    assert.equal(ctx.ok, false);
    assert.equal(ctx.result_code, "RUN_TRACE_INVALID");
    assert.match(ctx.next_safe_action, /empty/);
  });

  it("returns RUN_TRACE_INVALID when trace file is unreadable", () => {
    const ctx = loadOperatorTraceContext({
      filePath: "/tmp/unreadable.jsonl",
      existsSync: () => true,
      readFileSync: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    assert.equal(ctx.ok, false);
    assert.equal(ctx.result_code, "RUN_TRACE_INVALID");
    assert.match(ctx.next_safe_action, /unreadable/);
  });

  it("exposes cost_token_summary on complete fixture", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "complete.v1.jsonl"),
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => loadFixture(path.basename(p)),
      repoRoot: "/tmp/repo",
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.cost_token_summary.run.token_status, "available");
    assert.equal(ctx.cost_token_summary.run.total_tokens, 28);
  });

  it("exposes harness resilience as unavailable on complete fixture without E22 events", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "complete.v1.jsonl"),
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => loadFixture(path.basename(p)),
      repoRoot: "/tmp/repo",
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.run_state.tool_failure_summary.availability, "unavailable");
    assert.equal(ctx.run_state.context_authority_status.availability, "unavailable");
    const status = runOperatorStatus({ loadContext: () => ctx });
    assert.match(status.text, /tool_failure:\s+unavailable/);
    assert.match(status.text, /context_authority:\s+unavailable/);
    assert.match(status.text, /tool_failure_summary/);
    const explain = runOperatorExplain({ loadContext: () => ctx });
    assert.match(explain.text, /tool_failure:\s+unavailable/);
    assert.equal(status.json.tool_failure_summary.availability, "unavailable");
    assert.equal(explain.json.context_authority_status.availability, "unavailable");
  });

  it("exposes run_state on complete fixture", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "complete.v1.jsonl"),
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => loadFixture(path.basename(p)),
      repoRoot: "/tmp/repo",
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.run_state.result_code, "RUN_FOUND");
    assert.equal(ctx.run_state.run_id, "fix-complete");
    assert.equal(ctx.run_state.attach_result_code, "RUN_ATTACH_MISSING");
  });

  it("maps blocked fixture blocking_reason_code", () => {
    const ctx = loadOperatorTraceContext({
      filePath: path.join(FIXTURES, "blocked.v1.jsonl"),
      existsSync: (p) => !String(p).includes("report-bundles"),
      readFileSync: (p) => loadFixture(path.basename(p)),
      repoRoot: "/tmp/repo",
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.run_state.blocking_reason_code, "CERBERUS_BLOCKERS_ITERATE");
  });
});

describe("operator-trace-command runOperatorStatus", () => {
  it("formats human output with next_safe_action", () => {
    const result = runOperatorStatus({
      loadContext: () => ({
        ok: true,
        run_id: "task-1",
        trace_file: "/traces/task-1.jsonl",
        summary: {
          outcome: "complete",
          current_phase: "complete",
          applicable_contract: "single_agent / agent-contract",
          risk_category: "standard",
          degraded_mode: { active: false, reason_codes: [] },
          blocked_gates: [],
          permission_denials: [],
          cerberus: { verdict: null, evidence_ref: null },
          policy_decision: { decision: null, reason_code: null, policy_source: null },
          budget: { tokens: 10, estimated_cost: null, confidence: null },
          artifacts: { trace: "/traces/task-1.jsonl", report: null, attach_bundle: null },
          missing_evidence: [],
          next_safe_action: "Run may advance",
        },
        status_label: "complete",
        explain: {},
        skipped: 0,
        truncated: false,
        run_state: {
          result_code: "RUN_FOUND",
          run_id: "task-1",
          current_phase: "complete",
          last_successful_phase: "complete",
          blocking_reason_code: null,
          next_safe_action: "Run may advance",
          evidence_paths: ["/traces/task-1.jsonl"],
          attach_available: false,
          attach_result_code: "RUN_ATTACH_MISSING",
          privacy_notice_status: "bundle_not_collected",
          model: null,
          model_backend: null,
          selection_reason: null,
          tool_failure_summary: {
            availability: "unavailable",
            reason_code: "unavailable",
            next_safe_action: "unavailable",
            evidence_path: "unavailable",
          },
          context_authority_status: {
            availability: "unavailable",
            reason_code: "unavailable",
            next_safe_action: "unavailable",
            evidence_path: "unavailable",
          },
        },
        cost_token_summary: {
          run: { token_status: "available", total_tokens: 10, cost_status: "not_billing", latency_status: "unavailable" },
          by_phase: [],
          by_step: [],
        },
      }),
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /result_code:\s+RUN_FOUND/);
    assert.match(result.text, /run_state_visibility/);
    assert.match(result.text, /cost_token_run_summary/);
    assert.match(result.text, /next_safe_action:/);
  });
});

describe("operator-trace-command runOperatorExplain", () => {
  it("includes remediation and what_not_to_do for blocked runs", () => {
    const result = runOperatorExplain({
      loadContext: () => ({
        ok: true,
        run_id: "task-blocked",
        trace_file: "/traces/task-blocked.jsonl",
        summary: {
          outcome: "blocked",
          current_phase: "cerberus",
          applicable_contract: "multi_agent / agent-contract",
          risk_category: "blocked",
          degraded_mode: { active: false, reason_codes: [] },
          blocked_gates: ["cerberus:block"],
          permission_denials: [],
          policy_decision: { decision: null, reason_code: null, policy_source: null },
          budget: { tokens: null, estimated_cost: null, confidence: null },
          artifacts: { trace: "/traces/task-blocked.jsonl", report: null, attach_bundle: null },
          missing_evidence: [],
          cerberus: { verdict: "block", evidence_ref: "tests/x.test.js" },
          next_safe_action: "Fix blockers before merge.",
        },
        status_label: "blocked",
        explain: { failure_type: "UNKNOWN" },
        skipped: 0,
        truncated: false,
        run_state: {
          blocking_reason_code: "CERBERUS_BLOCK",
          result_code: "RUN_FOUND",
          tool_failure_summary: { availability: "unavailable" },
          context_authority_status: { availability: "unavailable" },
        },
        cost_token_summary: {
          run: { token_status: "unavailable", cost_status: "unavailable", latency_status: "unavailable" },
          by_phase: [],
          by_step: [],
        },
      }),
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /blocking_gate:\s+cerberus:block/);
    assert.match(result.text, /what_not_to_do:/);
    assert.match(result.text, /remediation:/);
  });

  it("exit 2 with reason_code when trace missing", () => {
    const result = runOperatorExplain({
      loadContext: () => ({
        ok: false,
        reason_code: "OPERATOR_TRACE_NOT_FOUND",
        next_safe_action: "Provide --run-id",
      }),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.reason_code, "OPERATOR_TRACE_NOT_FOUND");
  });
});

describe("deriveOperatorStatusLabel edge cases", () => {
  it("warn when complete with missing evidence", () => {
    const summary = {
      outcome: "complete",
      missing_evidence: ["manual_review"],
    };
    assert.equal(deriveOperatorStatusLabel(summary, [
      { event: "session_start" },
      { event: "session_end", done: true },
    ]), "warn");
  });
});
