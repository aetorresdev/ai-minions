"use strict";

/**
 * In-memory run snapshot (STATE-1). Complements the on-disk state store — not a substitute
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

/** @param {{ run: { current_iteration: number } }} runState */
function syncRunIteration(runState, iteration) {
  runState.run.current_iteration = iteration;
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
  return {
    run: { ...runState.run },
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
  finalizeRunState,
  getRunStatePublicView,
};
