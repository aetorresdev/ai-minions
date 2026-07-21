'use strict';

/**
 * Interactive config / credentials readiness pane for the operator cockpit.
 * Reuses doctor + credential-readiness surfaces — status labels only, never secrets.
 */

const {
  assessProviderCredentials,
  assessPathActivation,
  formatCredentialStatusLines,
  SUPPORTED_ENDPOINT_ENV_VARS,
  envValuePresent,
} = require('./operator-credential-readiness');
const {
  runOperatorDoctor,
  deriveDoctorFieldSummary,
  deriveDoctorNextSafeAction,
} = require('./operator-doctor-evidence');
const { ansi } = require('./terminal-style');

const CONFIG_READINESS_PANE_SCHEMA = '1';

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizePaneToken(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Endpoint / home env vars — present|missing only (never values).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ env_var: string, status: 'present' | 'missing' }[]}
 */
function assessEndpointEnvStatus(env = process.env) {
  return SUPPORTED_ENDPOINT_ENV_VARS.map((envVar) => ({
    env_var: envVar,
    status: envValuePresent(env[envVar]) ? 'present' : 'missing',
  }));
}

/**
 * Concrete remediation candidates derived from readiness state (not executed).
 * @param {{
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 *   runnerPreflight?: object | null,
 *   doctorOk?: boolean,
 *   next_safe_action?: string | null,
 * }} input
 * @returns {string[]}
 */
function deriveRemediationCandidates(input = {}) {
  /** @type {string[]} */
  const candidates = [];
  const pathActivation = input.pathActivation;
  const credentials = input.credentials;
  const runner = input.runnerPreflight;
  const modelPolicy = String(
    credentials?.model_policy ?? runner?.model_policy ?? 'local_only',
  ).trim() || 'local_only';

  if (pathActivation?.status === 'activation_required' && pathActivation.path_remediation) {
    candidates.push(`Activate PATH: ${pathActivation.path_remediation}`);
  }
  if (pathActivation?.status === 'shim_missing') {
    candidates.push('Install product CLI: node scripts/install-ai-minions.mjs');
  }

  if (
    credentials?.remote_tokens_required
    && Array.isArray(credentials.missing_required_env_vars)
    && credentials.missing_required_env_vars.length
  ) {
    for (const envVar of credentials.missing_required_env_vars) {
      candidates.push(`Export provider env var (value not shown): export ${envVar}=<your-token>`);
    }
  }

  if (runner && runner.ok === false) {
    const blockers = (runner.blockers ?? []).join(' ').toLowerCase();
    if (/unreachable|missing local backend|local backend/i.test(blockers)) {
      candidates.push('Start backend: ollama serve (set OLLAMA_HOST/OLLAMA_PORT if needed)');
    }
    if (/model not found|no local models|empty/i.test(blockers)) {
      candidates.push('Pull/configure model: ollama pull <model> (then re-run doctor)');
    }
  }

  if (input.doctorOk === true) {
    candidates.push(`Run smoke: ai-minions smoke --model-policy ${modelPolicy}`);
  } else if (!candidates.length && input.next_safe_action) {
    candidates.push(String(input.next_safe_action));
  }

  return candidates;
}

/**
 * Build pane model from doctor/credential surfaces (injectable for unit tests).
 * @param {{
 *   report?: object | null,
 *   runnerPreflight?: object | null,
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 *   endpointEnv?: { env_var: string, status: 'present' | 'missing' }[] | null,
 *   env?: NodeJS.ProcessEnv,
 * }} [input]
 */
function buildConfigReadinessPaneModel(input = {}) {
  const runnerPreflight = input.runnerPreflight ?? null;
  const modelPolicy = String(
    input.credentials?.model_policy
      ?? runnerPreflight?.model_policy
      ?? 'local_only',
  ).trim() || 'local_only';

  const credentials = input.credentials
    ?? assessProviderCredentials({ modelPolicy, env: input.env });
  const pathActivation = input.pathActivation ?? assessPathActivation();
  const endpointEnv = input.endpointEnv ?? assessEndpointEnvStatus(input.env ?? process.env);

  const report = input.report ?? {
    ok: false,
    layer_stopped: null,
    traces_dir: null,
    bootstrap: { checks: [] },
    runtime_preflight: null,
    checks: [],
    model_policy: modelPolicy,
  };

  const fields = deriveDoctorFieldSummary(report);
  const discovered = Array.isArray(runnerPreflight?.discovered_models)
    ? runnerPreflight.discovered_models.map(String)
    : [];
  const nextSafe = deriveDoctorNextSafeAction(report, {
    runnerPreflight,
    pathActivation,
    credentials,
  });
  const remediations = deriveRemediationCandidates({
    pathActivation,
    credentials,
    runnerPreflight,
    doctorOk: report.ok === true,
    next_safe_action: nextSafe,
  });

  /** @type {string | null} */
  let policyNote = null;
  if (credentials.local_only_tokens_not_required) {
    policyNote = 'local_only: remote provider tokens are not required';
  } else if (modelPolicy === 'hybrid') {
    policyNote = 'hybrid: remote provider tokens and local endpoints may be required when missing';
  } else if (credentials.remote_tokens_required) {
    policyNote = 'remote_ok: at least one supported provider token is required (any_provider sufficiency)';
  }

  return {
    ok: report.ok === true,
    model_policy: modelPolicy,
    policy_note: policyNote,
    path_activation: {
      status: pathActivation.status,
      on_path: pathActivation.on_path,
      shim_present: pathActivation.shim_present,
      path_remediation: pathActivation.path_remediation,
      note: pathActivation.note,
    },
    runtime_host: report.runtime_preflight?.runtime_host ?? 'claude_code',
    config_validity: fields.config_validity,
    local_backend: fields.local_backend,
    provider_reachability: fields.provider_reachability,
    local_backend_url: runnerPreflight?.base_url ?? null,
    discovered_models: discovered,
    discovered_models_count: discovered.length,
    credentials: {
      model_policy: credentials.model_policy,
      remote_tokens_required: credentials.remote_tokens_required,
      local_only_tokens_not_required: credentials.local_only_tokens_not_required,
      credential_sufficiency: credentials.credential_sufficiency,
      note: credentials.note,
      providers: credentials.providers.map((p) => ({
        provider: p.provider,
        env_var: p.env_var,
        status: p.status,
        required_for_policy: p.required_for_policy,
      })),
      missing_required_env_vars: [...credentials.missing_required_env_vars],
    },
    endpoint_env: endpointEnv,
    next_safe_action: nextSafe,
    remediation_candidates: remediations,
    smoke_command: `ai-minions smoke --model-policy ${modelPolicy}`,
    doctor_command: `ai-minions doctor --model-policy ${modelPolicy}`,
  };
}

/**
 * @param {object} pane
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatConfigReadinessPaneText(pane, options = {}) {
  const useColor = options.useColor === true;
  const section = (label) => ansi(useColor, '1;36', label);
  const title = ansi(useColor, '1', 'ai-minions tui — config / credentials readiness');

  const discovered = pane.discovered_models_count
    ? pane.discovered_models.join(', ')
    : '(none)';

  const lines = [
    '+----------------------------------------------------------------------+',
    `|  ${title}          |`,
    '+----------------------------------------------------------------------+',
    '',
    section('== Model policy =='),
    `  model_policy:            ${pane.model_policy}`,
    `  policy_note:             ${pane.policy_note ?? '-'}`,
    '',
    section('== PATH / activation =='),
    `  path_status:             ${pane.path_activation.status}`,
    `  cli_on_path:             ${pane.path_activation.on_path}`,
    `  cli_shim_present:        ${pane.path_activation.shim_present}`,
  ];

  if (pane.path_activation.path_remediation) {
    lines.push(`  path_remediation:        ${pane.path_activation.path_remediation}`);
  }

  lines.push(
    '',
    section('== Runtime / local backend =='),
    `  runtime_host:            ${pane.runtime_host}`,
    `  config_validity:         ${pane.config_validity}`,
    `  local_backend:           ${pane.local_backend}`,
    `  provider_reachability:   ${pane.provider_reachability}`,
    `  local_backend_url:       ${pane.local_backend_url ?? '-'}`,
    `  discovered_models:       ${discovered}`,
    '',
    section('== Provider credentials (status only) =='),
    ...formatCredentialStatusLines(pane.credentials),
    '',
    section('== Endpoint / home env (set/unset only) =='),
  );

  for (const entry of pane.endpoint_env || []) {
    lines.push(`    - ${entry.env_var}: ${entry.status}`);
  }

  lines.push(
    '',
    section('== Next safe action =='),
    `  next_safe_action:        ${ansi(useColor, '36', pane.next_safe_action ?? '-')}`,
    '',
    section('== Remediation candidates =='),
  );

  if (pane.remediation_candidates && pane.remediation_candidates.length) {
    for (const item of pane.remediation_candidates) {
      lines.push(`  - ${item}`);
    }
  } else {
    lines.push('  - (none)');
  }

  lines.push(
    '',
    `  smoke_command:           ${pane.smoke_command}`,
    `  doctor_command:          ${pane.doctor_command}`,
    '',
    'Commands: [r] refresh  [c] copy remediations  [d] full doctor text  [b] back',
    'Policy: credential/endpoint values never printed — present|missing|not_checked only.',
    'Not claimed: secret manager · durable credential store · shell rc mutation · fullscreen navigator.',
  );

  return lines.join('\n');
}

/**
 * Copy-friendly remediation + command block (no secrets).
 * @param {object} pane
 * @returns {string}
 */
function formatCopyableRemediationBlock(pane) {
  const lines = [
    '-- copyable --',
    `next_safe_action: ${pane.next_safe_action ?? '-'}`,
    `smoke_command: ${pane.smoke_command}`,
    `doctor_command: ${pane.doctor_command}`,
    'remediation_candidates:',
  ];
  if (pane.remediation_candidates && pane.remediation_candidates.length) {
    for (const item of pane.remediation_candidates) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('- (none)');
  }
  return lines.join('\n');
}

/**
 * @param {string} raw
 * @returns {{ action: 'refresh' | 'copy' | 'doctor' | 'back' | 'unknown' }}
 */
function resolveConfigReadinessPaneInput(raw) {
  const token = normalizePaneToken(raw);
  if (token === 'b' || token === 'back' || token === 'q' || token === 'quit' || token === 'cancel') {
    return { action: 'back' };
  }
  if (token === 'r' || token === 'refresh' || token === 'reload') {
    return { action: 'refresh' };
  }
  if (token === 'c' || token === 'copy' || token === 'cmd' || token === 'command') {
    return { action: 'copy' };
  }
  if (token === 'd' || token === 'doctor' || token === 'full') {
    return { action: 'doctor' };
  }
  return { action: 'unknown' };
}

/**
 * Load pane via doctor (injectable).
 * @param {{
 *   cwd?: string,
 *   modelPolicy?: string,
 *   useColor?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   runDoctorFn?: typeof runOperatorDoctor,
 *   pathActivation?: ReturnType<typeof assessPathActivation> | null,
 *   credentials?: ReturnType<typeof assessProviderCredentials> | null,
 * }} [options]
 */
async function loadConfigReadinessPane(options = {}) {
  const runDoctorFn = options.runDoctorFn ?? runOperatorDoctor;
  const doctor = await runDoctorFn({
    cwd: options.cwd,
    modelPolicy: options.modelPolicy,
    json: false,
    useColor: false,
    env: options.env,
    pathActivation: options.pathActivation ?? undefined,
    credentials: options.credentials ?? undefined,
  });

  const pane = buildConfigReadinessPaneModel({
    report: doctor.report,
    runnerPreflight: doctor.runnerPreflight,
    pathActivation: doctor.pathActivation,
    credentials: doctor.credentials,
    env: options.env,
  });

  return {
    ok: doctor.ok === true,
    exitCode: Number.isInteger(doctor.exitCode) ? doctor.exitCode : (doctor.ok ? 0 : 2),
    pane,
    doctor,
  };
}

/**
 * Interactive config/readiness pane loop.
 * @param {{
 *   question: (prompt: string) => Promise<string>,
 *   write: (text: string) => void,
 *   useColor?: boolean,
 *   cwd?: string,
 *   modelPolicy?: string,
 *   env?: NodeJS.ProcessEnv,
 *   runDoctorFn?: typeof runOperatorDoctor,
 *   maxLoops?: number,
 * }} options
 */
async function runOperatorConfigReadinessPane(options) {
  const write = options.write;
  const question = options.question;
  const useColor = options.useColor === true;
  const maxLoops = Number.isInteger(options.maxLoops) && options.maxLoops > 0
    ? options.maxLoops
    : Number.POSITIVE_INFINITY;

  let loops = 0;
  let lastExitCode = 0;
  /** @type {object | null} */
  let lastPane = null;
  /** @type {string} */
  let lastText = '';

  while (loops < maxLoops) {
    loops += 1;
    const loaded = await loadConfigReadinessPane({
      cwd: options.cwd,
      modelPolicy: options.modelPolicy,
      env: options.env,
      runDoctorFn: options.runDoctorFn,
    });
    lastPane = loaded.pane;
    lastExitCode = loaded.exitCode;
    lastText = formatConfigReadinessPaneText(loaded.pane, { useColor });
    write(`\n${lastText}\n`);

    const raw = await question('Config/readiness [r|c|d|b]: ');
    const resolved = resolveConfigReadinessPaneInput(raw);

    if (resolved.action === 'back') {
      return {
        ok: true,
        exitCode: lastExitCode,
        reason_code: 'CONFIG_READINESS_PANE_BACK',
        pane: lastPane,
        schema_version: CONFIG_READINESS_PANE_SCHEMA,
        text: lastText,
      };
    }

    if (resolved.action === 'refresh') {
      continue;
    }

    if (resolved.action === 'copy') {
      write(`\n${formatCopyableRemediationBlock(loaded.pane)}\n`);
      continue;
    }

    if (resolved.action === 'doctor') {
      const doctorText = loaded.doctor?.text || '(doctor text unavailable)';
      write(`\n— full doctor —\n${doctorText}\n`);
      continue;
    }

    write('Unknown command. Use r (refresh), c (copy), d (doctor), or b (back).\n');
  }

  return {
    ok: lastExitCode === 0,
    exitCode: lastExitCode,
    reason_code: 'CONFIG_READINESS_PANE_MAX_LOOPS',
    pane: lastPane,
    schema_version: CONFIG_READINESS_PANE_SCHEMA,
    text: 'max_loops',
  };
}

module.exports = {
  CONFIG_READINESS_PANE_SCHEMA,
  assessEndpointEnvStatus,
  deriveRemediationCandidates,
  buildConfigReadinessPaneModel,
  formatConfigReadinessPaneText,
  formatCopyableRemediationBlock,
  resolveConfigReadinessPaneInput,
  loadConfigReadinessPane,
  runOperatorConfigReadinessPane,
};
