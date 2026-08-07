"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPhaseContext } = require("../run-phases/phase-context");
const { executeStepAgentInvocation } = require("../run-phases/step-execution");

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

function makeCtx(overrides = {}) {
  const traces = [];
  const ctx = createPhaseContext({
    taskId: "task-step-exec",
    cwd: "/tmp/step",
    goal: "GOAL: ship feature",
    sessionEnv: null,
    iterations: () => 1,
    traceEvent: (_taskId, payload) => traces.push(payload),
    log: () => {},
    getLastBudgetMeta: () => ({}),
    emitContextStatsRows: () => {},
    emitModelFallbackLifecycleIfNeeded: () => {},
    costGuardAbort: () => false,
    ...overrides,
  });
  return { ctx, traces };
}

function makeStepDeps(overrides = {}) {
  const runState = { steps: {} };
  const degradedInRun = new Set();
  const base = {
    agentId: "dev-backend",
    step: { task: "edit foo.js" },
    stepId: "step-1",
    stepIndex: 0,
    retryNumber: 0,
    graphMeta: { graph_id: "g1" },
    intentStep: { intent_id: "intent-1" },
    contextBlock: "CTX",
    writeAgentState: () => {},
    setStepRunning: () => {},
    setStepFailedAndClear: () => {},
    setStepCompleted: () => {},
    runState,
    askAgent: async () => ({ output: "done output", context_stats: null }),
    getDegradedAgents: () => [],
    clearDegradedAgents: () => {},
    degradedInRun,
    edgeMeta: (edgeType) => ({ edge_type: edgeType }),
    qaAgentDoneTraceExtras: () => ({}),
    shouldEmitQaReviewRecord: () => false,
    traceReviewRecord: () => {},
    buildReviewRecord: (opts) => opts,
    onAfterAgentStart: async () => "proceed",
  };
  return { step: { ...base, ...overrides }, runState, degradedInRun };
}

describe("run-phases/step-execution — executeStepAgentInvocation", () => {
  it("emits agent_start before agent_done on success", async () => {
    const { ctx, traces } = makeCtx();
    const { step } = makeStepDeps();
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "continue");
    assert.equal(out.result, "done output");
    assertSubsequence(traceEvents(traces), ["agent_start", "agent_done"]);
  });

  it("emits agent_start before contract_fail on askAgent error", async () => {
    const { ctx, traces } = makeCtx();
    const { step } = makeStepDeps({
      askAgent: async () => {
        const err = new Error("missing handoff block");
        throw err;
      },
    });
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "continue");
    assert.ok(out.artifact);
    assert.equal(out.artifact.gateBlocked, true);
    assertSubsequence(traceEvents(traces), ["agent_start", "contract_fail"]);
    assert.equal(traces.some((t) => t.event === "agent_done"), false);
  });

  it("emits err.context_stats via emitContextStatsRows on contract_fail (retry marker survives)", async () => {
    /** @type {object[]} */
    const emitted = [];
    const { ctx, traces } = makeCtx({
      emitContextStatsRows: (stats, agent, iteration, _g, _i, loc) => {
        emitted.push({ stats, agent, iteration, loc });
      },
    });
    const { step } = makeStepDeps({
      askAgent: async () => {
        const err = new Error("[output contract] files_read empty");
        err.gate_id = "files_read_empty";
        err.context_stats = { ollama_retried_after_empty: 1, ollama_prompt_tokens: 12 };
        throw err;
      },
    });
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "continue");
    assertSubsequence(traceEvents(traces), ["agent_start", "contract_fail"]);
    assert.equal(emitted.length, 1, "error path must emit context_stats rows");
    assert.equal(emitted[0].agent, "dev-backend");
    assert.equal(emitted[0].stats.ollama_retried_after_empty, 1);
    assert.equal(emitted[0].loc.step_id, "step-1");
  });

  it("does not emit context_stats on contract_fail when err carries none", async () => {
    let emitCalls = 0;
    const { ctx } = makeCtx({
      emitContextStatsRows: () => { emitCalls += 1; },
    });
    const { step } = makeStepDeps({
      askAgent: async () => {
        throw new Error("plain failure without stats");
      },
    });
    await executeStepAgentInvocation(ctx, step);
    assert.equal(emitCalls, 0);
  });

  it("breaks iteration on critical role contract_fail", async () => {
    const { ctx, traces } = makeCtx();
    const { step } = makeStepDeps({
      agentId: "qa",
      askAgent: async () => {
        throw new Error("qa contract violation");
      },
    });
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "break_iteration");
    const fail = traces.find((t) => t.event === "contract_fail");
    assert.equal(fail.critical, true);
  });

  it("skips askAgent when onAfterAgentStart returns skip_step", async () => {
    const { ctx, traces } = makeCtx();
    let asked = false;
    const { step } = makeStepDeps({
      onAfterAgentStart: async () => "skip_step",
      askAgent: async () => {
        asked = true;
        return { output: "x" };
      },
    });
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "continue");
    assert.equal(asked, false);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].event, "agent_start");
  });

  it("breaks orchestration when worker cost guard aborts", async () => {
    const { ctx, traces } = makeCtx({
      costGuardAbort: (phase) => phase === "worker",
    });
    const { step } = makeStepDeps();
    const out = await executeStepAgentInvocation(ctx, step);
    assert.equal(out.action, "break_orchestration");
    assert.equal(out.result, "done output");
    assertSubsequence(traceEvents(traces), ["agent_start", "agent_done"]);
  });
});
