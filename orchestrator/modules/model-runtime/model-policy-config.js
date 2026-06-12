"use strict";

/**
 * Versioned model tier policy loader — governance config only.
 * Does not change model selection or routing (policy loader slice).
 */

const path = require("node:path");
const fs = require("node:fs");

const { MODEL_TIERS, TRACE_ROLES } = require("../trace/model-selection-trace");

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

  return {
    model_policy_version: SUPPORTED_MODEL_POLICY_VERSION,
    default_tier: policy.default_tier,
    tiers,
    role_defaults: roleDefaults,
    rules,
  };
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

module.exports = {
  SUPPORTED_MODEL_POLICY_VERSION,
  MODEL_POLICY_FILENAME,
  MODEL_POLICY_REL_PATH,
  DEFAULT_MODEL_POLICY,
  cloneDefaultModelPolicy,
  validateModelPolicy,
  parseModelPolicyJson,
  resolveModelPolicyPath,
  loadModelPolicyConfig,
  resolveRoleDefaultTier,
  listAllowedModelsForTier,
  rulesForTier,
};
