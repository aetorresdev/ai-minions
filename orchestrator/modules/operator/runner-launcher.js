'use strict';

/**
 * Launch orchestrator runs from the runner TUI/CLI (preflight + execute + status).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildRunPreflight, formatPreflightText } = require('./runner-preflight');
const { configureLocalModelPolicy, resetLocalModelPolicy } = require('../../local-model-policy');
const { createIsolatedWorktree } = require('../worktree/worktree-isolation');
const { emitWorkspaceRunCwdBound } = require('../worktree/trace-workspace-lifecycle');
const { resolveRunCwdFromContract, readRunWorkdirContract } = require('../worktree/run-workdir-contract');
const { randomUUID } = require('crypto');
const { parseJsonl } = require('../budget/token-trace-report');
const { buildRunOutcomeSummary } = require('../trace/run-outcome-summary');
const {
  extractRoleRoutingFromTrace,
  formatTraceRoleRoutingText,
} = require('../../runner-model-routing');

/**
 * @param {string[]} keys
 */
function saveEnv(keys) {
  /** @type {Record<string, string | undefined>} */
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  return prev;
}

/**
 * @param {Record<string, string | undefined>} prev
 */
function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/**
 * @param {{ done?: boolean, taskId?: string, summary?: string, iterations?: number }} result
 * @returns {'done' | 'failed' | 'running'}
 */
function terminalStatusFromRunResult(result) {
  if (!result || typeof result !== 'object') return 'failed';
  return result.done ? 'done' : 'failed';
}

/**
 * @param {{
 *   goal: string,
 *   cwd?: string,
 *   flowMode?: string,
 *   modelPolicy?: string,
 *   model?: string | null,
 *   skipStateMcp?: boolean,
 *   maxIterations?: number,
 *   taskId?: string,
 *   worktreeIsolated?: boolean,
 *   worktreeBaseRef?: string,
 *   skipBackendCheck?: boolean,
 *   interactive?: boolean,
 *   localProvider?: string | null,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   run?: Function,
 *   buildRunPreflight?: typeof buildRunPreflight,
 * }} options
 */
async function launchRun(options) {
  const goal = String(options.goal ?? '').trim();
  if (!goal) throw new Error('launchRun requires a non-empty goal');

  const preflightFn = options.buildRunPreflight ?? buildRunPreflight;
  const preflight = await preflightFn({
    cwd: options.cwd,
    modelPolicy: options.modelPolicy,
    model: options.model,
    interactive: options.interactive === true,
    localProvider: options.localProvider,
    ollamaHost: options.ollamaHost,
    ollamaPort: options.ollamaPort,
    ollamaBaseUrl: options.ollamaBaseUrl,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime,
  });

  if (!preflight.ok) {
    const err = new Error(`Run preflight blocked: ${preflight.blockers.join('; ') || 'unknown'}`);
    err.preflight = preflight;
    err.code = 'RUNNER_PREFLIGHT_BLOCKED';
    throw err;
  }

  const repoCwd = options.cwd || process.cwd();
  let runCwd = repoCwd;
  /** @type {object | null} */
  let worktree = null;

  if (options.worktreeIsolated === true) {
    const taskId = options.taskId || `task-${randomUUID().slice(0, 8)}`;
    const created = createIsolatedWorktree({
      repoRoot: repoCwd,
      primaryCwd: repoCwd,
      taskId,
      baseRef: options.worktreeBaseRef,
    });
    if (!created.ok) {
      const err = new Error(`Worktree isolation failed: ${created.error}${created.detail ? ` (${created.detail})` : ''}`);
      err.code = 'RUNNER_WORKTREE_BLOCKED';
      err.worktree = created;
      throw err;
    }
    runCwd = created.contract
      ? resolveRunCwdFromContract(created.contract)
      : created.worktree_path;
    if (path.resolve(runCwd) === path.resolve(repoCwd)) {
      const err = new Error('Worktree isolation requires run cwd distinct from repo root');
      err.code = 'RUNNER_WORKTREE_BLOCKED';
      err.worktree = created;
      throw err;
    }
    worktree = created;
    options.taskId = taskId;
    if (created.contract) {
      emitWorkspaceRunCwdBound(taskId, {
        task_id: taskId,
        repo_root: created.repo_root,
        worktree_path: created.worktree_path,
        branch: created.branch,
        base_ref: created.contract.base_ref,
        run_cwd: runCwd,
        artifact_root: created.contract.artifact_root,
        cleanup_policy: created.contract.cleanup_policy,
      });
      const refreshed = readRunWorkdirContract(created.worktree_path);
      if (refreshed.ok) {
        created.contract = refreshed.contract;
        worktree = created;
      }
    }
  }

  // Root path until run-control physical slice moves orchestrator.js.
  const runFn = options.run ?? require("../../orchestrator").run;
  const envKeys = ['ORCH_MODEL_MODE', 'ORCH_ALLOW_REMOTE_MODELS', 'ORCH_NON_INTERACTIVE', 'OLLAMA_HOST', 'OLLAMA_PORT'];
  const prevEnv = saveEnv(envKeys);

  try {
    if (preflight.model_policy === 'local_only') {
      process.env.ORCH_MODEL_MODE = 'local_only';
      process.env.ORCH_NON_INTERACTIVE = '1';
      if (preflight.resolved_endpoint) {
        process.env.OLLAMA_HOST = preflight.resolved_endpoint.host;
        process.env.OLLAMA_PORT = String(preflight.resolved_endpoint.port);
      }
    }

    configureLocalModelPolicy({
      cliModel: options.model ?? null,
      cwd: runCwd,
      skipBackendCheck: options.skipBackendCheck === true,
      selectionResult: preflight.selection_result,
      endpointMeta: preflight.resolved_endpoint,
    });

    const result = await runFn(goal, {
      cwd: runCwd,
      flowMode: options.flowMode || 'single_agent',
      skipStateMcp: options.skipStateMcp === true,
      ...(options.maxIterations != null ? { maxIterations: options.maxIterations } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.model ? { localModel: options.model } : {}),
    });

    const terminal_status = terminalStatusFromRunResult(result);
    return {
      preflight,
      result,
      terminal_status,
      task_id: result.taskId,
      worktree,
      run_cwd: runCwd,
      run_workdir_contract: worktree?.contract || null,
    };
  } finally {
    restoreEnv(prevEnv);
    resetLocalModelPolicy();
  }
}

/**
 * @param {string} taskId
 * @param {{ tracesDir?: string }} [options]
 */
function loadRunStatusFromTrace(taskId, options = {}) {
  const tracesDir = options.tracesDir
    || process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), '.claude', 'metrics', 'traces');
  const filePath = path.join(tracesDir, `${taskId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return {
      task_id: taskId,
      terminal_status: 'unknown',
      trace_file: filePath,
      summary: null,
      error: 'trace file not found',
      role_routing: null,
    };
  }

  const { rows } = parseJsonl(fs.readFileSync(filePath, 'utf8'), { validateLines: false });
  const ros = buildRunOutcomeSummary(rows, { trace_file: filePath });
  const sessionEnd = rows.find((r) => r && r.event === 'session_end');
  const terminal_status = sessionEnd && sessionEnd.done === true
    ? 'done'
    : sessionEnd && sessionEnd.done === false
      ? 'failed'
      : 'running';

  const role_routing = extractRoleRoutingFromTrace(rows);

  return {
    task_id: taskId,
    terminal_status,
    trace_file: filePath,
    summary: ros,
    done: ros.what?.done,
    iterations: ros.what?.iterations,
    role_routing,
  };
}

/**
 * @param {ReturnType<typeof loadRunStatusFromTrace>} status
 * @returns {string}
 */
function formatRunStatusText(status) {
  const lines = [
    'Run status',
    `  task_id:          ${status.task_id}`,
    `  terminal_status:  ${status.terminal_status}`,
    `  trace_file:       ${status.trace_file}`,
  ];
  if (status.error) lines.push(`  error:            ${status.error}`);
  if (status.done != null) lines.push(`  done:             ${status.done}`);
  if (status.iterations != null) lines.push(`  iterations:       ${status.iterations}`);
  return lines.join('\n');
}

module.exports = {
  launchRun,
  loadRunStatusFromTrace,
  formatRunStatusText,
  formatPreflightText,
  formatTraceRoleRoutingText,
  terminalStatusFromRunResult,
  saveEnv,
  restoreEnv,
};
