"use strict";

/**
 * Spawn a classified external process: manifest/adapters → permission evaluator → spawnSync.
 * Used for orchestrator-owned subprocess boundaries that are not MCP and not the Claude CLI transport.
 *
 * Call-time `require("child_process").spawnSync` so tests can monkey-patch before invoke (same as run-claude.js).
 */

const path = require("path");
const { runClassifiedInvocationPermissionGate } = require("../../security/classified-invocation-permission-gate");
const { runContextAuthorityGate } = require("../tools/context-authority-runtime-gate");

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {object} [options] — spawnSync options plus traceRole, actor, permissionProfileName
 */
function spawnClassifiedSync(executable, args, options = {}) {
  const {
    traceRole = "ORCHESTRATOR",
    actor = "orchestrator",
    cwd,
    permissionProfileName,
    traceAgentId,
    context_authority,
    ...spawnOpts
  } = options;
  const repoRoot = cwd || process.cwd();
  const argv = Array.isArray(args) ? args : [];

  if (process.env.ORCH_SKIP_CLASSIFIED_SHELL_GATE === "1") {
    return require("child_process").spawnSync(executable, argv, { cwd: repoRoot, ...spawnOpts });
  }

  if (process.env.ORCH_SKIP_CONTEXT_AUTHORITY_GATE !== "1") {
    const caResult = runContextAuthorityGate({
      context_authority,
      tool: path.basename(String(executable || "shell")),
    });
    if (!caResult.skipped) {
      try {
        const { emitPermissionCheckTrace } = require("../../orchestrator.js");
        emitPermissionCheckTrace(caResult.tracePayload);
      } catch {
        /* orchestrator not loaded or tests-only graph */
      }
    }
    if (!caResult.allowed && !caResult.skipped) {
      const err = new Error(`Context authority denied (${caResult.reason_code})`);
      err.code = "CONTEXT_AUTHORITY_DENIED";
      err.context_authority_decision = caResult;
      throw err;
    }
  }

  const gate = runClassifiedInvocationPermissionGate({
    repoRoot,
    role: traceRole,
    actor,
    agentId: traceAgentId,
    executable,
    args: argv,
    permissionProfileName,
  });
  try {
    const { emitPermissionCheckTrace } = require("../../orchestrator.js");
    emitPermissionCheckTrace(gate.tracePayload);
  } catch {
    /* orchestrator not loaded or tests-only graph */
  }

  const out = gate.output;
  if (out.decision === "deny" || out.decision === "requires_approval" || !out.safe_to_continue) {
    const err = new Error(`Classified shell invocation denied (${out.reason_code})`);
    err.code = "CLASSIFIED_SHELL_DENIED";
    err.permission_decision = out;
    err.classification = gate.classification;
    throw err;
  }

  return require("child_process").spawnSync(executable, argv, {
    cwd: repoRoot,
    ...spawnOpts,
  });
}

module.exports = { spawnClassifiedSync };
