/**
 * Claude CLI invocation (spawnSync).
 */

'use strict';

// Call-time require("child_process").spawnSync so tests can monkey-patch cp.spawnSync before invoke.

// ── Output token limits (hard cap per role) ───────────────────────────────────
// Only applied to roles that produce structured/JSON output — not code agents.
// DEV/ARCHITECT/QA/CERBERUS are excluded: cutting mid-code breaks output.
const MAX_OUTPUT_TOKENS = {
  orchestrator: 400,   // JSON plan or decide only
  summarizer:   500,   // structured handoff summary
};

// ── Claude CLI ────────────────────────────────────────────────────────────────

function runClaude(prompt, { cwd, model, maxTokens, traceRole = "ORCHESTRATOR" } = {}) {
  if (process.env.ORCH_SKIP_SHELL_PERMISSION_GATE !== "1") {
    const { runClaudeCliPermissionGate } = require("../../security/claude-cli-shell-gate");
    const repoRoot = cwd || process.cwd();
    const gate = runClaudeCliPermissionGate({
      repoRoot,
      role: traceRole,
      actor: "orchestrator",
    });
    const out = gate.output;
    if (out.decision === "deny" || out.decision === "requires_approval" || !out.safe_to_continue) {
      const err = new Error(`Claude CLI invocation denied (${out.reason_code})`);
      err.code = "CLAUDE_CLI_SHELL_DENIED";
      err.permission_decision = out;
      throw err;
    }
    try {
      const { emitPermissionCheckTrace } = require("../../orchestrator.js");
      emitPermissionCheckTrace(gate.tracePayload);
    } catch {
      /* orchestrator not loaded or tests-only import graph — trace optional */
    }
  }

  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 180000;
  // Pass prompt via stdin ("-p -") to avoid the claude CLI arg parser treating
  // prompt content that starts with "---" or "--" as unknown CLI flags.
  const args = ["-p", "-", "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  if (maxTokens) args.push("--max-tokens", String(maxTokens));
  const result = require("child_process").spawnSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: cwd || process.cwd(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "claude CLI error");
  return result.stdout.trim();
}

module.exports = { runClaude, MAX_OUTPUT_TOKENS };
