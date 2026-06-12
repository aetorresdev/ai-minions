'use strict';

/**
 * Canonical execution directory contract for isolated orchestrator runs.
 * Separates execution state (mutable run workspace) from business artifacts.
 */

const fs = require('fs');
const path = require('path');

const BINDING_REL_PATH = '.claude/worktree-binding.json';
const CONTRACT_REL_PATH = '.claude/run-workdir-contract.json';
const CONTRACT_SCHEMA_VERSION = '1';

const CLEANUP_POLICIES = Object.freeze([
  'retain',
  'cleanup_on_success',
  'cleanup_always',
]);

/**
 * @param {string} runId
 * @returns {string}
 */
function defaultArtifactRoot(worktreePath, runId) {
  const safe = String(runId || 'run').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'run';
  return path.join(path.resolve(worktreePath), '.claude', 'run-artifacts', safe);
}

/**
 * @param {string} policy
 * @returns {boolean}
 */
function isValidCleanupPolicy(policy) {
  return CLEANUP_POLICIES.includes(policy);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {string[]} errors
 */
function requireNonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`missing_${label}`);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {string[]} errors
 */
function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    errors.push(`invalid_${label}`);
  }
}

/**
 * @param {unknown} contract
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateRunWorkdirContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') {
    return { ok: false, errors: ['contract_must_be_object'] };
  }
  const c = /** @type {Record<string, unknown>} */ (contract);

  const required = [
    'schema_version',
    'run_id',
    'repo_root',
    'base_ref',
    'worktree_path',
    'artifact_root',
    'cleanup_policy',
    'created_at',
    'worktree_isolated',
    'run_cwd',
    'execution_state',
    'business_artifacts',
  ];
  for (const key of required) {
    if (c[key] == null || c[key] === '') errors.push(`missing_${key}`);
  }

  if (c.schema_version !== CONTRACT_SCHEMA_VERSION) {
    errors.push('invalid_schema_version');
  }
  requireNonEmptyString(c.run_id, 'run_id', errors);
  requireNonEmptyString(c.repo_root, 'repo_root', errors);
  requireNonEmptyString(c.worktree_path, 'worktree_path', errors);
  requireNonEmptyString(c.artifact_root, 'artifact_root', errors);
  requireNonEmptyString(c.run_cwd, 'run_cwd', errors);

  if (typeof c.cleanup_policy === 'string' && !isValidCleanupPolicy(c.cleanup_policy)) {
    errors.push('invalid_cleanup_policy');
  }
  if (typeof c.worktree_isolated !== 'boolean') {
    errors.push('invalid_worktree_isolated');
  }
  if (c.retained_after_failure != null && typeof c.retained_after_failure !== 'boolean') {
    errors.push('invalid_retained_after_failure');
  }
  if (c.trace_refs != null && !Array.isArray(c.trace_refs)) {
    errors.push('invalid_trace_refs');
  }

  const exec = c.execution_state;
  if (exec == null || typeof exec !== 'object') {
    errors.push('invalid_execution_state');
  } else {
    const es = /** @type {Record<string, unknown>} */ (exec);
    requireNonEmptyString(es.run_cwd, 'execution_state_run_cwd', errors);
    requireNonEmptyString(es.worktree_path, 'execution_state_worktree_path', errors);
    if (typeof es.cleanup_policy === 'string' && !isValidCleanupPolicy(es.cleanup_policy)) {
      errors.push('invalid_execution_state_cleanup_policy');
    }
    requireStringArray(es.mutable_paths, 'execution_state_mutable_paths', errors);
  }

  const biz = c.business_artifacts;
  if (biz == null || typeof biz !== 'object') {
    errors.push('invalid_business_artifacts');
  } else {
    const ba = /** @type {Record<string, unknown>} */ (biz);
    requireNonEmptyString(ba.artifact_root, 'business_artifacts_artifact_root', errors);
    if (ba.trace_refs != null && !Array.isArray(ba.trace_refs)) {
      errors.push('invalid_business_artifacts_trace_refs');
    }
    requireStringArray(ba.read_only_paths, 'business_artifacts_read_only_paths', errors);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * @param {{
 *   run_id: string,
 *   repo_root: string,
 *   base_ref?: string,
 *   worktree_path: string,
 *   artifact_root?: string,
 *   cleanup_policy?: string,
 *   created_at?: string,
 *   retained_after_failure?: boolean,
 *   trace_refs?: unknown[],
 *   worktree_isolated?: boolean,
 *   run_cwd?: string,
 * }} input
 */
function buildRunWorkdirContract(input) {
  const runId = String(input.run_id || '').trim();
  const repoRoot = path.resolve(String(input.repo_root || ''));
  const worktreePath = path.resolve(String(input.worktree_path || ''));
  const cleanupPolicy = input.cleanup_policy || 'retain';
  if (input.cleanup_policy != null && !isValidCleanupPolicy(cleanupPolicy)) {
    return { ok: false, errors: ['invalid_cleanup_policy'] };
  }

  const contract = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    run_id: runId,
    repo_root: repoRoot,
    base_ref: String(input.base_ref || 'HEAD'),
    worktree_path: worktreePath,
    artifact_root: input.artifact_root
      ? path.resolve(String(input.artifact_root))
      : defaultArtifactRoot(worktreePath, runId),
    cleanup_policy: cleanupPolicy,
    created_at: input.created_at || new Date().toISOString(),
    retained_after_failure: input.retained_after_failure !== false,
    trace_refs: Array.isArray(input.trace_refs) ? input.trace_refs : [],
    worktree_isolated: input.worktree_isolated !== false,
    run_cwd: path.resolve(input.run_cwd || worktreePath),
    execution_state: {
      run_cwd: path.resolve(input.run_cwd || worktreePath),
      worktree_path: worktreePath,
      cleanup_policy: cleanupPolicy,
      mutable_paths: [],
    },
    business_artifacts: {
      artifact_root: '',
      trace_refs: [],
      read_only_paths: [],
    },
  };

  contract.execution_state.mutable_paths = [
    contract.execution_state.run_cwd,
    contract.artifact_root,
  ];
  contract.business_artifacts.artifact_root = contract.artifact_root;
  contract.business_artifacts.trace_refs = contract.trace_refs;
  contract.business_artifacts.read_only_paths = [contract.repo_root];

  const validated = validateRunWorkdirContract(contract);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  return { ok: true, contract };
}

/**
 * @param {object} binding W1 worktree-binding.json payload
 * @param {{ cleanup_policy?: string, trace_refs?: unknown[] }} [overrides]
 */
function contractFromBinding(binding, overrides = {}) {
  if (!binding || typeof binding !== 'object') {
    return { ok: false, errors: ['invalid_binding'] };
  }
  return buildRunWorkdirContract({
    run_id: binding.task_id,
    repo_root: binding.repo_root,
    base_ref: binding.base_ref || 'HEAD',
    worktree_path: binding.worktree_path,
    cleanup_policy: overrides.cleanup_policy,
    trace_refs: overrides.trace_refs,
    worktree_isolated: true,
    run_cwd: binding.worktree_path,
    created_at: binding.written_at,
  });
}

/**
 * @param {string} cwd worktree or repo path
 * @returns {object | null}
 */
function readRunWorkdirContractFile(cwd) {
  const p = path.join(path.resolve(cwd), CONTRACT_REL_PATH);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} worktreePath
 * @returns {object | null}
 */
function readWorktreeBindingFile(worktreePath) {
  const p = path.join(path.resolve(worktreePath), BINDING_REL_PATH);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} cwd
 * @returns {{ ok: true, contract: object, source: 'contract' | 'binding' } | { ok: false, errors: string[] }}
 */
function readRunWorkdirContract(cwd) {
  const dir = path.resolve(cwd);
  const fromFile = readRunWorkdirContractFile(dir);
  if (fromFile) {
    const validated = validateRunWorkdirContract(fromFile);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    return { ok: true, contract: fromFile, source: 'contract' };
  }

  const binding = readWorktreeBindingFile(dir);
  if (binding) {
    const built = contractFromBinding(binding);
    if (!built.ok) return built;
    return { ok: true, contract: built.contract, source: 'binding' };
  }

  return { ok: false, errors: ['contract_not_found'] };
}

/**
 * @param {string} worktreePath
 * @param {object} contract
 */
function writeRunWorkdirContract(worktreePath, contract) {
  const validated = validateRunWorkdirContract(contract);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  const root = path.resolve(worktreePath);
  const dir = path.join(root, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(contract.artifact_root, { recursive: true });
  fs.writeFileSync(
    path.join(root, CONTRACT_REL_PATH),
    `${JSON.stringify(contract, null, 2)}\n`,
    'utf8',
  );
  return { ok: true, path: path.join(root, CONTRACT_REL_PATH) };
}

/**
 * Resolved cwd for an isolated run — never implicit repo root when isolated.
 * @param {{ worktree_isolated?: boolean, repo_root?: string, worktree_path?: string, run_cwd?: string }} contract
 * @returns {string}
 */
function resolveRunCwdFromContract(contract) {
  if (!contract || contract.worktree_isolated !== true) {
    return path.resolve(contract?.repo_root || process.cwd());
  }
  return path.resolve(contract.run_cwd || contract.worktree_path);
}

/**
 * @param {object} contract
 * @returns {string}
 */
function formatRunWorkdirContractText(contract) {
  const validated = validateRunWorkdirContract(contract);
  if (!validated.ok) {
    return `Run workdir contract (invalid)\n  errors: ${validated.errors.join(', ')}`;
  }
  const mutablePaths = contract.execution_state.mutable_paths;
  const readOnlyPaths = contract.business_artifacts.read_only_paths;
  const lines = [
    'Run workdir contract',
    `  run_id:                 ${contract.run_id}`,
    `  worktree_isolated:      ${contract.worktree_isolated}`,
    `  repo_root (read-only):  ${contract.repo_root}`,
    `  worktree_path:          ${contract.worktree_path}`,
    `  run_cwd:                ${contract.run_cwd}`,
    `  artifact_root:          ${contract.artifact_root}`,
    `  cleanup_policy:         ${contract.cleanup_policy}`,
    `  retained_after_failure: ${contract.retained_after_failure}`,
    '  execution_state (mutable):',
    ...mutablePaths.map((p) => `    - ${p}`),
    '  business_artifacts (read-only source):',
    ...readOnlyPaths.map((p) => `    - ${p}`),
  ];
  if (contract.trace_refs?.length) {
    lines.push(`  trace_refs:             ${contract.trace_refs.length} ref(s)`);
  }
  return lines.join('\n');
}

module.exports = {
  CONTRACT_REL_PATH,
  CONTRACT_SCHEMA_VERSION,
  BINDING_REL_PATH,
  CLEANUP_POLICIES,
  defaultArtifactRoot,
  isValidCleanupPolicy,
  validateRunWorkdirContract,
  buildRunWorkdirContract,
  contractFromBinding,
  readRunWorkdirContractFile,
  readRunWorkdirContract,
  writeRunWorkdirContract,
  resolveRunCwdFromContract,
  formatRunWorkdirContractText,
};
