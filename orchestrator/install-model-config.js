'use strict';

/**
 * Build and write .ai-minions install config from normalized discovery (adapter contract shape).
 * E14-3: runtime YAML + governance JSON + optional install-profile evidence.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { rankDiscoveredModels } = require('./local-model-selection');
const {
  cloneDefaultModelPolicy,
  validateModelPolicy,
  validateProviderInferenceProfiles,
} = require('./modules/model-runtime/model-policy-config');
const { validateModelPolicy: validateRuntimeYamlPolicy } = require('./local-model-selection');

const AI_MINIONS_DIR = '.ai-minions';
const MODEL_POLICY_YAML = 'model-policy.yaml';
const MODEL_POLICY_JSON = 'model_policy.json';
const INSTALL_PROFILE_JSON = 'install-profile.json';

/**
 * @param {{ name: string, family?: string | null, size_bytes?: number | null }} model
 * @returns {'cheap' | 'standard' | 'strong'}
 */
function classifyModelTier(model) {
  const name = String(model.name ?? '').toLowerCase();
  const size = model.size_bytes ?? 0;
  if (/70b|72b|65b|405b|large|strong/i.test(name) || size > 20_000_000_000) {
    return 'strong';
  }
  if (/1b|1\.8b|3b|mini|tiny|small/i.test(name) || (size > 0 && size < 5_000_000_000)) {
    return 'cheap';
  }
  return 'standard';
}

/**
 * @param {Array<{ name: string, backend_id: string, family?: string | null, size_bytes?: number | null }>} models
 * @returns {{ cheap: string[], standard: string[], strong: string[], frontier: string[] }}
 */
function buildTierModelLists(models) {
  /** @type {{ cheap: string[], standard: string[], strong: string[], frontier: string[] }} */
  const tiers = { cheap: [], standard: [], strong: [], frontier: [] };
  for (const model of models) {
    const tier = classifyModelTier(model);
    if (!tiers[tier].includes(model.name)) {
      tiers[tier].push(model.name);
    }
  }
  if (tiers.standard.length === 0 && models.length > 0) {
    tiers.standard.push(models[0].name);
  }
  if (tiers.strong.length === 0 && models.length > 0) {
    const largest = [...models].sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0))[0];
    tiers.strong.push(largest.name);
  }
  return tiers;
}

/**
 * @param {'local_only' | 'remote_ok' | null} modelPolicy
 * @returns {Record<string, unknown>}
 */
function buildProviderInferenceProfiles(modelPolicy) {
  /** @type {Record<string, unknown>} */
  const profiles = {
    ollama: {
      default: {
        effort: 'medium',
        thinking_mode: 'disabled',
        thinking_display: 'omit',
        max_tokens: 8192,
        profile_source: 'installer_default',
      },
    },
  };
  if (modelPolicy === 'remote_ok' || modelPolicy === 'local_only' || modelPolicy == null) {
    profiles.anthropic = {
      default: {
        effort: 'medium',
        thinking_mode: 'disabled',
        thinking_display: 'omit',
        max_tokens: 8192,
        profile_source: 'installer_default',
      },
      by_role: {
        ARCHITECT: {
          effort: 'high',
          thinking_mode: 'adaptive',
          thinking_display: 'omit',
          max_tokens: 16384,
          profile_source: 'installer_default',
        },
        CERBERUS: {
          effort: 'medium',
          thinking_mode: 'disabled',
          thinking_display: 'omit',
          max_tokens: 8192,
          profile_source: 'installer_default',
        },
      },
    };
  }
  return profiles;
}

/**
 * @param {{
 *   backends: Array<{ backend_id: string, support_status: string, host: string, port: number }>,
 *   models: Array<{ name: string, backend_id: string, family?: string | null, size_bytes?: number | null }>,
 * }} discovery
 * @param {'local_only' | 'remote_ok' | null} modelPolicy
 */
function buildInstallModelConfig(discovery, modelPolicy = null) {
  const models = discovery.models ?? [];
  if (models.length === 0) {
    throw new Error('install-model-config: cannot build config without discovered models');
  }

  const ranked = rankDiscoveredModels(
    models.map((m) => ({
      name: m.name,
      backend: m.backend_id,
      family: m.family ?? null,
      size_bytes: m.size_bytes ?? null,
      context_length: null,
    })),
    null,
    { taskHint: 'code' },
  );
  const defaultModel = ranked[0].name;
  const primaryBackend = discovery.backends?.[0];
  const families = [...new Set(models.map((m) => m.family).filter(Boolean))];

  const yamlPolicy = {
    model_policy_version: 1,
    default_model: defaultModel,
    local_backend: {
      backend_id: primaryBackend?.backend_id ?? 'ollama',
      support_status: primaryBackend?.support_status ?? 'supported',
      host: primaryBackend?.host ?? 'localhost',
      port: primaryBackend?.port ?? 11434,
    },
    ...(families.length > 0 ? { prefer_families: families } : {}),
  };

  const jsonPolicy = cloneDefaultModelPolicy();
  jsonPolicy.tiers = buildTierModelLists(models);
  jsonPolicy.provider_inference_profiles = buildProviderInferenceProfiles(modelPolicy);

  validateRuntimeYamlPolicy(yamlPolicy);
  validateModelPolicy(jsonPolicy);
  validateProviderInferenceProfiles(jsonPolicy.provider_inference_profiles);

  const degradedSingleModel = models.length === 1;

  return {
    yamlPolicy,
    jsonPolicy,
    yamlText: yaml.dump(yamlPolicy, { lineWidth: 100, noRefs: true }),
    jsonText: `${JSON.stringify(jsonPolicy, null, 2)}\n`,
    defaultModel,
    degradedSingleModel,
    rankedModelNames: ranked.map((m) => m.name),
  };
}

/**
 * @param {string} repoRoot
 * @param {{
 *   backends: unknown[],
 *   models: unknown[],
 * }} discovery
 * @param {'local_only' | 'remote_ok' | null} modelPolicy
 * @param {{
 *   writeFiles?: (targetDir: string, files: Record<string, string>) => void,
 *   now?: () => string,
 * }} [options]
 */
function writeInstallModelConfig(repoRoot, discovery, modelPolicy, options = {}) {
  const built = buildInstallModelConfig(discovery, modelPolicy);
  const targetDir = path.join(path.resolve(repoRoot), AI_MINIONS_DIR);
  const now = options.now ?? (() => new Date().toISOString());

  const installProfile = {
    install_profile_version: 1,
    installed_at: now(),
    model_policy: modelPolicy,
    inference_profile_mode: 'declarative',
    discovery: {
      backend_ids: (discovery.backends ?? []).map((b) => b.backend_id),
      model_count: discovery.models?.length ?? 0,
      default_model: built.defaultModel,
      degraded_single_model: built.degradedSingleModel,
    },
    files_written: [MODEL_POLICY_YAML, MODEL_POLICY_JSON, INSTALL_PROFILE_JSON],
  };

  const files = {
    [MODEL_POLICY_YAML]: built.yamlText,
    [MODEL_POLICY_JSON]: built.jsonText,
    [INSTALL_PROFILE_JSON]: `${JSON.stringify(installProfile, null, 2)}\n`,
  };

  const writeFiles =
    options.writeFiles ??
    ((dir, fileMap) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(fileMap)) {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
      }
    });

  writeFiles(targetDir, files);

  return {
    config_dir: targetDir,
    files_written: Object.keys(files),
    default_model: built.defaultModel,
    degraded_single_model: built.degradedSingleModel,
    inference_profiles_written: true,
    inference_profile_mode: 'declarative',
    ranked_model_names: built.rankedModelNames,
  };
}

module.exports = {
  AI_MINIONS_DIR,
  MODEL_POLICY_YAML,
  MODEL_POLICY_JSON,
  INSTALL_PROFILE_JSON,
  classifyModelTier,
  buildTierModelLists,
  buildProviderInferenceProfiles,
  buildInstallModelConfig,
  writeInstallModelConfig,
};
