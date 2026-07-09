"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectRunsFromDir } = require("../../modules/operator/scenario-metrics-export");
const {
  buildRunOutcomeSummary,
  formatRunOutcomeSummaryLines,
} = require("../../modules/trace/run-outcome-summary");

test("buildRunOutcomeSummary: successful run with tokens and taxonomy", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "ts-ok",
      flow_mode: "single_agent",
      scenario_id: "Sc-ok",
      max_iterations: 2,
    },
    {
      event: "iteration_done",
      task_id: "ts-ok",
      outcome: "done",
      transition_reason: { type: "DONE", reason_code: "RUN_COMPLETED" },
    },
    {
      event: "session_end",
      task_id: "ts-ok",
      done: true,
      iterations: 1,
      gate_blocks: 0,
      summary: "Shipped feature X",
      ollama_prompt_tokens_total: 100,
      ollama_completion_tokens_total: 40,
    },
  ];
  const s = buildRunOutcomeSummary(rows, { trace_file: "/tmp/x.jsonl" });
  assert.equal(s.where.task_id, "ts-ok");
  assert.equal(s.where.scenario_id, "Sc-ok");
  assert.equal(s.what.done, true);
  assert.equal(s.what.last_transition_reason.reason_code, "RUN_COMPLETED");
  assert.equal(s.cost.ollama_total_tokens, 140);
  assert.equal(s.why.gate_blocks, 0);
  assert.equal(s.why.iteration_done_events, 1);
  const text = formatRunOutcomeSummaryLines(s).join("\n");
  assert.match(text, /RUN_COMPLETED/);
  assert.match(text, /Shipped feature X/);
});

test("buildRunOutcomeSummary: blocked / not done with gate_blocks", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "ts-b",
      flow_mode: "multi_agent",
      scenario_id: "Sc-b",
      max_iterations: 3,
    },
    {
      event: "iteration_done",
      task_id: "ts-b",
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "CERBERUS_BLOCKERS_ITERATE" },
      failure_axis: "cerberus",
      failure_type: "contract_mismatch",
    },
    {
      event: "session_end",
      task_id: "ts-b",
      done: false,
      iterations: 2,
      gate_blocks: 2,
      summary: "blocked",
      qa_degraded: true,
      manual_review_recommended: true,
    },
  ];
  const s = buildRunOutcomeSummary(rows, {});
  assert.equal(s.what.done, false);
  assert.equal(s.why.gate_blocks, 2);
  assert.equal(s.qa.qa_degraded, true);
  assert.equal(s.qa.manual_review_recommended, true);
  assert.ok(s.why.top_reason_codes.some((x) => x.reason_code === "CERBERUS_BLOCKERS_ITERATE"));
});

test("buildRunOutcomeSummary: model_tier_gate findings from trace", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "ts-gate",
      flow_mode: "single_agent",
      max_iterations: 1,
    },
    {
      event: "model_tier_gate_denied",
      task_id: "ts-gate",
      gate_id: "model_tier_gate",
      role: "DEV",
      agent: "dev-backend",
      step_id: "s1",
      model: "claude-opus-4",
      model_tier: "frontier",
      selection_source: "default",
      selection_reason: "model_routing_primary",
      reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
      denial_reason: "Frontier tier cannot use selection_source=default.",
    },
    {
      event: "session_end",
      task_id: "ts-gate",
      done: false,
      iterations: 1,
      gate_blocks: 1,
      summary: "blocked by model tier gate",
    },
  ];
  const s = buildRunOutcomeSummary(rows, {});
  assert.equal(s.model_tier_gate.denied_count, 1);
  assert.equal(s.model_tier_gate.findings[0].reason_code, "FRONTIER_UNAUTHORIZED_SOURCE");
  const text = formatRunOutcomeSummaryLines(s).join("\n");
  assert.match(text, /model_tier_gate: denied=1/);
});

test("buildRunOutcomeSummary: intent_groups from multi-intent rollup", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "ts-m",
      scenario_id: "Sc-m",
      flow_mode: "single_agent",
      max_iterations: 4,
    },
    {
      event: "context_stats",
      task_id: "ts-m",
      step_id: "step-a",
      agent: "dev-backend",
      iteration: 1,
      intent_id: "intent-a",
      ollama_prompt_tokens: 50,
      ollama_completion_tokens: 10,
    },
    {
      event: "agent_done",
      task_id: "ts-m",
      step_id: "step-a",
      agent: "dev-backend",
      intent_id: "intent-a",
      edge_type: "success",
    },
    {
      event: "context_stats",
      task_id: "ts-m",
      step_id: "step-b",
      agent: "qa",
      iteration: 1,
      intent_id: "intent-b",
      ollama_prompt_tokens: 5,
      ollama_completion_tokens: 2,
    },
    {
      event: "agent_done",
      task_id: "ts-m",
      step_id: "step-b",
      agent: "qa",
      intent_id: "intent-b",
      edge_type: "success",
    },
    { event: "session_end", task_id: "ts-m", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const s = buildRunOutcomeSummary(rows, {});
  assert.equal(s.intent_groups.length, 2);
  const sorted = [...s.intent_groups].sort((a, b) => b.ollama_total_tokens - a.ollama_total_tokens);
  assert.equal(sorted[0].intent_id, "intent-a");
  assert.ok(sorted[0].ollama_total_tokens >= sorted[1].ollama_total_tokens);
});

test("collectRunsFromDir attaches run_outcome_summary per run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ros-"));
  try {
    const row = [
      {
        ts: "t0",
        task_id: "tid-ros",
        event: "session_start",
        flow_mode: "single_agent",
        scenario_id: "Sc-ROS",
        max_iterations: 1,
      },
      {
        ts: "t1",
        task_id: "tid-ros",
        event: "session_end",
        iterations: 1,
        done: true,
        gate_blocks: 0,
        summary: "ok",
      },
    ].map((o) => JSON.stringify(o)).join("\n");
    fs.writeFileSync(path.join(dir, "tid-ros.jsonl"), row, "utf8");
    const runs = collectRunsFromDir(dir, { includeUntagged: false });
    assert.equal(runs.length, 1);
    assert.ok(runs[0].run_outcome_summary);
    assert.equal(runs[0].run_outcome_summary.where.task_id, "tid-ros");
    assert.equal(runs[0].run_outcome_summary.what.done, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
