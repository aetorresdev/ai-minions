"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseJsonl, buildReport, optionalOllamaUsdEstimate, rollupStepsCostOutcome } = require("../token-trace-report");

test("parseJsonl skips empty lines and collects errors", () => {
  const { rows, errors } = parseJsonl(`{"a":1}\n\nnot-json\n{"b":2}\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a, 1);
  assert.equal(rows[1].b, 2);
  assert.ok(errors.length >= 1);
});

test("buildReport aggregates context_stats and session_end", () => {
  const jsonl = [
    { ts: "t0", task_id: "tid", event: "session_start", flow_mode: "single_agent", max_iterations: 2 },
    { ts: "t1", task_id: "tid", event: "context_stats", agent: "orchestrator", phase: "plan", ollama_prompt_tokens: 10, ollama_completion_tokens: 2 },
    { ts: "t2", task_id: "tid", event: "context_stats", agent: "dev-backend", iteration: 1, ollama_prompt_tokens: 100, ollama_completion_tokens: 50 },
    { ts: "t3", task_id: "tid", event: "mcp_call", server: "x", tool: "y", transport: "direct", duration_ms: 1, ok: true },
    {
      ts: "t4",
      task_id: "tid",
      event: "session_end",
      iterations: 1,
      done: true,
      ollama_prompt_tokens_total: 110,
      ollama_completion_tokens_total: 52,
      mcp_total_calls: 1,
      mcp_failed_calls: 0,
      mcp_by_tool: { "x.y": 1 },
      mcp_by_transport: { direct: 1 },
    },
  ].map((o) => JSON.stringify(o)).join("\n");

  const { rows } = parseJsonl(jsonl);
  const report = buildReport(rows);
  assert.equal(report.ollama_from_context_stats.prompt, 110);
  assert.equal(report.ollama_from_context_stats.completion, 52);
  assert.ok(report.ollama_session_end_totals);
  assert.equal(report.mcp_events_count, 1);
  assert.equal(report.mcp_from_session_end.mcp_total_calls, 1);
  assert.ok(report.by_agent_phase["orchestrator | plan"]);
});

test("rollupStepsCostOutcome joins tokens and failure signals by step_id", () => {
  const intent = "11111111-2222-3333-4444-555555555555";
  const rows = [
    { event: "agent_start", step_id: "s1", intent_id: intent, agent: "dev-backend", iteration: 1 },
    { event: "agent_done", step_id: "s1", intent_id: intent, edge_type: "success", agent: "dev-backend", iteration: 1 },
    { event: "context_stats", step_id: "s1", intent_id: intent, agent: "dev-backend", iteration: 1, ollama_prompt_tokens: 100, ollama_completion_tokens: 40 },
    { event: "context_stats", step_id: "s1", intent_id: intent, agent: "dev-backend", iteration: 1, ollama_prompt_tokens: 10, ollama_completion_tokens: 5 },
    { event: "agent_start", step_id: "s2", intent_id: intent, agent: "qa", iteration: 1 },
    { event: "gate_result", step_id: "s2", passed: false, gate: "handoff_structure" },
    { event: "context_stats", step_id: "s2", agent: "qa", iteration: 1, ollama_prompt_tokens: 1, ollama_completion_tokens: 1 },
  ];
  const roll = rollupStepsCostOutcome(rows);
  assert.equal(roll.length, 2);
  assert.equal(roll[0].step_id, "s1");
  assert.equal(roll[0].ollama_total_tokens, 155);
  assert.equal(roll[0].step_failed, false);
  assert.equal(roll[0].intent_id, intent);
  const s2 = roll.find((x) => x.step_id === "s2");
  assert.ok(s2);
  assert.equal(s2.step_failed, true);
  assert.equal(s2.gate_fail, true);
});

test("rollupStepsCostOutcome records qa_blocker_non_vacuous from qa agent_done", () => {
  const rows = [
    { event: "agent_start", step_id: "sq", agent: "qa", iteration: 0 },
    {
      event: "agent_done",
      step_id: "sq",
      agent: "qa",
      iteration: 0,
      edge_type: "success",
      qa_triple_template: true,
      qa_blocker_non_vacuous: true,
    },
    { event: "context_stats", step_id: "sq", agent: "qa", iteration: 0, ollama_prompt_tokens: 5, ollama_completion_tokens: 2 },
  ];
  const roll = rollupStepsCostOutcome(rows);
  assert.equal(roll.length, 1);
  assert.equal(roll[0].step_failed, false);
  assert.equal(roll[0].qa_triple_template, true);
  assert.equal(roll[0].qa_blocker_non_vacuous, true);
});

test("rollupStepsCostOutcome omits qa fields when agent_done has no qa template flags", () => {
  const rows = [
    { event: "agent_start", step_id: "sd", agent: "dev-backend", iteration: 0 },
    { event: "agent_done", step_id: "sd", agent: "dev-backend", iteration: 0, edge_type: "success" },
    { event: "context_stats", step_id: "sd", agent: "dev-backend", iteration: 0, ollama_prompt_tokens: 1, ollama_completion_tokens: 1 },
  ];
  const roll = rollupStepsCostOutcome(rows);
  assert.equal(roll.length, 1);
  assert.equal(roll[0].qa_triple_template, undefined);
  assert.equal(roll[0].qa_blocker_non_vacuous, undefined);
});

test("optionalOllamaUsdEstimate marks USD as estimated when env rates set", () => {
  const jsonl = [
    { ts: "t0", task_id: "tid", event: "session_start", flow_mode: "single_agent" },
    { ts: "t1", task_id: "tid", event: "session_end", ollama_prompt_tokens_total: 1e6, ollama_completion_tokens_total: 1e6 },
  ].map((o) => JSON.stringify(o)).join("\n");
  const report = buildReport(parseJsonl(jsonl).rows);
  process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "2";
  try {
    const usd = optionalOllamaUsdEstimate(report);
    assert.ok(usd);
    assert.equal(usd.usd_note, "estimated");
    assert.equal(usd.usd_source, "env_rates_per_mtok");
    assert.equal(usd.usd_total_estimate, 3);
  } finally {
    delete process.env.ORCH_USD_PER_MTOK_PROMPT;
    delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
  }
});
