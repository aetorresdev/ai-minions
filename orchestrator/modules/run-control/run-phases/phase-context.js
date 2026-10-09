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

/**
 * Why a state-MCP response must not be trusted, or null when it is usable.
 * A response is a failure when it is not an object or does not report `ok`.
 * Use only for tools whose healthy reply carries `ok: true` (register_task,
 * validate_goal_alignment, advance_mode).
 *
 * @param {unknown} res
 * @returns {string | null}
 */
function stateMcpResponseFailure(res) {
  if (res === null || typeof res !== "object") return "non-object response";
  const r = /** @type {Record<string, unknown>} */ (res);
  if (r.ok) return null;
  const detail = r.error ?? (r.errors != null ? JSON.stringify(r.errors) : null) ?? "ok=false";
  return String(detail).slice(0, 300);
}

/**
 * Failure reason for a validate_transition response, or null when usable. A usable reply may still
 * report `allowed: false` (a policy block, handled by callers); only a non-object or `ok: false` reply is a failure.
 *
 * @param {unknown} res
 * @returns {string | null}
 */
function stateMcpTransitionFailure(res) {
  if (res === null || typeof res !== "object") return "non-object response";
  const r = /** @type {Record<string, unknown>} */ (res);
  if (r.ok !== false) return null;
  return String(r.error ?? (r.errors != null ? JSON.stringify(r.errors) : "ok=false")).slice(0, 300);
}

/**
 * Terminal stop for a state-MCP failure when gates are required (no --skip-gates):
 * the run ends done=false for manual review; it never continues ungated.
 *
 * @param {string} tool state-MCP tool that failed
 * @param {unknown} reason error message or response failure reason
 * @returns {{ action: "break_orchestration", done: false, manualReview: true, summary: string, reason: string }}
 */
function buildStateMcpStop(tool, reason) {
  const text = String(reason == null || reason === "" ? "unknown error" : reason).slice(0, 300);
  return {
    action: "break_orchestration",
    done: false,
    manualReview: true,
    summary: `Manual review required: state-MCP ${tool} failed — ${text}`,
    reason: text,
  };
}

module.exports = {
  createPhaseContext,
  stateMcpResponseFailure,
  stateMcpTransitionFailure,
  buildStateMcpStop,
};
