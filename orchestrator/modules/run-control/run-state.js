"use strict";

/**
 * In-memory run snapshot. Complements the on-disk state store — not a substitute
 * for `events.jsonl` / envelope authority (see agent-contract § Authoritative state).
 *
 * @typedef {'running' | 'done' | 'failed' | 'aborted'} RunStatus
 * @typedef {'pending' | 'running' | 'done' | 'failed' | 'retrying'} StepStatus
 * @typedef {'active' | 'resolved' | 'abandoned'} IntentStatus
 */

/**
 * @param {{ taskId: string, flowMode: string, goal: string, maxIterations: number }} init
 */
function createRunState(init) {
  return {
    run: {
      /** @type {RunStatus} */
      status: "running",
      task_id: init.taskId,
      flow_mode: init.flowMode,
      goal: init.goal,
      max_iterations: init.maxIterations,
      current_iteration: 0,
    },
    /**
     * Optional: current worker step + intent (expanded when step lifecycle is centralized).
     * @type {{ step_id: string, agent_id: string, status: StepStatus, intent: { status: IntentStatus } } | null}
     */
    step: null,
  };
}

/**
 * Advance outer-loop counter and **reset** `step` for the new iteration.
 * Avoids carrying the previous iteration’s terminal `step` (e.g. `done`) into
 * `session_end.run_state_snapshot` / tooling while `current_iteration` already moved.
 */
function syncRunIteration(runState, iteration) {
  runState.run.current_iteration = iteration;
  runState.step = null;
}

/** @param {{ step: object | null }} runState */
function setStepRunning(runState, stepId, agentId) {
  runState.step = {
    step_id: stepId,
    agent_id: agentId,
    status: "running",
    intent: { status: "active" },
  };
}

/** Marks the in-flight worker step succeeded (after `agent_done` is emitted). */
function setStepCompleted(runState) {
  if (!runState.step) return;
  runState.step.status = "done";
  runState.step.intent.status = "resolved";
}

/** Contract or hard fail before `agent_done` — clears in-flight step. */
function setStepFailedAndClear(runState) {
  if (!runState.step) return;
  runState.step.status = "failed";
  runState.step.intent.status = "abandoned";
  runState.step = null;
}

/**
 * After `agent_done` we may have marked the step **done**; gate/handoff `continue` means another attempt
 * on the same worker step — treat as **retrying** until the next terminal path.
 */
function markStepRetryingAfterGate(runState) {
  if (!runState.step) return;
  runState.step.status = "retrying";
  runState.step.intent.status = "active";
}

/**
 * Set terminal run.status once, from final `done` / `manualReview` flags (end of `run()`).
 * Does not overwrite if something already set a terminal status (future: mid-run abort hooks).
 * @param {{ run: { status: RunStatus } }} runState
 */
function finalizeRunState(runState, { done, manualReview }) {
  if (runState.run.status !== "running") return;
  if (done) {
    runState.run.status = "done";
    return;
  }
  if (manualReview) {
    runState.run.status = "aborted";
    return;
  }
  runState.run.status = "failed";
}

/** Immutable-ish snapshot for `run()` return value and tooling (e.g. explain-run wrappers). */
function getRunStatePublicView(runState) {
  const g = runState.run.goal;
  const goalPublic = typeof g === "string" && g.length > 200 ? `${g.slice(0, 200)}…` : g;
  return {
    run: { ...runState.run, goal: goalPublic },
    step: runState.step
      ? {
        step_id: runState.step.step_id,
        agent_id: runState.step.agent_id,
        status: runState.step.status,
        intent: { ...runState.step.intent },
      }
      : null,
  };
}

module.exports = {
  createRunState,
  syncRunIteration,
  setStepRunning,
  setStepCompleted,
  setStepFailedAndClear,
  markStepRetryingAfterGate,
  finalizeRunState,
  getRunStatePublicView,
};
