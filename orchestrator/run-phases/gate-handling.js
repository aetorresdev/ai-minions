"use strict";

/**
 * Gate handling phase: compact handoff → handoff structure → goal alignment →
 * transition validation → advance_mode. Observable boundary ends before step
 * summarizer and artifact push (slice 5).
 *
 * @param {ReturnType<import("./phase-context").createPhaseContext>} ctx
 * @param {{
 *   agentId: string,
 *   step: { task: string, qaPhase?: string },
 *   stepId: string,
 *   stepIndex: number,
 *   intentId: string,
 *   result: string,
 *   graphMeta: object,
 *   intentStep: object,
 *   steps: object[],
 *   currentMode: string,
 *   requireHandoff: boolean,
 *   skipStateMcp: boolean,
 *   flowMode: string,
 *   maxIterations: number,
 *   qaSpecFlowEnabledRun: boolean,
 *   qaSpecSatisfiedThisIteration: boolean,
 *   runState: object,
 *   AGENTS_REQUIRING_GATE: Set<string>,
 *   AGENT_TO_MODE: Record<string, string>,
 *   resolveHandoffMode: (agentId: string, step: object, mode: string) => string,
 *   callCompactHandoff: (opts: object, ctx: object) => object,
 *   bumpOllamaFromStats: (stats: object) => void,
 *   emitContextCompactionStarted: (...args: unknown[]) => void,
 *   emitContextCompactionCompleted: (...args: unknown[]) => void,
 *   compactHandoffDegradedMeta: (err: Error) => object,
 *   compactHandoffStrictFailureFields: (err: Error) => object,
 *   validateHandoffStructure: (mode: string, yaml: string, opts: object) => { valid: boolean, reason?: string },
 *   qaSpecFlowTraceExtras: (toMode: string, passed: boolean, yaml: string) => object,
 *   callStateMcp: (tool: string, payload: object, opts: object) => object,
 *   orchTestSystemPathHarnessOn: () => boolean,
 *   edgeMeta: (edgeType: string) => object,
 *   markStepRetryingAfterGate: (runState: object) => void,
 * }} deps
 * @returns {Promise<{
 *   action: "continue" | "proceed",
 *   artifact?: object,
 *   handoffYaml?: string,
 *   handoffCompressionMeta?: object,
 *   currentMode?: string,
 *   qaSpecSatisfiedThisIteration?: boolean,
 * }>}
 */
async function executeGateHandlingPhase(ctx, deps) {
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
  } = deps;

  let handoffYaml = "";
  /** @type {Record<string, unknown>} */
  let handoffCompressionMeta = {};
  let nextCurrentMode = currentMode;
  let qaSpecSatisfied = qaSpecSatisfiedThisIteration;

  const toMode = resolveHandoffMode(agentId, step, AGENT_TO_MODE[agentId]);
  const nextStepIdx = steps.indexOf(step) + 1;
  const nextAgent = steps[nextStepIdx]?.agentId;
  const nextMode = nextAgent ? (AGENT_TO_MODE[nextAgent] || "ORCHESTRATOR") : "ORCHESTRATOR";

  if (!AGENTS_REQUIRING_GATE.has(agentId)) {
    return { action: "proceed", handoffYaml, handoffCompressionMeta, currentMode: nextCurrentMode };
  }

  ctx.log("gate", `Compacting handoff for ${agentId} → ${nextMode}...`);
  const compactionMeta = {
    iteration: ctx.iterations(),
    step_id: stepId,
    step_index: stepIndex,
    ...graphMeta,
    ...intentStep,
  };
  emitContextCompactionStarted(ctx.traceEvent, ctx.taskId, agentId, compactionMeta);
  try {
    const compactRes = callCompactHandoff(
      {
        text: result,
        modeCompleted: toMode,
        nextMode,
        iteration: ctx.iterations(),
        maxIterations,
        flowMode,
      },
      { cwd: ctx.cwd },
    );
    handoffYaml = compactRes.yaml;
    bumpOllamaFromStats({
      ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
      ollama_completion_tokens: compactRes.ollama_completion_tokens,
    });
    emitContextCompactionCompleted(ctx.traceEvent, ctx.taskId, agentId, compactionMeta, compactRes);
    ctx.traceEvent(ctx.taskId, {
      event: "context_stats",
      agent: "context_compactor",
      attributed_to_role: agentId,
      invocation_type: "context_compaction",
      execution_actor: "context_compactor",
      trigger_reason: "handoff_policy",
      iteration: ctx.iterations(),
      step_id: stepId,
      step_index: stepIndex,
      ...graphMeta,
      ...intentStep,
      ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
      ollama_completion_tokens: compactRes.ollama_completion_tokens,
    });
    ctx.log("gate", `Handoff YAML ready (${handoffYaml.length} chars)`);
    ctx.traceEvent(ctx.taskId, {
      event: "gate_result",
      agent: agentId,
      iteration: ctx.iterations(),
      step_id: stepId,
      ...graphMeta,
      ...intentStep,
      ...edgeMeta("success"),
      gate: "compact_handoff",
      passed: true,
      formal_handoff_completed: true,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (requireHandoff) {
      ctx.traceEvent(ctx.taskId, {
        event: "compact_handoff_failed",
        agent: agentId,
        iteration: ctx.iterations(),
        step_id: stepId,
        ...intentStep,
        message: msg.slice(0, 400),
        phase: "worker_step",
      });
      ctx.log("gate", `🟥 compact_handoff failed (strict — hard fail): ${msg}`);
      markStepRetryingAfterGate(runState);
      return {
        action: "continue",
        artifact: {
          agentId,
          task: step.task,
          result,
          step_id: stepId,
          intent_id: intentId,
          gate_kind: "compact_handoff",
          ...compactHandoffStrictFailureFields(err),
        },
      };
    }
    ctx.traceEvent(ctx.taskId, {
      event: "compact_handoff_fallback",
      agent: agentId,
      iteration: ctx.iterations(),
      step_id: stepId,
      ...intentStep,
      message: msg.slice(0, 400),
      phase: "worker_step",
      handoff_degraded: true,
    });
    handoffCompressionMeta = compactHandoffDegradedMeta(err);
    ctx.log("gate", `⚠ compact_handoff unavailable (degraded — continuing without YAML compression): ${msg}`);
  }

  const requireQaSpecRef = qaSpecFlowEnabledRun && qaSpecSatisfied && toMode === "DEV";
  const sv = validateHandoffStructure(toMode, handoffYaml, { strict: requireHandoff, requireQaSpecRef });
  if (!sv.valid) {
    ctx.log("gate", `🟥 Handoff structure invalid (${toMode}): ${sv.reason}`);
    ctx.traceEvent(ctx.taskId, {
      event: "gate_result",
      agent: agentId,
      iteration: ctx.iterations(),
      step_id: stepId,
      ...graphMeta,
      ...intentStep,
      ...edgeMeta("gate_block"),
      gate: "handoff_structure",
      passed: false,
      reason: sv.reason,
    });
    markStepRetryingAfterGate(runState);
    return {
      action: "continue",
      artifact: {
        agentId,
        task: step.task,
        result,
        handoffYaml,
        gateBlocked: true,
        gateReason: `handoff_structure: ${sv.reason}`,
        step_id: stepId,
        intent_id: intentId,
        gate_kind: "handoff_structure",
      },
    };
  }
  ctx.traceEvent(ctx.taskId, {
    event: "gate_result",
    agent: agentId,
    iteration: ctx.iterations(),
    step_id: stepId,
    ...graphMeta,
    ...intentStep,
    ...edgeMeta("success"),
    gate: "handoff_structure",
    passed: true,
  });
  if (toMode === "QA_SPEC") qaSpecSatisfied = true;
  const qaFlowTrace = qaSpecFlowTraceExtras(toMode, true, handoffYaml);
  if (qaFlowTrace.event) {
    ctx.traceEvent(ctx.taskId, {
      ...qaFlowTrace,
      agent: agentId,
      iteration: ctx.iterations(),
      step_id: stepId,
      step_index: stepIndex,
      ...graphMeta,
      ...intentStep,
    });
  }

  if (!skipStateMcp && handoffYaml) {
    try {
      ctx.log("gate", `Validating goal alignment for ${agentId}...`);
      const alignment = callStateMcp(
        "validate_goal_alignment",
        { task_id: ctx.taskId, handoff_yaml: handoffYaml },
        { cwd: ctx.cwd },
      );

      if (!alignment.ok) {
        ctx.log("gate", `WARNING: validate_goal_alignment failed: ${alignment.error}`);
      } else if (alignment.aligned === false) {
        if (orchTestSystemPathHarnessOn()) {
          ctx.log("gate", "⚠ test system-path harness: goal alignment returned false — continuing (test harness only; not prod semantics)");
          ctx.traceEvent(ctx.taskId, {
            event: "gate_result",
            agent: agentId,
            iteration: ctx.iterations(),
            step_id: stepId,
            ...intentStep,
            gate: "goal_alignment",
            passed: true,
            confidence: alignment.confidence,
            test_system_path_harness: true,
            notes: alignment.notes,
          });
        } else {
          ctx.log("gate", `🟥 Goal not aligned: ${alignment.notes}. Skipping advance_mode for this step.`);
          ctx.traceEvent(ctx.taskId, {
            event: "gate_result",
            agent: agentId,
            iteration: ctx.iterations(),
            step_id: stepId,
            ...graphMeta,
            ...intentStep,
            ...edgeMeta("gate_block"),
            gate: "goal_alignment",
            passed: false,
            confidence: alignment.confidence,
            reason: alignment.notes,
          });
          markStepRetryingAfterGate(runState);
          return {
            action: "continue",
            artifact: {
              agentId,
              task: step.task,
              result,
              handoffYaml,
              gateBlocked: true,
              gateReason: `goal_alignment: ${alignment.notes}`,
              step_id: stepId,
              intent_id: intentId,
              gate_kind: "goal_alignment",
            },
          };
        }
      } else {
        ctx.log("gate", `🟩 Goal aligned (confidence: ${alignment.confidence ?? "n/a"})`);
        ctx.traceEvent(ctx.taskId, {
          event: "gate_result",
          agent: agentId,
          iteration: ctx.iterations(),
          step_id: stepId,
          ...graphMeta,
          ...intentStep,
          ...edgeMeta("success"),
          gate: "goal_alignment",
          passed: true,
          confidence: alignment.confidence,
        });
      }

      ctx.log("gate", `validate_transition: ${nextCurrentMode} → ${nextMode} (iteration ${ctx.iterations()})`);
      const vt = callStateMcp(
        "validate_transition",
        {
          task_id: ctx.taskId,
          from_mode: nextCurrentMode,
          to_mode: nextMode,
          handoff_yaml: handoffYaml,
          iteration: ctx.iterations(),
        },
        { cwd: ctx.cwd },
      );

      if (!vt.allowed) {
        ctx.log("gate", `🟥 Transition blocked: ${(vt.errors || []).join("; ")}`);
        ctx.traceEvent(ctx.taskId, {
          event: "gate_result",
          agent: agentId,
          iteration: ctx.iterations(),
          step_id: stepId,
          ...graphMeta,
          ...intentStep,
          ...edgeMeta("gate_block"),
          gate: "transition",
          from_mode: nextCurrentMode,
          to_mode: nextMode,
          passed: false,
          reason: (vt.errors || []).join("; "),
        });
        markStepRetryingAfterGate(runState);
        return {
          action: "continue",
          artifact: {
            agentId,
            task: step.task,
            result,
            handoffYaml,
            gateBlocked: true,
            gateReason: (vt.errors || []).join("; "),
            step_id: stepId,
            intent_id: intentId,
            gate_kind: "transition",
          },
        };
      }

      ctx.log("gate", `🟩 Transition allowed — advancing to ${nextMode}`);
      ctx.traceEvent(ctx.taskId, {
        event: "gate_result",
        agent: agentId,
        iteration: ctx.iterations(),
        step_id: stepId,
        ...graphMeta,
        ...intentStep,
        ...edgeMeta("success"),
        gate: "transition",
        from_mode: nextCurrentMode,
        to_mode: nextMode,
        passed: true,
      });
      const adv = callStateMcp(
        "advance_mode",
        {
          task_id: ctx.taskId,
          to_mode: nextMode,
          from_mode: nextCurrentMode,
          handoff_yaml: handoffYaml,
          iteration: ctx.iterations(),
        },
        { cwd: ctx.cwd },
      );

      if (adv.ok) {
        nextCurrentMode = nextMode;
        ctx.log("gate", `Mode advanced → ${nextCurrentMode}`);
      } else {
        ctx.log("gate", `WARNING: advance_mode returned ok=false: ${adv.error || JSON.stringify(adv.errors)}`);
      }
    } catch (err) {
      ctx.log("gate", `WARNING: State MCP gate error (${err.message}). Continuing without gate.`);
    }
  }

  return {
    action: "proceed",
    handoffYaml,
    handoffCompressionMeta,
    currentMode: nextCurrentMode,
    ...(qaSpecSatisfied !== qaSpecSatisfiedThisIteration ? { qaSpecSatisfiedThisIteration: qaSpecSatisfied } : {}),
  };
}

module.exports = {
  executeGateHandlingPhase,
};
