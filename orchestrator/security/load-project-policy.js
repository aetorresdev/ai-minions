"use strict";

const path = require("path");
const fs = require("fs");

const VALID_PROFILES = ["dev-local", "ci-safe", "prod-guarded"];
const SUPPORTED_VERSION = 1;

// Actions that can never be permitted by project policy, regardless of allow rules
const ALWAYS_DENY_CLASSES = ["credential_reveal", "credential_export"];

// Dangerous actions that require scoped allows (not wildcards)
const GUARDED_ACTIONS = [
  "terraform_apply",
  "terraform_destroy",
  "kubectl_delete",
  "kubectl_apply",
  "gha_workflow_dispatch",
  "jenkins_build_trigger",
  "n8n_activate_workflow",
  "n8n_execute_workflow",
];

const yaml = require("js-yaml");

function parseYaml(raw) {
  return yaml.load(raw);
}

function validatePolicy(policy) {
  if (typeof policy !== "object" || policy === null) {
    throw new Error("Project policy must be a YAML object");
  }
  if (policy.permission_policy_version !== SUPPORTED_VERSION) {
    throw new Error(
      `Unsupported permission_policy_version: ${policy.permission_policy_version}. Expected: ${SUPPORTED_VERSION}`
    );
  }
  if (!policy.extends || !Array.isArray(policy.extends) || policy.extends.length === 0) {
    throw new Error("Project policy must declare 'extends' with at least one built-in profile");
  }
  for (const prof of policy.extends) {
    if (!VALID_PROFILES.includes(prof)) {
      throw new Error(`Project policy extends unknown profile: ${prof}. Valid: ${VALID_PROFILES.join(", ")}`);
    }
  }

  // Credential invariant — project policy can never override these
  if (policy.credentials) {
    if (policy.credentials.reveal && policy.credentials.reveal !== "deny") {
      throw new Error("Project policy cannot allow credential reveal");
    }
    if (policy.credentials.export && policy.credentials.export !== "deny") {
      throw new Error("Project policy cannot allow credential export");
    }
  }

  // Wildcard allow is forbidden; every entry must be a scoped object with known guarded action
  if (policy.dangerous_actions?.allow) {
    const allows = policy.dangerous_actions.allow;
    if (Array.isArray(allows)) {
      for (const entry of allows) {
        if (entry === "*") {
          throw new Error("Wildcard allow ('*') is forbidden in dangerous_actions.allow");
        }
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          throw new Error("Each dangerous_actions.allow entry must be a scoped object");
        }
        for (const key of ["id", "tool", "target_class"]) {
          if (typeof entry[key] !== "string" || entry[key].trim() === "") {
            throw new Error(
              "Each dangerous_actions.allow entry must include non-empty string 'id', 'tool', and 'target_class'"
            );
          }
        }
        if (!GUARDED_ACTIONS.includes(entry.id)) {
          throw new Error(`Unknown guarded action in dangerous_actions.allow: ${entry.id}`);
        }
      }
    }
  }

  // require_explicit_allow entries must be known guarded actions
  if (policy.dangerous_actions?.require_explicit_allow) {
    const reqs = policy.dangerous_actions.require_explicit_allow;
    if (!Array.isArray(reqs)) {
      throw new Error("dangerous_actions.require_explicit_allow must be an array");
    }
    for (const action of reqs) {
      if (!GUARDED_ACTIONS.includes(action)) {
        throw new Error(`Unknown guarded action in require_explicit_allow: ${action}`);
      }
    }
  }
}

/**
 * Load `.ai-minions/permissions.yaml` from the given repo root.
 * Returns null if the file does not exist (caller falls back to base profile).
 * Throws on parse error or schema violation (fail-safe).
 */
function loadProjectPolicy(repoRoot) {
  const policyPath = path.join(repoRoot, ".ai-minions", "permissions.yaml");
  if (!fs.existsSync(policyPath)) {
    return null;
  }
  const raw = fs.readFileSync(policyPath, "utf8");
  let parsed;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Failed to parse project policy at ${policyPath}: ${err.message}`);
  }
  validatePolicy(parsed);
  return parsed;
}

/**
 * Merge project policy on top of a resolved base profile.
 * Project policy can restrict but not expand beyond what the base profile allows.
 * Returns a merged policy descriptor with policy_source tracking.
 */
function mergeProjectPolicy(baseProfile, projectPolicy, profileName) {
  if (!projectPolicy) {
    return {
      profile: baseProfile,
      profile_name: profileName,
      project_capabilities: [],
      dangerous_actions: { require_explicit_allow: [] },
      runtime: {},
      credentials: { reveal: "deny", export: "deny" },
      policy_source: "built_in_profile",
    };
  }

  // Credentials invariant — always deny regardless of policy
  const credentials = { reveal: "deny", export: "deny" };

  // runtime flags from project policy (additive, does not loosen base)
  const runtime = Object.assign({}, projectPolicy.runtime || {});

  // dangerous_actions.require_explicit_allow is additive (more restrictions = ok)
  const requireExplicitAllow = projectPolicy.dangerous_actions?.require_explicit_allow || [];

  // scoped explicit allows — only valid if action is in GUARDED_ACTIONS and not in ALWAYS_DENY_CLASSES
  const explicitAllows = (projectPolicy.dangerous_actions?.allow || []).filter((entry) => {
    if (typeof entry === "string") return false; // plain strings not accepted (would be wildcard pattern)
    if (ALWAYS_DENY_CLASSES.includes(entry.id)) return false; // credential invariant
    return true;
  });

  return {
    profile: baseProfile,
    profile_name: profileName,
    project_capabilities: projectPolicy.project_capabilities || [],
    dangerous_actions: {
      require_explicit_allow: requireExplicitAllow,
      allow: explicitAllows,
    },
    runtime,
    credentials,
    policy_source: "project_policy",
  };
}

module.exports = {
  loadProjectPolicy,
  mergeProjectPolicy,
  validatePolicy,
  GUARDED_ACTIONS,
  ALWAYS_DENY_CLASSES,
};
