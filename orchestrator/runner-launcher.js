'use strict';

/**
 * Launch orchestrator runs from the runner TUI/CLI (preflight + execute + status).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildRunPreflight, formatPreflightText } = require('./runner-preflight');
const { configureLocalModelPolicy, resetLocalModelPolicy } = require('./local-model-policy');
const { parseJsonl } = require('./token-trace-report');
const { buildRunOutcomeSummary } = require('./run-outcome-summary');
const {
  extractRoleRoutingFromTrace,
  formatTraceRoleRoutingText,
} = require('./runner-model-routing');

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
 *   skipBackendCheck?: boolean,
 *   interactive?: boolean,
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
  });

  if (!preflight.ok) {
    const err = new Error(`Run preflight blocked: ${preflight.blockers.join('; ') || 'unknown'}`);
    err.preflight = preflight;
    err.code = 'RUNNER_PREFLIGHT_BLOCKED';
    throw err;
  }

  const runFn = options.run ?? require('./orchestrator').run;
  const envKeys = ['ORCH_MODEL_MODE', 'ORCH_ALLOW_REMOTE_MODELS', 'ORCH_NON_INTERACTIVE'];
  const prevEnv = saveEnv(envKeys);

  try {
    if (preflight.model_policy === 'local_only') {
      process.env.ORCH_MODEL_MODE = 'local_only';
      process.env.ORCH_NON_INTERACTIVE = '1';
    }

    configureLocalModelPolicy({
      cliModel: options.model ?? null,
      cwd: options.cwd ?? null,
      skipBackendCheck: options.skipBackendCheck === true,
    });

    const result = await runFn(goal, {
      cwd: options.cwd,
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
