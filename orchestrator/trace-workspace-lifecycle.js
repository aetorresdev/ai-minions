'use strict';

/**
 * Workspace lifecycle trace events (git worktree isolation) + contract trace_refs.
 * Observability only — distinct from agent reasoning / context_stats.
 */

const {
  readRunWorkdirContract,
  writeRunWorkdirContract,
} = require('./run-workdir-contract');
const { appendTraceEvent } = require('./trace-append');

const WORKSPACE_EVENTS = Object.freeze([
  'workspace_created',
  'workspace_reused',
  'workspace_rejected',
  'workspace_run_cwd_bound',
  'workspace_artifacts_ready',
  'workspace_promotion_started',
  'workspace_promotion_completed',
  'workspace_promotion_denied',
  'workspace_promotion_failed',
  'workspace_cleanup_started',
  'workspace_cleanup_completed',
  'workspace_cleanup_skipped',
  'workspace_cleanup_failed',
]);

/**
 * @returns {boolean}
 */
function isWorkspaceTraceEnabled() {
  return process.env.ORCH_DISABLE_WORKSPACE_TRACE !== '1';
}

/**
 * @param {{
 *   task_id?: string,
 *   run_id?: string,
 *   repo_root: string,
 *   worktree_path: string,
 *   branch?: string,
 *   base_ref?: string,
 *   run_cwd?: string,
 *   artifact_root?: string,
 *   cleanup_policy?: string,
 * }} ctx
 * @returns {Record<string, unknown>}
 */
function buildWorkspaceTraceBase(ctx) {
  const taskId = ctx.task_id || ctx.run_id || '';
  /** @type {Record<string, unknown>} */
  const base = {
    execution_actor: 'workspace_manager',
    isolation_mode: 'git_worktree',
    worktree_path: ctx.worktree_path,
    repo_root: ctx.repo_root,
    worktree_task_id: taskId,
  };
  if (typeof ctx.branch === 'string' && ctx.branch.length) base.worktree_branch = ctx.branch;
  if (typeof ctx.base_ref === 'string' && ctx.base_ref.length) base.base_ref = ctx.base_ref;
  if (typeof ctx.run_cwd === 'string' && ctx.run_cwd.length) base.run_cwd = ctx.run_cwd;
  if (typeof ctx.artifact_root === 'string' && ctx.artifact_root.length) {
    base.artifact_root = ctx.artifact_root;
  }
  if (typeof ctx.cleanup_policy === 'string' && ctx.cleanup_policy.length) {
    base.cleanup_policy = ctx.cleanup_policy;
  }
  return base;
}

/**
 * @param {string} worktreePath
 * @param {{ event: string, ts_ms: number, line_index: number }} ref
 */
function appendTraceRefToContract(worktreePath, ref) {
  const read = readRunWorkdirContract(worktreePath);
  if (!read.ok) return { ok: false, errors: read.errors };
  const contract = read.contract;
  const refs = Array.isArray(contract.trace_refs) ? [...contract.trace_refs] : [];
  refs.push(ref);
  contract.trace_refs = refs;
  contract.business_artifacts.trace_refs = refs;
  return writeRunWorkdirContract(worktreePath, contract);
}

/**
 * @param {string} taskId
 * @param {string | null | undefined} worktreePath
 * @param {Record<string, unknown>} payload
 * @param {{ tracesDir?: string }} [options]
 */
function emitWorkspaceLifecycleEvent(taskId, worktreePath, payload, options = {}) {
  if (!isWorkspaceTraceEnabled() || !taskId) {
    return { ok: false, skipped: true };
  }
  const appended = appendTraceEvent(taskId, payload, options);
  if (!appended.ok || !appended.record) return appended;
  const ref = {
    event: payload.event,
    ts_ms: appended.record.ts_ms,
    line_index: appended.line_index,
  };
  if (worktreePath) {
    appendTraceRefToContract(worktreePath, ref);
  }
  return { ...appended, trace_ref: ref };
}

/**
 * @param {string} taskId
 * @param {Parameters<typeof buildWorkspaceTraceBase>[0]} ctx
 * @param {Record<string, unknown>} [extra]
 * @param {{ tracesDir?: string }} [options]
 */
function emitWorkspaceCreated(taskId, ctx, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_created', ...buildWorkspaceTraceBase(ctx), ...extra },
    options,
  );
}

function emitWorkspaceReused(taskId, ctx, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_reused', ...buildWorkspaceTraceBase(ctx), ...extra },
    options,
  );
}

function emitWorkspaceRejected(taskId, ctx, reasonCode, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path || null,
    {
      event: 'workspace_rejected',
      ...buildWorkspaceTraceBase(ctx),
      reason_code: reasonCode,
      ...extra,
    },
    options,
  );
}

function emitWorkspaceRunCwdBound(taskId, ctx, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_run_cwd_bound', ...buildWorkspaceTraceBase(ctx) },
    options,
  );
}

function emitWorkspaceArtifactsReady(taskId, ctx, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_artifacts_ready', ...buildWorkspaceTraceBase(ctx) },
    options,
  );
}

function emitWorkspaceCleanupStarted(taskId, ctx, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_cleanup_started', ...buildWorkspaceTraceBase(ctx) },
    options,
  );
}

function emitWorkspaceCleanupCompleted(taskId, ctx, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_cleanup_completed', ...buildWorkspaceTraceBase(ctx) },
    options,
  );
}

function emitWorkspaceCleanupSkipped(taskId, ctx, reasonCode, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    {
      event: 'workspace_cleanup_skipped',
      ...buildWorkspaceTraceBase(ctx),
      reason_code: reasonCode,
    },
    options,
  );
}

function emitWorkspaceCleanupFailed(taskId, ctx, reasonCode, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    {
      event: 'workspace_cleanup_failed',
      ...buildWorkspaceTraceBase(ctx),
      reason_code: reasonCode,
      retained: true,
      ...extra,
    },
    options,
  );
}

function emitWorkspacePromotionStarted(taskId, ctx, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_promotion_started', ...buildWorkspaceTraceBase(ctx), ...extra },
    options,
  );
}

function emitWorkspacePromotionCompleted(taskId, ctx, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    { event: 'workspace_promotion_completed', ...buildWorkspaceTraceBase(ctx), ...extra },
    options,
  );
}

function emitWorkspacePromotionDenied(taskId, ctx, reasonCode, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    {
      event: 'workspace_promotion_denied',
      ...buildWorkspaceTraceBase(ctx),
      reason_code: reasonCode,
      cleanup_side_effects: false,
      ...extra,
    },
    options,
  );
}

function emitWorkspacePromotionFailed(taskId, ctx, reasonCode, extra = {}, options = {}) {
  return emitWorkspaceLifecycleEvent(
    taskId,
    ctx.worktree_path,
    {
      event: 'workspace_promotion_failed',
      ...buildWorkspaceTraceBase(ctx),
      reason_code: reasonCode,
      ...extra,
    },
    options,
  );
}

/**
 * @param {object[]} rows
 * @returns {object}
 */
function summarizeWorkspaceLifecycleFromRows(rows) {
  const timeline = rows
    .filter((r) => typeof r.event === 'string' && WORKSPACE_EVENTS.includes(r.event))
    .map((r) => ({
      event: r.event,
      ts_ms: r.ts_ms,
      worktree_task_id: r.worktree_task_id ?? null,
      reason_code: typeof r.reason_code === 'string' ? r.reason_code : null,
      retained: r.retained === true,
    }));

  const last = timeline.length ? timeline[timeline.length - 1] : null;
  const created = timeline.some((t) => t.event === 'workspace_created');
  const reused = timeline.some((t) => t.event === 'workspace_reused');
  const cleanupAttempted = timeline.some((t) =>
    t.event === 'workspace_cleanup_started'
    || t.event === 'workspace_cleanup_skipped',
  );
  const cleanupDone = timeline.some((t) => t.event === 'workspace_cleanup_completed');
  const cleanupRetained = timeline.some((t) =>
    t.event === 'workspace_cleanup_failed'
    || t.event === 'workspace_cleanup_skipped',
  );
  const promotionAttempted = timeline.some((t) =>
    t.event === 'workspace_promotion_started'
    || t.event === 'workspace_promotion_denied',
  );
  const promotionCompleted = timeline.some((t) => t.event === 'workspace_promotion_completed');
  const promotionDenied = timeline.some((t) => t.event === 'workspace_promotion_denied');

  return {
    computed_from: 'workspace_lifecycle_events',
    event_count: timeline.length,
    timeline,
    flags: {
      workspace_created: created,
      workspace_reused: reused,
      promotion_attempted: promotionAttempted,
      promotion_completed: promotionCompleted,
      promotion_denied: promotionDenied,
      cleanup_attempted: cleanupAttempted,
      cleanup_completed: cleanupDone,
      workspace_retained: cleanupRetained,
    },
    last_event: last ? last.event : null,
  };
}

module.exports = {
  WORKSPACE_EVENTS,
  isWorkspaceTraceEnabled,
  buildWorkspaceTraceBase,
  appendTraceRefToContract,
  emitWorkspaceLifecycleEvent,
  emitWorkspaceCreated,
  emitWorkspaceReused,
  emitWorkspaceRejected,
  emitWorkspaceRunCwdBound,
  emitWorkspaceArtifactsReady,
  emitWorkspaceCleanupStarted,
  emitWorkspaceCleanupCompleted,
  emitWorkspaceCleanupSkipped,
  emitWorkspaceCleanupFailed,
  emitWorkspacePromotionStarted,
  emitWorkspacePromotionCompleted,
  emitWorkspacePromotionDenied,
  emitWorkspacePromotionFailed,
  summarizeWorkspaceLifecycleFromRows,
};
