/**
 * Runtime-host adapter contract — host integration surface independent of model backend.
 * First adapter: claude_code. Generic fields must not imply model provider.
 */

export const RUNTIME_HOST_IDS = Object.freeze({
  CLAUDE_CODE: "claude_code",
});

/** @typedef {'configured'|'skipped'|'unavailable'|'failed'|'degraded'} RuntimeIntegrationStatus */

export const RUNTIME_INTEGRATION_STATUS = Object.freeze({
  CONFIGURED: "configured",
  SKIPPED: "skipped",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
  DEGRADED: "degraded",
});

export const RUNTIME_REASON_CODES = Object.freeze({
  CONFIGURED: "RUNTIME_INTEGRATION_CONFIGURED",
  SKIPPED: "RUNTIME_INTEGRATION_SKIPPED",
  UNAVAILABLE: "RUNTIME_HOST_UNAVAILABLE",
  FAILED: "RUNTIME_INTEGRATION_FAILED",
  DEGRADED: "RUNTIME_INTEGRATION_DEGRADED",
  MCP_REGISTERED: "RUNTIME_MCP_REGISTERED",
  MCP_ALREADY_REGISTERED: "RUNTIME_MCP_ALREADY_REGISTERED",
  MCP_REGISTER_FAILED: "RUNTIME_MCP_REGISTER_FAILED",
  MCP_VENV_SYNC_FAILED: "RUNTIME_MCP_VENV_SYNC_FAILED",
  MCP_ARTIFACT_MISSING: "RUNTIME_MCP_ARTIFACT_MISSING",
  HOOK_CONFIGURED: "RUNTIME_HOOK_CONFIGURED",
  HOOK_ALREADY_CONFIGURED: "RUNTIME_HOOK_ALREADY_CONFIGURED",
  HOOK_WIRE_FAILED: "RUNTIME_HOOK_WIRE_FAILED",
  SETTINGS_UNREADABLE: "RUNTIME_SETTINGS_UNREADABLE",
  SETTINGS_WRITE_FAILED: "RUNTIME_SETTINGS_WRITE_FAILED",
  VERIFY_FAILED: "RUNTIME_INTEGRATION_VERIFY_FAILED",
});

export const REQUIRED_MCP_SERVERS = Object.freeze([
  {
    server_id: "orchestrator-state",
    rel_dir: "mcp-servers/orchestrator-state",
  },
  {
    server_id: "compact-handoff",
    rel_dir: "mcp-servers/compact-handoff",
  },
]);

export const REQUIRED_HOOKS = Object.freeze([
  {
    hook_id: "mode-enforcer",
    script: "mode-enforcer.py",
    matcher: "*",
    event: "PreToolUse",
  },
  {
    hook_id: "handoff-enforcer",
    script: "handoff-enforcer.py",
    matcher: "mcp__orchestrator-state__advance_mode",
    event: "PreToolUse",
  },
]);

/**
 * @param {RuntimeIntegrationStatus[]} componentStatuses
 * @returns {RuntimeIntegrationStatus}
 */
export function deriveRuntimeIntegrationStatus(componentStatuses) {
  if (componentStatuses.includes(RUNTIME_INTEGRATION_STATUS.FAILED)) {
    return RUNTIME_INTEGRATION_STATUS.FAILED;
  }
  if (componentStatuses.includes(RUNTIME_INTEGRATION_STATUS.UNAVAILABLE)) {
    return RUNTIME_INTEGRATION_STATUS.UNAVAILABLE;
  }
  if (componentStatuses.includes(RUNTIME_INTEGRATION_STATUS.DEGRADED)) {
    return RUNTIME_INTEGRATION_STATUS.DEGRADED;
  }
  if (componentStatuses.includes(RUNTIME_INTEGRATION_STATUS.SKIPPED)) {
    return RUNTIME_INTEGRATION_STATUS.SKIPPED;
  }
  if (
    componentStatuses.length > 0
    && componentStatuses.every((s) => s === RUNTIME_INTEGRATION_STATUS.CONFIGURED)
  ) {
    return RUNTIME_INTEGRATION_STATUS.CONFIGURED;
  }
  return RUNTIME_INTEGRATION_STATUS.DEGRADED;
}
