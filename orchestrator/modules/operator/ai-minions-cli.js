#!/usr/bin/env node
/**
 * Product CLI router — ai-minions init/start (v0.18 alpha).
 * Wraps existing install + runner launch paths; no duplicate SoT.
 */

'use strict';

const path = require('path');
const os = require('os');

const { formatPreflightText } = require('./runner-preflight');
const { launchRun } = require('./runner-launcher');
const {
  parseCommonArgs,
  parseMaxIterations,
  resolveModelPolicyOption,
} = require('./runner-tui-cli');
const {
  buildRoleRoutingPreview,
  formatRoleRoutingText,
} = require('../../runner-model-routing');
const { printAiMinionsCliHelp } = require('./operator-cli-help');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-ai-minions.mjs');

const PLANNED_ALPHA_COMMANDS = new Set([
  'status',
  'explain',
  'doctor',
  'evidence',
  'context',
  'resume',
  'result',
]);

/**
 * @param {string | undefined} cwd
 */
function resolveProjectRoot(cwd) {
  return cwd ? path.resolve(String(cwd)) : process.cwd();
}

/**
 * @param {string[]} argv
 */
function parseAiMinionsArgs(argv) {
  const out = parseCommonArgs(argv);
  out.json = argv.includes('--json');
  out.noInstall = argv.includes('--no-install');
  return out;
}

/**
 * @param {string} cmd
 * @returns {string}
 */
function formatPlannedCommandMessage(cmd) {
  const hints = {
    status: 'npm run runner:tui -- status --run-id <task_id>',
    explain: 'npm run explain-run -- --run-id <task_id>',
    doctor: 'see docs/orchestrator/pre-run-checklist.md and npm run runner:tui -- preflight',
    evidence: 'npm run control-plane:tui -- --run-id <task_id>',
    context: 'see docs/orchestrator/context-package-contract.md',
    resume: 'not implemented — inspect traces + explain-run',
    result: 'npm run runner:tui -- status --run-id <task_id> (result alias)',
  };
  return [
    `${cmd}: not implemented in v0.18 alpha (init/start slice only).`,
    `next_safe_action: ${hints[cmd] || 'npm run ai-minions -- --help'}`,
  ].join('\n');
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/install-ai-minions.mjs').runInstallAiMinions>>} report
 * @returns {string}
 */
function formatInitText(report) {
  const configDir = path.join(report.repo_root, '.ai-minions');
  const configPaths = [
    path.join(configDir, 'model-policy.yaml'),
    path.join(configDir, 'model_policy.json'),
    path.join(configDir, 'install-profile.json'),
  ];
  const failures = report.checks.filter((c) => c.status === 'fail');
  const warnings = report.checks.filter((c) => c.status === 'warn');

  /** @type {string | null} */
  let provider = null;
  if (report.discovery && report.discovery.backends && report.discovery.backends.length) {
    provider = report.discovery.backends[0].backend_id;
  }

  const lines = [
    'ai-minions init',
    `  config_dir:       ${configDir}`,
    `  config_paths:`,
    ...configPaths.map((p) => `    - ${p}`),
    `  model_policy:     ${report.model_policy ?? '(not set)'}`,
    `  provider:         ${provider ?? '(unknown)'}`,
    `  phase:            ${report.phase}`,
    `  ok:               ${report.ok}`,
  ];

  if (report.default_model) {
    lines.push(`  default_model:    ${report.default_model}`);
  }

  if (failures.length) {
    lines.push('  missing_prerequisites:');
    for (const f of failures) {
      lines.push(`    - ${f.reason_code}: ${f.message}`);
    }
  } else {
    lines.push('  missing_prerequisites: (none blocking)');
  }

  if (warnings.length) {
    lines.push('  warnings:');
    for (const w of warnings) {
      lines.push(`    - ${w.reason_code}: ${w.message}`);
    }
  }

  lines.push(`  next_safe_action: ${deriveInitNextSafeAction(report)}`);
  return lines.join('\n');
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/install-ai-minions.mjs').runInstallAiMinions>>} report
 */
function deriveInitNextSafeAction(report) {
  if (report.ok && report.phase === 'config_write') {
    return 'Run: npm run ai-minions -- start --goal "<goal>" (or npm run runner:tui -- preflight first)';
  }
  if (report.phase === 'host_prereqs') {
    return 'Fix host prerequisites, then re-run: npm run ai-minions -- init';
  }
  if (report.phase === 'model_discovery') {
    return 'Ensure Ollama is reachable with local models, then re-run: npm run ai-minions -- init';
  }
  return 'Review blockers above, then re-run: npm run ai-minions -- init';
}

/**
 * @param {string} taskId
 */
function defaultTracePath(taskId) {
  const tracesDir = process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), '.claude', 'metrics', 'traces');
  return path.join(tracesDir, `${taskId}.jsonl`);
}

/**
 * @param {Awaited<ReturnType<typeof launchRun>>} launched
 * @param {{ flowMode?: string }} [meta]
 * @returns {string}
 */
function formatStartText(launched, meta = {}) {
  const flowMode = meta.flowMode || 'single_agent';
  const traceFile = defaultTracePath(String(launched.task_id));
  const lines = [
    'ai-minions start',
    `  run_id:           ${launched.task_id}`,
    `  mode:             ${flowMode}`,
    `  provider:         ${launched.preflight.provider}`,
    `  backend:          ${launched.preflight.model_policy}`,
    `  selected_model:   ${launched.preflight.selected_model ?? '(none)'}`,
    `  terminal_status:  ${launched.terminal_status}`,
    `  trace_file:       ${traceFile}`,
    `  evidence_path:    ${traceFile}`,
    `  next_safe_action: npm run ai-minions -- status --run-id ${launched.task_id} (planned status command) — interim: npm run runner:tui -- status --run-id ${launched.task_id}`,
  ];
  if (launched.result.summary) {
    lines.push(`  summary:          ${launched.result.summary}`);
  }
  return lines.join('\n');
}

/**
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string | null,
 *   install?: boolean,
 *   json?: boolean,
 *   loadInstallModule?: () => Promise<typeof import('../../../../scripts/install-ai-minions.mjs')>,
 * }} [options]
 */
async function runInit(options = {}) {
  const repoRoot = resolveProjectRoot(options.cwd);
  const loadInstall = options.loadInstallModule
    || (() => import(INSTALL_SCRIPT));
  const installMod = await loadInstall();
  const report = await installMod.runInstallAiMinions({
    repoRoot,
    install: options.install !== false,
    modelPolicy: options.modelPolicy ?? null,
  });
  return {
    report,
    text: formatInitText(report),
    exitCode: report.ok ? 0 : 1,
    json: options.json === true ? report : null,
  };
}

/**
 * @param {{
 *   goal: string,
 *   cwd?: string,
 *   flowMode?: string,
 *   modelPolicy?: string,
 *   model?: string,
 *   skipGates?: boolean,
 *   maxIterations?: number | string,
 *   interactive?: boolean,
 *   worktreeIsolated?: boolean,
 *   taskId?: string,
 *   worktreeBaseRef?: string,
 *   launchRunFn?: typeof launchRun,
 * }} options
 */
async function runStart(options) {
  const goal = String(options.goal ?? '').trim();
  if (!goal) {
    const err = new Error('start requires --goal');
    err.code = 'AI_MINIONS_USAGE';
    throw err;
  }

  const maxIterations = options.maxIterations != null
    ? parseMaxIterations(String(options.maxIterations))
    : undefined;
  if (options.maxIterations != null && Number.isNaN(maxIterations)) {
    const err = new Error('--iterations requires a positive integer');
    err.code = 'AI_MINIONS_USAGE';
    throw err;
  }

  const launchRunFn = options.launchRunFn ?? launchRun;
  const launched = await launchRunFn({
    goal,
    cwd: options.cwd,
    flowMode: options.flowMode,
    modelPolicy: options.modelPolicy,
    model: options.model,
    skipStateMcp: options.skipGates === true,
    maxIterations,
    interactive: options.interactive === true,
    worktreeIsolated: options.worktreeIsolated === true,
    taskId: options.taskId,
    worktreeBaseRef: options.worktreeBaseRef,
  });

  return {
    launched,
    preflightText: formatPreflightText(launched.preflight),
    routingText: formatRoleRoutingText(buildRoleRoutingPreview({
      modelPolicy: launched.preflight.model_policy,
      localModel: launched.preflight.selected_model,
      flowMode: options.flowMode,
    })),
    text: formatStartText(launched, { flowMode: options.flowMode }),
    exitCode: launched.terminal_status === 'done' ? 0 : 3,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    printAiMinionsCliHelp();
    process.exit(argv.length ? 0 : 1);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const opts = parseAiMinionsArgs(rest);

  if (PLANNED_ALPHA_COMMANDS.has(cmd)) {
    console.error(formatPlannedCommandMessage(cmd));
    process.exit(1);
  }

  if (cmd === 'init') {
    if (opts.modelPolicy != null && !['local_only', 'remote_ok'].includes(String(opts.modelPolicy))) {
      console.error('blocker: unknown --model-policy value (expected local_only or remote_ok)');
      process.exit(1);
    }
    const result = await runInit({
      cwd: opts.cwd,
      modelPolicy: opts.modelPolicy ? String(opts.modelPolicy) : null,
      install: opts.noInstall !== true,
      json: opts.json === true,
    });
    if (result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.report.ok) {
      for (const b of result.report.checks.filter((c) => c.status === 'fail')) {
        console.error(`blocker: ${b.reason_code}`);
      }
    }
    process.exit(result.exitCode);
  }

  if (cmd === 'start') {
    if (!opts.goal) {
      console.error('start requires --goal');
      process.exit(1);
    }
    const modelPolicy = await resolveModelPolicyOption(opts);
    try {
      const result = await runStart({
        goal: String(opts.goal),
        cwd: opts.cwd,
        flowMode: opts.flowMode,
        modelPolicy: modelPolicy ?? (opts.modelPolicy ? String(opts.modelPolicy) : undefined),
        model: opts.model ? String(opts.model) : undefined,
        skipGates: opts.skipGates === true,
        maxIterations: opts.maxIterations,
        interactive: opts.interactive === true,
        worktreeIsolated: opts.worktreeIsolated === true,
        taskId: opts.runId ? String(opts.runId) : undefined,
        worktreeBaseRef: opts.baseRef ? String(opts.baseRef) : undefined,
      });
      console.log(result.preflightText);
      console.log('');
      console.log(result.routingText);
      console.log('');
      console.log(result.text);
      process.exit(result.exitCode);
    } catch (err) {
      if (err && err.preflight) {
        console.error(formatPreflightText(err.preflight));
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      const code = err && err.code;
      if (code === 'AI_MINIONS_USAGE') process.exit(1);
      process.exit(code === 'RUNNER_PREFLIGHT_BLOCKED' || code === 'RUNNER_WORKTREE_BLOCKED' ? 2 : 1);
    }
  }

  console.error(`Unknown command: ${cmd}`);
  printAiMinionsCliHelp();
  process.exit(1);
}

module.exports = {
  REPO_ROOT,
  INSTALL_SCRIPT,
  PLANNED_ALPHA_COMMANDS,
  parseAiMinionsArgs,
  formatInitText,
  formatStartText,
  formatPlannedCommandMessage,
  deriveInitNextSafeAction,
  defaultTracePath,
  runInit,
  runStart,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
