"use strict";

/**
 * Grouped dependency builders for run-phases (post-SPLIT-2 cleanup).
 * Phase modules accept grouped deps and flatten internally — no behavior change.
 */

/**
 * @param {object} fields
 */
function buildGateHandlingDeps(fields) {
  const {
    agentId,
    step,
    stepId,
    stepIndex,
    intentId,
    result,
    graphMeta,
    intentStep,
    steps,
    currentMode,
    requireHandoff,
    skipStateMcp,
    flowMode,
    maxIterations,
    qaSpecFlowEnabledRun,
    qaSpecSatisfiedThisIteration,
    runState,
    AGENTS_REQUIRING_GATE,
    AGENT_TO_MODE,
    resolveHandoffMode,
    callCompactHandoff,
    bumpOllamaFromStats,
    emitContextCompactionStarted,
    emitContextCompactionCompleted,
    compactHandoffDegradedMeta,
    compactHandoffStrictFailureFields,
    validateHandoffStructure,
    qaSpecFlowTraceExtras,
    callStateMcp,
    orchTestSystemPathHarnessOn,
    edgeMeta,
    markStepRetryingAfterGate,
  } = fields;

  return {
    step: {
      agentId,
      step,
      stepId,
      stepIndex,
      intentId,
      result,
      graphMeta,
      intentStep,
      steps,
      currentMode,
      flowMode,
      maxIterations,
      qaSpecFlowEnabledRun,
      qaSpecSatisfiedThisIteration,
      runState,
    },
    handoffDeps: {
      AGENT_TO_MODE,
      resolveHandoffMode,
      callCompactHandoff,
      bumpOllamaFromStats,
      emitContextCompactionStarted,
      emitContextCompactionCompleted,
      compactHandoffDegradedMeta,
      compactHandoffStrictFailureFields,
      validateHandoffStructure,
      qaSpecFlowTraceExtras,
    },
    gateDeps: {
      AGENTS_REQUIRING_GATE,
      requireHandoff,
      skipStateMcp,
      callStateMcp,
      orchTestSystemPathHarnessOn,
      markStepRetryingAfterGate,
    },
    traceDeps: {
      edgeMeta,
    },
  };
}

/**
 * Flatten grouped gate-handling deps for phase implementation.
 * @param {ReturnType<typeof buildGateHandlingDeps>} grouped
 */
function flattenGateHandlingDeps(grouped) {
  return {
    ...grouped.step,
    ...grouped.handoffDeps,
    ...grouped.gateDeps,
    ...grouped.traceDeps,
  };
}

/**
 * @param {object} fields
 */
function buildIterationFinalizationDeps(fields) {
  const {
    artifacts,
    goal,
    maxIterations,
    maxReviewChars,
    sessionEnv,
    previousAgentId,
    currentMode,
    requireHandoff,
    skipStateMcp,
    flowMode,
    askAgent,
    bumpOllamaFromStats,
    costGuardAbort,
    truncateForContext,
    logRoleSwitch,
    detectBlockers,
    callCompactHandoff,
    emitContextCompactionStarted,
    emitContextCompactionCompleted,
    compactHandoffStrictFailureFields,
    callStateMcp,
    traceReviewRecord,
    buildReviewRecord,
    traceDoubtReviewCycle,
    buildDoubtReviewCycleFromCerberusOutput,
    traceIterationDone,
    transitionReason,
    iterationDoneCtx,
    extractJson,
    decideCerberusBlockersBranch,
    decideGateBlockedArtifactsBranch,
    decideCorrectionsPlan,
    planStepsAfterCorrectionsResponse,
    formatGateBlockedReasonLines,
    planStepsReplayFromGateBlockedArtifacts,
    summaryMaxIterationsGateBlocked,
    decideFromOrchestratorDecide,
    mapDecideLoopToPlanOutcome,
  } = fields;

  return {
    loop: {
      artifacts,
      goal,
      maxIterations,
      maxReviewChars,
      sessionEnv,
      previousAgentId,
      currentMode,
      requireHandoff,
      skipStateMcp,
      flowMode,
      askAgent,
      bumpOllamaFromStats,
      costGuardAbort,
      truncateForContext,
      logRoleSwitch,
      detectBlockers,
    },
    handoffDeps: {
      callCompactHandoff,
      emitContextCompactionStarted,
      emitContextCompactionCompleted,
      compactHandoffStrictFailureFields,
      callStateMcp,
    },
    traceDeps: {
      traceReviewRecord,
      buildReviewRecord,
      traceDoubtReviewCycle,
      buildDoubtReviewCycleFromCerberusOutput,
      traceIterationDone,
      transitionReason,
      iterationDoneCtx,
    },
    decisionDeps: {
      extractJson,
      decideCerberusBlockersBranch,
      decideGateBlockedArtifactsBranch,
      decideCorrectionsPlan,
      planStepsAfterCorrectionsResponse,
      formatGateBlockedReasonLines,
      planStepsReplayFromGateBlockedArtifacts,
      summaryMaxIterationsGateBlocked,
      decideFromOrchestratorDecide,
      mapDecideLoopToPlanOutcome,
    },
  };
}

/**
 * @param {ReturnType<typeof buildIterationFinalizationDeps>} grouped
 */
function flattenIterationFinalizationDeps(grouped) {
  return {
    ...grouped.loop,
    ...grouped.handoffDeps,
    ...grouped.traceDeps,
    ...grouped.decisionDeps,
  };
}

/**
 * @param {object} fields
 */
function buildSessionEndDeps(fields) {
  const {
    done,
    summary,
    manualReview,
    iterations,
    maxIterations,
    skipStateMcp,
    runState,
    artifacts,
    goal,
    degradedInRun,
    runScope,
    scenarioId,
    ollamaTokenTotals,
    loopExhaustedDefaultSummary,
    traceIterationDone,
    transitionReason,
    finalizeRunState,
    callStateMcp,
    AGENT_STATE_FILE,
    fsUnlinkSync,
    loadTraceRowsForTask,
    runRecoverySweepAndTrace,
    getRunStatePublicView,
    aggregateMcpUsage,
    getMcpAuditCalls,
    aggregatePermissionCheckRows,
    getPermissionCheckAuditBuffer,
  } = fields;

  return {
    sessionEndDeps: {
      done,
      summary,
      manualReview,
      iterations,
      maxIterations,
      skipStateMcp,
      runState,
      artifacts,
      goal,
      degradedInRun,
      runScope,
      scenarioId,
      ollamaTokenTotals,
      loopExhaustedDefaultSummary,
      finalizeRunState,
      AGENT_STATE_FILE,
      fsUnlinkSync,
      getRunStatePublicView,
    },
    traceDeps: {
      traceIterationDone,
      transitionReason,
      loadTraceRowsForTask,
      runRecoverySweepAndTrace,
      aggregateMcpUsage,
      getMcpAuditCalls,
      aggregatePermissionCheckRows,
      getPermissionCheckAuditBuffer,
    },
    stateDeps: {
      callStateMcp,
    },
  };
}

/**
 * @param {ReturnType<typeof buildSessionEndDeps>} grouped
 */
function flattenSessionEndDeps(grouped) {
  return {
    ...grouped.sessionEndDeps,
    ...grouped.traceDeps,
    ...grouped.stateDeps,
  };
}

module.exports = {
  buildGateHandlingDeps,
  flattenGateHandlingDeps,
  buildIterationFinalizationDeps,
  flattenIterationFinalizationDeps,
  buildSessionEndDeps,
  flattenSessionEndDeps,
};
