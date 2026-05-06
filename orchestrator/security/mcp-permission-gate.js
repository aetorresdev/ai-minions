"use strict";

const { loadPermissionConfig, resolveProfile } = require("./load-permission-config");
const { loadProjectPolicy, mergeProjectPolicy } = require("./load-project-policy");
const { evaluatePermission } = require("./evaluate-permission");
const { traceSecurityDecision } = require("./trace-security-decision");
const { resolveMcpTrustLevel } = require("./resolve-mcp-trust-level");

/**
 * Parse comma-separated MCP server ids from env-style string.
 * @param {string} [raw]
 * @returns {Set<string>}
 */
function parseDeclaredServerList(raw) {
  const out = new Set();
  if (!raw || typeof raw !== "string") return out;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t) out.add(t);
  }
  return out;
}

/**
 * Resolve active permission profile name: explicit env wins, else first `extends` from project policy, else dev-local.
 * @param {string} repoRoot
 */
function resolveActivePermissionProfileName(repoRoot) {
  const fromEnv = process.env.ORCH_PERMISSION_PROFILE;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }
  try {
    const pol = loadProjectPolicy(repoRoot);
    if (pol && Array.isArray(pol.extends) && pol.extends.length > 0 && typeof pol.extends[0] === "string") {
      return pol.extends[0];
    }
  } catch {
    /* fail-safe: fall through */
  }
  return "dev-local";
}

/**
 * Run permission evaluator for an MCP invocation (side-effect class).
 *
 * @param {object} opts
 * @param {string} opts.server
 * @param {string} opts.tool
 * @param {string} [opts.repoRoot] — cwd / workspace root for project policy
 * @param {string} [opts.actor]
 * @param {string} [opts.role]
 * @param {string} [opts.permissionProfileName] — override profile (else derived)
 * @param {boolean} [opts.ciMcpConfigured] — for allow_if_ci_configured (caller supplies from CI context)
 * @param {Set<string>} [opts.declaredServers] — extra declared ids (e.g. from future YAML); merged with ORCH_MCP_DECLARED_SERVERS
 * @param {Set<string>} [opts.remoteDeclaredServers] — ORCH_MCP_REMOTE_DECLARED_SERVERS
 */
function runMcpPermissionGate(opts) {
  const server = opts.server != null ? String(opts.server) : "";
  const tool = opts.tool != null ? String(opts.tool) : "";
  const repoRoot = opts.repoRoot != null ? String(opts.repoRoot) : process.cwd();

  const profileName =
    opts.permissionProfileName != null ? String(opts.permissionProfileName) : resolveActivePermissionProfileName(repoRoot);

  const cfg = loadPermissionConfig();
  const baseProfile = resolveProfile(profileName, cfg.profiles);
  const projectPolicy = loadProjectPolicy(repoRoot);
  const merged = mergeProjectPolicy(baseProfile, projectPolicy, profileName);

  const envDeclared = parseDeclaredServerList(process.env.ORCH_MCP_DECLARED_SERVERS);
  const envRemote = parseDeclaredServerList(process.env.ORCH_MCP_REMOTE_DECLARED_SERVERS);
  const declared = new Set(envDeclared);
  if (opts.declaredServers) {
    for (const x of opts.declaredServers) declared.add(x);
  }
  const remoteDeclared = new Set(envRemote);
  if (opts.remoteDeclaredServers) {
    for (const x of opts.remoteDeclaredServers) remoteDeclared.add(x);
  }

  const trustLevel = resolveMcpTrustLevel(server, {
    declared_servers: declared,
    remote_declared_servers: remoteDeclared,
  });

  const ciConfigured =
    opts.ciMcpConfigured === true ||
    process.env.ORCH_CI_MCP_CONFIGURED === "1" ||
    process.env.CI === "true";

  const input = {
    actor: opts.actor != null ? String(opts.actor) : "orchestrator",
    role: opts.role != null ? String(opts.role) : "ORCHESTRATOR",
    tool: `${server}.${tool}`,
    action_class: "external_side_effect",
    target_class: null,
    domain: "mcp",
    permission_profile: profileName,
    policy_source: merged.policy_source,
    profile: merged.profile,
    precheck: {
      mcp_trust_level: trustLevel,
      ci_mcp_configured: ciConfigured,
    },
  };

  const output = evaluatePermission(input);
  const tracePayload = traceSecurityDecision(input, output);
  return { input, output, tracePayload, trust_level: trustLevel };
}

module.exports = {
  runMcpPermissionGate,
  resolveActivePermissionProfileName,
  parseDeclaredServerList,
};
