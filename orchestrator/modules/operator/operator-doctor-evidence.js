'use strict';

/**
 * ai-minions doctor/evidence — wraps operator-preflight bridge + trace/bundle inspect.
 * No duplicate SoT: bootstrap/runtime/runner via operator-preflight; evidence via trace summary + bundle paths.
 */

const fs = require('fs');
const path = require('path');

const { buildRunPreflight, formatPreflightText } = require('./runner-preflight');
const { loadOperatorTraceContext } = require('./operator-trace-command');
const { buildControlPlaneRunText } = require('./control-plane-tui');
const { ansi, formatStatusTag, colorOk } = require('./terminal-style');
const {
  assessProviderCredentials,
  assessPathActivation,
  formatCredentialStatusLines,
} = require('./operator-credential-readiness');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OPERATOR_PREFLIGHT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'operator-preflight.mjs');
const COLLECT_REPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'collect-run-report.mjs');

/**
 * Resolve clone root from cwd (lifts orchestrator/ package cwd to repo root).
 * @param {string | undefined} cwd
 * @returns {string}
 */
function resolveCloneRepoRoot(cwd) {
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
 * @param {{ repoRoot?: string, cwd?: string }} [options]
 * @returns {string}
 */
function resolveOperatorRepoRoot(options = {}) {
  if (options.repoRoot != null && String(options.repoRoot).trim() !== '') {
    return path.resolve(String(options.repoRoot));
  }
  return resolveCloneRepoRoot(options.cwd);
}

const KNOWN_LIMITATIONS = [
  'v0.21 beta — doctor does not run npm test unless bootstrap --test is added later',
  'remote_ok skips local Ollama reachability checks in runner preflight',
  'evidence lists bundle paths only; collect via scripts/collect-run-report.mjs',
  'trace read path applies sanitizeTraceRowsForRead — raw trace may differ',
];

/**
 * @param {Awaited<ReturnType<typeof buildRunPreflight>>} runnerPreflight
 */
function buildRunnerInvokeResult(runnerPreflight) {
  return {
    exitCode: runnerPreflight.ok ? 0 : 2,
    stdout: formatPreflightText(runnerPreflight),
    stderr: '',
  };
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/operator-preflight.mjs').runOperatorPreflight>>} report
 */
function deriveDoctorFieldSummary(report) {
  const bootstrapChecks = report.bootstrap?.checks ?? [];
  const authCheck = bootstrapChecks.find((c) => c.id === 'claude_auth');
  const cliCheck = bootstrapChecks.find((c) => c.id === 'claude_cli');

  const hostIds = new Set([
    'node_version',
    'npm_ci',
    'repo_layout',
    'trace_dir',
  ]);
  const hostChecks = bootstrapChecks.filter((c) => hostIds.has(c.id));
  const hostWorst = hostChecks.some((c) => c.status === 'fail')
    ? 'fail'
    : hostChecks.some((c) => c.status === 'warn')
      ? 'warn'
      : hostChecks.length
        ? 'pass'
        : 'unknown';

  const runnerFails = report.checks.filter((c) => c.layer === 'runner' && c.status === 'fail');
  const providerReachability = runnerFails.some((c) => /OLLAMA_UNREACHABLE|ollama backend unreachable/i.test(`${c.operator_reason_code} ${c.message}`))
    ? 'unreachable'
    : report.checks.some((c) => c.layer === 'runner' && c.status === 'pass')
      ? 'reachable'
      : 'not_checked';

  const localBackend = runnerFails.some((c) => /LOCAL_BACKEND_MISSING|missing local backend/i.test(`${c.operator_reason_code} ${c.message}`))
    ? 'missing'
    : providerReachability === 'reachable'
      ? 'ok'
      : 'unknown';

  let authStatus = 'not_checked';
  if (authCheck) {
    authStatus = authCheck.status === 'pass' ? 'authenticated' : authCheck.status === 'warn' ? 'warn' : 'missing';
  } else if (cliCheck && cliCheck.status === 'fail') {
    authStatus = 'cli_missing';
  } else if (cliCheck && /skipped/i.test(cliCheck.message || '')) {
    authStatus = 'not_checked';
  } else if (cliCheck && cliCheck.status === 'pass') {
    authStatus = 'cli_present_auth_not_checked';
  }

  const runtime = report.runtime_preflight;
  const configValidity = runtime?.overall_status ?? 'not_checked';

  return {
    host_prerequisites: hostWorst,
    provider_reachability: providerReachability,
    local_backend: localBackend,
    auth_status: authStatus,
    config_validity: configValidity,
    known_limitations: KNOWN_LIMITATIONS,
  };
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/operator-preflight.mjs').runOperatorPreflight>>} report
 * @param {{
 *   runnerPreflight?: Awaited<ReturnType<typeof buildRunPreflight>> | null,
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 * }} [meta]
 */
function deriveDoctorNextSafeAction(report, meta = {}) {
  const pathActivation = meta.pathActivation;
  if (pathActivation && pathActivation.status === 'activation_required' && pathActivation.path_remediation) {
    return `Activate PATH, then re-run doctor: ${pathActivation.path_remediation}`;
  }
  if (pathActivation && pathActivation.status === 'shim_missing') {
    return 'Run product install first: node scripts/install-ai-minions.mjs — then re-run: ai-minions doctor';
  }

  const credentials = meta.credentials;
  if (
    credentials
    && credentials.remote_tokens_required
    && credentials.missing_required_env_vars.length
  ) {
    const first = credentials.missing_required_env_vars[0];
    return `Export missing provider credential (value not shown): export ${first}=<your-token> — then re-run: ai-minions doctor --model-policy ${credentials.model_policy}`;
  }

  const runner = meta.runnerPreflight;
  if (runner && !runner.ok) {
    const blockers = (runner.blockers ?? []).join(' ').toLowerCase();
    if (/unreachable|missing local backend|local backend/i.test(blockers)) {
      return 'Start Ollama (ollama serve), set OLLAMA_HOST/OLLAMA_PORT if remote, then re-run: ai-minions doctor --model-policy local_only';
    }
    if (/model not found|no local models|empty/i.test(blockers)) {
      return 'Pull a local model (e.g. ollama pull qwen2.5-coder:7b), then re-run: ai-minions doctor --model-policy local_only';
    }
    if (runner.next_safe_action) {
      return runner.next_safe_action;
    }
  }

  if (report.ok) {
    return 'Environment ready — run: ai-minions smoke --model-policy local_only (or start --goal after smoke).';
  }
  if (report.layer_stopped === 'bootstrap') {
    return 'Fix host/bootstrap blockers above, then re-run: ai-minions doctor';
  }
  if (report.layer_stopped === 'runtime') {
    return 'Fix runtime MCP/hook/config blockers, then re-run: ai-minions doctor';
  }
  return 'Fix runner/model/Ollama blockers, then re-run: ai-minions doctor --model-policy local_only';
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/operator-preflight.mjs').runOperatorPreflight>>} report
 * @param {Awaited<ReturnType<typeof buildRunPreflight>> | null} [runnerPreflight]
 * @param {{
 *   useColor?: boolean,
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 * }} [options]
 * @returns {string}
 */
function formatOperatorDoctorText(report, runnerPreflight = null, options = {}) {
  const useColor = options.useColor === true;
  const fields = deriveDoctorFieldSummary(report);
  const pathActivation = options.pathActivation ?? null;
  const credentials = options.credentials
    ?? assessProviderCredentials({ modelPolicy: runnerPreflight?.model_policy });
  const modelPolicy = runnerPreflight?.model_policy
    ?? credentials.model_policy
    ?? 'local_only';
  const discovered = Array.isArray(runnerPreflight?.discovered_models)
    ? runnerPreflight.discovered_models
    : [];
  const nextAction = deriveDoctorNextSafeAction(report, {
    runnerPreflight,
    pathActivation,
    credentials,
  });

  const lines = [
    ansi(useColor, '1', 'ai-minions doctor'),
    `  ok:                    ${colorOk(report.ok, useColor)}`,
    `  traces_dir:            ${report.traces_dir ?? '-'}`,
    `  layer_stopped:         ${report.layer_stopped ?? '(none)'}`,
    `  model_policy:          ${modelPolicy}`,
  ];
  if (pathActivation) {
    lines.push(
      `  path_activation:       ${pathActivation.status}`,
      `  path_on_path:          ${pathActivation.on_path}`,
      `  cli_shim_present:      ${pathActivation.shim_present}`,
    );
    if (pathActivation.path_remediation) {
      lines.push(`  path_remediation:      ${pathActivation.path_remediation}`);
    }
  }
  if (runnerPreflight?.config_target) {
    lines.push(`  config_target:         ${runnerPreflight.config_target}`);
  }
  if (runnerPreflight?.config_path) {
    lines.push(`  config_path:           ${runnerPreflight.config_path}`);
  }
  if (runnerPreflight?.policy_source) {
    lines.push(`  policy_source:         ${runnerPreflight.policy_source}`);
  }
  if (runnerPreflight?.base_url) {
    lines.push(`  local_backend_url:     ${runnerPreflight.base_url}`);
  }
  lines.push(
    `  host_prerequisites:    ${fields.host_prerequisites}`,
    `  provider_reachability: ${fields.provider_reachability}`,
    `  local_backend:         ${fields.local_backend}`,
    `  model_backend:         ${report.runtime_preflight?.model_backend ?? fields.local_backend}`,
    `  runtime_host:          ${report.runtime_preflight?.runtime_host ?? 'claude_code'}`,
    `  auth_status:           ${fields.auth_status}`,
    `  config_validity:       ${fields.config_validity}`,
    `  discovered_models:     ${discovered.length ? discovered.join(', ') : '(none)'}`,
  );
  lines.push(...formatCredentialStatusLines(credentials));

  if (report.ok && fields.config_validity === 'degraded') {
    lines.push(
      '  beta_lane_note:        v0.20 beta OK — MCP venv + Claude hooks WARNs are optional; strict mode needs uv sync',
    );
  }

  lines.push(
    '  known_limitations:',
    ...fields.known_limitations.map((l) => `    - ${l}`),
    `  next_safe_action:      ${ansi(useColor, '36', nextAction)}`,
    '',
    '-- checks (bootstrap → runtime → runner) --',
  );

  for (const c of report.checks) {
    const tag = formatStatusTag(c.status, useColor);
    const shipCode = c.reason_code ? ` ${c.reason_code}` : '';
    lines.push(`  ${tag} ${c.operator_reason_code}${shipCode} — [${c.layer}] ${c.message}`);
  }
  return lines.join('\n');
}

/**
 * @param {Awaited<ReturnType<import('../../../../scripts/operator-preflight.mjs').runOperatorPreflight>>} report
 * @param {Awaited<ReturnType<typeof buildRunPreflight>> | null} [runnerPreflight]
 * @param {{
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 * }} [meta]
 */
function buildOperatorDoctorJson(report, runnerPreflight = null, meta = {}) {
  const credentials = meta.credentials
    ?? assessProviderCredentials({ modelPolicy: runnerPreflight?.model_policy });
  const pathActivation = meta.pathActivation ?? null;
  const discovered = Array.isArray(runnerPreflight?.discovered_models)
    ? runnerPreflight.discovered_models
    : [];
  return {
    command: 'doctor',
    ok: report.ok,
    traces_dir: report.traces_dir ?? null,
    layer_stopped: report.layer_stopped ?? null,
    runtime_preflight: report.runtime_preflight ?? null,
    model_policy: runnerPreflight?.model_policy ?? credentials.model_policy,
    config_target: runnerPreflight?.config_target ?? null,
    config_path: runnerPreflight?.config_path ?? null,
    policy_source: runnerPreflight?.policy_source ?? null,
    local_backend_url: runnerPreflight?.base_url ?? null,
    discovered_models: discovered,
    path_activation: pathActivation
      ? {
          status: pathActivation.status,
          on_path: pathActivation.on_path,
          shim_present: pathActivation.shim_present,
          bin_dir: pathActivation.bin_dir,
          path_remediation: pathActivation.path_remediation,
          note: pathActivation.note,
        }
      : null,
    provider_credentials: {
      remote_tokens_required: credentials.remote_tokens_required,
      local_only_tokens_not_required: credentials.local_only_tokens_not_required,
      note: credentials.note,
      providers: credentials.providers.map((p) => ({
        provider: p.provider,
        env_var: p.env_var,
        status: p.status,
        required_for_policy: p.required_for_policy,
      })),
      missing_required_env_vars: credentials.missing_required_env_vars,
    },
    summary: deriveDoctorFieldSummary(report),
    checks: report.checks,
    next_safe_action: deriveDoctorNextSafeAction(report, {
      runnerPreflight,
      pathActivation,
      credentials,
    }),
  };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   cwd?: string,
 *   modelPolicy?: string,
 *   live?: boolean,
 *   install?: boolean,
 *   localProvider?: string,
 *   ollamaHost?: string,
 *   ollamaPort?: string | number,
 *   ollamaBaseUrl?: string,
 *   allowPublicLocalRuntime?: boolean,
 *   json?: boolean,
 *   useColor?: boolean,
 *   homeDir?: string,
 *   binDir?: string,
 *   pathEnv?: string,
 *   env?: NodeJS.ProcessEnv,
 *   existsSync?: typeof fs.existsSync,
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 *   loadOperatorPreflightModule?: () => Promise<typeof import('../../../../scripts/operator-preflight.mjs')>,
 *   buildRunPreflightFn?: typeof buildRunPreflight,
 * }} [options]
 */
async function runOperatorDoctor(options = {}) {
  const repoRoot = resolveOperatorRepoRoot(options);
  const modelPolicy = options.modelPolicy ?? 'local_only';
  const useColor = options.useColor === true && options.json !== true;
  const loadMod = options.loadOperatorPreflightModule
    ?? (() => import(OPERATOR_PREFLIGHT_SCRIPT));
  const mod = await loadMod();
  const buildRunPreflightFn = options.buildRunPreflightFn ?? buildRunPreflight;
  const runnerPreflight = await buildRunPreflightFn({
    cwd: repoRoot,
    modelPolicy,
    localProvider: options.localProvider,
    ollamaHost: options.ollamaHost,
    ollamaPort: options.ollamaPort,
    ollamaBaseUrl: options.ollamaBaseUrl,
    allowPublicLocalRuntime: options.allowPublicLocalRuntime,
  });

  const report = await mod.runOperatorPreflight({
    repoRoot,
    modelPolicy,
    live: options.live === true,
    install: options.install !== false,
    invokeRunner: () => buildRunnerInvokeResult(runnerPreflight),
  });

  const pathActivation = options.pathActivation
    ?? assessPathActivation({
      homeDir: options.homeDir,
      binDir: options.binDir,
      pathEnv: options.pathEnv,
      existsSync: options.existsSync,
    });
  const credentials = options.credentials
    ?? assessProviderCredentials({
      modelPolicy: runnerPreflight?.model_policy ?? modelPolicy,
      env: options.env,
    });

  return {
    ok: report.ok,
    exitCode: report.ok ? 0 : 2,
    report,
    runnerPreflight,
    pathActivation,
    credentials,
    text: formatOperatorDoctorText(report, runnerPreflight, {
      useColor,
      pathActivation,
      credentials,
    }),
    json: buildOperatorDoctorJson(report, runnerPreflight, {
      pathActivation,
      credentials,
    }),
  };
}

/**
 * @param {string} taskId
 * @param {string} repoRoot
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync, statSync?: typeof fs.statSync }} [fsOps]
 */
function resolveLatestBundleDir(taskId, repoRoot, fsOps = {}) {
  const existsSync = fsOps.existsSync ?? fs.existsSync;
  const readdirSync = fsOps.readdirSync ?? fs.readdirSync;
  const statSync = fsOps.statSync ?? fs.statSync;
  const bundleRoot = path.join(repoRoot, 'report-bundles');
  if (!existsSync(bundleRoot)) return null;

  const prefix = `${taskId}-`;
  /** @type {string[]} */
  const matches = [];
  try {
    for (const name of readdirSync(bundleRoot)) {
      if (!name.startsWith(prefix)) continue;
      const full = path.join(bundleRoot, name);
      try {
        if (statSync(full).isDirectory()) matches.push(full);
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    return null;
  }
  if (!matches.length) return null;
  matches.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return matches[0];
}

/**
 * @param {string | null} bundleDir
 * @param {{ existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync }} [fsOps]
 */
function deriveRedactionStatus(bundleDir, fsOps = {}) {
  const existsSync = fsOps.existsSync ?? fs.existsSync;
  const readFileSync = fsOps.readFileSync ?? fs.readFileSync;

  if (!bundleDir || !existsSync(bundleDir)) {
    return {
      status: 'bundle_not_collected',
      reason_code: null,
      message: 'No local report bundle — trace reads are sanitized; collect bundle for shareable redaction.',
    };
  }

  const privacyPath = path.join(bundleDir, 'privacy-scan.json');
  if (existsSync(privacyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(privacyPath, 'utf8'));
      const reason = parsed.reason_code ?? parsed.summary?.reason_code ?? null;
      return {
        status: 'privacy_scan_present',
        reason_code: reason,
        message: reason
          ? `Bundle privacy scan recorded (${reason}) — upload shareable/ only.`
          : 'Bundle privacy scan present — upload shareable/ only.',
      };
    } catch {
      return {
        status: 'privacy_scan_unreadable',
        reason_code: null,
        message: 'privacy-scan.json present but unreadable.',
      };
    }
  }

  const shareableDir = path.join(bundleDir, 'shareable');
  if (existsSync(shareableDir)) {
    return {
      status: 'shareable_subdir_present',
      reason_code: null,
      message: 'shareable/ exists but privacy-scan.json missing — verify before upload.',
    };
  }

  return {
    status: 'bundle_raw_local_only',
    reason_code: null,
    message: 'Bundle exists without privacy scan — local-only; do not upload raw trace/.',
  };
}

/**
 * @param {string} taskId
 * @param {string} repoRoot
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync, statSync?: typeof fs.statSync }} [fsOps]
 */
function resolveEvidenceArtifactPaths(taskId, repoRoot, fsOps = {}) {
  const existsSync = fsOps.existsSync ?? fs.existsSync;
  const bundleDir = resolveLatestBundleDir(taskId, repoRoot, fsOps);
  if (!bundleDir) {
    return {
      attach_bundle: null,
      report_path: null,
      attach_md: null,
    };
  }

  const inspectReport = path.join(bundleDir, 'inspect-report.json');
  const attachMd = path.join(bundleDir, 'ATTACH.md');
  return {
    attach_bundle: bundleDir,
    report_path: existsSync(inspectReport) ? inspectReport : null,
    attach_md: existsSync(attachMd) ? attachMd : null,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ repoRoot?: string, artifactPaths?: ReturnType<typeof resolveEvidenceArtifactPaths>, redaction?: ReturnType<typeof deriveRedactionStatus> }} meta
 */
function buildEvidenceMissingList(ctx, meta = {}) {
  const missing = [...ctx.summary.missing_evidence];
  const paths = meta.artifactPaths ?? resolveEvidenceArtifactPaths(String(ctx.run_id), meta.repoRoot ?? REPO_ROOT);
  if (!paths.attach_bundle) missing.push('attach_bundle');
  if (!paths.report_path) missing.push('inspect_report');
  return [...new Set(missing)];
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ repoRoot?: string, artifactPaths?: ReturnType<typeof resolveEvidenceArtifactPaths>, redaction?: ReturnType<typeof deriveRedactionStatus>, useColor?: boolean }} meta
 * @returns {string}
 */
function formatOperatorEvidenceText(ctx, meta = {}) {
  const useColor = meta.useColor === true;
  const repoRoot = meta.repoRoot ?? REPO_ROOT;
  const artifactPaths = meta.artifactPaths ?? resolveEvidenceArtifactPaths(String(ctx.run_id), repoRoot);
  const redaction = meta.redaction ?? deriveRedactionStatus(artifactPaths.attach_bundle);
  const missing = buildEvidenceMissingList(ctx, { repoRoot, artifactPaths });

  const lines = [
    ansi(useColor, '1', 'ai-minions evidence'),
    `  run_id:              ${ctx.run_id}`,
    `  trace_path:          ${ctx.trace_file}`,
    `  report_path:         ${artifactPaths.report_path ?? '(not collected — run collect-run-report)'}`,
    `  attach_bundle:       ${artifactPaths.attach_bundle ?? '(not collected)'}`,
    `  attach_md:           ${artifactPaths.attach_md ?? '(not generated)'}`,
    `  missing_evidence:    ${missing.length ? ansi(useColor, '33', missing.join(', ')) : '(none)'}`,
    `  redaction_status:    ${redaction.status}`,
    `  redaction_detail:    ${redaction.message}`,
    `  next_safe_action:    ${ansi(useColor, '36', deriveEvidenceNextSafeAction(ctx, artifactPaths, missing))}`,
    '',
    '-- inspect (control-plane read-only) --',
    buildControlPlaneRunText(ctx.rows, { trace_file: ctx.trace_file }),
  ];
  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {ReturnType<typeof resolveEvidenceArtifactPaths>} artifactPaths
 * @param {string[]} missing
 */
function deriveEvidenceNextSafeAction(ctx, artifactPaths, missing) {
  if (!artifactPaths.attach_bundle) {
    return `Collect bundle: node ${path.relative(REPO_ROOT, COLLECT_REPORT_SCRIPT)} ${ctx.run_id}`;
  }
  if (missing.length) {
    return 'Review missing_evidence and inspect blockers; attach shareable/ + privacy-scan.json to issues only.';
  }
  return 'Evidence paths ready — use ATTACH.md upload guidance; trace wins on disputes.';
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ repoRoot?: string, artifactPaths?: ReturnType<typeof resolveEvidenceArtifactPaths>, redaction?: ReturnType<typeof deriveRedactionStatus> }} meta
 */
function buildOperatorEvidenceJson(ctx, meta = {}) {
  const repoRoot = meta.repoRoot ?? REPO_ROOT;
  const artifactPaths = meta.artifactPaths ?? resolveEvidenceArtifactPaths(String(ctx.run_id), repoRoot);
  const redaction = meta.redaction ?? deriveRedactionStatus(artifactPaths.attach_bundle);
  const missing = buildEvidenceMissingList(ctx, { repoRoot, artifactPaths });

  return {
    command: 'evidence',
    run_id: ctx.run_id,
    trace_path: ctx.trace_file,
    report_path: artifactPaths.report_path,
    attach_bundle: artifactPaths.attach_bundle,
    attach_md: artifactPaths.attach_md,
    missing_evidence: missing,
    redaction_status: redaction.status,
    redaction_reason_code: redaction.reason_code,
    redaction_detail: redaction.message,
    collect_report_script: COLLECT_REPORT_SCRIPT,
    operator_trace_summary: ctx.summary,
    next_safe_action: deriveEvidenceNextSafeAction(ctx, artifactPaths, missing),
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   repoRoot?: string,
 *   json?: boolean,
 *   useColor?: boolean,
 *   loadContext?: typeof loadOperatorTraceContext,
 * }} [options]
 */
function runOperatorEvidence(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const repoRoot = resolveOperatorRepoRoot(options);
  const useColor = options.useColor === true && options.json !== true;
  const ctx = loadContext({
    runId: options.runId,
    filePath: options.filePath,
  });

  if (!ctx.ok) {
    return {
      ok: false,
      exitCode: 2,
      reason_code: ctx.reason_code,
      next_safe_action: ctx.next_safe_action,
      text: [
        ansi(useColor, '1', 'ai-minions evidence'),
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ansi(useColor, '36', ctx.next_safe_action)}`,
      ].join('\n'),
      json: ctx,
    };
  }

  const artifactPaths = resolveEvidenceArtifactPaths(String(ctx.run_id), repoRoot);
  const summaryWithArtifacts = {
    ...ctx.summary,
    artifacts: {
      trace: ctx.trace_file,
      report: artifactPaths.report_path,
      attach_bundle: artifactPaths.attach_bundle,
    },
  };

  const enrichedCtx = { ...ctx, summary: summaryWithArtifacts };

  return {
    ok: true,
    exitCode: 0,
    text: formatOperatorEvidenceText(enrichedCtx, { repoRoot, artifactPaths, useColor }),
    json: buildOperatorEvidenceJson(enrichedCtx, { repoRoot, artifactPaths }),
  };
}

module.exports = {
  REPO_ROOT,
  OPERATOR_PREFLIGHT_SCRIPT,
  COLLECT_REPORT_SCRIPT,
  resolveCloneRepoRoot,
  resolveOperatorRepoRoot,
  KNOWN_LIMITATIONS,
  deriveDoctorFieldSummary,
  deriveDoctorNextSafeAction,
  formatOperatorDoctorText,
  buildOperatorDoctorJson,
  runOperatorDoctor,
  resolveLatestBundleDir,
  deriveRedactionStatus,
  resolveEvidenceArtifactPaths,
  buildEvidenceMissingList,
  formatOperatorEvidenceText,
  buildOperatorEvidenceJson,
  runOperatorEvidence,
};
