"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGateHandlingDeps,
  flattenGateHandlingDeps,
  buildIterationFinalizationDeps,
  flattenIterationFinalizationDeps,
  buildSessionEndDeps,
  flattenSessionEndDeps,
} = require("../run-phases/phase-deps");

describe("run-phases/phase-deps", () => {
  it("buildGateHandlingDeps groups step, handoffDeps, gateDeps, traceDeps", () => {
    const grouped = buildGateHandlingDeps({
      agentId: "dev-backend",
      step: { task: "x" },
      stepId: "s1",
      stepIndex: 0,
      intentId: "i1",
      result: "r",
      graphMeta: {},
      intentStep: {},
      steps: [],
      currentMode: "DEV",
      requireHandoff: true,
      skipStateMcp: false,
      flowMode: "single_agent",
      maxIterations: 3,
      qaSpecFlowEnabledRun: false,
      qaSpecSatisfiedThisIteration: false,
      runState: {},
      AGENTS_REQUIRING_GATE: new Set(["dev-backend"]),
      AGENT_TO_MODE: { "dev-backend": "DEV" },
      resolveHandoffMode: () => "DEV",
      callCompactHandoff: () => ({}),
      bumpOllamaFromStats: () => {},
      emitContextCompactionStarted: () => {},
      emitContextCompactionCompleted: () => {},
      compactHandoffDegradedMeta: () => ({}),
      compactHandoffStrictFailureFields: () => ({}),
      validateHandoffStructure: () => ({ valid: true }),
      qaSpecFlowTraceExtras: () => ({}),
      callStateMcp: () => ({}),
      orchTestSystemPathHarnessOn: () => false,
      edgeMeta: () => ({}),
      markStepRetryingAfterGate: () => {},
    });
    assert.ok(grouped.step);
    assert.ok(grouped.handoffDeps.callCompactHandoff);
    assert.ok(grouped.gateDeps.AGENTS_REQUIRING_GATE);
    assert.ok(grouped.traceDeps.edgeMeta);
    const flat = flattenGateHandlingDeps(grouped);
    assert.equal(flat.agentId, "dev-backend");
    assert.equal(flat.callCompactHandoff, grouped.handoffDeps.callCompactHandoff);
  });

  it("buildIterationFinalizationDeps groups loop, handoffDeps, traceDeps, decisionDeps", () => {
    const noop = () => {};
    const grouped = buildIterationFinalizationDeps({
      artifacts: [],
      goal: "g",
      maxIterations: 3,
      maxReviewChars: 1000,
      sessionEnv: null,
      previousAgentId: null,
      currentMode: "DEV",
      requireHandoff: false,
      skipStateMcp: true,
      flowMode: "single_agent",
      askAgent: async () => ({ output: "" }),
      bumpOllamaFromStats: noop,
      costGuardAbort: () => false,
      truncateForContext: (t) => ({ text: t }),
      logRoleSwitch: noop,
      detectBlockers: () => ({ count: 0, items: [] }),
      callCompactHandoff: () => ({}),
      emitContextCompactionStarted: noop,
      emitContextCompactionCompleted: noop,
      compactHandoffStrictFailureFields: () => ({}),
      callStateMcp: () => ({}),
      traceReviewRecord: noop,
      buildReviewRecord: (o) => o,
      traceDoubtReviewCycle: noop,
      buildDoubtReviewCycleFromCerberusOutput: () => ({}),
      traceIterationDone: noop,
      transitionReason: () => ({}),
      iterationDoneCtx: () => ({}),
      extractJson: () => null,
      decideCerberusBlockersBranch: () => "skip",
      decideGateBlockedArtifactsBranch: () => "skip",
      decideCorrectionsPlan: () => ({}),
      planStepsAfterCorrectionsResponse: () => ({ steps: [], traceBranch: "x" }),
      formatGateBlockedReasonLines: () => [],
      planStepsReplayFromGateBlockedArtifacts: () => [],
      summaryMaxIterationsGateBlocked: () => "",
      decideFromOrchestratorDecide: () => ({}),
      mapDecideLoopToPlanOutcome: () => ({ variant: "stop", summary: "x", planSteps: [] }),
    });
    assert.ok(grouped.loop.artifacts);
    assert.ok(grouped.decisionDeps.decideCerberusBlockersBranch);
    const flat = flattenIterationFinalizationDeps(grouped);
    assert.equal(flat.goal, "g");
    assert.equal(flat.decideCerberusBlockersBranch, grouped.decisionDeps.decideCerberusBlockersBranch);
  });

  it("buildSessionEndDeps groups sessionEndDeps, traceDeps, stateDeps", () => {
    const noop = () => {};
    const grouped = buildSessionEndDeps({
      done: true,
      summary: "ok",
      manualReview: false,
      iterations: 1,
      maxIterations: 3,
      skipStateMcp: false,
      runState: {},
      artifacts: [],
      goal: "g",
      degradedInRun: new Set(),
      runScope: { scope: "local" },
      scenarioId: null,
      ollamaTokenTotals: { prompt: 0, completion: 0 },
      loopExhaustedDefaultSummary: () => "stopped",
      traceIterationDone: noop,
      transitionReason: () => ({}),
      finalizeRunState: noop,
      callStateMcp: () => ({}),
      AGENT_STATE_FILE: "/tmp/x",
      fsUnlinkSync: noop,
      loadTraceRowsForTask: () => [],
      runRecoverySweepAndTrace: noop,
      getRunStatePublicView: (r) => r,
      aggregateMcpUsage: () => ({}),
      getMcpAuditCalls: () => [],
      aggregatePermissionCheckRows: () => ({}),
      getPermissionCheckAuditBuffer: () => [],
    });
    assert.equal(grouped.sessionEndDeps.done, true);
    assert.ok(grouped.traceDeps.runRecoverySweepAndTrace);
    assert.ok(grouped.stateDeps.callStateMcp);
    const flat = flattenSessionEndDeps(grouped);
    assert.equal(flat.summary, "ok");
    assert.equal(flat.callStateMcp, grouped.stateDeps.callStateMcp);
  });
});
