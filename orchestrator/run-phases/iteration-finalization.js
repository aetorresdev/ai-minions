"use strict";

/**
 * Iteration finalization (slice 5): per-step summarizer + artifact, then cerberus
 * review → blocker/gate-block decide → iteration_done. Session end stays slice 6.
 */

/**
 * @param {ReturnType<import("./phase-context").createPhaseContext>} ctx
 * @param {{
 *   agentId: string,
 *   step: { task: string },
 *   stepId: string,
 *   intentId: string,
 *   result: string,
 *   handoffYaml: string,
 *   handoffCompressionMeta: object,
 *   stepSummary: boolean,
 *   priorArtifacts: object[],
 *   summarizeHandoff: (opts: object) => Promise<object>,
 *   bumpOllamaFromStats: (stats: object) => void,
 *   costGuardAbort: (phase: string) => boolean,
 * }} deps
 * @returns {Promise<{ action: "proceed" | "break_orchestration", artifact: object }>}
 */
async function finalizeStepArtifact(ctx, deps) {
  const {
    agentId,
    step,
    stepId,
    intentId,
    result,
    handoffYaml,
    handoffCompressionMeta,
    stepSummary,
    priorArtifacts,
    summarizeHandoff,
    bumpOllamaFromStats,
    costGuardAbort,
  } = deps;

  let handoffSummary = "";
  if (stepSummary) {
    ctx.log("summarizer", `Summarizing ${agentId} output (Ollama)...`);
    try {
      const summaryResult = await summarizeHandoff({
        agentId,
        task: step.task,
        result,
        cwd: ctx.cwd,
        priorArtifacts,
      });
      handoffSummary = summaryResult.summary;
      bumpOllamaFromStats(summaryResult);
      if (summaryResult.ollama_prompt_tokens != null || summaryResult.ollama_completion_tokens != null) {
        ctx.traceEvent(ctx.taskId, {
          event: "context_stats",
          agent: "summarizer",
          target_agent: agentId,
          iteration: ctx.iterations(),
          ...(typeof summaryResult.ollama_prompt_tokens === "number"
            ? { ollama_prompt_tokens: summaryResult.ollama_prompt_tokens }
            : {}),
          ...(typeof summaryResult.ollama_completion_tokens === "number"
            ? { ollama_completion_tokens: summaryResult.ollama_completion_tokens }
            : {}),
        });
      }
      if (costGuardAbort("summarizer")) {
        return { action: "break_orchestration", artifact: {} };
      }
      ctx.log("summarizer", `Summary ready (${handoffSummary.length} chars)`);
    } catch (err) {
      ctx.log("summarizer", `Ollama failed (${err.message}); next step uses truncation.`);
    }
  }

  const artifact = {
    agentId,
    task: step.task,
    result,
    handoffYaml,
    gateBlocked: false,
    step_id: stepId,
    intent_id: intentId,
    ...(handoffSummary ? { handoffSummary } : {}),
    ...(Object.keys(handoffCompressionMeta).length ? handoffCompressionMeta : {}),
  };
  ctx.log(agentId, `Done (${result.length} chars)`);
  return { action: "proceed", artifact };
}

/**
 * @param {ReturnType<import("./phase-context").createPhaseContext>} ctx
 * @param {{
 *   artifacts: object[],
 *   goal: string,
 *   maxIterations: number,
 *   maxReviewChars: number,
 *   sessionEnv: object | null,
 *   previousAgentId: string | null,
 *   currentMode: string,
 *   requireHandoff: boolean,
 *   skipStateMcp: boolean,
 *   flowMode: string,
 *   askAgent: (agentId: string, prompt: string, opts: object) => Promise<{ output: string, context_stats?: object }>,
 *   bumpOllamaFromStats: (stats: object) => void,
 *   costGuardAbort: (phase: string) => boolean,
 *   truncateForContext: (text: string, max: number) => { text: string },
 *   logRoleSwitch: (from: string, to: string) => void,
 *   detectBlockers: (output: string) => { count: number, items: string[] },
 *   callCompactHandoff: (opts: object, mcpCtx: object) => object,
 *   emitContextCompactionStarted: (...args: unknown[]) => void,
 *   emitContextCompactionCompleted: (...args: unknown[]) => void,
 *   compactHandoffStrictFailureFields: (err: Error) => object,
 *   callStateMcp: (tool: string, payload: object, opts: object) => object,
 *   traceReviewRecord: (...args: unknown[]) => void,
 *   buildReviewRecord: (opts: object) => object,
 *   traceDoubtReviewCycle: (...args: unknown[]) => void,
 *   buildDoubtReviewCycleFromCerberusOutput: (output: string, opts: object) => object,
 *   traceIterationDone: (...args: unknown[]) => void,
 *   transitionReason: (...args: unknown[]) => object,
 *   iterationDoneCtx: (extra?: object) => object,
 *   extractJson: (text: string) => object | null,
 *   decideCerberusBlockersBranch: (opts: object) => string,
 *   decideGateBlockedArtifactsBranch: (opts: object) => string,
 *   decideCorrectionsPlan: (json: object | null) => object,
 *   planStepsAfterCorrectionsResponse: (opts: object) => { steps: object[], traceBranch: string },
 *   formatGateBlockedReasonLines: (artifacts: object[]) => string[],
 *   planStepsReplayFromGateBlockedArtifacts: (artifacts: object[]) => object[],
 *   summaryMaxIterationsGateBlocked: (opts: object) => string,
 *   decideFromOrchestratorDecide: (json: object | null) => object,
 *   mapDecideLoopToPlanOutcome: (decision: object) => object,
 * }} deps
 * @returns {Promise<{
 *   action: "continue" | "break_orchestration",
 *   done?: boolean,
 *   manualReview?: boolean,
 *   summary?: string,
 *   plan?: { steps: object[] },
 *   currentMode?: string,
 *   artifactsToPush?: object[],
 * }>}
 */
async function executeIterationFinalizationPhase(ctx, deps) {
  const {
    artifacts,
    goal,
    maxIterations,
    maxReviewChars,
    sessionEnv,
    previousAgentId,
    currentMode: initialMode,
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
  } = deps;

  const iterations = ctx.iterations();
  let currentMode = initialMode;
  /** @type {object[]} */
  const artifactsToPush = [];
  let cerberusReviewRecordEmitted = false;

  logRoleSwitch(previousAgentId || "orchestrator", "cerberus");
  ctx.log("cerberus", "Reviewing deliverables...");
  const reviewChunks = artifacts.map((a) => {
    const { text } = truncateForContext(a.result, maxReviewChars);
    return `## ${a.agentId} — ${a.task}\n\n${text}`;
  });
  const cerberusPrompt = `Working directory: ${ctx.cwd}

Original goal: ${goal}

Deliverables from iteration ${iterations}:

${reviewChunks.join("\n\n---\n\n")}

Review the above. Classify each finding as blocker | improvement | nice-to-have.
Only blockers require another DEV iteration.

Your reply must begin with these three lines in this exact order (use (none) when a category has nothing to report; no preamble before blocker:):
blocker: ...
improvement: ...
nice-to-have: ...`;

  let cerberusResult = "";
  try {
    const { output, context_stats: cerbCtx } = await askAgent("cerberus", cerberusPrompt, {
      cwd: ctx.cwd,
      sessionEnv,
    });
    cerberusResult = output;
    if (cerbCtx) {
      ctx.emitModelFallbackLifecycleIfNeeded(ctx.traceEvent, ctx.taskId, "cerberus", cerbCtx, {
        iteration: iterations,
        phase: "review",
      });
      ctx.emitContextStatsRows(cerbCtx, "cerberus", iterations, {}, {}, { phase: "review" });
    }
    if (costGuardAbort("cerberus")) {
      return { action: "break_orchestration" };
    }
    ctx.log("cerberus", `Review ready (${cerberusResult.length} chars)`);
  } catch (err) {
    const gateId = err.gate_id || null;
    const reason = (err.message || String(err)).slice(0, 300);
    ctx.traceEvent(ctx.taskId, {
      event: "contract_fail",
      agent: "cerberus",
      iteration: iterations,
      duration_ms: 0,
      reason,
      critical: true,
      ...(gateId ? { gate_id: gateId } : {}),
    });
    ctx.log("cerberus", `🟥 Output contract failed: ${err.message}`);
    traceReviewRecord(
      ctx.traceEvent,
      ctx.taskId,
      buildReviewRecord({
        reviewerRole: "cerberus",
        output: "",
        iteration: iterations,
        gateBlocked: true,
        gateReason: err.message,
        reviewedArtifactIds: artifacts
          .filter((a) => a.step_id && !a.gateBlocked)
          .map((a) => a.step_id),
      }),
    );
    cerberusReviewRecordEmitted = true;
    traceDoubtReviewCycle(
      ctx.traceEvent,
      ctx.taskId,
      buildDoubtReviewCycleFromCerberusOutput("", {
        iteration: iterations,
        reviewed_artifact_ids: artifacts
          .filter((a) => a.step_id && !a.gateBlocked && a.agentId !== "cerberus")
          .map((a) => a.step_id),
      }),
    );
    artifactsToPush.push({
      agentId: "cerberus",
      task: "(session review) Deliverable review before decide",
      result: "",
      gateBlocked: true,
      gateReason: err.message,
      gate_kind: gateId || "cerberus_output_contract",
    });
  }

  if (!skipStateMcp) {
    let cerberusHandoff = "";
    const cerbCompactionMeta = { iteration: iterations, phase: "cerberus_advance" };
    emitContextCompactionStarted(ctx.traceEvent, ctx.taskId, "cerberus", cerbCompactionMeta);
    try {
      const compactRes = callCompactHandoff(
        {
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        },
        { cwd: ctx.cwd },
      );
      cerberusHandoff = compactRes.yaml;
      bumpOllamaFromStats({
        ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
        ollama_completion_tokens: compactRes.ollama_completion_tokens,
      });
      emitContextCompactionCompleted(ctx.traceEvent, ctx.taskId, "cerberus", cerbCompactionMeta, compactRes);
      ctx.traceEvent(ctx.taskId, {
        event: "context_stats",
        agent: "context_compactor",
        attributed_to_role: "cerberus",
        invocation_type: "context_compaction",
        execution_actor: "context_compactor",
        trigger_reason: "handoff_policy",
        iteration: iterations,
        phase: "cerberus_advance",
        ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
        ollama_completion_tokens: compactRes.ollama_completion_tokens,
      });
    } catch (err) {
      const msg = err.message || String(err);
      if (requireHandoff) {
        ctx.traceEvent(ctx.taskId, {
          event: "compact_handoff_failed",
          agent: "cerberus",
          iteration: iterations,
          message: msg.slice(0, 400),
          phase: "cerberus_advance",
        });
        ctx.log("gate", `🟥 compact_handoff failed (strict — CERBERUS → ORCHESTRATOR): ${msg}`);
        artifactsToPush.push({
          agentId: "cerberus",
          task: "(session review) Deliverable review before decide",
          result: cerberusResult,
          gate_kind: "compact_handoff",
          ...compactHandoffStrictFailureFields(err),
        });
      } else {
        ctx.traceEvent(ctx.taskId, {
          event: "compact_handoff_fallback",
          agent: "cerberus",
          iteration: iterations,
          message: msg.slice(0, 400),
          phase: "cerberus_advance",
          handoff_degraded: true,
        });
        ctx.log("gate", `⚠ compact_handoff unavailable (degraded — CERBERUS advance): ${msg}`);
      }
    }
    if (cerberusHandoff) {
      try {
        const vt = callStateMcp(
          "validate_transition",
          {
            task_id: ctx.taskId,
            from_mode: "CERBERUS",
            to_mode: "ORCHESTRATOR",
            handoff_yaml: cerberusHandoff,
            iteration: iterations,
          },
          { cwd: ctx.cwd },
        );

        if (vt.allowed) {
          callStateMcp(
            "advance_mode",
            {
              task_id: ctx.taskId,
              to_mode: "ORCHESTRATOR",
              from_mode: "CERBERUS",
              handoff_yaml: cerberusHandoff,
              iteration: iterations,
            },
            { cwd: ctx.cwd },
          );
          currentMode = "ORCHESTRATOR";
        }
      } catch (err) {
        ctx.log("gate", `WARNING: Cerberus transition gate error (${err.message})`);
      }
    }
  }

  const cerberusBlockers = detectBlockers(cerberusResult);
  const reviewedIds = artifacts
    .filter((a) => a.step_id && !a.gateBlocked && a.agentId !== "cerberus")
    .map((a) => a.step_id);
  if (!cerberusReviewRecordEmitted) {
    traceReviewRecord(
      ctx.traceEvent,
      ctx.taskId,
      buildReviewRecord({
        reviewerRole: "cerberus",
        output: cerberusResult,
        iteration: iterations,
        reviewedArtifactIds: reviewedIds,
      }),
    );
    traceDoubtReviewCycle(
      ctx.traceEvent,
      ctx.taskId,
      buildDoubtReviewCycleFromCerberusOutput(cerberusResult, {
        iteration: iterations,
        reviewed_artifact_ids: reviewedIds,
      }),
    );
  }
  ctx.traceEvent(ctx.taskId, {
    event: "cerberus_check",
    iteration: iterations,
    blockers: cerberusBlockers.count,
    items: cerberusBlockers.items.slice(0, 5),
  });

  const cerbDecision = decideCerberusBlockersBranch({
    blockerCount: cerberusBlockers.count,
    iterations,
    maxIterations,
  });
  if (cerbDecision === "iterate") {
    ctx.log("cerberus", `🟥 ${cerberusBlockers.count} blocker(s) detected — forcing iteration (deterministic)`);
    cerberusBlockers.items.forEach((b) => ctx.log("cerberus", `  ↳ ${b.slice(0, 120)}`));

    const artifactsBlob = artifacts
      .map((a) => {
        const { text } = truncateForContext(a.result, maxReviewChars);
        return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
      })
      .join("\n\n---\n\n");

    const correctPrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus blockers (must be fixed):
${cerberusBlockers.items.join("\n")}

List the correction steps required. Reply with JSON: { "done": false, "corrections": [{ "agentId": "...", "task": "..." }] }`;

    logRoleSwitch("cerberus", "orchestrator");
    const { output: correctResponse, context_stats: correctCtx } = await askAgent("orchestrator", correctPrompt, {
      cwd: ctx.cwd,
      sessionEnv,
      phase: "decide",
    });
    if (correctCtx) {
      ctx.emitModelFallbackLifecycleIfNeeded(ctx.traceEvent, ctx.taskId, "orchestrator", correctCtx, {
        iteration: iterations,
        phase: "correct",
      });
      ctx.emitContextStatsRows(correctCtx, "orchestrator", iterations, {}, {}, { phase: "correct" });
    }
    if (costGuardAbort("correct")) {
      return { action: "break_orchestration", currentMode };
    }
    const corrections = extractJson(correctResponse);
    const corrPlan = decideCorrectionsPlan(corrections);
    const planOut = planStepsAfterCorrectionsResponse({
      corrPlan,
      artifacts,
      blockerItems: cerberusBlockers.items,
      maxBlockersInTask: 2,
    });
    const steps = /** @type {Array<{ agentId?: string, task: string }>} */ (planOut.steps);
    if (planOut.traceBranch === "iterate_corrections_json") {
      ctx.log("orchestrator", `↻ Correcting — ${steps.length} step(s):`);
      steps.forEach((c) =>
        ctx.log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`),
      );
      traceIterationDone(
        ctx.taskId,
        iterations,
        "iterate",
        transitionReason("GATE_BLOCK", "cerberus_blockers"),
        { blockers: cerberusBlockers.count, corrections: steps.length },
        iterationDoneCtx(),
      );
      return {
        action: "continue",
        plan: { steps },
        currentMode,
        ...(artifactsToPush.length ? { artifactsToPush } : {}),
      };
    }
    ctx.log("orchestrator", "WARNING: orchestrator returned no corrections — retrying last DEV steps");
    traceIterationDone(
      ctx.taskId,
      iterations,
      "iterate_fallback",
      transitionReason("ITERATE_FALLBACK", "orchestrator_no_corrections_json"),
      { blockers: cerberusBlockers.count },
      iterationDoneCtx(),
    );
    return {
      action: "continue",
      plan: { steps },
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }

  if (cerbDecision === "manual_cap") {
    const summary = `Max iterations reached with ${cerberusBlockers.count} gate-blocked CERBERUS finding(s). Manual review required.`;
    ctx.log("orchestrator", `⚠ ${summary}`);
    traceIterationDone(
      ctx.taskId,
      iterations,
      "max_iterations_with_blockers",
      transitionReason("MAX_ITERATIONS", "cerberus_blockers_cap"),
      { blockers: cerberusBlockers.count },
      iterationDoneCtx(),
    );
    return {
      action: "continue",
      done: false,
      manualReview: true,
      summary,
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }

  const gateBlockedArtifacts = artifacts.filter((a) => a.gateBlocked);
  const gateBlockedDecision = decideGateBlockedArtifactsBranch({
    artifactCount: gateBlockedArtifacts.length,
    iterations,
    maxIterations,
  });
  if (gateBlockedDecision === "iterate") {
    const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
    ctx.traceEvent(ctx.taskId, {
      event: "gate_blocked_completion",
      iteration: iterations,
      count: gateBlockedArtifacts.length,
      reasons: gateBlockReasons,
    });
    ctx.log("orchestrator", `🟥 ${gateBlockedArtifacts.length} gate-blocked artifact(s) — cannot mark done (forcing iteration):`);
    gateBlockReasons.forEach((r) => ctx.log("orchestrator", `  ↳ ${r}`));
    const _gb0 = gateBlockedArtifacts[0];
    traceIterationDone(
      ctx.taskId,
      iterations,
      "gate_blocked_iterate",
      transitionReason("GATE_BLOCK", "artifact_contract_or_handoff", {
        ...(_gb0 && _gb0.step_id ? { step_id: _gb0.step_id } : {}),
        ...(_gb0 && _gb0.gate_kind ? { gate_id: _gb0.gate_kind } : {}),
      }),
      { gate_blocks: gateBlockedArtifacts.length },
      iterationDoneCtx({ gateKinds: gateBlockedArtifacts.map((a) => a.gate_kind).filter(Boolean) }),
    );
    return {
      action: "continue",
      plan: { steps: planStepsReplayFromGateBlockedArtifacts(gateBlockedArtifacts) },
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }
  if (gateBlockedDecision === "manual_cap") {
    const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
    const summary = summaryMaxIterationsGateBlocked({
      count: gateBlockedArtifacts.length,
      reasonLines: gateBlockReasons,
    });
    ctx.log("orchestrator", `⚠ ${summary}`);
    traceIterationDone(
      ctx.taskId,
      iterations,
      "max_iterations_with_gate_blocks",
      transitionReason("MAX_ITERATIONS", "gate_blocked_artifacts_cap"),
      { gate_blocks: gateBlockedArtifacts.length },
      iterationDoneCtx(),
    );
    return {
      action: "continue",
      done: false,
      manualReview: true,
      summary,
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }

  logRoleSwitch("cerberus", "orchestrator");
  ctx.log("orchestrator", "No blockers — evaluating completion...");
  const artifactsBlob = artifacts
    .map((a) => {
      const { text } = truncateForContext(a.result, maxReviewChars);
      return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
    })
    .join("\n\n---\n\n");

  const decidePrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus review (no blockers):
${cerberusResult}

No blockers were found. Confirm completion or list any remaining corrections.
Reply with JSON only.`;

  let decideResponse = "";
  try {
    const { output, context_stats: decideCtx } = await askAgent("orchestrator", decidePrompt, {
      cwd: ctx.cwd,
      sessionEnv,
      phase: "decide",
    });
    decideResponse = output;
    if (decideCtx) {
      ctx.emitModelFallbackLifecycleIfNeeded(ctx.traceEvent, ctx.taskId, "orchestrator", decideCtx, {
        iteration: iterations,
        phase: "decide",
      });
      ctx.emitContextStatsRows(decideCtx, "orchestrator", iterations, {}, {}, { phase: "decide" });
    }
    if (costGuardAbort("decide")) {
      return { action: "break_orchestration", currentMode };
    }
  } catch (decideErr) {
    ctx.log("orchestrator", `⚠ Decide contract failed (${decideErr.message}) — treating as stopped`);
    ctx.traceEvent(ctx.taskId, { event: "decide_contract_fail", reason: decideErr.message });
  }
  const decide = extractJson(decideResponse);
  const loopDecision = decideFromOrchestratorDecide(decide);
  const mapped = mapDecideLoopToPlanOutcome(loopDecision);

  if (mapped.variant === "finish") {
    const summary = /** @type {string} */ (mapped.summary);
    ctx.log("orchestrator", `✓ Done: ${summary}`);
    traceIterationDone(
      ctx.taskId,
      iterations,
      "done",
      transitionReason("DONE"),
      { summary: summary.slice(0, 200) },
      iterationDoneCtx(),
    );
    return {
      action: "continue",
      done: true,
      summary,
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }
  if (mapped.variant === "iterate") {
    const corrections = /** @type {Array<{ agentId?: string, task: string }>} */ (mapped.planSteps);
    ctx.log("orchestrator", `↻ Iterating — ${corrections.length} correction(s):`);
    corrections.forEach((c) =>
      ctx.log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`),
    );
    traceIterationDone(
      ctx.taskId,
      iterations,
      "iterate",
      transitionReason("ITERATE", "orchestrator_decide_corrections"),
      { corrections: corrections.length },
      iterationDoneCtx(),
    );
    return {
      action: "continue",
      plan: { steps: corrections },
      currentMode,
      ...(artifactsToPush.length ? { artifactsToPush } : {}),
    };
  }

  const summary = /** @type {string} */ (mapped.summary);
  ctx.log("orchestrator", summary);
  traceIterationDone(
    ctx.taskId,
    iterations,
    "stopped",
    transitionReason("CONTRACT_FAIL", summary),
    { summary },
    iterationDoneCtx(),
  );
  return {
    action: "continue",
    done: true,
    summary,
    currentMode,
    ...(artifactsToPush.length ? { artifactsToPush } : {}),
  };
}

module.exports = {
  finalizeStepArtifact,
  executeIterationFinalizationPhase,
};
