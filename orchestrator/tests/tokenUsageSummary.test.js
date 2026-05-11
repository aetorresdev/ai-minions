"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildTokenUsageSummary } = require("../token-usage-summary");
const { buildReport } = require("../token-trace-report");

test("buildTokenUsageSummary splits direct vs infra-attributed (role totals)", () => {
  const rows = [
    { event: "context_stats", agent: "architect", iteration: 0, ollama_prompt_tokens: 3, ollama_completion_tokens: 5 },
    { event: "context_stats", agent: "dev-backend", iteration: 1, ollama_prompt_tokens: 10, ollama_completion_tokens: 20 },
    { event: "context_stats", agent: "qa", iteration: 1, ollama_prompt_tokens: 7, ollama_completion_tokens: 8 },
    {
      event: "context_stats",
      agent: "context_compactor",
      attributed_to_role: "qa",
      invocation_type: "context_compaction",
      execution_actor: "context_compactor",
      trigger_reason: "handoff_policy",
      iteration: 1,
      step_id: "s-qa",
      ollama_prompt_tokens: 30,
      ollama_completion_tokens: 40,
    },
    { event: "context_stats", agent: "qa", iteration: 1, ollama_prompt_tokens: 1, ollama_completion_tokens: 2 },
  ];

  const { token_usage_summary: s } = buildTokenUsageSummary(rows);
  assert.equal(s.run_total.input_tokens, 51);
  assert.equal(s.run_total.output_tokens, 75);
  assert.equal(s.run_total.total_tokens, 126);

  const qa = s.by_role.qa;
  assert.ok(qa);
  assert.equal(qa.direct_input_tokens, 8);
  assert.equal(qa.direct_output_tokens, 10);
  assert.equal(qa.infra_attributed_input_tokens, 30);
  assert.equal(qa.infra_attributed_output_tokens, 40);
  assert.equal(qa.total_tokens, 88);

  const comp = s.by_invocation.find((x) => x.invocation_type === "context_compaction");
  assert.ok(comp);
  assert.equal(comp.attributed_to_role, "qa");
  assert.equal(comp.execution_actor, "context_compactor");
});

test("buildTokenUsageSummary records by_model for zero-token Claude fallback segments", () => {
  const rows = [
    {
      event: "context_stats",
      agent: "qa",
      iteration: 1,
      step_id: "s1",
      model_name: "claude-sonnet-4-6",
      model_backend: "claude",
      ollama_prompt_tokens: 0,
      ollama_completion_tokens: 0,
      status: "fallback_triggered",
      fallback_reason: "model_error",
      model_fallback_segment_index: 0,
      model_fallback_chain_length: 2,
    },
    {
      event: "context_stats",
      agent: "qa",
      iteration: 1,
      step_id: "s1",
      model_name: "claude-haiku-4-5-20251001",
      model_backend: "claude",
      ollama_prompt_tokens: 0,
      ollama_completion_tokens: 0,
      status: "completed",
      fallback_from: "claude-sonnet-4-6",
      usage_accounting_status: "unknown_provider_usage",
      model_fallback_segment_index: 1,
      model_fallback_chain_length: 2,
    },
  ];
  const { token_usage_summary: s } = buildTokenUsageSummary(rows);
  assert.equal(s.by_invocation.length, 2);
  assert.equal(s.by_role.qa.by_model.length, 2);
  assert.equal(s.by_role.qa.by_model[0].status, "fallback_triggered");
  assert.equal(s.by_role.qa.by_model[1].fallback_from, "claude-sonnet-4-6");
});

test("buildReport includes token_usage_summary", () => {
  const rows = [
    { event: "context_stats", agent: "dev-backend", ollama_prompt_tokens: 1, ollama_completion_tokens: 1 },
    {
      event: "context_stats",
      agent: "context_compactor",
      attributed_to_role: "dev-backend",
      invocation_type: "context_compaction",
      ollama_prompt_tokens: 2,
      ollama_completion_tokens: 3,
    },
  ];
  const report = buildReport(rows);
  assert.ok(report.token_usage_summary);
  assert.equal(report.token_usage_summary.by_role["dev-backend"].total_tokens, 7);
});
