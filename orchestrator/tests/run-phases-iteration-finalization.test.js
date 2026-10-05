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

/** No `blocker` token anywhere — isolates decide/contract behavior from blocker parsing. */
const CERBERUS_CLEAN_OUTPUT = "improvement: reviewed `a.js` and the validation_run output; no change required\nnice-to-have: (none)";

const CERBERUS_VACUOUS_BLOCKER_OUTPUT = [
  "blocker: (none)",
  "improvement: reviewed `a.js` and the validation_run output; no change required",
  "nice-to-have: (none)",
].join("\n");

/** askAgent stub that records calls per role; decide always claims success so a bypass shows as done=true. */
function recordingAskAgent({ cerberus, orchestrator }) {
  const calls = [];
  const askAgent = async (agentId, _prompt, opts = {}) => {
    calls.push({ agentId, phase: opts.phase ?? null });
    const handler = agentId === "cerberus" ? cerberus : orchestrator;
    return handler();
  };
  return { askAgent, calls };
}

function terminalIterationDone(traces) {
  const rows = traces.filter((t) => t.event === "iteration_done");
  assert.equal(rows.length, 1, `expected exactly one iteration_done, got ${rows.length}`);
  return rows[0];
}

describe("run-phases/iteration-finalization — vacuous blocker", () => {
  it("blocker: (none) does not force an iteration and the run can finish", async () => {
    const { askAgent, calls } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_VACUOUS_BLOCKER_OUTPUT }),
      orchestrator: async () => ({ output: '{"done": true, "summary": "All good"}' }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    const check = traces.find((t) => t.event === "cerberus_check");
    assert.equal(check.blockers, 0);
    assert.deepEqual(check.items, []);
    assert.equal(out.done, true);
    assert.equal(terminalIterationDone(traces).outcome, "done");
    assert.deepEqual(
      calls.map((c) => c.phase),
      [null, "decide"],
      "no correction round may be requested for a vacuous blocker",
    );
  });

  it("a real blocker next to a vacuous one still forces iteration", async () => {
    const { askAgent } = recordingAskAgent({
      cerberus: async () => ({
        output: "blocker: (none)\n- blocker: missing tests\nimprovement: (none)\nnice-to-have: (none)",
      }),
      orchestrator: async () => ({
        output: '{"done": false, "corrections": [{"agentId": "dev-backend", "task": "add tests"}]}',
      }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    assert.equal(traces.find((t) => t.event === "cerberus_check").blockers, 1);
    assert.equal(out.action, "continue");
    assert.equal(out.done, undefined);
    assert.equal(out.plan.steps.length, 1);
    assert.equal(terminalIterationDone(traces).outcome, "iterate");
  });
});

describe("run-phases/iteration-finalization — CERBERUS contract failure is terminal", () => {
  it("stops for manual review, never reaches decide, never reports done", async () => {
    const { askAgent, calls } = recordingAskAgent({
      cerberus: async () => {
        const err = new Error("[output contract] cerberus: output must classify at least one finding");
        err.gate_id = "finding_classification_missing";
        throw err;
      },
      orchestrator: async () => ({ output: '{"done": true, "summary": "All good"}' }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    assert.equal(out.action, "break_orchestration");
    assert.equal(out.done, false);
    assert.equal(out.manualReview, true);
    assert.match(out.summary, /manual review/i);
    assert.match(out.summary, /CERBERUS/);
    assert.match(out.summary, /output must classify at least one finding/);
    assert.deepEqual(calls.map((c) => c.agentId), ["cerberus"], "decide/correct must not run after a CERBERUS failure");

    const iter = terminalIterationDone(traces);
    assert.notEqual(iter.outcome, "done");
    assert.equal(iter.transition_reason.type, "CONTRACT_FAIL");
    assert.equal(iter.transition_reason.reason_code, "CONTRACT_OR_DECIDE_FAILURE");
    assert.equal(iter.transition_reason.gate_id, "finding_classification_missing");
    assert.equal(traces.some((t) => t.event === "contract_fail" && t.agent === "cerberus"), true);

    const blocked = (out.artifactsToPush || []).find((a) => a.agentId === "cerberus");
    assert.ok(blocked, "gate-blocked CERBERUS artifact must stay visible");
    assert.equal(blocked.gateBlocked, true);
  });

  it("a non-contract CERBERUS error (e.g. transport) is also terminal", async () => {
    const { askAgent, calls } = recordingAskAgent({
      cerberus: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
      orchestrator: async () => ({ output: '{"done": true, "summary": "All good"}' }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    assert.equal(out.action, "break_orchestration");
    assert.equal(out.done, false);
    assert.equal(out.manualReview, true);
    assert.match(out.summary, /ECONNREFUSED/);
    assert.deepEqual(calls.map((c) => c.agentId), ["cerberus"]);
    assert.notEqual(terminalIterationDone(traces).outcome, "done");
  });
});

describe("run-phases/iteration-finalization — strict CERBERUS handoff failure blocks success", () => {
  const strictDeps = (askAgent, extra = {}) => ({
    askAgent,
    skipStateMcp: false,
    requireHandoff: true,
    callCompactHandoff: () => {
      throw new Error("compactor unavailable");
    },
    ...extra,
  });
  const decideDone = async () => ({ output: '{"done": true, "summary": "All good"}' });

  it("at the iteration cap: no decide, done=false, manual review, gate-blocked artifact kept", async () => {
    const { askAgent, calls } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_VACUOUS_BLOCKER_OUTPUT }),
      orchestrator: decideDone,
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { ...strictDeps(askAgent), maxIterations: 1 } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    assert.deepEqual(calls.map((c) => c.agentId), ["cerberus"], "decide must not run");
    assert.equal(out.done, false);
    assert.equal(out.manualReview, true);
    assert.match(out.summary, /manual review/i);
    assert.match(out.summary, /compact_handoff/i);
    assert.equal(out.artifactsToPush.some((a) => a.agentId === "cerberus" && a.gateBlocked === true), true);

    const iter = terminalIterationDone(traces);
    assert.equal(iter.outcome, "max_iterations_with_gate_blocks");
    assert.equal(iter.transition_reason.reason_code, "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS");
  });

  it("below the cap: existing gate-block iteration, never decide or done", async () => {
    const { askAgent, calls } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_VACUOUS_BLOCKER_OUTPUT }),
      orchestrator: decideDone,
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { ...strictDeps(askAgent), maxIterations: 3 } });
    const out = await executeIterationFinalizationPhase(ctx, deps);

    assert.deepEqual(calls.map((c) => c.agentId), ["cerberus"], "decide must not run");
    assert.notEqual(out.done, true);
    assert.equal(out.action, "continue");
    assert.equal(traces.some((t) => t.event === "gate_blocked_completion"), true);
    const iter = terminalIterationDone(traces);
    assert.equal(iter.outcome, "gate_blocked_iterate");
    assert.equal(iter.transition_reason.gate_id, "compact_handoff");
  });

  it("non-strict handoff failure stays degraded and can still finish (control)", async () => {
    const { askAgent } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_VACUOUS_BLOCKER_OUTPUT }),
      orchestrator: decideDone,
    });
    const { ctx, traces, deps } = makeIterDeps({
      deps: { ...strictDeps(askAgent, { requireHandoff: false }), maxIterations: 1 },
    });
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.done, true);
    assert.equal(terminalIterationDone(traces).outcome, "done");
  });
});

describe("run-phases/iteration-finalization — decide failure is terminal", () => {
  const cases = [
    {
      label: "decide throws",
      orchestrator: async () => {
        throw new Error("[output contract] orchestrator: decide output is not valid JSON");
      },
      reason: /decide output is not valid JSON/,
    },
    {
      label: "decide returns prose instead of JSON",
      orchestrator: async () => ({ output: "Everything looks great, we are done here." }),
      reason: /invalid/i,
    },
    {
      label: "decide returns JSON without done or corrections",
      orchestrator: async () => ({ output: '{"status": "ok"}' }),
      reason: /invalid/i,
    },
    {
      label: "decide returns done=false with no corrections",
      orchestrator: async () => ({ output: '{"done": false, "corrections": []}' }),
      reason: /invalid/i,
    },
  ];
  for (const c of cases) {
    it(`${c.label}: stops for manual review, never reports done`, async () => {
      const { askAgent, calls } = recordingAskAgent({
        cerberus: async () => ({ output: CERBERUS_CLEAN_OUTPUT }),
        orchestrator: c.orchestrator,
      });
      const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
      const out = await executeIterationFinalizationPhase(ctx, deps);

      assert.equal(out.action, "break_orchestration");
      assert.equal(out.done, false);
      assert.equal(out.manualReview, true);
      assert.match(out.summary, /manual review/i);
      assert.match(out.summary, /decide/i);
      assert.match(out.summary, c.reason);
      assert.equal(out.plan, undefined, "no new plan (retry cycle) may be produced");
      assert.deepEqual(
        calls.map((x) => x.phase),
        [null, "decide"],
        "exactly one decide call; no automatic retry",
      );

      const iter = terminalIterationDone(traces);
      assert.equal(iter.outcome, "stopped");
      assert.equal(iter.transition_reason.type, "CONTRACT_FAIL");
      assert.equal(iter.transition_reason.reason_code, "CONTRACT_OR_DECIDE_FAILURE");
    });
  }

  it("a valid decide done=true is still success (control)", async () => {
    const { askAgent } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_CLEAN_OUTPUT }),
      orchestrator: async () => ({ output: '{"done": true, "summary": "All good"}' }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.done, true);
    assert.equal(out.manualReview, undefined);
    assert.equal(terminalIterationDone(traces).outcome, "done");
  });

  it("a valid decide with corrections still iterates (control)", async () => {
    const { askAgent } = recordingAskAgent({
      cerberus: async () => ({ output: CERBERUS_CLEAN_OUTPUT }),
      orchestrator: async () => ({
        output: '{"done": false, "corrections": [{"agentId": "dev-backend", "task": "tighten validation"}]}',
      }),
    });
    const { ctx, traces, deps } = makeIterDeps({ deps: { askAgent } });
    const out = await executeIterationFinalizationPhase(ctx, deps);
    assert.equal(out.action, "continue");
    assert.equal(out.plan.steps.length, 1);
    assert.equal(terminalIterationDone(traces).outcome, "iterate");
  });
});
