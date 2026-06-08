"use strict";

const { branchMatchesAnyPattern } = require("./branch-pattern");

/**
 * @typedef {object} BranchPolicyPosture
 * @property {"full"|"limited"|"unknown"} permission_visibility
 * @property {string | null} default_branch
 * @property {"known"|"unknown"|"not_protected"} protected_status
 * @property {boolean} rulesets_visible
 * @property {boolean} required_checks_visible
 * @property {boolean} required_reviews_visible
 * @property {boolean} release_sensitive
 * @property {"config"|"github_api"|"none"} policy_source
 */

/**
 * @param {string} targetBranch
 * @param {object | null} explicitConfig
 * @returns {boolean}
 */
function isProtectedByConfig(targetBranch, explicitConfig) {
  if (!explicitConfig) return false;
  return branchMatchesAnyPattern(targetBranch, explicitConfig.protected_branches || []);
}

/**
 * @param {string} targetBranch
 * @param {object | null} explicitConfig
 * @returns {boolean}
 */
function isReleaseSensitiveByConfig(targetBranch, explicitConfig) {
  if (!explicitConfig) return false;
  const lists = [
    explicitConfig.production_branches,
    explicitConfig.release_branches,
    explicitConfig.tag_sources,
  ];
  return lists.some((arr) => branchMatchesAnyPattern(targetBranch, arr || []));
}

/**
 * @param {string} targetBranch
 * @param {object | null} githubDiscovery
 * @returns {boolean}
 */
function isProtectedByGithub(targetBranch, githubDiscovery) {
  if (!githubDiscovery) return false;
  if (typeof githubDiscovery.target_is_protected === "boolean") {
    return githubDiscovery.target_is_protected;
  }
  const protectedBranches = githubDiscovery.protected_branches;
  if (Array.isArray(protectedBranches)) {
    return protectedBranches.map(String).includes(targetBranch);
  }
  return false;
}

/**
 * Merge explicit config and optional GitHub discovery into branch posture.
 *
 * @param {{
 *   target_branch?: string | null,
 *   explicit_config?: object | null,
 *   github_discovery?: object | null,
 * }} input
 * @returns {BranchPolicyPosture}
 */
function discoverBranchPolicyPosture(input) {
  const targetBranch = input.target_branch != null ? String(input.target_branch).trim() : "";
  const explicitConfig = input.explicit_config || null;
  const githubDiscovery = input.github_discovery || null;

  /** @type {BranchPolicyPosture} */
  const posture = {
    permission_visibility: "unknown",
    default_branch: null,
    protected_status: "unknown",
    rulesets_visible: false,
    required_checks_visible: false,
    required_reviews_visible: false,
    release_sensitive: false,
    policy_source: "none",
  };

  if (githubDiscovery && typeof githubDiscovery === "object") {
    posture.permission_visibility = "full";
    posture.policy_source = "github_api";
    posture.default_branch =
      githubDiscovery.default_branch != null ? String(githubDiscovery.default_branch) : null;
    posture.rulesets_visible = Boolean(githubDiscovery.rulesets_visible);
    posture.required_checks_visible = Boolean(githubDiscovery.required_checks_visible);
    posture.required_reviews_visible = Boolean(githubDiscovery.required_reviews_visible);
    if (targetBranch) {
      posture.protected_status = isProtectedByGithub(targetBranch, githubDiscovery)
        ? "known"
        : "not_protected";
      posture.release_sensitive =
        Boolean(githubDiscovery.target_is_release_sensitive) ||
        isProtectedByGithub(targetBranch, githubDiscovery);
    }
    return posture;
  }

  if (explicitConfig) {
    posture.permission_visibility = "limited";
    posture.policy_source = "config";
    posture.default_branch =
      explicitConfig.default_branch != null
        ? String(explicitConfig.default_branch)
        : explicitConfig.protected_branches?.[0]
          ? String(explicitConfig.protected_branches[0])
          : null;
    if (targetBranch) {
      const protectedHit = isProtectedByConfig(targetBranch, explicitConfig);
      posture.protected_status = protectedHit ? "known" : "not_protected";
      posture.release_sensitive =
        protectedHit || isReleaseSensitiveByConfig(targetBranch, explicitConfig);
    }
    return posture;
  }

  return posture;
}

module.exports = {
  discoverBranchPolicyPosture,
  isProtectedByConfig,
  isReleaseSensitiveByConfig,
};
