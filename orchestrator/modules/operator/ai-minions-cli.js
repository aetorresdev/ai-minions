#!/usr/bin/env node
/**
 * Product CLI router — ai-minions init/start/status/explain (v0.18 alpha).
 * Wraps existing install + runner launch paths; no duplicate SoT.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const { formatPreflightText } = require('./runner-preflight');
const { launchRun } = require('./runner-launcher');
const {
  parseCommonArgs,
  parseMaxIterations,
  resolveModelPolicyOption,
  endpointOptionsFromCli,
} = require('./runner-tui-cli');
const {
  buildRoleRoutingPreview,
  formatRoleRoutingText,
} = require('../../runner-model-routing');
const { printAiMinionsCliHelp } = require('./operator-cli-help');
const { runOperatorStatus, runOperatorExplain } = require('./operator-trace-command');
const { runOperatorReport } = require('./operator-run-report');
const { runOperatorEvidenceTui } = require('./operator-evidence-tui');
const { runOperatorDoctor, runOperatorEvidence } = require('./operator-doctor-evidence');
const { runOperatorContext, runOperatorResume } = require('./operator-context-resume');
const { resolveUseColorForCli } = require('./terminal-style');
const {
  runOperatorVersion,
  runOperatorAbout,
  formatVersionOneLine,
  buildAboutInfo,
} = require('./operator-about');
const { resolvePolicyCwd } = require('../model-runtime/local-runtime-endpoint');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-ai-minions.mjs');
const FRICTION_LOG_LIB = path.join(REPO_ROOT, 'scripts', 'lib', 'cohort-ux-friction-log.mjs');

/**
 * Best-effort dispatch boundary for explicitly enabled cohort instrumentation.
 * Only the structured handler result crosses this boundary; argv is never accepted.
 *
 * @param {string} command
 * @param {object} result
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   loadFrictionModule?: () => Promise<{ appendProductCliFrictionEvent: Function }>,
 *   warn?: (line: string) => void,
 * }} [options]
 */
async function recordProductCliFriction(command, result, options = {}) {
  const env = options.env ?? process.env;
  const configuredPath = env.AI_MINIONS_COHORT_FRICTION_LOG;
  if (configuredPath == null || configuredPath === '') {
    return { ok: true, enabled: false };
  }

  const warn = options.warn ?? ((line) => console.error(line));
  try {
    const loadFrictionModule = options.loadFrictionModule
      ?? (() => import(pathToFileURL(FRICTION_LOG_LIB).href));
    const friction = await loadFrictionModule();
    const recorded = friction.appendProductCliFrictionEvent({
      command,
      result,
      env,
    });
    if (!recorded.ok) {
      warn(`warning: ${recorded.reason_code}`);
    }
    return recorded;
  } catch {
    const recorded = {
      ok: false,
      enabled: true,
      reason_code: 'FRICTION_INSTRUMENTATION_LOAD_FAILED',
    };
    warn(`warning: ${recorded.reason_code}`);
    return recorded;
  }
}

/**
 * @param {string} command
 * @param {{ exitCode?: number }} result
 */
async function exitProductCli(command, result) {
  await recordProductCliFriction(command, result);
  process.exit(Number.isInteger(result.exitCode) ? result.exitCode : 1);
}

/**
 * @param {string | undefined} cwd
 * @returns {string}
 */
function resolveConfigRepoRoot(cwd) {
  return resolvePolicyCwd(resolveInstallRepoRoot(cwd));
}

/**
 * Resolve config-write target for init (operator project cwd, not product install home).
 * @param {string | undefined} cwd
 */
function resolveInstallRepoRoot(cwd) {
  const candidate = cwd ? path.resolve(String(cwd)) : process.cwd();

  if (fs.existsSync(path.join(candidate, 'orchestrator', 'package.json'))) {
    return candidate;
  }

  if (
    path.basename(candidate) === 'orchestrator'
    && fs.existsSync(path.join(candidate, 'package.json'))
    && fs.existsSync(path.join(path.dirname(candidate), 'scripts', 'install-ai-minions.mjs'))
  ) {
    return path.dirname(candidate);
  }

  return candidate;
}

/**
 * @param {string[]} argv
 */
function parseAiMinionsArgs(argv) {
  const out = parseCommonArgs(argv);
  out.json = argv.includes('--json');
  out.noInstall = argv.includes('--no-install');
  out.live = argv.includes('--live');
  out.latest = argv.includes('--latest');
  out.migrateModelPolicy = argv.includes('--migrate-model-policy');
  out.force = argv.includes('--force');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run' && argv[i + 1] && !out.runId) out.runId = argv[++i];
    else if (a === '--out' && argv[i + 1]) out.out = argv[++i];
  }
  return out;
}

/**
 * @param {string} cmd
 * @returns {string}
 */
function formatPlannedCommandMessage(cmd) {
  return [
    `${cmd}: not implemented in this alpha slice.`,
    'next_safe_action: ai-minions --help',
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
    `  config_target:    ${report.repo_root}`,
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
    return 'Run: ai-minions start --goal "<goal>" (or npm run runner:tui -- preflight first)';
  }
  if (report.phase === 'host_prereqs') {
    const codes = new Set(
      report.checks.filter((c) => c.status === 'fail').map((c) => c.reason_code),
    );
    if (codes.has('INSTALL_RUFF_MISSING') || codes.has('INSTALL_UV_MISSING')) {
      return 'Install host tools: brew install ruff uv — then re-run: ai-minions init';
    }
    return 'Fix host prerequisites (see install output), then re-run: ai-minions init';
  }
  if (report.phase === 'model_discovery') {
    return 'Start Ollama (ollama serve), pull a model, then re-run: ai-minions init';
  }
  return 'Review blockers above, then re-run: ai-minions init';
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
    `  next_safe_action: ai-minions status --run-id ${launched.task_id}`,
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
 *   localProvider?: string,
 *   ollamaHost?: string,
 *   ollamaPort?: string | number,
 *   ollamaBaseUrl?: string,
 *   allowPublicLocalRuntime?: boolean,
 *   model?: string,
 *   migrateModelPolicy?: boolean,
 *   force?: boolean,
 *   loadInstallModule?: () => Promise<typeof import('../../../../scripts/install-ai-minions.mjs')>,
 * }} [options]
 */
async function runInit(options = {}) {
  const repoRoot = resolveInstallRepoRoot(options.cwd);
  const loadInstall = options.loadInstallModule
    || (() => import(INSTALL_SCRIPT));
  const installMod = await loadInstall();
  const report = await installMod.runInstallAiMinions({
    repoRoot,
    install: options.install !== false,
    modelPolicy: options.modelPolicy ?? null,
    localProvider: options.localProvider ?? null,
    ollamaHost: options.ollamaHost ?? null,
    ollamaPort: options.ollamaPort ?? null,
    ollamaBaseUrl: options.ollamaBaseUrl ?? null,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime === true,
    model: options.model ?? null,
    migrateModelPolicy: options.migrateModelPolicy === true,
    force: options.force === true,
  });
  return {
    report,
    text: formatInitText(report),
    exitCode: report.ok ? 0 : 1,
    next_safe_action: deriveInitNextSafeAction(report),
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
 *   localProvider?: string,
 *   ollamaHost?: string,
 *   ollamaPort?: string | number,
 *   ollamaBaseUrl?: string,
 *   allowPublicLocalRuntime?: boolean,
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
    localProvider: options.localProvider,
    ollamaHost: options.ollamaHost,
    ollamaPort: options.ollamaPort,
    ollamaBaseUrl: options.ollamaBaseUrl,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime,
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
    next_safe_action: `ai-minions status --run-id ${launched.task_id}`,
  };
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--version') || argv.includes('-V')) {
    const info = buildAboutInfo({
      resolveRepoRoot: resolveConfigRepoRoot,
    });
    console.log(formatVersionOneLine(info));
    process.exit(0);
  }

  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    const helpColor = resolveUseColorForCli(argv, { json: false });
    printAiMinionsCliHelp({ useColor: helpColor });
    process.exit(argv.length ? 0 : 1);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const opts = parseAiMinionsArgs(rest);
  const useColor = resolveUseColorForCli(rest, { json: opts.json === true });

  if (cmd === 'version') {
    const result = runOperatorVersion({
      cwd: opts.cwd,
      resolveRepoRoot: resolveConfigRepoRoot,
    });
    if (opts.json === true) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    process.exit(result.exitCode);
  }

  if (cmd === 'about') {
    const result = runOperatorAbout({
      cwd: opts.cwd,
      json: opts.json === true,
      resolveRepoRoot: resolveConfigRepoRoot,
    });
    console.log(result.text);
    process.exit(result.exitCode);
  }

  if (cmd === 'doctor') {
    try {
      const result = await runOperatorDoctor({
        repoRoot: resolveInstallRepoRoot(opts.cwd),
        cwd: opts.cwd,
        modelPolicy: opts.modelPolicy ? String(opts.modelPolicy) : undefined,
        live: opts.live === true,
        install: opts.noInstall !== true,
        json: opts.json === true,
        useColor,
        ...endpointOptionsFromCli(opts),
      });
      if (opts.json === true && result.json) {
        console.log(JSON.stringify(result.json, null, 2));
      } else {
        console.log(result.text);
      }
      if (!result.ok) {
        for (const c of result.report.checks.filter((ch) => ch.status === 'fail')) {
          console.error(`blocker: ${c.reason_code || c.operator_reason_code}`);
        }
      }
      return exitProductCli(cmd, result);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
    }
  }

  if (cmd === 'evidence') {
    const result = runOperatorEvidence({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      repoRoot: resolveInstallRepoRoot(opts.cwd),
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'context') {
    const result = runOperatorContext({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'resume') {
    const result = runOperatorResume({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'status' || cmd === 'result') {
    const result = runOperatorStatus({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'explain') {
    const result = runOperatorExplain({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'report') {
    if (!opts.runId && !opts.latest && !opts.file) {
      console.error('report requires --run <id>, --run-id <id>, --latest, or --file <path>');
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
    }
    const result = runOperatorReport({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      latest: opts.latest === true,
      outDir: opts.out ? String(opts.out) : undefined,
      cwd: opts.cwd,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'tui') {
    if (!opts.runId && !opts.latest && !opts.file) {
      console.error('tui requires --run <id>, --run-id <id>, --latest, or --file <path>');
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
    }
    const result = runOperatorEvidenceTui({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      latest: opts.latest === true,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'init') {
    if (opts.modelPolicy != null && !['local_only', 'remote_ok'].includes(String(opts.modelPolicy))) {
      console.error('blocker: unknown --model-policy value (expected local_only or remote_ok)');
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
    }
    const result = await runInit({
      cwd: opts.cwd,
      modelPolicy: opts.modelPolicy ? String(opts.modelPolicy) : null,
      install: opts.noInstall !== true,
      json: opts.json === true,
      model: opts.model ? String(opts.model) : undefined,
      migrateModelPolicy: opts.migrateModelPolicy === true,
      force: opts.force === true,
      ...endpointOptionsFromCli(opts),
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
    return exitProductCli(cmd, result);
  }

  if (cmd === 'first-run') {
    const { runFirstRun } = require('./operator-guided-first-run');
    try {
      const result = await runFirstRun({
        cwd: opts.cwd,
        modelPolicy: opts.modelPolicy ? String(opts.modelPolicy) : undefined,
        install: opts.noInstall !== true,
        json: opts.json === true,
        useColor,
      });
      if (opts.json === true && result.json) {
        console.log(JSON.stringify(result.json, null, 2));
      } else {
        console.log(result.text);
      }
      if (!result.ok && result.reason_code) {
        console.error(`reason_code: ${result.reason_code}`);
      }
      return exitProductCli(cmd, result);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
    }
  }

  if (cmd === 'smoke') {
    const { runSmoke } = require('./operator-guided-first-run');
    const modelPolicy = await resolveModelPolicyOption(opts);
    try {
      const result = await runSmoke({
        goal: opts.goal ? String(opts.goal) : undefined,
        cwd: opts.cwd,
        modelPolicy: modelPolicy ?? (opts.modelPolicy ? String(opts.modelPolicy) : undefined),
        model: opts.model ? String(opts.model) : undefined,
        skipGates: opts.skipGates !== false,
        maxIterations: opts.maxIterations ?? 1,
        useColor,
      });
      console.log(result.preflightText);
      console.log('');
      console.log(result.routingText);
      console.log('');
      console.log(result.smokeText || result.text);
      if (!result.ok) {
        if (result.reason_code) {
          console.error(`reason_code: ${result.reason_code}`);
        }
        if (result.failure_class) {
          console.error(`failure_class: ${result.failure_class}`);
        }
        if (result.blocker_summary) {
          console.error(`blocker_summary: ${result.blocker_summary}`);
        }
        if (result.next_safe_action) {
          console.error(`next_safe_action: ${result.next_safe_action}`);
        }
      }
      return exitProductCli(cmd, result);
    } catch (err) {
      if (err && err.preflight) {
        console.error(formatPreflightText(err.preflight));
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      const code = err && err.code;
      const exitCode = code === 'RUNNER_PREFLIGHT_BLOCKED' || code === 'RUNNER_WORKTREE_BLOCKED'
        ? 2
        : 1;
      return exitProductCli(cmd, { ok: false, exitCode });
    }
  }

  if (cmd === 'attach') {
    const { runAttach } = require('./operator-guided-first-run');
    const result = await runAttach({
      runId: opts.runId ? String(opts.runId) : undefined,
      cwd: opts.cwd,
      json: opts.json === true,
      useColor,
    });
    if (opts.json === true && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.text);
    }
    if (!result.ok && result.reason_code) {
      console.error(`reason_code: ${result.reason_code}`);
    }
    return exitProductCli(cmd, result);
  }

  if (cmd === 'start') {
    if (!opts.goal) {
      console.error('start requires --goal');
      return exitProductCli(cmd, { ok: false, exitCode: 1 });
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
        ...endpointOptionsFromCli(opts),
      });
      console.log(result.preflightText);
      console.log('');
      console.log(result.routingText);
      console.log('');
      console.log(result.text);
      return exitProductCli(cmd, result);
    } catch (err) {
      if (err && err.preflight) {
        console.error(formatPreflightText(err.preflight));
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      const code = err && err.code;
      const exitCode = code === 'RUNNER_PREFLIGHT_BLOCKED' || code === 'RUNNER_WORKTREE_BLOCKED'
        ? 2
        : 1;
      return exitProductCli(cmd, { ok: false, exitCode });
    }
  }

  console.error(`Unknown command: ${cmd}`);
  printAiMinionsCliHelp({ useColor });
  process.exit(1);
}

module.exports = {
  REPO_ROOT,
  INSTALL_SCRIPT,
  parseAiMinionsArgs,
  formatInitText,
  formatStartText,
  formatPlannedCommandMessage,
  deriveInitNextSafeAction,
  defaultTracePath,
  resolveInstallRepoRoot,
  resolveConfigRepoRoot,
  recordProductCliFriction,
  runInit,
  runStart,
  runOperatorStatus,
  runOperatorExplain,
  runOperatorDoctor,
  runOperatorEvidence,
  runOperatorContext,
  runOperatorResume,
  runOperatorVersion,
  runOperatorAbout,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
