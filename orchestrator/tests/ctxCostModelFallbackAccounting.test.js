"use strict";

/**
 * Acceptance-style fixture: context lifecycle attribution + model fallback chain.
 * ARCHITECT → DEV → QA direct + QA infra compaction + QA continues + QA Sonnet→Haiku fallback.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildTokenUsageSummary } = require("../token-usage-summary");

test("context cost chain: direct vs infra-attributed per role; run_total matches sum(context_stats tokens)", () => {
  const rows = [
    { event: "context_stats", agent: "architect", iteration: 1, step_id: "s-arch", ollama_prompt_tokens: 3, ollama_completion_tokens: 5 },
    { event: "context_stats", agent: "dev-backend", iteration: 1, step_id: "s-dev", ollama_prompt_tokens: 7, ollama_completion_tokens: 9 },
    { event: "context_stats", agent: "qa", iteration: 1, step_id: "s-qa-1", ollama_prompt_tokens: 10, ollama_completion_tokens: 12 },
    {
      event: "context_stats",
      agent: "context_compactor",
      attributed_to_role: "qa",
      invocation_type: "context_compaction",
      execution_actor: "context_compactor",
      trigger_reason: "handoff_policy",
      iteration: 1,
      step_id: "s-qa-1",
      ollama_prompt_tokens: 30,
      ollama_completion_tokens: 40,
    },
    { event: "context_stats", agent: "qa", iteration: 1, step_id: "s-qa-2", ollama_prompt_tokens: 2, ollama_completion_tokens: 4 },
    {
      event: "context_stats",
      agent: "qa",
      iteration: 1,
      step_id: "s-fb",
      model_name: "claude-sonnet",
      model_backend: "claude",
      ollama_prompt_tokens: 100,
      ollama_completion_tokens: 50,
      status: "fallback_triggered",
      fallback_reason: "model_quota_exhausted",
      fallback_target: "claude-haiku",
      model_fallback_segment_index: 0,
      model_fallback_chain_length: 2,
    },
    {
      event: "context_stats",
      agent: "qa",
      iteration: 1,
      step_id: "s-fb",
      model_name: "claude-haiku",
      model_backend: "claude",
      ollama_prompt_tokens: 11,
      ollama_completion_tokens: 22,
      status: "completed",
      fallback_from: "claude-sonnet",
      model_fallback_segment_index: 1,
      model_fallback_chain_length: 2,
    },
  ];

  const { token_usage_summary: s } = buildTokenUsageSummary(rows);

  const arch = s.by_role.architect;
  const dev = s.by_role["dev-backend"];
  const qa = s.by_role.qa;
  assert.ok(arch && dev && qa);

  assert.equal(arch.direct_input_tokens, 3);
  assert.equal(arch.direct_output_tokens, 5);
  assert.equal(arch.infra_attributed_input_tokens, 0);
  assert.equal(arch.total_tokens, 8);

  assert.equal(dev.total_tokens, 16);

  assert.equal(qa.direct_input_tokens, 10 + 2 + 100 + 11);
  assert.equal(qa.direct_output_tokens, 12 + 4 + 50 + 22);
  assert.equal(qa.infra_attributed_input_tokens, 30);
  assert.equal(qa.infra_attributed_output_tokens, 40);
  assert.equal(qa.total_tokens, qa.direct_input_tokens + qa.direct_output_tokens + 30 + 40);

  const sumInv = s.by_invocation.reduce((a, x) => a + x.total_tokens, 0);
  assert.equal(s.run_total.total_tokens, sumInv);
  assert.equal(s.run_total.total_tokens, arch.total_tokens + dev.total_tokens + qa.total_tokens);

  const fbInv = s.by_invocation
    .filter((x) => x.step_id === "s-fb" && x.invocation_type === "agent_call")
    .sort((a, b) => (a.model_fallback_segment_index ?? 0) - (b.model_fallback_segment_index ?? 0));
  assert.equal(fbInv.length, 2);
  assert.equal(fbInv[0].fallback_target, "claude-haiku");
  assert.equal(fbInv[0].fallback_reason, "model_quota_exhausted");
  assert.equal(fbInv[1].fallback_from, "claude-sonnet");
});
