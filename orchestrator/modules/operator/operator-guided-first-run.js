/**
 * Guided first-run CLI — product verbs first-run / smoke / attach (v0.20 beta).
 * Guided CLI only — not production TUI.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { runOperatorDoctor } = require('./operator-doctor-evidence');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const COLLECT_REPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'collect-run-report.mjs');

/**
 * @param {string | undefined} cwd
 */
function resolveRepo(cwd) {
  const { resolveInstallRepoRoot } = require('./ai-minions-cli');
  return resolveInstallRepoRoot(cwd);
}

/** @type {typeof import('./ai-minions-cli').runStart} */
let runStartFn;
function getRunStart() {
  if (!runStartFn) {
    // Lazy require avoids circular dependency at load time.
    runStartFn = require('./ai-minions-cli').runStart;
  }
  return runStartFn;
}

const FIRST_RUN_REASON_CODES = {
  READY: 'FIRST_RUN_READY',
  NEEDS_INIT: 'FIRST_RUN_NEEDS_INIT',
  PROVIDER_BLOCKED: 'FIRST_RUN_PROVIDER_BLOCKED',
  MODEL_BLOCKED: 'FIRST_RUN_MODEL_BLOCKED',
  CONFIG_INVALID: 'FIRST_RUN_CONFIG_INVALID',
  UNSUPPORTED_CWD: 'FIRST_RUN_UNSUPPORTED_CWD',
  UNKNOWN_ERROR: 'FIRST_RUN_UNKNOWN_ERROR',
};

const DEFAULT_SMOKE_GOAL =
  'Beta smoke: list three files in the repo root and stop';

/**
 * @param {string} repoRoot
 */
function hasInitConfig(repoRoot) {
  const policy = path.join(repoRoot, '.ai-minions', 'model_policy.json');
  return fs.existsSync(policy);
}

/**
 * @param {string} repoRoot
 * @returns {{ ok: boolean, reason_code?: string, message?: string }}
 */
function validateTargetRepo(repoRoot) {
  const orchPkg = path.join(repoRoot, 'orchestrator', 'package.json');
  if (!fs.existsSync(orchPkg)) {
    return {
      ok: false,
      reason_code: FIRST_RUN_REASON_CODES.UNSUPPORTED_CWD,
      message:
        'orchestrator/package.json missing — set AI_MINIONS_HOME to clone root or use --cwd',
    };
  }
  return { ok: true };
}

/**
 * @param {Awaited<ReturnType<typeof runOperatorDoctor>>} doctorResult
 * @returns {string}
 */
function classifyDoctorFailure(doctorResult) {
  const fails = doctorResult.report.checks.filter((c) => c.status === 'fail');
  for (const f of fails) {
    const code = String(f.operator_reason_code || f.reason_code || '');
    if (
      code.includes('OLLAMA')
      || code.includes('LOCAL_BACKEND')
      || code.includes('PROVIDER')
    ) {
      return FIRST_RUN_REASON_CODES.PROVIDER_BLOCKED;
    }
    if (code.includes('MODEL')) {
      return FIRST_RUN_REASON_CODES.MODEL_BLOCKED;
    }
    if (code.includes('CONFIG') || code.includes('BOOTSTRAP')) {
      return FIRST_RUN_REASON_CODES.CONFIG_INVALID;
    }
  }
  return FIRST_RUN_REASON_CODES.UNKNOWN_ERROR;
}

/**
 * @param {string} reasonCode
 * @param {boolean} needsInit
 * @returns {string}
 */
function deriveFirstRunNextSafeAction(reasonCode, needsInit) {
  switch (reasonCode) {
    case FIRST_RUN_REASON_CODES.NEEDS_INIT:
      return 'Run: ai-minions init --model-policy local_only';
    case FIRST_RUN_REASON_CODES.READY:
      return 'Run: ai-minions smoke --model-policy local_only';
    case FIRST_RUN_REASON_CODES.PROVIDER_BLOCKED:
      return 'Ensure Ollama is reachable, then re-run: ai-minions doctor --model-policy local_only';
    case FIRST_RUN_REASON_CODES.MODEL_BLOCKED:
      return 'Fix local model selection, then re-run: ai-minions doctor --model-policy local_only';
    case FIRST_RUN_REASON_CODES.CONFIG_INVALID:
      return 'Fix bootstrap/config blockers, then re-run: ai-minions first-run';
    case FIRST_RUN_REASON_CODES.UNSUPPORTED_CWD:
      return 'Set AI_MINIONS_HOME to ai-minions clone root or pass --cwd <clone-root>';
    default:
      return needsInit
        ? 'Run: ai-minions init --model-policy local_only'
        : 'Run: ai-minions smoke --model-policy local_only';
  }
}

/**
 * @param {{
 *   ok: boolean,
 *   reason_code: string,
 *   repo_root: string,
 *   doctor_ok: boolean,
 *   config_present: boolean,
 *   next_safe_action: string,
 * }} ctx
 */
function formatFirstRunText(ctx) {
  const lines = [
    'ai-minions first-run',
    `  ok:               ${ctx.ok}`,
    `  reason_code:      ${ctx.reason_code}`,
    `  repo_root:        ${ctx.repo_root}`,
    `  doctor_ok:        ${ctx.doctor_ok}`,
    `  config_present:   ${ctx.config_present}`,
    `  next_safe_action: ${ctx.next_safe_action}`,
    '',
    '  guided_chain:',
    '    1. ai-minions init --model-policy local_only   (if config missing)',
    '    2. ai-minions doctor --model-policy local_only',
    '    3. ai-minions smoke --model-policy local_only',
    '    4. ai-minions status --run-id <task_id>',
    '    5. ai-minions attach --run-id <task_id>',
    '',
    '  Not claimed: production TUI · Web UI · durable resume',
    '  Legacy: npm run runner:tui (advanced) · npm run ai-minions (dev fallback from orchestrator/)',
  ];
  return lines.join('\n');
}

/**
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string,
 *   install?: boolean,
 *   json?: boolean,
 *   runOperatorDoctor?: typeof runOperatorDoctor,
 * }} [options]
 */
async function runFirstRun(options = {}) {
  const repoRoot = resolveRepo(options.cwd);
  const validate = validateTargetRepo(repoRoot);
  if (!validate.ok) {
    const reason_code = validate.reason_code ?? FIRST_RUN_REASON_CODES.UNSUPPORTED_CWD;
    const next_safe_action = deriveFirstRunNextSafeAction(reason_code, true);
    const payload = {
      ok: false,
      reason_code,
      repo_root: repoRoot,
      doctor_ok: false,
      config_present: hasInitConfig(repoRoot),
      next_safe_action,
      message: validate.message,
    };
    return {
      ok: false,
      exitCode: 2,
      reason_code,
      text: formatFirstRunText(payload),
      json: options.json === true ? payload : null,
    };
  }

  const doctorFn = options.runOperatorDoctor ?? runOperatorDoctor;
  const doctor = await doctorFn({
    repoRoot,
    cwd: options.cwd,
    modelPolicy: options.modelPolicy ?? 'local_only',
    install: options.install !== false,
  });

  const configPresent = hasInitConfig(repoRoot);
  if (!doctor.ok) {
    const reason_code = classifyDoctorFailure(doctor);
    const next_safe_action = deriveFirstRunNextSafeAction(reason_code, !configPresent);
    const payload = {
      ok: false,
      reason_code,
      repo_root: repoRoot,
      doctor_ok: false,
      config_present: configPresent,
      next_safe_action,
    };
    return {
      ok: false,
      exitCode: 2,
      reason_code,
      text: formatFirstRunText(payload),
      json: options.json === true ? payload : null,
    };
  }

  const reason_code = configPresent
    ? FIRST_RUN_REASON_CODES.READY
    : FIRST_RUN_REASON_CODES.NEEDS_INIT;
  const next_safe_action = deriveFirstRunNextSafeAction(reason_code, !configPresent);
  const payload = {
    ok: true,
    reason_code,
    repo_root: repoRoot,
    doctor_ok: true,
    config_present: configPresent,
    next_safe_action,
  };
  return {
    ok: true,
    exitCode: 0,
    reason_code,
    text: formatFirstRunText(payload),
    json: options.json === true ? payload : null,
  };
}

/**
 * @param {{
 *   goal?: string,
 *   cwd?: string,
 *   modelPolicy?: string,
 *   model?: string,
 *   skipGates?: boolean,
 *   maxIterations?: number | string,
 *   json?: boolean,
 *   runStart?: typeof getRunStart extends () => infer R ? R : never,
 * }} [options]
 */
async function runSmoke(options = {}) {
  const goal = String(options.goal ?? DEFAULT_SMOKE_GOAL).trim();
  const runStart = options.runStart ?? getRunStart();
  const result = await runStart({
    goal,
    cwd: options.cwd,
    modelPolicy: options.modelPolicy ?? 'local_only',
    model: options.model,
    skipGates: options.skipGates !== false,
    maxIterations: options.maxIterations ?? 1,
  });
  return {
    ...result,
    reason_code: result.exitCode === 0 ? 'SMOKE_OK' : 'SMOKE_BLOCKED',
  };
}

/**
 * @param {{
 *   runId?: string,
 *   cwd?: string,
 *   outDir?: string,
 *   json?: boolean,
 *   skipPanels?: boolean,
 *   loadCollectModule?: () => Promise<typeof import('../../../../scripts/collect-run-report.mjs')>,
 * }} [options]
 */
async function runAttach(options = {}) {
  const runId = options.runId ? String(options.runId).trim() : '';
  if (!runId) {
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'ATTACH_RUN_ID_MISSING',
      text: 'attach requires --run-id <task_id>\nnext_safe_action: ai-minions status --run-id <task_id>',
      json: null,
    };
  }

  const repoRoot = resolveRepo(options.cwd);
  const loadMod = options.loadCollectModule
    ?? (() => import(COLLECT_REPORT_SCRIPT));
  const mod = await loadMod();
  const report = await mod.runCollectRunReport({
    taskId: runId,
    repoRoot,
    outDir: options.outDir,
    skipPanels: options.skipPanels === true,
  });

  const text = mod.formatReportText(report);
  if (!report.ok) {
    mod.writeBlockersToStderr(report);
  }

  return {
    ok: report.ok,
    exitCode: report.ok ? 0 : 1,
    reason_code: report.ok ? 'ATTACH_OK' : 'ATTACH_BLOCKED',
    text,
    json: options.json === true ? report : null,
    report,
  };
}

module.exports = {
  FIRST_RUN_REASON_CODES,
  DEFAULT_SMOKE_GOAL,
  hasInitConfig,
  validateTargetRepo,
  classifyDoctorFailure,
  deriveFirstRunNextSafeAction,
  formatFirstRunText,
  runFirstRun,
  runSmoke,
  runAttach,
};
