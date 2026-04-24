"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDashboardText, linesCountTable, sortedEntries } = require("../console-dashboard");

test("sortedEntries orders by count descending", () => {
  const s = sortedEntries({ a: 1, b: 3, c: 2 });
  assert.deepEqual(s, [["b", 3], ["c", 2], ["a", 1]]);
});

test("linesCountTable includes bars and keys", () => {
  const lines = linesCountTable("demo", { x: 2, y: 1 }, 10, 10);
  const joined = lines.join("\n");
  assert.match(joined, /demo/);
  assert.match(joined, /x/);
  assert.match(joined, /#####/);
});

test("buildDashboardText includes taxonomy and rollup header", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "t1",
      flow_mode: "single_agent",
      max_iterations: 2,
      scenario_id: "S1",
    },
    {
      event: "iteration_done",
      task_id: "t1",
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "CERBERUS_BLOCKERS_ITERATE" },
      failure_type: "contract_mismatch",
      failure_axis: "cerberus",
    },
    {
      event: "context_stats",
      task_id: "t1",
      step_id: "t1-i0-dev-backend",
      agent: "dev-backend",
      iteration: 0,
      ollama_prompt_tokens: 100,
      ollama_completion_tokens: 50,
    },
    {
      event: "agent_done",
      task_id: "t1",
      step_id: "t1-i0-dev-backend",
      agent: "dev-backend",
      edge_type: "success",
    },
    { event: "session_end", task_id: "t1", done: false, iterations: 1, gate_blocks: 0 },
  ];
  const out = buildDashboardText(rows, { source: "fixture" });
  assert.match(out, /CERBERUS_BLOCKERS_ITERATE/);
  assert.match(out, /cerberus/);
  assert.match(out, /t1-i0-dev-backend/);
  assert.match(out, /rollupStepsCostOutcome/);
});
