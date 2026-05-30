"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  collectBudgetEvents,
  deriveBudgetStatus,
  formatBudgetViewText,
  runBudgetView,
} = require("../runner-budget-view");

const goldenClean = fs.readFileSync(
  path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl"),
  "utf8",
).trim().split("\n").map((l) => JSON.parse(l));

describe("runner-budget-view", () => {
  it("collectBudgetEvents captures warning, block, and guard abort", () => {
    const rows = [
      { event: "budget_warning", phase: "plan", estimate_usd: 0.8, threshold_usd: 0.5, limit_usd: 1, budget_scope: "run", ts_ms: 1 },
      { event: "budget_block", phase: "plan", estimate_usd: 1.2, limit_usd: 1, budget_scope: "run", reason_code: "GUARD_COST_LIMIT", ts_ms: 2 },
      { event: "budget_exhausted", phase: "plan", estimate_usd: 1.2, limit_usd: 1, budget_scope: "run", ts_ms: 3 },
      {
        event: "iteration_done",
        outcome: "abort",
        guard_phase: "plan",
        estimate_usd: 1.2,
        limit_usd: 1,
        budget_scope: "run",
        transition_reason: { reason_code: "GUARD_COST_LIMIT" },
        ts_ms: 4,
      },
      { event: "budget_config_invalid", var_name: "ORCH_BUDGET_WARNING_RATIO", reason: "out_of_range", ts_ms: 5 },
    ];
    const events = collectBudgetEvents(rows);
    assert.equal(events.length, 5);
    assert.equal(events[0].kind, "budget_warning");
    assert.equal(events[3].kind, "guard_cost_limit");
    assert.equal(deriveBudgetStatus(events), "config_invalid");
  });

  it("deriveBudgetStatus returns blocked when guard abort without config invalid", () => {
    const rows = [
      { event: "budget_block", limit_usd: 1, estimate_usd: 2, ts_ms: 1 },
    ];
    const events = collectBudgetEvents(rows);
    assert.equal(deriveBudgetStatus(events), "blocked");
  });

  it("formatBudgetViewText shows tokens and budget timeline", () => {
    const prevPrompt = process.env.ORCH_USD_PER_MTOK_PROMPT;
    const prevCompletion = process.env.ORCH_USD_PER_MTOK_COMPLETION;
    try {
      process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
      process.env.ORCH_USD_PER_MTOK_COMPLETION = "1";
      const rows = [
        ...goldenClean.slice(0, 2),
        {
          event: "context_stats",
          task_id: "task-golden-v1",
          step_id: "task-golden-v1-i1-dev-backend",
          agent: "dev-backend",
          iteration: 1,
          ollama_prompt_tokens: 1000,
          ollama_completion_tokens: 500,
          ts_ms: 3,
        },
        {
          event: "session_end",
          task_id: "task-golden-v1",
          iterations: 1,
          done: true,
          ollama_prompt_tokens_total: 1000,
          ollama_completion_tokens_total: 500,
          ts_ms: 4,
        },
        { event: "budget_warning", phase: "execute", estimate_usd: 0.0015, threshold_usd: 0.001, limit_usd: 0.002, budget_scope: "run", ts_ms: 5 },
      ];
      const text = formatBudgetViewText(rows, { trace_file: "/tmp/golden.jsonl" });
      assert.match(text, /Runner budget view/);
      assert.match(text, /task-golden-v1/);
      assert.match(text, /cost:\s+prompt=1000/);
      assert.match(text, /Top steps by Ollama tokens/);
      assert.match(text, /budget_warning/);
      assert.match(text, /budget_status:\s+warning/);
    } finally {
      if (prevPrompt === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
      else process.env.ORCH_USD_PER_MTOK_PROMPT = prevPrompt;
      if (prevCompletion === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
      else process.env.ORCH_USD_PER_MTOK_COMPLETION = prevCompletion;
    }
  });

  it("formatBudgetViewText handles trace without budget events", () => {
    const text = formatBudgetViewText(goldenClean, { trace_file: "/tmp/golden.jsonl" });
    assert.match(text, /budget_status:\s+no_budget_signals/);
    assert.match(text, /Budget timeline/);
    assert.match(text, /\(none recorded\)/);
  });

  it("runBudgetView snapshot reads fixture file", async () => {
    const fixture = path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl");
    const result = await runBudgetView({ filePath: fixture });
    assert.equal(result.ok, true);
    assert.match(result.text || "", /Runner budget view/);
    assert.match(result.text || "", /terminal_status:\s+done/);
  });

  it("runBudgetView reports missing trace", async () => {
    const missing = path.join(os.tmpdir(), `task-missing-budget-${Date.now()}.jsonl`);
    const result = await runBudgetView({ filePath: missing });
    assert.equal(result.ok, false);
    assert.equal(result.error, "trace file not found");
  });
});
