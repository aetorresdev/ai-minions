"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { DEFAULT_MODE, DEFAULT_AGENT_PERMISSIONS } = require("./constants");

const CONFIG_REL = path.join(".ai-minions", "merge-governance.yaml");
const ENV_CONFIG_PATH = "ORCH_MERGE_GOVERNANCE_CONFIG";

/**
 * @param {unknown} raw
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
function validateMergeGovernanceConfig(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "merge governance config must be a YAML object" };
  }
  const mg = raw.merge_governance;
  if (typeof mg !== "object" || mg === null || Array.isArray(mg)) {
    return { ok: false, error: "merge_governance key is required" };
  }
  const mode = mg.mode != null ? String(mg.mode) : DEFAULT_MODE;
  if (mode !== DEFAULT_MODE) {
    return { ok: false, error: `unsupported merge_governance.mode: ${mode}` };
  }
  for (const key of [
    "protected_branches",
    "production_branches",
    "release_branches",
    "tag_sources",
  ]) {
    if (mg[key] != null && !Array.isArray(mg[key])) {
      return { ok: false, error: `merge_governance.${key} must be an array when present` };
    }
  }
  const perms = mg.agent_permissions;
  if (perms != null && (typeof perms !== "object" || Array.isArray(perms))) {
    return { ok: false, error: "merge_governance.agent_permissions must be an object" };
  }
  return {
    ok: true,
    config: {
      mode,
      protected_branches: Array.isArray(mg.protected_branches) ? mg.protected_branches.map(String) : [],
      production_branches: Array.isArray(mg.production_branches) ? mg.production_branches.map(String) : [],
      release_branches: Array.isArray(mg.release_branches) ? mg.release_branches.map(String) : [],
      tag_sources: Array.isArray(mg.tag_sources) ? mg.tag_sources.map(String) : [],
      default_branch: mg.default_branch != null ? String(mg.default_branch) : null,
      agent_permissions: Object.assign({}, DEFAULT_AGENT_PERMISSIONS, perms || {}),
    },
  };
}

/**
 * Load explicit operator merge governance config. Never invents policy.
 *
 * @param {string} repoRoot
 * @returns {{ ok: boolean, config: object | null, source: string | null, error: string | null }}
 */
function loadMergeGovernanceConfig(repoRoot) {
  const envPath = process.env[ENV_CONFIG_PATH];
  const candidates = [];
  if (envPath && String(envPath).trim()) {
    candidates.push({ path: path.resolve(String(envPath)), source: "env" });
  }
  if (repoRoot && String(repoRoot).trim()) {
    candidates.push({
      path: path.join(path.resolve(repoRoot), CONFIG_REL),
      source: "repo",
    });
  }
  for (const { path: configPath, source } of candidates) {
    if (!fs.existsSync(configPath)) continue;
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      return {
        ok: false,
        config: null,
        source,
        error: `cannot parse merge governance config: ${err.message}`,
      };
    }
    const validated = validateMergeGovernanceConfig(raw);
    if (!validated.ok) {
      return { ok: false, config: null, source, error: validated.error };
    }
    return { ok: true, config: validated.config, source, error: null };
  }
  return { ok: true, config: null, source: null, error: null };
}

module.exports = {
  CONFIG_REL,
  ENV_CONFIG_PATH,
  validateMergeGovernanceConfig,
  loadMergeGovernanceConfig,
};
