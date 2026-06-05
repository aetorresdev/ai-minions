"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPhaseContext } = require("../run-phases/phase-context");
const { executeSessionEndPhase } = require("../run-phases/session-end");
const { transitionReason } = require("../trace-writer");
const { loopExhaustedDefaultSummary } = require("../decision-engine");

function traceEvents(traces) {
  return traces.map((t) => t.event);
}

function assertSubsequence(events, expectedInOrder) {
  let idx = 0;
  for (const e of events) {
    if (e === expectedInOrder[idx]) idx += 1;
  }
  assert.equal(
    idx,
    expectedInOrder.length,
    `expected subsequence ${expectedInOrder.join(" → ")} in ${events.join(", ")}`,
  );
}

function makeDeps(overrides = {}) {
  const traces = [];
  const ctx = createPhaseContext({
    taskId: "task-session-end",
    cwd: "/tmp/end",
    goal: "GOAL: finish",
    sessionEnv: null,
    iterations: () => 3,
    traceEvent: (_taskId, payload) => traces.push(payload),
    log: () => {},
    getLastBudgetMeta: () => ({}),
    emitContextStatsRows: () => {},
    emitModelFallbackLifecycleIfNeeded: () => {},
    costGuardAbort: () => false,
  });

  const mcpCalls = [];
  const base = {
    done: false,
    summary: "",
    manualReview: false,
    iterations: 3,
    maxIterations: 3,
    skipStateMcp: false,
    runState: { task_id: "task-session-end", iterations: 3 },
    artifacts: [
      { agentId: "dev-backend", task: "fix", result: "ok", gateBlocked: false, handoff_fallback_used: true, handoff_error: "timeout" },
    ],
    goal: "GOAL: finish",
    degradedInRun: new Set(["qa"]),
    runScope: { scope: "local" },
    scenarioId: "scenario-a",
    ollamaTokenTotals: { prompt: 10, completion: 5 },
    loopExhaustedDefaultSummary,
    traceIterationDone: (_taskId, _iter, outcome, tr, extra) => {
      traces.push({ event: "iteration_done", outcome, ...tr, ...extra });
    },
    transitionReason,
    finalizeRunState: (rs, opts) => {
      rs.finalized = opts;
    },
    callStateMcp: (tool, payload) => {
      mcpCalls.push({ tool, payload });
      return { ok: true };
    },
    AGENT_STATE_FILE: "/tmp/nonexistent-agent-state",
    fsUnlinkSync: () => {},
    loadTraceRowsForTask: () => [{ event: "session_start", task_id: "task-session-end" }],
    runRecoverySweepAndTrace: () => {
      traces.push({ event: "recovery_sweep", lifecycleMode: "live_before_session_end" });
    },
    getRunStatePublicView: (rs) => ({ ...rs, public: true }),
    aggregateMcpUsage: () => ({ mcp_total_calls: 2 }),
    getMcpAuditCalls: () => [],
    aggregatePermissionCheckRows: () => ({ by_decision: { allow: 1 } }),
    getPermissionCheckAuditBuffer: () => [],
  };

  return { ctx, traces, mcpCalls, deps: { ...base, ...overrides } };
}

describe("run-phases/session-end — executeSessionEndPhase", () => {
  it("emits loop_limit_stopped iteration_done when run exhausts without summary", () => {
    const { ctx, traces, deps } = makeDeps({ artifacts: [] });
    const out = executeSessionEndPhase(ctx, deps);
    assert.match(out.summary, /Stopped after 3 iteration/);
    const doneEv = traces.find((t) => t.event === "iteration_done");
    assert.equal(doneEv.outcome, "loop_limit_stopped");
    assert.equal(out.done, false);
  });

  it("records artifact, closes task, runs recovery sweep, then session_end", () => {
    const { ctx, traces, mcpCalls, deps } = makeDeps({ done: true, summary: "Shipped." });
    const out = executeSessionEndPhase(ctx, deps);
    assert.equal(out.done, true);
    assert.match(out.summary, /handoff compression unavailable/);
    assert.equal(mcpCalls.some((c) => c.tool === "record_artifact"), true);
    assert.equal(mcpCalls.some((c) => c.tool === "close_task"), true);
    assertSubsequence(traceEvents(traces), ["recovery_sweep", "session_end"]);
    const end = traces.find((t) => t.event === "session_end");
    assert.equal(end.scenario_id, "scenario-a");
    assert.equal(end.qa_degraded, true);
    assert.equal(end.manual_review_recommended, true);
    assert.equal(end.handoff_degraded, true);
    assert.equal(end.ollama_prompt_tokens_total, 10);
    assert.equal(out.runState.public, true);
  });

  it("skips state MCP when skipStateMcp is true", () => {
    const { ctx, mcpCalls, deps } = makeDeps({ skipStateMcp: true, done: true, summary: "ok" });
    executeSessionEndPhase(ctx, deps);
    assert.equal(mcpCalls.length, 0);
  });
});
