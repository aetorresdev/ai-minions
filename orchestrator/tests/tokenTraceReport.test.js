"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseJsonl, buildReport } = require("../token-trace-report");

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
