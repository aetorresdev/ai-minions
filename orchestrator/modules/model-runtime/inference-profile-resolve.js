/**
 * Resolve Ollama num_predict from env + provider_inference_profiles (ollama).
 * Precedence: OLLAMA_NUM_PREDICT → by_role max_tokens → default max_tokens → 2048.
 */

'use strict';

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
  const cwd = options.cwd != null ? String(options.cwd) : process.cwd();
  let policy;
  try {
    policy = loadPolicy(cwd).policy;
  } catch {
    return {
      num_predict: DEFAULT_NUM_PREDICT,
      profile_source: null,
      inference_profile_mode: 'default',
      role: normalizeTraceRole(options.role),
    };
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
