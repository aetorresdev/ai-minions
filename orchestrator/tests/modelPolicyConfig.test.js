"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  DEFAULT_MODEL_POLICY,
  MODEL_POLICY_REL_PATH,
  cloneDefaultModelPolicy,
  validateModelPolicy,
  loadModelPolicyConfig,
  resolveRoleDefaultTier,
  listAllowedModelsForTier,
  rulesForTier,
} = require("../modules/model-runtime/model-policy-config");

const VALID_FIXTURE = path.join(__dirname, "fixtures", "model-policy-valid.json");

/**
 * @param {string|null} jsonContent
 * @param {(dir: string) => void} fn
 */
function withTempPolicy(jsonContent, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-policy-json-"));
  try {
    if (jsonContent !== null) {
      fs.mkdirSync(path.join(dir, ".ai-minions"), { recursive: true });
      fs.writeFileSync(path.join(dir, MODEL_POLICY_REL_PATH), jsonContent, "utf8");
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("model-policy-config", () => {
  it("DEFAULT_MODEL_POLICY includes documented role defaults", () => {
    assert.equal(DEFAULT_MODEL_POLICY.default_tier, "standard");
    assert.equal(DEFAULT_MODEL_POLICY.role_defaults.ARCHITECT, "strong");
    assert.equal(DEFAULT_MODEL_POLICY.role_defaults.CERBERUS, "strong");
    assert.ok(DEFAULT_MODEL_POLICY.rules.some((r) => r.name === "frontier_requires_reason"));
  });

  it("loadModelPolicyConfig returns documented defaults when file absent", () => {
    withTempPolicy(null, (dir) => {
      const loaded = loadModelPolicyConfig(dir);
      assert.equal(loaded.source, "default");
      assert.equal(loaded.path, null);
      assert.deepEqual(loaded.policy.role_defaults, DEFAULT_MODEL_POLICY.role_defaults);
      assert.equal(loaded.policy.default_tier, "standard");
    });
  });

  it("loadModelPolicyConfig loads valid policy from .ai-minions/model_policy.json", () => {
    const raw = fs.readFileSync(VALID_FIXTURE, "utf8");
    withTempPolicy(raw, (dir) => {
      const loaded = loadModelPolicyConfig(dir);
      assert.equal(loaded.source, "file");
      assert.ok(loaded.path?.endsWith(MODEL_POLICY_REL_PATH));
      assert.equal(loaded.policy.role_defaults.DEV, "standard");
      assert.deepEqual(loaded.policy.tiers.cheap, ["local-small", "haiku"]);
    });
  });

  it("validateModelPolicy rejects unsupported version", () => {
    assert.throws(
      () => validateModelPolicy({ model_policy_version: 99 }),
      /unsupported model_policy_version/,
    );
  });

  it("validateModelPolicy rejects invalid default_tier", () => {
    const base = JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8"));
    base.default_tier = "mythical";
    assert.throws(() => validateModelPolicy(base), /default_tier must be one of/);
  });

  it("validateModelPolicy rejects unknown tier names in tiers map", () => {
    const base = JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8"));
    base.tiers.ultra = ["x"];
    assert.throws(() => validateModelPolicy(base), /unknown tier names: ultra/);
  });

  it("validateModelPolicy rejects unknown roles in role_defaults", () => {
    const base = JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8"));
    base.role_defaults.SWARM_OVERLORD = "strong";
    assert.throws(() => validateModelPolicy(base), /unknown role in role_defaults/);
  });

  it("validateModelPolicy rejects invalid tier on role_defaults entry", () => {
    const base = JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8"));
    base.role_defaults.DEV = "banana";
    assert.throws(() => validateModelPolicy(base), /role_defaults\.DEV must be one of/);
  });

  it("loadModelPolicyConfig fails closed on malformed JSON", () => {
    withTempPolicy("{ not-json", (dir) => {
      assert.throws(() => loadModelPolicyConfig(dir), /Failed to parse model policy/);
    });
  });

  it("loadModelPolicyConfig fails closed on malformed policy content", () => {
    withTempPolicy(JSON.stringify({ model_policy_version: 1, default_tier: "nope" }), (dir) => {
      assert.throws(() => loadModelPolicyConfig(dir), /default_tier must be one of/);
    });
  });

  it("resolveRoleDefaultTier falls back to default_tier for unknown runtime role", () => {
    const policy = cloneDefaultModelPolicy();
    policy.default_tier = "cheap";
    assert.equal(resolveRoleDefaultTier(policy, "INTERN"), "cheap");
  });

  it("resolveRoleDefaultTier uses role_defaults for known MODE roles", () => {
    const policy = validateModelPolicy(JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8")));
    assert.equal(resolveRoleDefaultTier(policy, "architect"), "strong");
    assert.equal(resolveRoleDefaultTier(policy, "QA"), "standard");
  });

  it("listAllowedModelsForTier returns configured model ids", () => {
    const policy = validateModelPolicy(JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8")));
    assert.deepEqual(listAllowedModelsForTier(policy, "cheap"), ["local-small", "haiku"]);
    assert.deepEqual(listAllowedModelsForTier(policy, "standard"), ["sonnet"]);
  });

  it("rulesForTier returns matching policy rules", () => {
    const policy = validateModelPolicy(JSON.parse(fs.readFileSync(VALID_FIXTURE, "utf8")));
    const frontierRules = rulesForTier(policy, "frontier");
    assert.equal(frontierRules.length, 1);
    assert.deepEqual(frontierRules[0].requires, ["selection_reason"]);
    assert.equal(rulesForTier(policy, "cheap").length, 0);
  });
});
