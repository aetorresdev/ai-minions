'use strict';

/**
 * Provider credential + PATH activation readiness for init/doctor.
 * Status only — never returns secret values.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** @typedef {'present' | 'missing' | 'not_checked'} CredentialStatus */

/**
 * Supported remote provider env vars (product-facing).
 * hybrid is reserved for a future policy; listed so doctor can describe intent.
 */
const SUPPORTED_PROVIDER_CREDENTIALS = Object.freeze([
  {
    provider: 'anthropic',
    env_var: 'ANTHROPIC_API_KEY',
    required_for_policies: Object.freeze(['remote_ok', 'hybrid']),
  },
  {
    provider: 'openai',
    env_var: 'OPENAI_API_KEY',
    required_for_policies: Object.freeze(['remote_ok', 'hybrid']),
  },
]);

/** Endpoint / home vars operators may set — never secret values. */
const SUPPORTED_ENDPOINT_ENV_VARS = Object.freeze([
  'AI_MINIONS_HOME',
  'OLLAMA_HOST',
  'OLLAMA_PORT',
  'ORCHESTRATOR_OLLAMA_URL',
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function envValuePresent(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {string | null | undefined} modelPolicy
 * @returns {boolean}
 */
function remoteTokensRequired(modelPolicy) {
  const policy = String(modelPolicy ?? 'local_only').trim() || 'local_only';
  return policy === 'remote_ok' || policy === 'hybrid';
}

/**
 * Assess provider credential env vars without reading secret values into output.
 * @param {{
 *   modelPolicy?: string | null,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
function assessProviderCredentials(options = {}) {
  const env = options.env ?? process.env;
  const modelPolicy = String(options.modelPolicy ?? 'local_only').trim() || 'local_only';
  const tokensRequired = remoteTokensRequired(modelPolicy);

  /** @type {{ provider: string, env_var: string, status: CredentialStatus, required_for_policy: boolean }[]} */
  const providers = SUPPORTED_PROVIDER_CREDENTIALS.map((entry) => {
    const requiredForPolicy = entry.required_for_policies.includes(modelPolicy);
    let status = /** @type {CredentialStatus} */ ('missing');
    try {
      status = envValuePresent(env[entry.env_var]) ? 'present' : 'missing';
    } catch {
      status = 'not_checked';
    }
    return {
      provider: entry.provider,
      env_var: entry.env_var,
      status,
      required_for_policy: requiredForPolicy,
    };
  });

  const anyPresent = providers.some((p) => p.status === 'present');
  const missingRequired = tokensRequired && !anyPresent
    ? providers.filter((p) => p.status === 'missing')
    : [];

  return {
    model_policy: modelPolicy,
    remote_tokens_required: tokensRequired,
    local_only_tokens_not_required: modelPolicy === 'local_only',
    providers,
    missing_required_env_vars: missingRequired.map((p) => p.env_var),
    note: tokensRequired
      ? 'remote_ok/hybrid requires at least one provider credential when remote providers are enabled'
      : 'local_only does not require remote provider tokens',
  };
}

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
function defaultBinDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.local', 'bin');
}

/**
 * @param {string | undefined | null} pathEnv
 * @param {string} dir
 * @returns {boolean}
 */
function pathIncludesDir(pathEnv, dir) {
  const target = path.resolve(dir);
  const parts = String(pathEnv ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  let targetReal;
  try {
    targetReal = fs.realpathSync(target);
  } catch {
    targetReal = target;
  }
  for (const part of parts) {
    try {
      if (fs.realpathSync(path.resolve(part)) === targetReal) {
        return true;
      }
    } catch {
      if (path.resolve(part) === target) {
        return true;
      }
    }
  }
  return false;
}

/**
 * PATH / product CLI activation status — no shell rc mutation advice beyond export.
 * @param {{
 *   homeDir?: string,
 *   binDir?: string,
 *   pathEnv?: string,
 *   existsSync?: typeof fs.existsSync,
 * }} [options]
 */
function assessPathActivation(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const binDir = options.binDir ?? defaultBinDir(homeDir);
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const existsSync = options.existsSync ?? fs.existsSync;
  const shimPath = path.join(binDir, 'ai-minions');
  const shimPresent = existsSync(shimPath);
  const onPath = pathIncludesDir(pathEnv, binDir);

  /** @type {'ready' | 'activation_required' | 'shim_missing'} */
  let status = 'shim_missing';
  if (shimPresent && onPath) {
    status = 'ready';
  } else if (shimPresent && !onPath) {
    status = 'activation_required';
  }

  return {
    status,
    bin_dir: binDir,
    shim_path: shimPath,
    shim_present: shimPresent,
    on_path: onPath,
    path_remediation: onPath ? null : `export PATH="${binDir}:$PATH"`,
    note: 'Installer does not mutate shell rc files — activate PATH manually when required',
  };
}

/**
 * Format credential block for human CLI output (status only).
 * @param {ReturnType<typeof assessProviderCredentials>} assessment
 * @returns {string[]}
 */
function formatCredentialStatusLines(assessment) {
  const lines = [
    `  model_policy:           ${assessment.model_policy}`,
    `  remote_tokens_required: ${assessment.remote_tokens_required}`,
    `  credential_note:        ${assessment.note}`,
    '  provider_credentials:',
  ];
  for (const p of assessment.providers) {
    const req = p.required_for_policy ? 'required' : 'optional';
    lines.push(`    - ${p.env_var}: ${p.status} (${req} for ${assessment.model_policy})`);
  }
  return lines;
}

module.exports = {
  SUPPORTED_PROVIDER_CREDENTIALS,
  SUPPORTED_ENDPOINT_ENV_VARS,
  assessProviderCredentials,
  assessPathActivation,
  remoteTokensRequired,
  formatCredentialStatusLines,
  defaultBinDir,
  pathIncludesDir,
  envValuePresent,
};
