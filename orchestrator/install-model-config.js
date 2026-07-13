'use strict';

/**
 * Build and write .ai-minions install config from normalized discovery (adapter contract shape).
 * Current config-write phase: runtime YAML + governance JSON + optional install-profile evidence.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { rankDiscoveredModels } = require('./local-model-selection');
const {
  cloneDefaultModelPolicy,
  validateModelPolicy,
  validateProviderInferenceProfiles,
  detectModelRoutingConfigConflict,
  authorizeModelPolicyMigration,
  loadModelPolicyYamlRaw,
  createRoutingConfigError,
  MODEL_ROUTING_CONFIG_CONFLICT,
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
 *   backends: Array<{ backend_id: string, support_status: string, host: string, port: number, base_url?: string, endpoint_scope?: string }>,
 *   models: Array<{ name: string, backend_id: string, family?: string | null, size_bytes?: number | null }>,
 * }} discovery
 * @param {'local_only' | 'remote_ok' | null} modelPolicy
 * @param {{ defaultModelOverride?: string | null }} [options]
 */
function buildInstallModelConfig(discovery, modelPolicy = null, options = {}) {
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
  const rankedDefault = ranked[0].name;
  let resolvedDefault = rankedDefault;
  if (options.defaultModelOverride) {
    if (!models.some((m) => m.name === options.defaultModelOverride)) {
      throw new Error(
        `install-model-config: --model "${options.defaultModelOverride}" not found in discovered Ollama inventory`,
      );
    }
    resolvedDefault = options.defaultModelOverride;
  }
  const primaryBackend = discovery.backends?.[0];
  const host = primaryBackend?.host ?? 'localhost';
  const port = primaryBackend?.port ?? 11434;
  const families = [...new Set(models.map((m) => m.family).filter(Boolean))];

  const yamlPolicy = {
    model_policy_version: 1,
    default_model: resolvedDefault,
    local_backend: {
      backend_id: primaryBackend?.backend_id ?? 'ollama',
      support_status: primaryBackend?.support_status ?? 'supported',
      host,
      port,
      base_url: primaryBackend?.base_url ?? `http://${host}:${port}`,
      endpoint_scope: primaryBackend?.endpoint_scope ?? 'localhost',
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
    defaultModel: resolvedDefault,
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
 *   defaultModelOverride?: string | null,
 *   migrateModelPolicy?: boolean,
 *   force?: boolean,
 * }} [options]
 */
function writeInstallModelConfig(repoRoot, discovery, modelPolicy, options = {}) {
  const built = buildInstallModelConfig(discovery, modelPolicy, {
    defaultModelOverride: options.defaultModelOverride ?? null,
  });
  const targetDir = path.join(path.resolve(repoRoot), AI_MINIONS_DIR);
  const now = options.now ?? (() => new Date().toISOString());
  const migrate = options.migrateModelPolicy === true;
  const force = options.force === true;

  const yamlPath = path.join(targetDir, MODEL_POLICY_YAML);
  const jsonPath = path.join(targetDir, MODEL_POLICY_JSON);
  const profilePath = path.join(targetDir, INSTALL_PROFILE_JSON);
  const yamlExists = fs.existsSync(yamlPath);
  const jsonExists = fs.existsSync(jsonPath);
  const profileExists = fs.existsSync(profilePath);

  const auth = authorizeModelPolicyMigration({
    migrateModelPolicy: migrate,
    force,
    jsonExists,
  });

  if (migrate) {
    const yamlLoaded = loadModelPolicyYamlRaw(repoRoot);
    const existingJson = jsonExists
      ? validateModelPolicy(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))
      : null;
    const againstExisting = detectModelRoutingConfigConflict({
      yamlPolicy: yamlLoaded.policy,
      jsonPolicy: existingJson,
      jsonFilePresent: jsonExists,
    });
    if (!againstExisting.ok) {
      throw createRoutingConfigError(againstExisting.message, {
        code: againstExisting.code,
        reason: againstExisting.reason,
        fields: againstExisting.fields,
      });
    }
    const againstNew = detectModelRoutingConfigConflict({
      yamlPolicy: yamlLoaded.policy,
      jsonPolicy: built.jsonPolicy,
      jsonFilePresent: true,
    });
    if (!againstNew.ok) {
      throw createRoutingConfigError(againstNew.message, {
        code: againstNew.code,
        reason: againstNew.reason,
        fields: againstNew.fields,
      });
    }
  } else if (yamlExists) {
    // Fail closed before accidental dual SoT even when preserving files.
    const yamlLoaded = loadModelPolicyYamlRaw(repoRoot);
    const existingJson = jsonExists
      ? validateModelPolicy(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))
      : null;
    const conflict = detectModelRoutingConfigConflict({
      yamlPolicy: yamlLoaded.policy,
      jsonPolicy: existingJson,
      jsonFilePresent: jsonExists,
    });
    if (!conflict.ok) {
      throw createRoutingConfigError(conflict.message, {
        code: conflict.code,
        reason: conflict.reason,
        fields: conflict.fields,
      });
    }
  }

  /** @type {Record<string, string>} */
  const filesToWrite = {};
  /** @type {string[]} */
  const filesWritten = [];
  /** @type {string[]} */
  const filesPreserved = [];

  // YAML: create if absent; never overwrite existing (protects local_backend).
  if (!yamlExists) {
    filesToWrite[MODEL_POLICY_YAML] = built.yamlText;
    filesWritten.push(MODEL_POLICY_YAML);
  } else {
    filesPreserved.push(MODEL_POLICY_YAML);
  }

  // JSON: create if absent; overwrite only with --migrate-model-policy.
  if (!jsonExists) {
    filesToWrite[MODEL_POLICY_JSON] = built.jsonText;
    filesWritten.push(MODEL_POLICY_JSON);
  } else if (auth.allow_json_overwrite) {
    filesToWrite[MODEL_POLICY_JSON] = built.jsonText;
    filesWritten.push(MODEL_POLICY_JSON);
  } else {
    filesPreserved.push(MODEL_POLICY_JSON);
  }

  // install-profile: create if absent; refresh only on migrate.
  // Evidence lists must reflect the actual write/preserve set for this call.
  const writeProfile = !profileExists || migrate;
  if (writeProfile) {
    const writtenIncludingProfile = [...filesWritten, INSTALL_PROFILE_JSON];
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
      files_written: writtenIncludingProfile,
      files_preserved: [...filesPreserved],
      migrate_model_policy: migrate,
    };
    filesToWrite[INSTALL_PROFILE_JSON] = `${JSON.stringify(installProfile, null, 2)}\n`;
    filesWritten.push(INSTALL_PROFILE_JSON);
  } else {
    filesPreserved.push(INSTALL_PROFILE_JSON);
  }

  const writeFiles =
    options.writeFiles ??
    ((dir, fileMap) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(fileMap)) {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
      }
    });

  if (Object.keys(filesToWrite).length > 0) {
    writeFiles(targetDir, filesToWrite);
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return {
    config_dir: targetDir,
    files_written: filesWritten,
    files_preserved: filesPreserved,
    default_model: built.defaultModel,
    degraded_single_model: built.degradedSingleModel,
    inference_profiles_written: filesWritten.includes(MODEL_POLICY_JSON),
    inference_profile_mode: 'declarative',
    ranked_model_names: built.rankedModelNames,
    migrate_model_policy: migrate,
    force_ignored_for_routing: force && !migrate && jsonExists,
    routing_auth_reason: auth.reason,
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
  MODEL_ROUTING_CONFIG_CONFLICT,
};
