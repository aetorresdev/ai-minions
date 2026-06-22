"use strict";

/**
 * Bridge orchestrator CLI runs to Claude Code hook consumers (flow-metrics, snapshot policy).
 * Writes project-local context when CLAUDE_SESSION_ID is absent.
 */

const fs = require("fs");
const path = require("path");
const { buildWorktreeHookContext } = require("../../worktree-isolation");

/**
 * @param {string} goal
 * @returns {{ scope: string, scope_unknown_reason: string | null }}
 */
function deriveRunScope(goal) {
  const g = String(goal || "").trim();
  const epic = g.match(/\b(?:epic|scope)\s*:\s*(.+)/i);
  if (epic && epic[1].trim()) {
    return { scope: epic[1].trim().slice(0, 200), scope_unknown_reason: null };
  }
  if (g.length >= 12) {
    return { scope: g.slice(0, 120), scope_unknown_reason: null };
  }
  return { scope: "unknown", scope_unknown_reason: "goal_too_short_for_scope_derivation" };
}

/**
 * @param {string} cwd
 * @param {{ taskId: string, flowMode: string, goal: string }} input
 */
function writeOrchRunContext(cwd, { taskId, flowMode, goal }) {
  const root = path.resolve(cwd || ".");
  const scopeInfo = deriveRunScope(goal);
  const ctx = {
    orch_run_context_version: "0.1",
    session_id: taskId,
    task_id: taskId,
    flow_mode: flowMode,
    flow_src: "orchestrator_cli",
    transcript_scope: "orchestrator_run",
    ...scopeInfo,
    ...buildWorktreeHookContext(root),
    written_at: new Date().toISOString(),
  };

  const claudeDir = path.join(root, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "orch-run-context.json"), `${JSON.stringify(ctx, null, 2)}\n`, "utf8");

  const hookStateDir = path.join(claudeDir, "flow-hook-state");
  fs.mkdirSync(hookStateDir, { recursive: true });
  const safeTask = String(taskId).replace(/[^\w.-]+/g, "_").slice(0, 120);
  fs.writeFileSync(
    path.join(hookStateDir, `task-${safeTask}.json`),
    `${JSON.stringify({ flow_mode: flowMode, dev_qa_ever: 0, last_transcript_lines: 0 }, null, 2)}\n`,
    "utf8",
  );

  try {
    const metricsDir = path.join(require("os").homedir(), ".claude", "metrics");
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, `orch-session-${taskId}.flag`), "1", "utf8");
  } catch {
    /* non-fatal */
  }
}

module.exports = {
  deriveRunScope,
  writeOrchRunContext,
};
