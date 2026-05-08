"use strict";

const { loadPermissionConfig, resolveProfile } = require("./load-permission-config");
const { resolveActivePermissionProfileName } = require("./mcp-permission-gate");
const { loadProjectPolicy, mergeProjectPolicy } = require("./load-project-policy");
const { evaluatePermission } = require("./evaluate-permission");
const { traceSecurityDecision } = require("./trace-security-decision");

/**
 * SEC-NET-R1-B3: HTTP/TCP egress pre-check against `domains.network` (allow_hosts + default).
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} [opts.permissionProfileName]
 * @param {string} opts.hostname
 * @param {number} opts.port
 * @param {string} [opts.role]
 * @param {string} [opts.actor]
 * @param {string} [opts.tool] — trace label e.g. ollama_chat, ollama_health_check
 * @param {string} [opts.pathLabel] — optional trace hint (path only, no query)
 */
function runNetworkPermissionGate(opts) {
  const repoRoot = opts.repoRoot != null ? String(opts.repoRoot) : process.cwd();
  const profileName =
    opts.permissionProfileName != null
      ? String(opts.permissionProfileName)
      : resolveActivePermissionProfileName(repoRoot);

  const cfg = loadPermissionConfig();
  const baseProfile = resolveProfile(profileName, cfg.profiles);
  const projectPolicy = loadProjectPolicy(repoRoot);
  const merged = mergeProjectPolicy(baseProfile, projectPolicy, profileName);

  const port = Number(opts.port);
  const input = {
    actor: opts.actor != null ? String(opts.actor) : "orchestrator",
    role: opts.role != null ? String(opts.role) : "ORCHESTRATOR",
    tool: opts.tool != null ? String(opts.tool) : "http_egress",
    action_class: "read",
    target_class: opts.pathLabel != null ? String(opts.pathLabel) : null,
    domain: "network",
    permission_profile: profileName,
    policy_source: merged.policy_source,
    profile: merged.profile,
    precheck: {
      network_hostname: String(opts.hostname),
      network_port: port,
    },
  };

  const output = evaluatePermission(input);
  const tracePayload = traceSecurityDecision(input, output);
  return { input, output, tracePayload };
}

module.exports = { runNetworkPermissionGate };
