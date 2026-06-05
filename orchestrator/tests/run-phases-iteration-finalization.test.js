"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPhaseContext } = require("../run-phases/phase-context");
const {
  finalizeStepArtifact,
  executeIterationFinalizationPhase,
} = require("../run-phases/iteration-finalization");
const {
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
} = require("../trace-lifecycle-events");
const { detectBlockers } = require("../run-loop-helpers");
const { transitionReason } = require("../trace-writer");
const {
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
  decideCorrectionsPlan,
  planStepsAfterCorrectionsResponse,
  formatGateBlockedReasonLines,
  planStepsReplayFromGateBlockedArtifacts,
  summaryMaxIterationsGateBlocked,
  decideFromOrchestratorDecide,
  mapDecideLoopToPlanOutcome,
} = require("../decision-engine");
const { truncateForContext } = require("../context-utils");
const {
  compactHandoffStrictFailureFields,
} = require("../orchestrator");

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
    taskId: "task-iter-final",
    cwd: "/tmp/iter",
    goal: "GOAL: ship",
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

describe("run-phases/iteration-finalization — finalizeStepArtifact", () => {
  it("returns artifact with handoff fields when summarizer disabled", async () => {
    const { ctx } = makeCtx();
    const out = await finalizeStepArtifact(ctx, {
      agentId: "dev-backend",
      step: { task: "edit foo.js" },
      stepId: "s1",
      intentId: "i1",
      result: "done",
      handoffYaml: "files_modified:\n  - foo.js\n",
      handoffCompressionMeta: {},
      stepSummary: false,
      priorArtifacts: [],
      summarizeHandoff: async () => ({ summary: "x" }),
      bumpOllamaFromStats: () => {},
      costGuardAbort: () => false,
    });
    assert.equal(out.action, "proceed");
    assert.equal(out.artifact.gateBlocked, false);
    assert.equal(out.artifact.step_id, "s1");
    assert.match(out.artifact.handoffYaml, /files_modified/);
  });

  it("breaks orchestration when summarizer cost guard aborts", async () => {
    const { ctx, traces } = makeCtx();
    const out = await finalizeStepArtifact(ctx, {
      agentId: "dev-backend",
      step: { task: "edit foo.js" },
      stepId: "s1",
      intentId: "i1",
      result: "done",
      handoffYaml: "",
      handoffCompressionMeta: {},
      stepSummary: true,
      priorArtifacts: [],
      summarizeHandoff: async () => ({
        summary: "summary text",
        ollama_prompt_tokens: 3,
        ollama_completion_tokens: 2,
      }),
      bumpOllamaFromStats: () => {},
      costGuardAbort: (phase) => phase === "summarizer",
    });
    assert.equal(out.action, "break_orchestration");
    assert.equal(traces.some((t) => t.event === "context_stats" && t.agent === "summarizer"), true);
  });
});

function makeIterDeps(overrides = {}) {
  const { ctx, traces } = makeCtx(overrides.ctxOverrides);
  const artifacts = overrides.artifacts ?? [
    {
      agentId: "dev-backend",
      task: "fix",
      result: "files_read: [a.js]\nfiles_modified:\n- a.js\nvalidation_run: ok",
      gateBlocked: false,
      step_id: "s-dev",
    },
  ];

  const base = {
    artifacts,
    goal: "GOAL: ship",
    maxIterations: 3,
    maxReviewChars: 8000,
    sessionEnv: null,
    previousAgentId: "dev-backend",
    currentMode: "QA",
    requireHandoff: false,
    skipStateMcp: true,
    flowMode: "single_agent",
    askAgent: async (agentId) => {
      if (agentId === "cerberus") {
        return {
          output: "improvement: reviewed deliverables; no blockers identified\nnice-to-have: (none)\n",
        };
      }
      return { output: '{"done": true, "summary": "All good"}' };
    },
    bumpOllamaFromStats: () => {},
    costGuardAbort: () => false,
    truncateForContext,
    logRoleSwitch: () => {},
    detectBlockers,
    callCompactHandoff: () => ({ yaml: "verdict: approve\n", ollama_prompt_tokens: 1, ollama_completion_tokens: 1 }),
    emitContextCompactionStarted,
    emitContextCompactionCompleted,
    compactHandoffStrictFailureFields,
    callStateMcp: () => ({ ok: true, allowed: true }),
    traceReviewRecord: () => {},
    buildReviewRecord: (o) => o,
    traceDoubtReviewCycle: () => {},
    buildDoubtReviewCycleFromCerberusOutput: (_o, meta) => meta,
    traceIterationDone: (_taskId, _iter, outcome, tr, extra, ctxExtra) => {
      traces.push({ event: "iteration_done", outcome, ...tr, ...extra, ...ctxExtra });
    },
    transitionReason,
    iterationDoneCtx: () => ({}),
    extractJson: (text) => {
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
    decideCerberusBlockersBranch,
    decideGateBlockedArtifactsBranch,
    decideCorrectionsPlan,
    planStepsAfterCorrectionsResponse,
    formatGateBlockedReasonLines,
    planStepsReplayFromGateBlockedArtifacts,
    summaryMaxIterationsGateBlocked,
    decideFromOrchestratorDecide,
    mapDecideLoopToPlanOutcome,
  };

  return { ctx, traces, deps: { ...base, ...overrides.deps }, artifacts };
}

describe("run-phases/iteration-finalization — executeIterationFinalizationPhase", () => {
  it("emits cerberus_check before iteration_done on done path", async () => {
    const { ctx, traces, deps } = makeIterDeps();
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.action, "continue");
    assert.equal(out.done, true);
    assert.equal(out.summary, "All good");
    assertSubsequence(traceEvents(traces), ["cerberus_check", "iteration_done"]);
    const done = traces.find((t) => t.event === "iteration_done");
    assert.equal(done.outcome, "done");
  });

  it("forces iteration when cerberus reports blockers", async () => {
    const { ctx, traces, deps } = makeIterDeps({
      deps: {
        askAgent: async (agentId) => {
          if (agentId === "cerberus") {
            return { output: "blocker: missing tests\nimprovement: (none)\nnice-to-have: (none)\n" };
          }
          return {
            output: '{"done": false, "corrections": [{"agentId": "dev-backend", "task": "add tests"}]}',
          };
        },
      },
    });
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.action, "continue");
    assert.equal(out.plan.steps.length, 1);
    assertSubsequence(traceEvents(traces), ["cerberus_check", "iteration_done"]);
    const done = traces.find((t) => t.event === "iteration_done");
    assert.equal(done.outcome, "iterate");
    assert.equal(done.transition_reason.reason_code, "CERBERUS_BLOCKERS_ITERATE");
  });

  it("gate-blocked artifacts force gate_blocked_iterate iteration_done", async () => {
    const { ctx, traces, deps } = makeIterDeps({
      artifacts: [
        {
          agentId: "dev-backend",
          task: "fix",
          result: "",
          gateBlocked: true,
          gateReason: "handoff_structure: invalid",
          gate_kind: "handoff_structure",
          step_id: "s-blocked",
          intent_id: "i1",
        },
      ],
      deps: {
        askAgent: async (agentId) => {
          if (agentId === "cerberus") {
            return {
              output: "improvement: reviewed deliverables; no blockers identified\nnice-to-have: (none)\n",
            };
          }
          throw new Error(`unexpected askAgent call: ${agentId}`);
        },
      },
    });
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.action, "continue");
    assert.ok(out.plan.steps.length >= 1);
    assert.equal(traces.some((t) => t.event === "gate_blocked_completion"), true);
    const done = traces.find((t) => t.event === "iteration_done");
    assert.equal(done.outcome, "gate_blocked_iterate");
  });
});
