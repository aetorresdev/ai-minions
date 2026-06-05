"use strict";

/**
 * Shared run-loop phase context (slice 3+). Bundles live run state accessors and
 * trace helpers so phase modules avoid growing flat deps bags.
 *
 * @param {{
 *   taskId: string,
 *   cwd: string,
 *   goal: string,
 *   sessionEnv: object | null,
 *   iterations: () => number,
 *   traceEvent: (taskId: string, payload: object) => void,
 *   log: (agent: string, msg: string) => void,
 *   getLastBudgetMeta: () => object,
 *   emitContextStatsRows: (...args: unknown[]) => void,
 *   emitModelFallbackLifecycleIfNeeded: (...args: unknown[]) => void,
 *   costGuardAbort: (phase: string) => boolean,
 * }} fields
 */
function createPhaseContext(fields) {
  return {
    taskId: fields.taskId,
    cwd: fields.cwd,
    goal: fields.goal,
    sessionEnv: fields.sessionEnv,
    iterations: fields.iterations,
    traceEvent: fields.traceEvent,
    log: fields.log,
    getLastBudgetMeta: fields.getLastBudgetMeta,
    emitContextStatsRows: fields.emitContextStatsRows,
    emitModelFallbackLifecycleIfNeeded: fields.emitModelFallbackLifecycleIfNeeded,
    costGuardAbort: fields.costGuardAbort,
  };
}

module.exports = {
  createPhaseContext,
};
