"use strict";

const { loadPermissionConfig, resolveProfile } = require("./load-permission-config");
const { resolveActivePermissionProfileName } = require("./mcp-permission-gate");
const { loadProjectPolicy, mergeProjectPolicy } = require("./load-project-policy");
const { evaluatePermission } = require("./evaluate-permission");
const { traceSecurityDecision } = require("./trace-security-decision");
const { syntheticDenyOutput, isClaudeCliTransportAllowedForRole } = require("./trace-role-capability");

/**
 * Permission gate for orchestrator-spawned Claude CLI (`claude`) subprocess used as LLM transport.
 * Domain `shell` + precheck distinguishes this from arbitrary shell commands (future).
 *
 * Allowed when `profile.domains.remote_model === "allow"` (Claude CLI talks to Anthropic).
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.role — MODE role (e.g. DEV, QA) for trace
 * @param {string} [opts.actor]
 * @param {string} [opts.agentId] — matrix role id when known (authoritative over MODE union)
 */
function runClaudeCliPermissionGate(opts) {
  const repoRoot = opts.repoRoot != null ? String(opts.repoRoot) : process.cwd();
  const profileName =
    opts.permissionProfileName != null ? String(opts.permissionProfileName) : resolveActivePermissionProfileName(repoRoot);

  const cfg = loadPermissionConfig();
  const baseProfile = resolveProfile(profileName, cfg.profiles);
  const projectPolicy = loadProjectPolicy(repoRoot);
  const merged = mergeProjectPolicy(baseProfile, projectPolicy, profileName);

  const input = {
    actor: opts.actor != null ? String(opts.actor) : "orchestrator",
    role: opts.role != null ? String(opts.role) : "ORCHESTRATOR",
    tool: "claude_cli",
    action_class: "external_side_effect",
    target_class: null,
    domain: "shell",
    permission_profile: profileName,
    policy_source: merged.policy_source,
    profile: merged.profile,
    precheck: {
      orchestrator_shell_spawn: "claude_cli",
    },
  };

  if (process.env.ORCH_SKIP_ROLE_CAPABILITY_GATE !== "1") {
    const cap = isClaudeCliTransportAllowedForRole({
      traceRole: input.role,
      agentId: opts.agentId,
    });
    if (!cap.ok) {
      const output = syntheticDenyOutput(input, cap.reason_code);
      return { input, output, tracePayload: traceSecurityDecision(input, output) };
    }
  }

  const output = evaluatePermission(input);
  const tracePayload = traceSecurityDecision(input, output);
  return { input, output, tracePayload };
}

module.exports = {
  runClaudeCliPermissionGate,
};
