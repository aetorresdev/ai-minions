/**
 * Role → credential access matrix (session mode is the ceiling).
 * Consumed by agents.js (buildEnvContext, facade exports).
 */

// Fixed permission per role. Session mode is the ceiling — roles cannot exceed it.
// "none"  = no credentials consumed
// "read"  = query, describe, logs, plan/diff, dry-run
// "write" = all read + execute, apply, insert, update, activate
const ROLE_PERMISSION = {
  orchestrator:  "none",
  owner:         "none",
  architect:     "read",
  "dev-backend": "write",
  "dev-frontend":"read",
  "dev-devops":  "write",
  qa:            "read",
  cerberus:      "read",   // hardcoded — cannot be elevated
  summarizer:    "none",
};

/**
 * Returns the effective access mode for a role given the session ceiling.
 * CERBERUS is always read regardless of session mode.
 */
function effectiveMode(agentId, sessionMode) {
  const rolePerm = ROLE_PERMISSION[agentId] ?? "none";
  if (rolePerm === "none") return "none";
  if (agentId === "cerberus") return "read";  // hardcoded
  if (sessionMode === "read") return "read";  // ceiling
  return rolePerm;  // write only if role allows and session allows
}

module.exports = {
  ROLE_PERMISSION,
  effectiveMode,
};
