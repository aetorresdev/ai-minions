"use strict";

/**
 * Versioned model tier policy loader + routing config authority (REQ-011).
 * Canonical SoT for tiers/role_defaults is model_policy.json.
 * model-policy.yaml may bootstrap local_backend / legacy default_model only.
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const yaml = require("js-yaml");

const { MODEL_TIERS, TRACE_ROLES } = require("../trace/model-selection-trace");

/** Stable fail-closed code when YAML/JSON routing keys disagree or YAML claims routing without JSON. */
const MODEL_ROUTING_CONFIG_CONFLICT = "MODEL_ROUTING_CONFIG_CONFLICT";

/** E23 routing authority keys — only these participate in conflict detection. */
const ROUTING_AUTHORITY_KEYS = Object.freeze(["tiers", "role_defaults"]);

const MODEL_POLICY_YAML_FILENAME = "model-policy.yaml";
const MODEL_POLICY_YAML_REL_PATH = path.join(".ai-minions", MODEL_POLICY_YAML_FILENAME);

/**
 * @param {ModelPolicyConfig} policy
 */
function assertPolicyTierDefaultsAllowed(policy) {
  if (policy.default_tier === "frontier") {
    throw new Error("model_policy.json: default_tier cannot be frontier");
  }
  for (const [role, tier] of Object.entries(policy.role_defaults)) {
    if (tier === "frontier") {
      throw new Error(`model_policy.json: role_defaults.${role} cannot be frontier`);
    }
  }
}

const SUPPORTED_MODEL_POLICY_VERSION = 1;
const MODEL_POLICY_FILENAME = "model_policy.json";
const MODEL_POLICY_REL_PATH = path.join(".ai-minions", MODEL_POLICY_FILENAME);

/** @typedef {typeof MODEL_TIERS[number]} ModelTier */
/** @typedef {typeof TRACE_ROLES[number]} TraceRole */

/**
 * @typedef {{
 *   model_policy_version: number,
 *   default_tier: ModelTier,
 *   tiers: Record<ModelTier, string[]>,
 *   role_defaults: Partial<Record<TraceRole, ModelTier>>,
 *   rules: Array<{
 *     name: string,
 *     when: { model_tier: ModelTier },
 *     requires: string[],
 *   }>,
 * }} ModelPolicyConfig
 */

/** @type {ModelPolicyConfig} */
const DEFAULT_MODEL_POLICY = Object.freeze({
  model_policy_version: SUPPORTED_MODEL_POLICY_VERSION,
  default_tier: "standard",
  tiers: {
    cheap: [],
    standard: [],
    strong: [],
    frontier: [],
  },
  role_defaults: {
    ORCHESTRATOR: "standard",
    OWNER: "standard",
    ARCHITECT: "strong",
    DEV: "standard",
    QA: "standard",
    CERBERUS: "strong",
  },
  rules: [
    {
      name: "frontier_requires_reason",
      when: { model_tier: "frontier" },
      requires: ["selection_reason"],
    },
  ],
});

/**
 * @param {unknown} tier
 * @returns {tier is ModelTier}
 */
function isModelTier(tier) {
  return typeof tier === "string" && MODEL_TIERS.includes(/** @type {ModelTier} */ (tier));
}

/**
 * @param {unknown} role
 * @returns {role is TraceRole}
 */
function isTraceRole(role) {
  return typeof role === "string" && TRACE_ROLES.includes(/** @type {TraceRole} */ (role));
}

/**
 * @returns {ModelPolicyConfig}
 */
function cloneDefaultModelPolicy() {
  return {
    model_policy_version: DEFAULT_MODEL_POLICY.model_policy_version,
    default_tier: DEFAULT_MODEL_POLICY.default_tier,
    tiers: {
      cheap: [...DEFAULT_MODEL_POLICY.tiers.cheap],
      standard: [...DEFAULT_MODEL_POLICY.tiers.standard],
      strong: [...DEFAULT_MODEL_POLICY.tiers.strong],
      frontier: [...DEFAULT_MODEL_POLICY.tiers.frontier],
    },
    role_defaults: { ...DEFAULT_MODEL_POLICY.role_defaults },
    rules: DEFAULT_MODEL_POLICY.rules.map((rule) => ({
      name: rule.name,
      when: { model_tier: rule.when.model_tier },
      requires: [...rule.requires],
    })),
  };
}

/**
 * @param {unknown} raw
 * @returns {ModelPolicyConfig}
 */
function validateModelPolicy(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("model_policy.json: root must be a JSON object");
  }

  const policy = /** @type {Record<string, unknown>} */ (raw);

  if (policy.model_policy_version !== SUPPORTED_MODEL_POLICY_VERSION) {
    throw new Error(
      `model_policy.json: unsupported model_policy_version ${String(policy.model_policy_version)} (expected ${SUPPORTED_MODEL_POLICY_VERSION})`,
    );
  }

  if (!isModelTier(policy.default_tier)) {
    throw new Error(
      `model_policy.json: default_tier must be one of ${MODEL_TIERS.join(", ")}`,
    );
  }

  if (typeof policy.tiers !== "object" || policy.tiers === null || Array.isArray(policy.tiers)) {
    throw new Error("model_policy.json: tiers must be an object");
  }

  /** @type {Record<ModelTier, string[]>} */
  const tiers = {
    cheap: [],
    standard: [],
    strong: [],
    frontier: [],
  };

  for (const tier of MODEL_TIERS) {
    const entry = /** @type {Record<string, unknown>} */ (policy.tiers)[tier];
    if (entry === undefined) {
      throw new Error(`model_policy.json: tiers.${tier} is required`);
    }
    if (!Array.isArray(entry)) {
      throw new Error(`model_policy.json: tiers.${tier} must be an array`);
    }
    for (const modelId of entry) {
      if (typeof modelId !== "string" || !modelId.trim()) {
        throw new Error(`model_policy.json: tiers.${tier} entries must be non-empty strings`);
      }
      tiers[tier].push(modelId.trim());
    }
  }

  const extraTierKeys = Object.keys(/** @type {object} */ (policy.tiers)).filter(
    (key) => !MODEL_TIERS.includes(/** @type {ModelTier} */ (key)),
  );
  if (extraTierKeys.length > 0) {
    throw new Error(
      `model_policy.json: unknown tier names: ${extraTierKeys.join(", ")}`,
    );
  }

  if (typeof policy.role_defaults !== "object" || policy.role_defaults === null || Array.isArray(policy.role_defaults)) {
    throw new Error("model_policy.json: role_defaults must be an object");
  }

  /** @type {Partial<Record<TraceRole, ModelTier>>} */
  const roleDefaults = {};
  for (const [role, tier] of Object.entries(/** @type {Record<string, unknown>} */ (policy.role_defaults))) {
    if (!isTraceRole(role)) {
      throw new Error(`model_policy.json: unknown role in role_defaults: ${role}`);
    }
    if (!isModelTier(tier)) {
      throw new Error(
        `model_policy.json: role_defaults.${role} must be one of ${MODEL_TIERS.join(", ")}`,
      );
    }
    roleDefaults[role] = tier;
  }

  if (!Array.isArray(policy.rules)) {
    throw new Error("model_policy.json: rules must be an array");
  }

  /** @type {ModelPolicyConfig["rules"]} */
  const rules = [];
  for (let i = 0; i < policy.rules.length; i += 1) {
    const rule = policy.rules[i];
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      throw new Error(`model_policy.json: rules[${i}] must be an object`);
    }
    const ruleObj = /** @type {Record<string, unknown>} */ (rule);
    if (typeof ruleObj.name !== "string" || !ruleObj.name.trim()) {
      throw new Error(`model_policy.json: rules[${i}].name must be a non-empty string`);
    }
    if (typeof ruleObj.when !== "object" || ruleObj.when === null || Array.isArray(ruleObj.when)) {
      throw new Error(`model_policy.json: rules[${i}].when must be an object`);
    }
    const whenTier = /** @type {Record<string, unknown>} */ (ruleObj.when).model_tier;
    if (!isModelTier(whenTier)) {
      throw new Error(
        `model_policy.json: rules[${i}].when.model_tier must be one of ${MODEL_TIERS.join(", ")}`,
      );
    }
    if (!Array.isArray(ruleObj.requires)) {
      throw new Error(`model_policy.json: rules[${i}].requires must be an array`);
    }
    const requires = [];
    for (const req of ruleObj.requires) {
      if (typeof req !== "string" || !req.trim()) {
        throw new Error(`model_policy.json: rules[${i}].requires entries must be non-empty strings`);
      }
      requires.push(req.trim());
    }
    rules.push({
      name: ruleObj.name.trim(),
      when: { model_tier: whenTier },
      requires,
    });
  }

  const normalized = {
    model_policy_version: SUPPORTED_MODEL_POLICY_VERSION,
    default_tier: policy.default_tier,
    tiers,
    role_defaults: roleDefaults,
    rules,
  };
  if (policy.provider_inference_profiles !== undefined) {
    normalized.provider_inference_profiles = validateProviderInferenceProfiles(
      policy.provider_inference_profiles,
    );
  }
  assertPolicyTierDefaultsAllowed(normalized);
  return normalized;
}

const INFERENCE_EFFORTS = new Set(['low', 'medium', 'high']);
const INFERENCE_THINKING_MODES = new Set(['disabled', 'adaptive', 'enabled']);
const INFERENCE_THINKING_DISPLAY = new Set(['omit', 'summary', 'full']);

/**
 * @param {unknown} profile
 * @param {string} label
 */
function validateInferenceProfileEntry(profile, label) {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
    throw new Error(`provider_inference_profiles: ${label} must be an object`);
  }
  const entry = /** @type {Record<string, unknown>} */ (profile);
  if (!INFERENCE_EFFORTS.has(String(entry.effort))) {
    throw new Error(`provider_inference_profiles: ${label}.effort must be low|medium|high`);
  }
  if (!INFERENCE_THINKING_MODES.has(String(entry.thinking_mode))) {
    throw new Error(
      `provider_inference_profiles: ${label}.thinking_mode must be disabled|adaptive|enabled`,
    );
  }
  if (!INFERENCE_THINKING_DISPLAY.has(String(entry.thinking_display))) {
    throw new Error(
      `provider_inference_profiles: ${label}.thinking_display must be omit|summary|full`,
    );
  }
  const maxTokens = Number(entry.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error(`provider_inference_profiles: ${label}.max_tokens must be a positive number`);
  }
  if (entry.profile_source != null && typeof entry.profile_source !== 'string') {
    throw new Error(`provider_inference_profiles: ${label}.profile_source must be a string`);
  }
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function validateProviderInferenceProfiles(raw) {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider_inference_profiles must be an object');
  }
  const root = /** @type {Record<string, unknown>} */ (raw);
  for (const [providerId, providerProfile] of Object.entries(root)) {
    if (typeof providerProfile !== 'object' || providerProfile === null || Array.isArray(providerProfile)) {
      throw new Error(`provider_inference_profiles.${providerId} must be an object`);
    }
    const pp = /** @type {Record<string, unknown>} */ (providerProfile);
    if (pp.default != null) {
      validateInferenceProfileEntry(pp.default, `${providerId}.default`);
    }
    if (pp.by_role != null) {
      if (typeof pp.by_role !== 'object' || Array.isArray(pp.by_role)) {
        throw new Error(`provider_inference_profiles.${providerId}.by_role must be an object`);
      }
      for (const [role, roleProfile] of Object.entries(/** @type {Record<string, unknown>} */ (pp.by_role))) {
        validateInferenceProfileEntry(roleProfile, `${providerId}.by_role.${role}`);
      }
    }
  }
  return root;
}

/**
 * @param {string} filePath
 * @param {string} raw
 * @returns {ModelPolicyConfig}
 */
function parseModelPolicyJson(filePath, raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse model policy at ${filePath}: ${msg}`);
  }
  try {
    return validateModelPolicy(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg} (file: ${filePath})`);
  }
}

/**
 * @param {string} [cwd]
 * @returns {string}
 */
function resolveModelPolicyPath(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), MODEL_POLICY_REL_PATH);
}

/**
 * @param {string} [cwd]
 * @returns {{ source: "default" | "file", path: string | null, policy: ModelPolicyConfig }}
 */
function loadModelPolicyConfig(cwd = process.cwd()) {
  const policyPath = resolveModelPolicyPath(cwd);
  if (!fs.existsSync(policyPath)) {
    return {
      source: "default",
      path: null,
      policy: cloneDefaultModelPolicy(),
    };
  }
  const raw = fs.readFileSync(policyPath, "utf8");
  return {
    source: "file",
    path: policyPath,
    policy: parseModelPolicyJson(policyPath, raw),
  };
}

/**
 * @param {ModelPolicyConfig} policy
 * @param {string} role
 * @returns {ModelTier}
 */
function resolveRoleDefaultTier(policy, role) {
  const normalized = String(role ?? "").toUpperCase().replace(/-/g, "_");
  if (isTraceRole(normalized) && policy.role_defaults[normalized]) {
    return policy.role_defaults[normalized];
  }
  return policy.default_tier;
}

/**
 * @param {ModelPolicyConfig} policy
 * @param {ModelTier} tier
 * @returns {string[]}
 */
function listAllowedModelsForTier(policy, tier) {
  return [...(policy.tiers[tier] ?? [])];
}

/**
 * @param {ModelPolicyConfig} policy
 * @param {ModelTier} tier
 * @returns {ModelPolicyConfig["rules"]}
 */
function rulesForTier(policy, tier) {
  return policy.rules.filter((rule) => rule.when.model_tier === tier);
}

/**
 * @param {string} [cwd]
 * @returns {string}
 */
function resolveModelPolicyYamlPath(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), MODEL_POLICY_YAML_REL_PATH);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForCompare(entry));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(/** @type {Record<string, unknown>} */ (value)).sort()) {
      out[key] = canonicalizeForCompare(/** @type {Record<string, unknown>} */ (value)[key]);
    }
    return out;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

/**
 * Structural equality independent of key order.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function routingValuesEqual(a, b) {
  return JSON.stringify(canonicalizeForCompare(a)) === JSON.stringify(canonicalizeForCompare(b));
}

/**
 * @param {Record<string, unknown> | null | undefined} yamlPolicy
 * @param {string} key
 * @returns {boolean}
 */
function yamlDeclaresRoutingKey(yamlPolicy, key) {
  if (!yamlPolicy || typeof yamlPolicy !== "object" || Array.isArray(yamlPolicy)) return false;
  return Object.prototype.hasOwnProperty.call(yamlPolicy, key)
    && yamlPolicy[key] !== undefined
    && yamlPolicy[key] !== null;
}

/**
 * @param {string} [cwd]
 * @returns {{ path: string | null, policy: Record<string, unknown> | null, raw: string | null }}
 */
function loadModelPolicyYamlRaw(cwd = process.cwd()) {
  const yamlPath = resolveModelPolicyYamlPath(cwd);
  if (!fs.existsSync(yamlPath)) {
    return { path: null, policy: null, raw: null };
  }
  const raw = fs.readFileSync(yamlPath, "utf8");
  const parsed = yaml.load(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`model-policy.yaml: root must be a YAML object (file: ${yamlPath})`);
  }
  return {
    path: yamlPath,
    policy: /** @type {Record<string, unknown>} */ (parsed),
    raw,
  };
}

/**
 * @param {string} message
 * @param {{
 *   code?: string,
 *   reason?: string,
 *   fields?: string[],
 * }} [detail]
 * @returns {Error & { code: string, reason?: string, fields: string[] }}
 */
function createRoutingConfigError(message, detail = {}) {
  const err = /** @type {Error & { code: string, reason?: string, fields: string[] }} */ (
    new Error(message)
  );
  err.code = detail.code || MODEL_ROUTING_CONFIG_CONFLICT;
  if (detail.reason) err.reason = detail.reason;
  err.fields = Array.isArray(detail.fields) ? [...detail.fields] : [];
  return err;
}

/**
 * Detect YAML↔JSON conflict on routing authority keys only (`tiers`, `role_defaults`).
 * JSON is always authority when present; YAML never wins or merges.
 *
 * @param {{
 *   yamlPolicy?: Record<string, unknown> | null,
 *   jsonPolicy?: ModelPolicyConfig | null,
 *   jsonFilePresent?: boolean,
 * }} input
 * @returns {{
 *   ok: true,
 *   declared_fields: string[],
 * } | {
 *   ok: false,
 *   code: string,
 *   reason: string,
 *   fields: string[],
 *   message: string,
 * }}
 */
function detectModelRoutingConfigConflict(input = {}) {
  const yamlPolicy = input.yamlPolicy ?? null;
  const jsonFilePresent = input.jsonFilePresent === true;
  const jsonPolicy = input.jsonPolicy ?? null;

  /** @type {string[]} */
  const declared = [];
  for (const key of ROUTING_AUTHORITY_KEYS) {
    if (yamlDeclaresRoutingKey(yamlPolicy, key)) declared.push(key);
  }

  if (declared.length === 0) {
    return { ok: true, declared_fields: [] };
  }

  if (!jsonFilePresent || !jsonPolicy) {
    return {
      ok: false,
      code: MODEL_ROUTING_CONFIG_CONFLICT,
      reason: "yaml_routing_without_canonical_json",
      fields: declared,
      message:
        `${MODEL_ROUTING_CONFIG_CONFLICT}: model-policy.yaml declares routing keys (${declared.join(", ")}) `
        + "but model_policy.json is absent — migrate explicitly; YAML cannot become routing SoT",
    };
  }

  /** @type {string[]} */
  const mismatched = [];
  for (const key of declared) {
    const yamlValue = /** @type {Record<string, unknown>} */ (yamlPolicy)[key];
    const jsonValue = /** @type {Record<string, unknown>} */ (jsonPolicy)[key];
    if (!routingValuesEqual(yamlValue, jsonValue)) {
      mismatched.push(key);
    }
  }
  if (mismatched.length > 0) {
    return {
      ok: false,
      code: MODEL_ROUTING_CONFIG_CONFLICT,
      reason: "yaml_json_routing_disagree",
      fields: mismatched,
      message:
        `${MODEL_ROUTING_CONFIG_CONFLICT}: routing keys disagree between model-policy.yaml and model_policy.json: `
        + mismatched.join(", "),
    };
  }

  return { ok: true, declared_fields: declared };
}

/**
 * @param {{
 *   defaultModel?: string | null,
 * }} [options]
 * @returns {{
 *   provider_id: string,
 *   endpoint_ref: string,
 *   model: string | null,
 *   route_source: "legacy_default",
 * }}
 */
function normalizeLegacyRouting(options = {}) {
  const model = options.defaultModel != null && String(options.defaultModel).trim()
    ? String(options.defaultModel).trim()
    : null;
  return {
    provider_id: "ollama",
    endpoint_ref: "default",
    model,
    route_source: "legacy_default",
  };
}

/**
 * Load canonical routing authority for a project cwd.
 * Does not claim tier routing already drives invocations (that is a later slice).
 *
 * @param {string} [cwd]
 * @returns {{
 *   route_source: "model_policy_json" | "legacy_default",
 *   json_present: boolean,
 *   json_path: string | null,
 *   yaml_path: string | null,
 *   policy: ModelPolicyConfig | null,
 *   legacy: ReturnType<typeof normalizeLegacyRouting> | null,
 *   yaml_declared_routing_fields: string[],
 * }}
 */
function loadCanonicalRoutingConfig(cwd = process.cwd()) {
  const jsonPath = resolveModelPolicyPath(cwd);
  const jsonPresent = fs.existsSync(jsonPath);
  const yamlLoaded = loadModelPolicyYamlRaw(cwd);

  let jsonPolicy = null;
  if (jsonPresent) {
    jsonPolicy = parseModelPolicyJson(jsonPath, fs.readFileSync(jsonPath, "utf8"));
  }

  const conflict = detectModelRoutingConfigConflict({
    yamlPolicy: yamlLoaded.policy,
    jsonPolicy,
    jsonFilePresent: jsonPresent,
  });
  if (!conflict.ok) {
    throw createRoutingConfigError(conflict.message, {
      code: conflict.code,
      reason: conflict.reason,
      fields: conflict.fields,
    });
  }

  if (jsonPresent && jsonPolicy) {
    return {
      route_source: "model_policy_json",
      json_present: true,
      json_path: jsonPath,
      yaml_path: yamlLoaded.path,
      policy: jsonPolicy,
      legacy: null,
      yaml_declared_routing_fields: conflict.declared_fields,
    };
  }

  const defaultModel = yamlLoaded.policy
    && typeof yamlLoaded.policy.default_model === "string"
    ? yamlLoaded.policy.default_model
    : null;

  return {
    route_source: "legacy_default",
    json_present: false,
    json_path: null,
    yaml_path: yamlLoaded.path,
    policy: null,
    legacy: normalizeLegacyRouting({ defaultModel }),
    yaml_declared_routing_fields: [],
  };
}

/**
 * Authorize whether install/init may rewrite model_policy.json.
 * `--force` alone never grants permission to destroy hand-edited routing JSON.
 *
 * @param {{
 *   migrateModelPolicy?: boolean,
 *   force?: boolean,
 *   jsonExists?: boolean,
 * }} [options]
 * @returns {{
 *   allow_json_write: boolean,
 *   allow_json_overwrite: boolean,
 *   reason: string,
 * }}
 */
function authorizeModelPolicyMigration(options = {}) {
  const migrate = options.migrateModelPolicy === true;
  const force = options.force === true;
  const jsonExists = options.jsonExists === true;

  if (!jsonExists) {
    return {
      allow_json_write: true,
      allow_json_overwrite: false,
      reason: "json_absent_create_allowed",
    };
  }

  if (migrate) {
    return {
      allow_json_write: true,
      allow_json_overwrite: true,
      reason: "migrate_model_policy",
    };
  }

  if (force) {
    return {
      allow_json_write: false,
      allow_json_overwrite: false,
      reason: "force_without_migrate_preserves_json",
    };
  }

  return {
    allow_json_write: false,
    allow_json_overwrite: false,
    reason: "preserve_existing_json",
  };
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function fileSha256OrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

module.exports = {
  SUPPORTED_MODEL_POLICY_VERSION,
  MODEL_POLICY_FILENAME,
  MODEL_POLICY_REL_PATH,
  MODEL_POLICY_YAML_FILENAME,
  MODEL_POLICY_YAML_REL_PATH,
  MODEL_ROUTING_CONFIG_CONFLICT,
  ROUTING_AUTHORITY_KEYS,
  DEFAULT_MODEL_POLICY,
  cloneDefaultModelPolicy,
  validateModelPolicy,
  parseModelPolicyJson,
  resolveModelPolicyPath,
  resolveModelPolicyYamlPath,
  loadModelPolicyConfig,
  loadModelPolicyYamlRaw,
  resolveRoleDefaultTier,
  listAllowedModelsForTier,
  rulesForTier,
  assertPolicyTierDefaultsAllowed,
  validateProviderInferenceProfiles,
  canonicalizeForCompare,
  routingValuesEqual,
  yamlDeclaresRoutingKey,
  detectModelRoutingConfigConflict,
  normalizeLegacyRouting,
  loadCanonicalRoutingConfig,
  authorizeModelPolicyMigration,
  createRoutingConfigError,
  fileSha256OrNull,
};
