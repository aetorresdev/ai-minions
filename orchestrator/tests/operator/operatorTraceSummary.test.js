"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildOperatorTraceSummary,
  buildEmptyOperatorTraceSummary,
  formatOperatorTraceSummaryLines,
  OPERATOR_TRACE_SUMMARY_SCHEMA,
} = require("../../modules/operator/operator-trace-summary");

const FIXTURES = path.join(__dirname, "..", "fixtures", "operator-trace-summary");

function loadFixture(name) {
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

test("buildEmptyOperatorTraceSummary: unknown outcome with guidance", () => {
  const s = buildEmptyOperatorTraceSummary({ trace_file: "/tmp/missing.jsonl" });
  assert.equal(s.schema_version, OPERATOR_TRACE_SUMMARY_SCHEMA);
  assert.equal(s.outcome, "unknown");
  assert.deepEqual(s.missing_evidence, ["trace_absent_or_empty"]);
  assert.match(s.next_safe_action, /trace/i);
  assert.equal(s.artifacts.trace, "/tmp/missing.jsonl");
});

test("buildOperatorTraceSummary: complete run", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "e18-complete",
      flow_mode: "single_agent",
      max_iterations: 2,
    },
    {
      event: "context_stats",
      task_id: "e18-complete",
      phase: "execute",
      agent: "dev-backend",
    },
    {
      event: "iteration_done",
      task_id: "e18-complete",
      outcome: "done",
      transition_reason: { type: "DONE", reason_code: "RUN_COMPLETED" },
    },
    {
      event: "session_end",
      task_id: "e18-complete",
      done: true,
      iterations: 1,
      gate_blocks: 0,
      ollama_prompt_tokens_total: 10,
      ollama_completion_tokens_total: 5,
    },
  ];
  const s = buildOperatorTraceSummary(rows, { trace_file: "/traces/e18-complete.jsonl" });
  assert.equal(s.run_id, "e18-complete");
  assert.equal(s.outcome, "complete");
  assert.equal(s.current_phase, "complete");
  assert.equal(s.applicable_contract, "single_agent / agent-contract");
  assert.equal(s.risk_category, "standard");
  assert.equal(s.degraded_mode.active, false);
  assert.equal(s.cerberus.verdict, null);
  assert.equal(s.budget.tokens, 15);
  assert.equal(s.artifacts.trace, "/traces/e18-complete.jsonl");
  assert.equal(s.missing_evidence.length, 0);
  const text = formatOperatorTraceSummaryLines(s).join("\n");
  assert.match(text, /outcome: complete/);
  assert.match(text, /next_safe_action:/);
});

test("buildOperatorTraceSummary: blocked with cerberus and gate_blocks", () => {
  const rows = [
    { event: "session_start", task_id: "e18-blocked", flow_mode: "multi_agent" },
    {
      event: "review_record",
      reviewer_role: "cerberus",
      verdict: "block",
      blockers: ["missing tests"],
      evidence_refs: ["tests/foo.test.js"],
      iteration: 1,
    },
    {
      event: "iteration_done",
      task_id: "e18-blocked",
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "CERBERUS_BLOCKERS_ITERATE" },
    },
    {
      event: "session_end",
      task_id: "e18-blocked",
      done: false,
      gate_blocks: 2,
      qa_degraded: true,
    },
  ];
  const s = buildOperatorTraceSummary(rows, {});
  assert.equal(s.outcome, "blocked");
  assert.equal(s.cerberus.verdict, "block");
  assert.equal(s.cerberus.evidence_ref, "tests/foo.test.js");
  assert.ok(s.blocked_gates.some((g) => g.startsWith("gate_blocks:")));
  assert.ok(s.blocked_gates.includes("cerberus:block"));
  assert.match(s.next_safe_action, /CERBERUS|block/i);
});

test("buildOperatorTraceSummary: degraded mode from trace event", () => {
  const rows = [
    { event: "session_start", task_id: "e18-deg", flow_mode: "single_agent" },
    { event: "degraded_mode", task_id: "e18-deg", reason: "skipStateMcp=true" },
    { event: "session_end", task_id: "e18-deg", done: true, gate_blocks: 0, iterations: 1 },
  ];
  const s = buildOperatorTraceSummary(rows, {});
  assert.equal(s.outcome, "degraded");
  assert.equal(s.degraded_mode.active, true);
  assert.ok(s.degraded_mode.reason_codes.includes("skipStateMcp=true"));
  assert.equal(s.risk_category, "degraded");
});

test("buildOperatorTraceSummary: permission denial elevates risk", () => {
  const rows = [
    { event: "session_start", task_id: "e18-perm", flow_mode: "single_agent" },
    {
      event: "permission_check",
      task_id: "e18-perm",
      trace_schema_version: "2",
      decision: "deny",
      reason_code: "mcp_trust_warn_deny",
      policy_source: "built_in_profile",
      permission_profile: "dev-local",
      tool: "acme.do_x",
      role: "DEV",
    },
    { event: "session_end", task_id: "e18-perm", done: true, gate_blocks: 0, iterations: 1 },
  ];
  const s = buildOperatorTraceSummary(rows, {});
  assert.equal(s.outcome, "complete");
  assert.equal(s.risk_category, "elevated");
  assert.equal(s.permission_denials.length, 1);
  assert.equal(s.policy_decision.reason_code, "mcp_trust_warn_deny");
});

test("buildOperatorTraceSummary: unknown when session_end missing", () => {
  const rows = [
    { event: "session_start", task_id: "e18-open", flow_mode: "single_agent" },
    { event: "agent_done", task_id: "e18-open", agent: "dev-backend", step_id: "s1" },
  ];
  const s = buildOperatorTraceSummary(rows, {});
  assert.equal(s.outcome, "unknown");
  assert.ok(s.missing_evidence.includes("session_end"));
});

test("fixture snapshot: complete blocked degraded unknown", () => {
  const cases = [
    { file: "complete.v1.jsonl", outcome: "complete" },
    { file: "blocked.v1.jsonl", outcome: "blocked" },
    { file: "degraded.v1.jsonl", outcome: "degraded" },
  ];
  for (const { file, outcome } of cases) {
    const rows = loadFixture(file);
    const s = buildOperatorTraceSummary(rows, { trace_file: `/fixtures/${file}` });
    assert.equal(s.outcome, outcome, file);
    assert.equal(s.schema_version, OPERATOR_TRACE_SUMMARY_SCHEMA);
    const lines = formatOperatorTraceSummaryLines(s);
    assert.ok(lines.length >= 5, file);
  }
});
