"use strict";

const path = require("path");
const { loadPermissionConfig, resolveProfile } = require("./load-permission-config");
const { resolveActivePermissionProfileName } = require("./mcp-permission-gate");
const { loadProjectPolicy, mergeProjectPolicy } = require("./load-project-policy");
const { evaluatePermission } = require("./evaluate-permission");
const { traceSecurityDecision } = require("./trace-security-decision");
const { classifyAction } = require("./action-classifiers/classify-action");

/**
 * Map manifest tool id to permission-matrix domain. Infra CLIs share filesystem write-class semantics.
 * @param {{ tool_id?: string | null }} classification
 * @returns {"git" | "filesystem"}
 */
function permissionDomainForClassification(classification) {
  const tid = classification && classification.tool_id;
  if (tid === "git") return "git";
  return "filesystem";
}

function toolLabelFromClassification(executable, classification) {
  if (classification.tool_id) return String(classification.tool_id);
  const base = path.basename(String(executable || ""));
  return base || "unknown_shell";
}

/**
 * Classify argv via manifest/adapters, then run the permission evaluator (non-MCP runtime path).
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.executable
 * @param {string[]} [opts.args]
 * @param {string} [opts.role]
 * @param {string} [opts.actor]
 * @param {string} [opts.permissionProfileName]
 */
function runClassifiedInvocationPermissionGate(opts) {
  const repoRoot = opts.repoRoot != null ? String(opts.repoRoot) : process.cwd();
  const profileName =
    opts.permissionProfileName != null ? String(opts.permissionProfileName) : resolveActivePermissionProfileName(repoRoot);

  const classification = classifyAction({
    executable: opts.executable != null ? String(opts.executable) : "",
    args: Array.isArray(opts.args) ? opts.args : [],
    ctx: { repoRoot },
  });

  const action_class = classification.action_class || "unknown";
  const target_class =
    classification.target_class != null && classification.target_class !== ""
      ? String(classification.target_class)
      : null;

  const domain = permissionDomainForClassification(classification);
  const tool = toolLabelFromClassification(opts.executable, classification);

  const cfg = loadPermissionConfig();
  const baseProfile = resolveProfile(profileName, cfg.profiles);
  const projectPolicy = loadProjectPolicy(repoRoot);
  const merged = mergeProjectPolicy(baseProfile, projectPolicy, profileName);

  const input = {
    actor: opts.actor != null ? String(opts.actor) : "orchestrator",
    role: opts.role != null ? String(opts.role) : "ORCHESTRATOR",
    tool,
    action_class,
    target_class,
    domain,
    permission_profile: profileName,
    policy_source: merged.policy_source,
    profile: merged.profile,
  };

  const output = evaluatePermission(input);
  const tracePayload = traceSecurityDecision(input, output);
  return { input, output, tracePayload, classification };
}

module.exports = {
  runClassifiedInvocationPermissionGate,
  permissionDomainForClassification,
};
