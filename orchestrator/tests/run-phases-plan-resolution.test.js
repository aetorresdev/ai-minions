"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { executePlanResolutionPhase } = require("../run-phases/plan-resolution");
const { transitionReason } = require("../trace-writer");

function traceEvents(traces) {
  return traces.map((t) => t.event);
}

function assertSubsequence(events, expectedInOrder) {
  let idx = 0;
  for (const e of events) {
    if (e === expectedInOrder[idx]) idx += 1;
  }
  assert.equal(idx, expectedInOrder.length, `expected subsequence ${expectedInOrder.join(" → ")} in ${events.join(", ")}`);
}

function makeDeps(overrides = {}) {
  const traces = [];
  const base = {
    taskId: "task-plan-phase",
    cwd: "/tmp/plan",
    flowMode: "single_agent",
    goal: "GOAL: fix bug",
    maxIterations: 3,
    sessionEnv: null,
    skipStateMcp: true,
    credentialSessionMode: "write",
    plan: { steps: [] },
    summary: "",
    manualReview: false,
    skipMainOrchestrationLoop: false,
    currentMode: "ORCHESTRATOR",
    getLastBudgetMeta: () => ({}),
    log: () => {},
    traceEvent: (_taskId, payload) => traces.push(payload),
    askAgent: async () => ({
      output: '```json\n{"steps":[{"agentId":"dev-backend","task":"edit foo.js"}]}\n```',
      context_stats: { ollama_prompt_tokens: 1, ollama_completion_tokens: 2 },
    }),
    emitModelFallbackLifecycleIfNeeded: () => {},
    emitContextStatsRows: () => {},
    maybeEmitBudgetWarning: () => {},
    checkCostGuard: () => ({ ok: true }),
    budgetEventFields: (d) => ({
      phase: d.phase,
      estimate_usd: d.estimate,
      limit_usd: d.limit,
      reason_code: "GUARD_COST_LIMIT",
    }),
    traceIterationDone: (taskId, iter, outcome, tr, extra) => {
      traces.push({ event: "iteration_done", taskId, iter, outcome, ...tr, ...extra });
    },
    transitionReason,
    roundUsd6: (n) => Math.round(n * 1e6) / 1e6,
    extractJson: (text) => {
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
    stripLeadingOwnerArchitectForDegradedMultiAgent: (steps) => steps,
    isQaSpecBeforeDevEnabled: () => false,
    applyQaSpecBeforeDevPlan: (steps) => steps,
    validatePlanStepsCapability: () => ({ ok: true, errors: [] }),
    CAPABILITY_MATRIX_VERSION: "test-v1",
    callStateMcp: () => ({ ok: true }),
    AGENT_TO_MODE: { "dev-backend": "DEV" },
  };
  return { deps: { ...base, ...overrides }, traces };
}

describe("run-phases/plan-resolution — executePlanResolutionPhase", () => {
  it("parses plan steps without iteration_done when cost guard passes", async () => {
    const { deps, traces } = makeDeps();
    const out = await executePlanResolutionPhase(deps);
    assert.equal(out.plan.steps.length, 1);
    assert.equal(out.skipMainOrchestrationLoop, false);
    assert.equal(traces.some((t) => t.event === "iteration_done"), false);
  });

  it("reads live budget meta via getter after plan context_stats accounting", async () => {
    let meta = {};
    const { deps } = makeDeps({
      getLastBudgetMeta: () => meta,
      emitContextStatsRows: () => {
        meta = { role: "orchestrator", step_id: "plan-step", model_key: "ollama/unit" };
      },
      askAgent: async () => ({
        output: '{"steps":[{"agentId":"dev-backend","task":"x"}]}',
        context_stats: { ollama_prompt_tokens: 10, ollama_completion_tokens: 5 },
      }),
      checkCostGuard: (_phase, m) => {
        assert.equal(m.role, "orchestrator");
        return { ok: true };
      },
    });
    await executePlanResolutionPhase(deps);
  });

  it("preserves trace ordering on plan-phase cost guard abort", async () => {
    const { deps, traces } = makeDeps({
      checkCostGuard: () => ({
        ok: false,
        estimate: 12.5,
        limit: 10,
        phase: "plan",
        budget_scope: "run",
        triggered_budgets: ["run"],
      }),
    });
    const out = await executePlanResolutionPhase(deps);
    assert.equal(out.skipMainOrchestrationLoop, true);
    assert.equal(out.manualReview, true);
    assert.match(out.summary, /plan phase/);
    const events = traceEvents(traces);
    assertSubsequence(events, ["budget_block", "budget_exhausted", "iteration_done"]);
    const done = traces.find((t) => t.event === "iteration_done");
    assert.equal(done.outcome, "guard_abort");
    assert.equal(done.transition_reason.reason_code, "GUARD_COST_LIMIT");
    assert.equal(done.guard_phase, "plan");
  });

  it("emits plan_capability_reject before skipping main loop", async () => {
    const { deps, traces } = makeDeps({
      validatePlanStepsCapability: () => ({ ok: false, errors: ["domain not allowed"] }),
    });
    const out = await executePlanResolutionPhase(deps);
    assert.equal(out.skipMainOrchestrationLoop, true);
    const events = traceEvents(traces);
    const rejectIdx = events.indexOf("plan_capability_reject");
    assert.ok(rejectIdx >= 0);
    assert.equal(events.includes("iteration_done"), false);
  });

  it("calls advance_mode when gates enabled and plan has first agent", async () => {
    let advanced = false;
    const { deps, traces } = makeDeps({
      skipStateMcp: false,
      callStateMcp: (tool, payload) => {
        if (tool === "advance_mode") {
          advanced = true;
          assert.equal(payload.from_mode, "ORCHESTRATOR");
          assert.equal(payload.to_mode, "DEV");
        }
        return { ok: true };
      },
    });
    const out = await executePlanResolutionPhase(deps);
    assert.equal(advanced, true);
    assert.equal(out.currentMode, "DEV");
    assert.equal(traces.some((t) => t.event === "iteration_done"), false);
  });

  it("emits plan_normalized when multi_agent degraded strip removes leading steps", async () => {
    const { deps, traces } = makeDeps({
      flowMode: "multi_agent",
      skipStateMcp: true,
      askAgent: async () => ({
        output: '{"steps":[{"agentId":"owner","task":"scope"},{"agentId":"dev-backend","task":"fix"}]}',
      }),
      stripLeadingOwnerArchitectForDegradedMultiAgent: (steps) => steps.slice(1),
    });
    const out = await executePlanResolutionPhase(deps);
    assert.equal(out.plan.steps.length, 1);
    assert.equal(out.plan.steps[0].agentId, "dev-backend");
    assert.equal(traces.some((t) => t.event === "plan_normalized"), true);
  });

  it("catches planner output-contract throw and emits terminal contract_fail without rethrow", async () => {
    const err = new Error("[output contract] orchestrator: output is not valid JSON");
    err.gate_id = "orchestrator_json";
    err.rawModelOutput = "not json at all";
    err.context_stats = { ollama_prompt_tokens: 11, ollama_completion_tokens: 7 };
    let emittedStats = null;
    const { deps, traces } = makeDeps({
      askAgent: async () => {
        throw err;
      },
      emitContextStatsRows: (stats) => {
        emittedStats = stats;
      },
    });
    const out = await executePlanResolutionPhase(deps);
    assert.equal(out.skipMainOrchestrationLoop, true);
    assert.equal(out.manualReview, true);
    assert.match(out.summary, /orchestrator_json/);
    assert.deepEqual(emittedStats, err.context_stats);
    const fail = traces.find((t) => t.event === "contract_fail");
    assert.ok(fail);
    assert.equal(fail.phase, "planning");
    assert.equal(fail.gate_id, "orchestrator_json");
    assert.equal(fail.failure_class, "output_contract");
    assert.equal(fail.critical, true);
    assert.match(String(fail.sanitized_preview || ""), /not json/);
    const done = traces.find((t) => t.event === "iteration_done");
    assert.equal(done.outcome, "abort");
    assert.equal(done.phase, "planning");
    assert.equal(done.gate_id, "orchestrator_json");
  });
});
