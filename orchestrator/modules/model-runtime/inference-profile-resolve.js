/**
 * Resolve Ollama num_predict from env + provider_inference_profiles (ollama).
 * Precedence: OLLAMA_NUM_PREDICT → by_role max_tokens → default max_tokens → 2048.
 *
 * Config lookup: run/goal cwd first, then AI_MINIONS_HOME / REPO_ROOT when that
 * points at a product install with .ai-minions config. Without this, runs
 * launched outside the clone (e.g. cwd=/Users/cerberus) silently fall back to
 * 2048 even though install wrote 8192 into the product config.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadModelPolicyConfig } = require('./model-policy-config');

const DEFAULT_NUM_PREDICT = 2048;
const TRACE_ROLES = new Set([
  'ORCHESTRATOR',
  'OWNER',
  'ARCHITECT',
  'DEV',
  'QA',
  'CERBERUS',
]);

/**
 * @param {unknown} role
 * @returns {string | null}
 */
function normalizeTraceRole(role) {
  const raw = String(role ?? '').trim().toUpperCase().replace(/-/g, '_');
  if (!raw) return null;
  if (TRACE_ROLES.has(raw)) return raw;
  if (raw.startsWith('DEV_')) return 'DEV';
  return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveInt(value) {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * @param {{
 *   cwd?: string,
 *   role?: string | null,
 *   env?: NodeJS.ProcessEnv,
 *   loadPolicy?: typeof loadModelPolicyConfig,
 * }} [options]
 * @returns {{
 *   num_predict: number,
 *   profile_source: string | null,
 *   inference_profile_mode: 'applied' | 'env' | 'default',
 *   role: string | null,
 * }}
 */
function resolveOllamaNumPredict(options = {}) {
  const env = options.env ?? process.env;
  const envPredict = positiveInt(env.OLLAMA_NUM_PREDICT);
  if (envPredict != null) {
    return {
      num_predict: envPredict,
      profile_source: 'env_ollama_num_predict',
      inference_profile_mode: 'env',
      role: normalizeTraceRole(options.role),
    };
  }

  const loadPolicy = options.loadPolicy ?? loadModelPolicyConfig;
  const envMap = options.env ?? process.env;
  const baseCwd = options.cwd != null ? String(options.cwd) : process.cwd();

  const candidates = [baseCwd];
  for (const key of ['AI_MINIONS_HOME', 'REPO_ROOT']) {
    const raw = envMap[key];
    if (raw && String(raw).trim()) {
      candidates.push(path.resolve(String(raw).trim()));
    }
  }

  let policy = null;
  let policyLoadError = null;
  for (const candidate of candidates) {
    const hasConfig =
      fs.existsSync(path.join(candidate, '.ai-minions', 'model_policy.json'))
      || fs.existsSync(path.join(candidate, '.ai-minions', 'model-policy.yaml'));
    if (!hasConfig) continue;
    try {
      policy = loadPolicy(candidate).policy;
      break;
    } catch (err) {
      policyLoadError = err;
      policy = null;
      break;
    }
  }
  if (!policy && policyLoadError) {
    return {
      num_predict: DEFAULT_NUM_PREDICT,
      profile_source: null,
      inference_profile_mode: 'default',
      role: normalizeTraceRole(options.role),
    };
  }
  if (!policy) {
    try {
      policy = loadPolicy(baseCwd).policy;
    } catch {
      return {
        num_predict: DEFAULT_NUM_PREDICT,
        profile_source: null,
        inference_profile_mode: 'default',
        role: normalizeTraceRole(options.role),
      };
    }
  }

  const profiles = policy?.provider_inference_profiles?.ollama;
  const role = normalizeTraceRole(options.role);
  const roleEntry = role && profiles?.by_role && typeof profiles.by_role === 'object'
    ? profiles.by_role[role]
    : null;
  const defaultEntry = profiles?.default && typeof profiles.default === 'object'
    ? profiles.default
    : null;

  const roleTokens = roleEntry ? positiveInt(roleEntry.max_tokens) : null;
  if (roleTokens != null) {
    return {
      num_predict: roleTokens,
      profile_source: typeof roleEntry.profile_source === 'string'
        ? roleEntry.profile_source
        : 'model_policy_json',
      inference_profile_mode: 'applied',
      role,
    };
  }

  const defaultTokens = defaultEntry ? positiveInt(defaultEntry.max_tokens) : null;
  if (defaultTokens != null) {
    return {
      num_predict: defaultTokens,
      profile_source: typeof defaultEntry.profile_source === 'string'
        ? defaultEntry.profile_source
        : 'model_policy_json',
      inference_profile_mode: 'applied',
      role,
    };
  }

  return {
    num_predict: DEFAULT_NUM_PREDICT,
    profile_source: null,
    inference_profile_mode: 'default',
    role,
  };
}

module.exports = {
  DEFAULT_NUM_PREDICT,
  resolveOllamaNumPredict,
  normalizeTraceRole,
};
