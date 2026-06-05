'use strict';

/**
 * Explicit promotion path for isolated worktree outputs.
 * Separates result acceptance (promotion) from workspace cleanup.
 */

const fs = require('fs');
const path = require('path');
const {
  planWorktree,
  resolveGitRoot,
  readWorktreeBinding,
  statusWorktree,
} = require('./worktree-isolation');
const { readRunWorkdirContract } = require('./run-workdir-contract');
const {
  emitWorkspacePromotionStarted,
  emitWorkspacePromotionCompleted,
  emitWorkspacePromotionDenied,
  emitWorkspacePromotionFailed,
} = require('./trace-workspace-lifecycle');

const PROMOTION_RECORD_REL_PATH = '.claude/worktree-promotion-record.json';
const PROMOTION_SCHEMA_VERSION = '1';

/**
 * @param {string} child
 * @param {string} root
 * @returns {boolean}
 */
function isPathUnderRoot(child, root) {
  const resolvedChild = path.resolve(child);
  const resolvedRoot = path.resolve(root);
  if (resolvedChild === resolvedRoot) return true;
  const rel = path.relative(resolvedRoot, resolvedChild);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @param {string} worktreePath
 * @returns {object | null}
 */
function readPromotionRecord(worktreePath) {
  const p = path.join(path.resolve(worktreePath), PROMOTION_RECORD_REL_PATH);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} worktreePath
 * @param {object} record
 */
function writePromotionRecord(worktreePath, record) {
  const root = path.resolve(worktreePath);
  const dir = path.join(root, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    schema_version: PROMOTION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    ...record,
  };
  fs.writeFileSync(
    path.join(root, PROMOTION_RECORD_REL_PATH),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  return payload;
}

/**
 * @param {object} contract
 * @returns {boolean}
 */
function contractHasArtifactsReadyTrace(contract) {
  const refs = Array.isArray(contract.trace_refs) ? contract.trace_refs : [];
  return refs.some((r) => r && r.event === 'workspace_artifacts_ready');
}

/**
 * @param {object} plan
 * @param {object | null} binding
 * @param {object | null} contract
 * @returns {Parameters<typeof emitWorkspacePromotionStarted>[1]}
 */
function promotionTraceCtx(plan, binding, contract) {
  return {
    task_id: plan.task_id,
    repo_root: plan.repo_root,
    worktree_path: plan.worktree_path,
    branch: plan.branch || binding?.branch,
    base_ref: binding?.base_ref || contract?.base_ref || 'HEAD',
    run_cwd: contract?.run_cwd || plan.worktree_path,
    artifact_root: contract?.artifact_root,
    cleanup_policy: contract?.cleanup_policy,
  };
}

/**
 * @param {string} relPath
 * @param {object} contract
 * @returns {{ ok: true, absPath: string, relFromWorktree: string } | { ok: false, error: string, reason_code: string }}
 */
function resolvePromotionSource(relPath, contract) {
  const rel = String(relPath || '').trim().replace(/^\/+/, '');
  if (!rel || rel.includes('..')) {
    return { ok: false, error: 'invalid_artifact_path', reason_code: 'path_escape' };
  }

  const worktreePath = path.resolve(contract.worktree_path);
  const absPath = path.resolve(worktreePath, rel);
  if (!isPathUnderRoot(absPath, worktreePath)) {
    return { ok: false, error: 'artifact_outside_worktree', reason_code: 'outside_mutable_zone' };
  }

  const mutable = Array.isArray(contract.execution_state?.mutable_paths)
    ? contract.execution_state.mutable_paths.map((p) => path.resolve(String(p)))
    : [worktreePath, path.resolve(contract.artifact_root)];
  const underMutable = mutable.some((m) => isPathUnderRoot(absPath, m) || path.resolve(absPath) === path.resolve(m));
  if (!underMutable) {
    return { ok: false, error: 'artifact_not_in_mutable_zone', reason_code: 'outside_mutable_zone' };
  }

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return { ok: false, error: 'artifact_not_found', reason_code: 'missing_artifact' };
  }

  return { ok: true, absPath, relFromWorktree: rel };
}

/**
 * @param {string} relFromWorktree
 * @param {string | undefined} destRelPrefix
 * @param {object} contract
 * @returns {{ ok: true, destAbs: string, destRel: string } | { ok: false, error: string, reason_code: string }}
 */
function resolvePromotionDest(relFromWorktree, destRelPrefix, contract) {
  const repoRoot = path.resolve(contract.repo_root);
  const worktreePath = path.resolve(contract.worktree_path);
  const prefix = destRelPrefix != null && String(destRelPrefix).trim()
    ? String(destRelPrefix).trim().replace(/^\/+/, '').replace(/\/+$/, '')
    : '';
  const destRel = prefix ? path.join(prefix, relFromWorktree) : relFromWorktree;
  if (destRel.includes('..')) {
    return { ok: false, error: 'invalid_dest_path', reason_code: 'path_escape' };
  }

  const destAbs = path.resolve(repoRoot, destRel);
  if (!isPathUnderRoot(destAbs, repoRoot)) {
    return { ok: false, error: 'dest_outside_repo_root', reason_code: 'outside_repo_root' };
  }
  if (isPathUnderRoot(destAbs, worktreePath)) {
    return { ok: false, error: 'dest_inside_worktree', reason_code: 'dest_in_isolation_zone' };
  }

  return { ok: true, destAbs, destRel };
}

/**
 * @param {{
 *   taskId: string,
 *   repoRoot?: string,
 *   worktreesDir?: string,
 * }} options
 */
function validatePromotionEligibility(options) {
  const repo = resolveGitRoot(options.repoRoot || process.cwd());
  if (!repo.ok) {
    return { ok: false, error: repo.error, reason_code: 'not_a_git_repository' };
  }

  const plan = planWorktree({
    repoRoot: repo.gitRoot,
    taskId: options.taskId,
    worktreesDir: options.worktreesDir,
  });
  if (!plan.ok) {
    return { ok: false, error: plan.error, reason_code: 'invalid_task_id' };
  }

  if (!fs.existsSync(plan.worktree_path)) {
    return { ok: false, error: 'worktree_not_found', reason_code: 'worktree_missing', ...plan };
  }

  const binding = readWorktreeBinding(plan.worktree_path);
  if (!binding) {
    return { ok: false, error: 'worktree_not_managed', reason_code: 'unmanaged_worktree', ...plan };
  }

  const contractRead = readRunWorkdirContract(plan.worktree_path);
  if (!contractRead.ok) {
    return {
      ok: false,
      error: 'run_workdir_contract_invalid',
      reason_code: 'invalid_contract',
      errors: contractRead.errors,
      ...plan,
    };
  }

  const contract = contractRead.contract;
  if (!contractHasArtifactsReadyTrace(contract)) {
    return {
      ok: false,
      error: 'artifacts_not_ready',
      reason_code: 'missing_artifacts_ready_trace',
      ...plan,
      contract,
      binding,
    };
  }

  const existing = readPromotionRecord(plan.worktree_path);
  if (existing && existing.status === 'completed') {
    return {
      ok: false,
      error: 'promotion_already_completed',
      reason_code: 'already_promoted',
      ...plan,
      contract,
      binding,
      promotion_record: existing,
    };
  }

  return {
    ok: true,
    ...plan,
    binding,
    contract,
    ctx: promotionTraceCtx(plan, binding, contract),
    trace_refs: Array.isArray(contract.trace_refs) ? [...contract.trace_refs] : [],
  };
}

/**
 * @param {string[]} artifactRels
 * @param {object} contract
 * @param {string} [destRelPrefix]
 */
function validatePromotionArtifacts(artifactRels, contract, destRelPrefix) {
  if (!Array.isArray(artifactRels) || !artifactRels.length) {
    return { ok: false, error: 'missing_artifacts', reason_code: 'empty_artifact_list' };
  }

  /** @type {Array<{ relPath: string, sourceAbs: string, destAbs: string, destRel: string }>} */
  const resolved = [];
  for (const rel of artifactRels) {
    const src = resolvePromotionSource(rel, contract);
    if (!src.ok) {
      return { ok: false, error: src.error, reason_code: src.reason_code, artifact: rel };
    }
    const dest = resolvePromotionDest(src.relFromWorktree, destRelPrefix, contract);
    if (!dest.ok) {
      return { ok: false, error: dest.error, reason_code: dest.reason_code, artifact: rel };
    }
    resolved.push({
      relPath: src.relFromWorktree,
      sourceAbs: src.absPath,
      destAbs: dest.destAbs,
      destRel: dest.destRel,
    });
  }

  return { ok: true, artifacts: resolved };
}

/**
 * @param {{
 *   taskId: string,
 *   artifacts: string[],
 *   destRelPrefix?: string,
 *   operatorApproved?: boolean,
 *   repoRoot?: string,
 *   worktreesDir?: string,
 *   tracesDir?: string,
 * }} options
 */
function promoteWorktreeResults(options) {
  const eligibility = validatePromotionEligibility(options);
  if (!eligibility.ok) {
    return eligibility;
  }

  if (options.operatorApproved !== true) {
    return {
      ok: false,
      error: 'operator_approval_required',
      reason_code: 'approval_missing',
      task_id: eligibility.task_id,
      worktree_path: eligibility.worktree_path,
    };
  }

  const artifactCheck = validatePromotionArtifacts(
    options.artifacts,
    eligibility.contract,
    options.destRelPrefix,
  );
  if (!artifactCheck.ok) {
    emitWorkspacePromotionFailed(
      eligibility.task_id,
      eligibility.ctx,
      artifactCheck.reason_code || 'validation_failed',
      { detail: artifactCheck.error },
      { tracesDir: options.tracesDir },
    );
    return { ...artifactCheck, task_id: eligibility.task_id, worktree_path: eligibility.worktree_path };
  }

  emitWorkspacePromotionStarted(
    eligibility.task_id,
    eligibility.ctx,
    {
      artifact_count: artifactCheck.artifacts.length,
      operator_approved: true,
    },
    { tracesDir: options.tracesDir },
  );

  /** @type {Array<{ source_rel: string, dest_rel: string, promoted_at: string }>} */
  const promoted = [];
  try {
    for (const item of artifactCheck.artifacts) {
      fs.mkdirSync(path.dirname(item.destAbs), { recursive: true });
      fs.copyFileSync(item.sourceAbs, item.destAbs);
      promoted.push({
        source_rel: item.relPath,
        dest_rel: item.destRel,
        promoted_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    emitWorkspacePromotionFailed(
      eligibility.task_id,
      eligibility.ctx,
      'copy_failed',
      { detail: detail.slice(0, 500) },
      { tracesDir: options.tracesDir },
    );
    return {
      ok: false,
      error: 'promotion_copy_failed',
      reason_code: 'copy_failed',
      detail,
      task_id: eligibility.task_id,
      worktree_path: eligibility.worktree_path,
    };
  }

  const completedAt = new Date().toISOString();
  const record = writePromotionRecord(eligibility.worktree_path, {
    run_id: eligibility.task_id,
    worktree_path: eligibility.worktree_path,
    repo_root: eligibility.repo_root,
    status: 'completed',
    operator_approved: true,
    artifacts: promoted,
    trace_refs: eligibility.trace_refs,
    promoted_at: completedAt,
  });

  const emitted = emitWorkspacePromotionCompleted(
    eligibility.task_id,
    eligibility.ctx,
    {
      operator_approved: true,
      promoted_artifacts: promoted,
    },
    { tracesDir: options.tracesDir },
  );

  return {
    ok: true,
    promoted: true,
    task_id: eligibility.task_id,
    worktree_path: eligibility.worktree_path,
    repo_root: eligibility.repo_root,
    artifacts: promoted,
    promotion_record: record,
    trace_ref: emitted.trace_ref || null,
  };
}

/**
 * @param {{
 *   taskId: string,
 *   reasonCode?: string,
 *   repoRoot?: string,
 *   worktreesDir?: string,
 *   tracesDir?: string,
 * }} options
 */
function denyWorktreePromotion(options) {
  const repo = resolveGitRoot(options.repoRoot || process.cwd());
  if (!repo.ok) {
    return { ok: false, error: repo.error, reason_code: 'not_a_git_repository' };
  }

  const st = statusWorktree({
    repoRoot: repo.gitRoot,
    taskId: options.taskId,
    worktreesDir: options.worktreesDir,
  });
  if (!st.ok) {
    return { ok: false, error: st.error, reason_code: 'status_failed' };
  }
  if (!st.exists) {
    return { ok: false, error: 'worktree_not_found', reason_code: 'worktree_missing' };
  }

  const contract = st.contract;
  const binding = st.binding;
  const plan = planWorktree({
    repoRoot: repo.gitRoot,
    taskId: options.taskId,
    worktreesDir: options.worktreesDir,
  });
  const ctx = promotionTraceCtx(plan.ok ? plan : { task_id: options.taskId, repo_root: repo.gitRoot, worktree_path: st.worktree_path }, binding, contract);
  const reasonCode = String(options.reasonCode || 'operator_denied').trim() || 'operator_denied';

  const deniedAt = new Date().toISOString();
  const record = writePromotionRecord(st.worktree_path, {
    run_id: options.taskId,
    worktree_path: st.worktree_path,
    repo_root: contract?.repo_root || binding?.repo_root || repo.gitRoot,
    status: 'denied',
    operator_approved: false,
    deny_reason_code: reasonCode,
    denied_at: deniedAt,
    trace_refs: contract && Array.isArray(contract.trace_refs) ? [...contract.trace_refs] : [],
  });

  emitWorkspacePromotionDenied(
    options.taskId,
    ctx,
    reasonCode,
    { cleanup_side_effects: false },
    { tracesDir: options.tracesDir },
  );

  return {
    ok: true,
    denied: true,
    task_id: options.taskId,
    worktree_path: st.worktree_path,
    reason_code: reasonCode,
    promotion_record: record,
    cleanup_side_effects: false,
  };
}

/**
 * @param {object | null} record
 * @returns {string}
 */
function formatPromotionRecordText(record) {
  if (!record) return 'Promotion record: (none)';
  const lines = [
    'Promotion record',
    `  status:            ${record.status || 'unknown'}`,
    `  run_id:            ${record.run_id || '—'}`,
    `  operator_approved: ${record.operator_approved === true}`,
  ];
  if (record.denied_at) lines.push(`  denied_at:         ${record.denied_at}`);
  if (record.deny_reason_code) lines.push(`  deny_reason_code:  ${record.deny_reason_code}`);
  if (record.promoted_at) lines.push(`  promoted_at:       ${record.promoted_at}`);
  if (Array.isArray(record.artifacts) && record.artifacts.length) {
    lines.push('  artifacts:');
    for (const a of record.artifacts) {
      lines.push(`    ${a.source_rel} → ${a.dest_rel}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  PROMOTION_RECORD_REL_PATH,
  PROMOTION_SCHEMA_VERSION,
  isPathUnderRoot,
  readPromotionRecord,
  writePromotionRecord,
  contractHasArtifactsReadyTrace,
  validatePromotionEligibility,
  validatePromotionArtifacts,
  promoteWorktreeResults,
  denyWorktreePromotion,
  formatPromotionRecordText,
};
