"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCostTokenRunSummary,
  formatRunCostLine,
  formatRunLatencyLine,
  resolveStepCost,
} = require("../../modules/operator/operator-cost-token-summary");

test("resolveStepCost prefers known provider cost", () => {
  const r = resolveStepCost(0.05, 0.01, 1000, "anthropic");
  assert.equal(r.cost_status, "known");
  assert.equal(r.cost_usd, 0.05);
});

test("resolveStepCost uses estimated rollup when no provider cost", () => {
  const r = resolveStepCost(0, 0.02, 500, "ollama");
  assert.equal(r.cost_status, "estimated");
  assert.equal(r.cost_usd, 0.02);
});

test("resolveStepCost marks ollama tokens as not_billing without rates", () => {
  const r = resolveStepCost(null, null, 200, "ollama");
  assert.equal(r.cost_status, "not_billing");
  assert.equal(r.cost_usd, null);
});

test("buildCostTokenRunSummary aggregates run tokens from session_end", () => {
  const rows = [
    { event: "session_start", task_id: "c1", model_backend: "ollama" },
    {
      event: "context_stats",
      task_id: "c1",
      step_id: "c1-i1-dev",
      agent: "dev-backend",
      phase: "execute",
      ollama_prompt_tokens: 20,
      ollama_completion_tokens: 8,
    },
    {
      event: "session_end",
      task_id: "c1",
      done: true,
      ollama_prompt_tokens_total: 20,
      ollama_completion_tokens_total: 8,
    },
  ];
  const summary = buildCostTokenRunSummary(rows);
  assert.equal(summary.run.token_status, "available");
  assert.equal(summary.run.total_tokens, 28);
  assert.equal(summary.run.cost_status, "not_billing");
  assert.equal(summary.by_step.length, 1);
  assert.equal(summary.by_step[0].phase, "execute");
});

test("buildCostTokenRunSummary includes model_selection per-step fields", () => {
  const rows = [
    { event: "session_start", task_id: "m1", model_backend: "ollama" },
    {
      event: "model_selection",
      step_id: "m1-i1-dev",
      agent: "dev-backend",
      model: "qwen2.5-coder:7b",
      model_tier: "cheap",
      selection_reason: "default_model from policy",
      estimated_cost_usd: 0.001,
    },
    {
      event: "agent_start",
      step_id: "m1-i1-dev",
      agent: "dev-backend",
      ts_ms: 1000,
    },
    {
      event: "agent_done",
      step_id: "m1-i1-dev",
      agent: "dev-backend",
      duration_ms: 42,
      ts_ms: 1042,
    },
    { event: "session_end", task_id: "m1", done: true },
  ];
  const summary = buildCostTokenRunSummary(rows);
  const step = summary.by_step[0];
  assert.equal(step.model, "qwen2.5-coder:7b");
  assert.equal(step.model_tier, "cheap");
  assert.match(step.selection_reason, /default_model/);
  assert.equal(step.cost_status, "known");
  assert.equal(step.latency_ms, 42);
  assert.equal(summary.run.cost_status, "known");
  assert.equal(summary.run.total_latency_ms, 42);
});

test("buildCostTokenRunSummary rolls up by phase", () => {
  const rows = [
    { event: "session_start", task_id: "p1" },
    {
      event: "context_stats",
      step_id: "s1",
      phase: "plan",
      ollama_prompt_tokens: 10,
      ollama_completion_tokens: 5,
    },
    {
      event: "context_stats",
      step_id: "s2",
      phase: "execute",
      ollama_prompt_tokens: 30,
      ollama_completion_tokens: 10,
    },
    {
      event: "session_end",
      done: true,
      ollama_prompt_tokens_total: 40,
      ollama_completion_tokens_total: 15,
    },
  ];
  const summary = buildCostTokenRunSummary(rows);
  assert.equal(summary.by_phase.length, 2);
  const execute = summary.by_phase.find((p) => p.phase === "execute");
  assert.ok(execute);
  assert.equal(execute.total_tokens, 40);
});

test("formatRunCostLine distinguishes not_billing for local backend", () => {
  const line = formatRunCostLine({
    run: {
      token_status: "available",
      total_tokens: 28,
      input_tokens: 20,
      output_tokens: 8,
      cost_status: "not_billing",
    },
  });
  assert.match(line, /not_billing/);
  assert.match(line, /28 tokens/);
});

test("formatRunLatencyLine reports unavailable without durations", () => {
  const line = formatRunLatencyLine({
    run: { latency_status: "unavailable" },
  });
  assert.match(line, /unavailable/);
});

test("buildCostTokenRunSummary uses env estimated USD when rates configured", () => {
  const prevP = process.env.ORCH_USD_PER_MTOK_PROMPT;
  const prevC = process.env.ORCH_USD_PER_MTOK_COMPLETION;
  process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "2";
  try {
    const rows = [
      { event: "session_start", task_id: "e1", model_backend: "ollama" },
      {
        event: "context_stats",
        step_id: "e1-s1",
        ollama_prompt_tokens: 1_000_000,
        ollama_completion_tokens: 500_000,
      },
      {
        event: "session_end",
        done: true,
        ollama_prompt_tokens_total: 1_000_000,
        ollama_completion_tokens_total: 500_000,
      },
    ];
    const summary = buildCostTokenRunSummary(rows);
    assert.equal(summary.run.cost_status, "estimated");
    assert.equal(summary.run.estimated_cost_usd, 2);
    const line = formatRunCostLine(summary);
    assert.match(line, /estimated from config rates/);
  } finally {
    if (prevP === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
    else process.env.ORCH_USD_PER_MTOK_PROMPT = prevP;
    if (prevC === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
    else process.env.ORCH_USD_PER_MTOK_COMPLETION = prevC;
  }
});
