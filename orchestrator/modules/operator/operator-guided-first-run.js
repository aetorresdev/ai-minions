/**
 * Guided first-run CLI — product verbs first-run / smoke / attach (v0.20 beta).
 * Guided CLI only — not production TUI.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { runOperatorDoctor } = require('./operator-doctor-evidence');
const { loadRunStatusFromTrace } = require('./runner-launcher');
const { ansi, colorOk } = require('./terminal-style');

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

const SMOKE_REASON_CODES = {
  OK: 'SMOKE_OK',
  BLOCKED: 'SMOKE_BLOCKED',
  OUTPUT_CONTRACT: 'SMOKE_OUTPUT_CONTRACT',
  RUNTIME_FAILED: 'SMOKE_RUNTIME_FAILED',
  PREFLIGHT_BLOCKED: 'SMOKE_PREFLIGHT_BLOCKED',
};

const DEFAULT_SMOKE_GOAL = [
  'MODE: QA',
  'FLOW: single_agent',
  'Beta smoke validation (QA role): read README.md and orchestrator/package.json.',
  'Your reply MUST START with YAML (no markdown fence before it) containing:',
  'files_read:, files_modified:, validation_run:',
  'List README.md and orchestrator/package.json under files_read.',
  'files_modified must only contain paths already listed in files_read.',
  'validation_run must cite a real command (e.g. test -f README.md).',
  'Classify at least one finding as blocker | improvement | nice-to-have.',
  'After YAML, name one more file visible in the repo root in one sentence. Stop.',
].join(' ');

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
 *   repo_root?: string,
 *   doctor_ok?: boolean,
 *   config_present?: boolean,
 *   next_safe_action: string,
 *   useColor?: boolean,
 * }} ctx
 */
function formatFirstRunText(ctx) {
  const useColor = ctx.useColor === true;
  const lines = [
    ansi(useColor, '1', 'ai-minions first-run'),
    `  ok:               ${colorOk(ctx.ok, useColor)}`,
    `  reason_code:      ${ctx.reason_code}`,
    `  repo_root:        ${ctx.repo_root}`,
    `  doctor_ok:        ${colorOk(!!ctx.doctor_ok, useColor)}`,
    `  config_present:   ${ctx.config_present}`,
    `  next_safe_action: ${ansi(useColor, '36', ctx.next_safe_action)}`,
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
 * @param {ReturnType<typeof loadRunStatusFromTrace> | null} traceStatus
 * @returns {{
 *   reason_code: string,
 *   failure_class: string,
 *   message: string,
 *   gate_id: string | null,
 *   transition_reason: string | null,
 *   gate_blocks?: object[],
 * }}
 */
function classifySmokeFailure(traceStatus) {
  if (!traceStatus || traceStatus.error) {
    return {
      reason_code: SMOKE_REASON_CODES.RUNTIME_FAILED,
      failure_class: 'trace_unavailable',
      message: traceStatus?.error || 'trace unavailable after smoke run',
      gate_id: null,
      transition_reason: null,
      gate_blocks: [],
    };
  }

  const ros = traceStatus.summary;
  const tr = ros?.what?.last_transition_reason;
  const reasonCode = typeof tr?.reason_code === 'string' ? tr.reason_code : '';
  /** @type {object[]} */
  let gateBlocks = Array.isArray(traceStatus.gate_blocks) ? traceStatus.gate_blocks : [];
  if (!gateBlocks.length && Array.isArray(traceStatus.rows)) {
    const { collectGateBlocks } = require('./runner-trace-viewer');
    gateBlocks = collectGateBlocks(traceStatus.rows);
  }

  const contractBlocks = gateBlocks.filter(
    (b) => b && (b.kind === 'contract_fail' || b.kind === 'decide_contract_fail'
      || b.kind === 'review_blocker' || b.kind === 'review_record'),
  );
  const contractFails = ros?.why?.rollup_contract_fail_steps ?? 0;
  const hasContractSignal = contractBlocks.length > 0
    || contractFails > 0
    || reasonCode === 'MAX_ITERATIONS_CERBERUS_BLOCKERS'
    || reasonCode === 'MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS';

  if (hasContractSignal) {
    const primary = contractBlocks[0] || null;
    const gateId = (primary && typeof primary.gate_id === 'string' && primary.gate_id)
      || (typeof tr?.gate_id === 'string' ? tr.gate_id : null);
    const agent = primary && typeof primary.agent === 'string' ? primary.agent : null;
    const reviewer = primary && typeof primary.reviewer === 'string' ? primary.reviewer : null;
    const role = agent || reviewer || 'unknown';
    const reason = primary && typeof primary.reason === 'string'
      ? primary.reason
      : (reasonCode || 'output contract failure');
    const message = contractBlocks.length > 1
      ? `${role}: ${reason} (+${contractBlocks.length - 1} more gate block(s))`
      : `${role}: ${reason}`;
    return {
      reason_code: SMOKE_REASON_CODES.OUTPUT_CONTRACT,
      failure_class: 'output_contract',
      message,
      gate_id: gateId,
      transition_reason: reasonCode || null,
      gate_blocks: contractBlocks,
    };
  }

  return {
    reason_code: SMOKE_REASON_CODES.RUNTIME_FAILED,
    failure_class: 'runtime',
    message: reasonCode || `terminal_status=${traceStatus.terminal_status}`,
    gate_id: typeof tr?.gate_id === 'string' ? tr.gate_id : null,
    transition_reason: reasonCode || null,
    gate_blocks: gateBlocks,
  };
}

/**
 * @param {{
 *   ok: boolean,
 *   reason_code: string,
 *   task_id?: string | null,
 * }} ctx
 * @returns {string}
 */
function deriveSmokeNextSafeAction(ctx) {
  // Guided chain: smoke → status → attach (ok or fail-with-task_id). No merge/CERBERUS language.
  if (ctx.task_id) {
    const chain =
      `Run: ai-minions status --run-id ${ctx.task_id} then ai-minions attach --run-id ${ctx.task_id}`;
    if (!ctx.ok && ctx.reason_code === SMOKE_REASON_CODES.OUTPUT_CONTRACT) {
      return `${chain} — failure captured counts for beta dry-run (checklist B.3)`;
    }
    return chain;
  }
  if (ctx.ok) {
    return 'Run: ai-minions status --run-id <task_id> from smoke output';
  }
  return 'Re-run: ai-minions doctor --model-policy local_only then ai-minions smoke';
}

/**
 * @param {{
 *   ok: boolean,
 *   reason_code: string,
 *   task_id?: string | null,
 *   terminal_status?: string | null,
 *   skip_gates?: boolean,
 *   classification?: ReturnType<typeof classifySmokeFailure>,
 *   next_safe_action: string,
 *   useColor?: boolean,
 * }} ctx
 * @returns {string}
 */
function formatSmokeText(ctx) {
  const useColor = ctx.useColor === true;
  const lines = [
    ansi(useColor, '1', 'ai-minions smoke'),
    `  ok:               ${colorOk(ctx.ok, useColor)}`,
    `  reason_code:      ${ctx.reason_code}`,
  ];
  if (ctx.task_id) lines.push(`  run_id:           ${ctx.task_id}`);
  if (ctx.terminal_status) lines.push(`  terminal_status:  ${ctx.terminal_status}`);
  if (ctx.skip_gates) {
    lines.push(`  degraded_mode:    ${ansi(useColor, '33', 'true')} (--skip-gates; MCP/hard gates off)`);
  }
  lines.push('  note:             max_iterations=1 is repair rounds, not role count; smoke targets QA validation');
  if (ctx.classification && !ctx.ok) {
    lines.push(`  failure_class:    ${ctx.classification.failure_class}`);
    lines.push(`  blocker_summary:  ${ansi(useColor, '1;31', ctx.classification.message)}`);
    if (ctx.classification.gate_id) {
      lines.push(`  gate_id:          ${ctx.classification.gate_id}`);
    }
    if (ctx.classification.transition_reason) {
      lines.push(`  transition_reason: ${ctx.classification.transition_reason}`);
    }
    const blocks = Array.isArray(ctx.classification.gate_blocks)
      ? ctx.classification.gate_blocks
      : [];
    for (const b of blocks.slice(0, 6)) {
      const who = b.agent || b.reviewer || '?';
      const gid = b.gate_id ? ` gate_id=${b.gate_id}` : '';
      lines.push(`  gate_block:       ${ansi(useColor, '1;31', `[${who}] ${b.reason || b.kind}${gid}`)}`);
    }
  }
  if (!ctx.ok && ctx.reason_code === SMOKE_REASON_CODES.OUTPUT_CONTRACT) {
    lines.push('  checklist_note:   failure captured — valid beta dry-run per checklist B.3');
  }
  lines.push(`  next_safe_action: ${ansi(useColor, '36', ctx.next_safe_action)}`);
  return lines.join('\n');
}

/**
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string,
 *   install?: boolean,
 *   json?: boolean,
 *   useColor?: boolean,
 *   runOperatorDoctor?: typeof runOperatorDoctor,
 * }} [options]
 */
async function runFirstRun(options = {}) {
  const repoRoot = resolveRepo(options.cwd);
  const useColor = options.useColor === true && options.json !== true;
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
      text: formatFirstRunText({ ...payload, useColor }),
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
      text: formatFirstRunText({ ...payload, useColor }),
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
    text: formatFirstRunText({ ...payload, useColor }),
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
 *   useColor?: boolean,
 *   runStart?: typeof getRunStart extends () => infer R ? R : never,
 *   loadRunStatusFromTrace?: typeof loadRunStatusFromTrace,
 * }} [options]
 */
async function runSmoke(options = {}) {
  const goal = String(options.goal ?? DEFAULT_SMOKE_GOAL).trim();
  const skipGates = options.skipGates !== false;
  const useColor = options.useColor === true && options.json !== true;
  const runStart = options.runStart ?? getRunStart();
  const loadTrace = options.loadRunStatusFromTrace ?? loadRunStatusFromTrace;
  const result = await runStart({
    goal,
    cwd: options.cwd,
    modelPolicy: options.modelPolicy ?? 'local_only',
    model: options.model,
    skipGates,
    maxIterations: options.maxIterations ?? 1,
  });

  const taskId = result.launched?.task_id ?? null;
  const ok = result.exitCode === 0;
  /** @type {ReturnType<typeof classifySmokeFailure> | null} */
  let classification = null;
  let traceStatus = null;

  if (!ok && taskId) {
    traceStatus = loadTrace(String(taskId));
    classification = classifySmokeFailure(traceStatus);
  }

  const reason_code = ok
    ? SMOKE_REASON_CODES.OK
    : (classification?.reason_code ?? SMOKE_REASON_CODES.BLOCKED);
  const next_safe_action = deriveSmokeNextSafeAction({ ok, reason_code, task_id: taskId });
  const smokeText = formatSmokeText({
    ok,
    reason_code,
    task_id: taskId,
    terminal_status: result.launched?.terminal_status ?? null,
    skip_gates: skipGates,
    classification,
    next_safe_action,
    useColor,
  });

  return {
    ...result,
    ok,
    reason_code,
    task_id: taskId,
    failure_class: classification?.failure_class ?? null,
    blocker_summary: classification?.message ?? null,
    gate_id: classification?.gate_id ?? null,
    next_safe_action,
    smokeText,
    traceStatus,
  };
}

/**
 * @param {{
 *   runId?: string,
 *   cwd?: string,
 *   outDir?: string,
 *   json?: boolean,
 *   useColor?: boolean,
 *   skipPanels?: boolean,
 *   loadCollectModule?: () => Promise<typeof import('../../../../scripts/collect-run-report.mjs')>,
 * }} [options]
 */
async function runAttach(options = {}) {
  const runId = options.runId ? String(options.runId).trim() : '';
  const useColor = options.useColor === true && options.json !== true;
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

  const text = mod.formatReportText(report, { useColor });
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
  SMOKE_REASON_CODES,
  DEFAULT_SMOKE_GOAL,
  hasInitConfig,
  validateTargetRepo,
  classifyDoctorFailure,
  classifySmokeFailure,
  deriveFirstRunNextSafeAction,
  deriveSmokeNextSafeAction,
  formatFirstRunText,
  formatSmokeText,
  runFirstRun,
  runSmoke,
  runAttach,
};
