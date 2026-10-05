"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPhaseContext } = require("../run-phases/phase-context");
const { executeGateHandlingPhase } = require("../run-phases/gate-handling");
const {
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
} = require("../trace-lifecycle-events");
const {
  validateHandoffStructure,
  AGENTS_REQUIRING_GATE,
  AGENT_TO_MODE,
  edgeMeta,
  orchTestSystemPathHarnessOn,
} = require("../run-loop-helpers");
const { resolveHandoffMode, qaSpecFlowTraceExtras } = require("../qa-spec-flow");
const {
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,
} = require("../orchestrator");

const VALID_DEV_YAML = "files_modified:\n  - src/foo.js\nvalidation_run: npm test — pass\n";

function traceEvents(traces) {
  return traces.map((t) => t.event);
}

function gateResults(traces, gate) {
  return traces.filter((t) => t.event === "gate_result" && t.gate === gate);
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

function makeGateDeps(overrides = {}) {
  const traces = [];
  const ctx = createPhaseContext({
    taskId: "task-gate-phase",
    cwd: "/tmp/gate",
    goal: "GOAL: fix foo",
    sessionEnv: null,
    iterations: () => 2,
    traceEvent: (_taskId, payload) => traces.push(payload),
    log: () => {},
    getLastBudgetMeta: () => ({}),
    emitContextStatsRows: () => {},
    emitModelFallbackLifecycleIfNeeded: () => {},
    costGuardAbort: () => false,
  });

  const steps = [
    { agentId: "dev-backend", task: "edit foo.js" },
    { agentId: "qa", task: "verify" },
  ];
  const step = steps[0];

  const base = {
    agentId: "dev-backend",
    step,
    stepId: "step-dev-1",
    stepIndex: 0,
    intentId: "intent-1",
    result: "files_read: [src/foo.js]\nfiles_modified:\n- src/foo.js\nvalidation_run: ok",
    graphMeta: { graph_id: "g1" },
    intentStep: { intent_id: "intent-1" },
    steps,
    currentMode: "DEV",
    requireHandoff: true,
    skipStateMcp: false,
    flowMode: "single_agent",
    maxIterations: 3,
    qaSpecFlowEnabledRun: false,
    qaSpecSatisfiedThisIteration: false,
    runState: { steps: {} },
    AGENTS_REQUIRING_GATE,
    AGENT_TO_MODE,
    resolveHandoffMode,
    callCompactHandoff: () => ({
      yaml: VALID_DEV_YAML,
      ollama_prompt_tokens: 5,
      ollama_completion_tokens: 7,
    }),
    bumpOllamaFromStats: () => {},
    emitContextCompactionStarted,
    emitContextCompactionCompleted,
    compactHandoffDegradedMeta,
    compactHandoffStrictFailureFields,
    validateHandoffStructure,
    qaSpecFlowTraceExtras,
    callStateMcp: (tool) => {
      if (tool === "validate_goal_alignment") {
        return { ok: true, aligned: true, confidence: 0.9 };
      }
      if (tool === "validate_transition") {
        return { allowed: true, errors: [] };
      }
      if (tool === "advance_mode") {
        return { ok: true };
      }
      return { ok: false };
    },
    orchTestSystemPathHarnessOn,
    edgeMeta,
    markStepRetryingAfterGate: () => {},
  };

  return {
    ctx,
    traces,
    deps: { ...base, ...overrides },
  };
}

describe("run-phases/gate-handling — executeGateHandlingPhase (integration)", () => {
  it("full success path: compaction → gate_results → proceed with mode advance", async () => {
    const { ctx, traces, deps } = makeGateDeps();
    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "proceed");
    assert.match(out.handoffYaml, /files_modified/);
    assert.equal(out.currentMode, "QA");
    assertSubsequence(traceEvents(traces), [
      "context_compaction_started",
      "context_compaction_completed",
      "gate_result",
      "gate_result",
      "gate_result",
      "gate_result",
    ]);
    assert.equal(gateResults(traces, "compact_handoff")[0].passed, true);
    assert.equal(gateResults(traces, "handoff_structure")[0].passed, true);
    assert.equal(gateResults(traces, "goal_alignment")[0].passed, true);
    assert.equal(gateResults(traces, "transition")[0].passed, true);
    assert.equal(gateResults(traces, "transition")[0].to_mode, "QA");
  });

  it("strict compact_handoff failure blocks step with artifact", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      callCompactHandoff: () => {
        throw new Error("mcp unavailable");
      },
    });
    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "continue");
    assert.equal(out.artifact.gateBlocked, true);
    assert.equal(out.artifact.gate_kind, "compact_handoff");
    assert.equal(traces.some((t) => t.event === "compact_handoff_failed"), true);
    assert.equal(traces.some((t) => t.event === "gate_result"), false);
  });

  it("degraded compact_handoff fallback proceeds with compression meta", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      requireHandoff: false,
      callCompactHandoff: () => {
        throw new Error("timeout");
      },
      skipStateMcp: true,
    });
    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "proceed");
    assert.equal(out.handoffYaml, "");
    assert.equal(out.handoffCompressionMeta.handoff_degraded, true);
    assert.equal(traces.some((t) => t.event === "compact_handoff_fallback"), true);
  });

  it("handoff_structure gate_block returns continue with artifact", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      callCompactHandoff: () => ({ yaml: "empty: true\n", ollama_prompt_tokens: 1, ollama_completion_tokens: 1 }),
    });
    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "continue");
    assert.equal(out.artifact.gate_kind, "handoff_structure");
    const gr = gateResults(traces, "handoff_structure")[0];
    assert.equal(gr.passed, false);
    assert.match(gr.reason, /files_modified|validation_run/);
  });

  it("goal_alignment gate_block returns continue with artifact", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      orchTestSystemPathHarnessOn: () => false,
      callStateMcp: (tool) => {
        if (tool === "validate_goal_alignment") {
          return { ok: true, aligned: false, confidence: 0.2, notes: "scope drift" };
        }
        return { ok: true };
      },
    });
    const out = await executeGateHandlingPhase(ctx, deps);
    assert.equal(out.action, "continue");
    assert.equal(out.artifact.gate_kind, "goal_alignment");
    assert.equal(gateResults(traces, "goal_alignment")[0].passed, false);
  });

  it("transition gate_block returns continue with artifact", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      callStateMcp: (tool) => {
        if (tool === "validate_goal_alignment") {
          return { ok: true, aligned: true, confidence: 0.9 };
        }
        if (tool === "validate_transition") {
          return { allowed: false, errors: ["invalid MODE chain"] };
        }
        return { ok: true };
      },
    });
    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "continue");
    assert.equal(out.artifact.gate_kind, "transition");
    assert.equal(gateResults(traces, "transition")[0].passed, false);
  });

  describe("state-MCP failure is terminal (never proceeds ungated)", () => {
    const okTools = {
      validate_goal_alignment: { ok: true, aligned: true, confidence: 0.9 },
      validate_transition: { allowed: true, errors: [] },
      advance_mode: { ok: true },
    };
    const cases = [
      {
        label: "validate_goal_alignment throws",
        tool: "validate_goal_alignment",
        impl: () => { throw new Error("mcp transport down"); },
        reason: /mcp transport down/,
        later: ["validate_transition", "advance_mode"],
      },
      {
        label: "validate_goal_alignment returns ok=false",
        tool: "validate_goal_alignment",
        impl: () => ({ ok: false, error: "unknown task" }),
        reason: /unknown task/,
        later: ["validate_transition", "advance_mode"],
      },
      {
        label: "validate_transition throws",
        tool: "validate_transition",
        impl: () => { throw new Error("gate crashed"); },
        reason: /gate crashed/,
        later: ["advance_mode"],
      },
      {
        label: "advance_mode returns ok=false",
        tool: "advance_mode",
        impl: () => ({ ok: false, error: "task is closed" }),
        reason: /task is closed/,
        later: [],
      },
    ];
    for (const c of cases) {
      it(`${c.label}: break_orchestration with manual review and a blocked artifact`, async () => {
        const called = [];
        const { ctx, traces, deps } = makeGateDeps({
          callStateMcp: (tool) => {
            called.push(tool);
            return tool === c.tool ? c.impl() : okTools[tool];
          },
        });
        const out = await executeGateHandlingPhase(ctx, deps);

        assert.equal(out.action, "break_orchestration");
        assert.equal(out.done, false);
        assert.equal(out.manualReview, true);
        assert.match(out.summary, /manual review required/i);
        assert.match(out.summary, new RegExp(`state-MCP ${c.tool} failed`));
        assert.match(out.summary, c.reason);
        assert.equal(out.artifact.gateBlocked, true);
        assert.equal(out.artifact.gate_kind, "state_mcp");
        assert.equal(out.artifact.agentId, "dev-backend");
        const fail = traces.find((t) => t.event === "state_mcp_failure");
        assert.ok(fail, "state_mcp_failure trace required");
        assert.equal(fail.tool, c.tool);
        assert.equal(fail.step_id, "step-dev-1");
        for (const later of c.later) {
          assert.equal(called.includes(later), false, `${later} must not run after ${c.tool} failed`);
        }
      });
    }
  });

  it("skips compaction for agents outside AGENTS_REQUIRING_GATE", async () => {
    const { ctx, traces, deps } = makeGateDeps({
      agentId: "owner",
      step: { agentId: "owner", task: "clarify scope" },
    });
    let compactCalled = false;
    deps.callCompactHandoff = () => {
      compactCalled = true;
      return { yaml: "", ollama_prompt_tokens: 0, ollama_completion_tokens: 0 };
    };

    const out = await executeGateHandlingPhase(ctx, deps);

    assert.equal(out.action, "proceed");
    assert.equal(compactCalled, false);
    assert.equal(traces.length, 0);
  });
});
