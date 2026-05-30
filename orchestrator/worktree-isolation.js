'use strict';

/**
 * Git worktree isolation for orchestrator runs — one worktree per task_id.
 * Filesystem boundary only; does not replace permission/budget/governance gates.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BINDING_REL_PATH = '.claude/worktree-binding.json';
const BINDING_SCHEMA_VERSION = '1';
const BRANCH_PREFIX = 'orch/';

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function runGit(args, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}), GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

/**
 * @param {string} [cwd]
 * @returns {{ ok: true, gitRoot: string } | { ok: false, error: string, gitRoot: null }}
 */
function resolveGitRoot(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const r = runGit(['rev-parse', '--show-toplevel'], { cwd: start });
  if (!r.ok) {
    return { ok: false, error: 'not_a_git_repository', gitRoot: null };
  }
  return { ok: true, gitRoot: r.stdout };
}

/**
 * @param {string} taskId
 * @returns {string}
 */
function sanitizeTaskId(taskId) {
  const s = String(taskId || '').trim();
  if (!s) return '';
  return s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function defaultWorktreesDir(repoRoot) {
  const env = process.env.ORCH_WORKTREES_DIR;
  if (env != null && String(env).trim()) {
    return path.resolve(String(env).trim());
  }
  return path.join(path.resolve(repoRoot), '.claude', 'worktrees');
}

/**
 * @param {{ repoRoot: string, taskId: string, worktreesDir?: string }} input
 */
function planWorktree(input) {
  const safeTask = sanitizeTaskId(input.taskId);
  if (!safeTask) {
    return { ok: false, error: 'invalid_task_id' };
  }
  const repoRoot = path.resolve(input.repoRoot);
  const worktreesDir = input.worktreesDir
    ? path.resolve(input.worktreesDir)
    : defaultWorktreesDir(repoRoot);
  const worktreePath = path.join(worktreesDir, safeTask);
  const branch = `${BRANCH_PREFIX}${safeTask}`;
  return {
    ok: true,
    task_id: safeTask,
    repo_root: repoRoot,
    worktrees_dir: worktreesDir,
    worktree_path: worktreePath,
    branch,
    binding_path: path.join(worktreePath, BINDING_REL_PATH),
  };
}

/**
 * @param {string} worktreePath
 * @returns {object | null}
 */
function readWorktreeBinding(worktreePath) {
  const p = path.join(path.resolve(worktreePath), BINDING_REL_PATH);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} worktreePath
 * @param {object} binding
 */
function writeWorktreeBinding(worktreePath, binding) {
  const root = path.resolve(worktreePath);
  const dir = path.join(root, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    schema_version: BINDING_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    ...binding,
  };
  fs.writeFileSync(
    path.join(root, BINDING_REL_PATH),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

/**
 * @param {string} repoRoot
 * @param {string} branch
 * @returns {boolean}
 */
function branchExists(repoRoot, branch) {
  const r = runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot });
  return r.ok;
}

/**
 * @param {{
 *   repoRoot?: string,
 *   taskId: string,
 *   baseRef?: string,
 *   worktreesDir?: string,
 *   primaryCwd?: string,
 *   force?: boolean,
 * }} options
 */
function createIsolatedWorktree(options) {
  const repo = resolveGitRoot(options.repoRoot || options.primaryCwd || process.cwd());
  if (!repo.ok) {
    return { ok: false, error: repo.error };
  }

  const plan = planWorktree({
    repoRoot: repo.gitRoot,
    taskId: options.taskId,
    worktreesDir: options.worktreesDir,
  });
  if (!plan.ok) {
    return { ok: false, error: plan.error };
  }

  const existingBinding = fs.existsSync(plan.worktree_path)
    ? readWorktreeBinding(plan.worktree_path)
    : null;
  if (existingBinding && existingBinding.task_id === plan.task_id) {
    return {
      ok: true,
      created: false,
      already_exists: true,
      ...plan,
      binding: existingBinding,
    };
  }
  if (fs.existsSync(plan.worktree_path) && !options.force) {
    return { ok: false, error: 'worktree_path_exists', worktree_path: plan.worktree_path };
  }

  fs.mkdirSync(path.dirname(plan.worktree_path), { recursive: true });
  const baseRef = options.baseRef || 'HEAD';
  const addArgs = branchExists(repo.gitRoot, plan.branch)
    ? ['worktree', 'add', plan.worktree_path, plan.branch]
    : ['worktree', 'add', '-b', plan.branch, plan.worktree_path, baseRef];

  const add = runGit(addArgs, { cwd: repo.gitRoot });
  if (!add.ok) {
    return {
      ok: false,
      error: 'git_worktree_add_failed',
      detail: add.stderr || add.stdout,
      ...plan,
    };
  }

  const binding = {
    task_id: plan.task_id,
    repo_root: plan.repo_root,
    primary_cwd: path.resolve(options.primaryCwd || plan.repo_root),
    worktree_path: plan.worktree_path,
    branch: plan.branch,
    base_ref: baseRef,
    traces_dir: process.env.ORCH_TRACES_DIR || null,
  };
  writeWorktreeBinding(plan.worktree_path, binding);

  return {
    ok: true,
    created: true,
    already_exists: false,
    ...plan,
    binding,
  };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   taskId: string,
 *   worktreesDir?: string,
 *   force?: boolean,
 * }} options
 */
function removeIsolatedWorktree(options) {
  const repo = resolveGitRoot(options.repoRoot || process.cwd());
  if (!repo.ok) {
    return { ok: false, error: repo.error };
  }

  const plan = planWorktree({
    repoRoot: repo.gitRoot,
    taskId: options.taskId,
    worktreesDir: options.worktreesDir,
  });
  if (!plan.ok) {
    return { ok: false, error: plan.error };
  }

  if (!fs.existsSync(plan.worktree_path)) {
    return { ok: false, error: 'worktree_not_found', worktree_path: plan.worktree_path };
  }

  const binding = readWorktreeBinding(plan.worktree_path);
  const useForce = options.force === true || Boolean(binding);
  const removeArgs = useForce
    ? ['worktree', 'remove', '--force', plan.worktree_path]
    : ['worktree', 'remove', plan.worktree_path];
  const rem = runGit(removeArgs, { cwd: repo.gitRoot });
  if (!rem.ok) {
    return {
      ok: false,
      error: 'git_worktree_remove_failed',
      detail: rem.stderr || rem.stdout,
      worktree_path: plan.worktree_path,
    };
  }

  runGit(['worktree', 'prune'], { cwd: repo.gitRoot });
  return { ok: true, removed: true, worktree_path: plan.worktree_path, task_id: plan.task_id };
}

/**
 * @param {{ repoRoot?: string, worktreesDir?: string }} [options]
 */
function listManagedWorktrees(options = {}) {
  const repo = resolveGitRoot(options.repoRoot || process.cwd());
  if (!repo.ok) {
    return { ok: false, error: repo.error, worktrees: [] };
  }

  const worktreesDir = options.worktreesDir
    ? path.resolve(options.worktreesDir)
    : defaultWorktreesDir(repo.gitRoot);

  /** @type {Array<object>} */
  const worktrees = [];
  if (!fs.existsSync(worktreesDir)) {
    return { ok: true, repo_root: repo.gitRoot, worktrees_dir: worktreesDir, worktrees };
  }

  for (const name of fs.readdirSync(worktreesDir)) {
    const worktreePath = path.join(worktreesDir, name);
    if (!fs.statSync(worktreePath).isDirectory()) continue;
    const binding = readWorktreeBinding(worktreePath);
    worktrees.push({
      task_id: binding?.task_id || name,
      worktree_path: worktreePath,
      branch: binding?.branch || null,
      repo_root: binding?.repo_root || repo.gitRoot,
      binding,
    });
  }

  worktrees.sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
  return { ok: true, repo_root: repo.gitRoot, worktrees_dir: worktreesDir, worktrees };
}

/**
 * @param {{ cwd?: string, taskId?: string, repoRoot?: string, worktreesDir?: string }} [options]
 */
function statusWorktree(options = {}) {
  if (options.taskId) {
    const repo = resolveGitRoot(options.repoRoot || process.cwd());
    if (!repo.ok) return { ok: false, error: repo.error };
    const plan = planWorktree({
      repoRoot: repo.gitRoot,
      taskId: options.taskId,
      worktreesDir: options.worktreesDir,
    });
    if (!plan.ok) return { ok: false, error: plan.error };
    const binding = readWorktreeBinding(plan.worktree_path);
    return {
      ok: true,
      exists: fs.existsSync(plan.worktree_path),
      managed: Boolean(binding),
      worktree_path: plan.worktree_path,
      binding,
    };
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const binding = readWorktreeBinding(cwd);
  const gitRoot = resolveGitRoot(cwd);
  return {
    ok: true,
    cwd,
    managed: Boolean(binding),
    git_root: gitRoot.ok ? gitRoot.gitRoot : null,
    binding,
    trace_fields: buildWorktreeTraceFields(cwd),
  };
}

/**
 * @param {string} [cwd]
 * @returns {Record<string, string>}
 */
function buildWorktreeTraceFields(cwd) {
  const dir = path.resolve(cwd || process.cwd());
  const binding = readWorktreeBinding(dir);
  if (!binding || typeof binding !== 'object') return {};
  return {
    isolation_mode: 'git_worktree',
    worktree_path: dir,
    ...(typeof binding.branch === 'string' ? { worktree_branch: binding.branch } : {}),
    ...(typeof binding.repo_root === 'string' ? { repo_root: binding.repo_root } : {}),
    ...(typeof binding.task_id === 'string' ? { worktree_task_id: binding.task_id } : {}),
  };
}

/**
 * @param {string} [cwd]
 * @returns {Record<string, unknown>}
 */
function buildWorktreeHookContext(cwd) {
  const binding = readWorktreeBinding(path.resolve(cwd || process.cwd()));
  if (!binding) return {};
  return {
    isolation_mode: 'git_worktree',
    worktree_path: binding.worktree_path || path.resolve(cwd || process.cwd()),
    worktree_branch: binding.branch || null,
    repo_root: binding.repo_root || null,
  };
}

/**
 * @param {{ count: number }} listed
 * @returns {string}
 */
function formatWorktreeListText(listed) {
  const lines = ['Managed worktrees'];
  if (!listed.worktrees.length) {
    lines.push('  (none)');
    return lines.join('\n');
  }
  for (const w of listed.worktrees) {
    lines.push(`  ${w.task_id}  ${w.worktree_path}`);
    if (w.branch) lines.push(`    branch: ${w.branch}`);
  }
  return lines.join('\n');
}

module.exports = {
  BINDING_REL_PATH,
  BINDING_SCHEMA_VERSION,
  runGit,
  resolveGitRoot,
  sanitizeTaskId,
  defaultWorktreesDir,
  planWorktree,
  readWorktreeBinding,
  writeWorktreeBinding,
  createIsolatedWorktree,
  removeIsolatedWorktree,
  listManagedWorktrees,
  statusWorktree,
  buildWorktreeTraceFields,
  buildWorktreeHookContext,
  formatWorktreeListText,
};
