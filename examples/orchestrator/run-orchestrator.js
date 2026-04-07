#!/usr/bin/env node
/**
 * CLI entry point for the autonomous orchestrator.
 *
 * Usage:
 *   node run-orchestrator.js "Create a REST API for user management"
 *   node run-orchestrator.js --cwd /path/to/project "Add pagination to the users endpoint"
 *   echo "task description" | node run-orchestrator.js
 *
 * Options:
 *   --cwd <dir>          Working directory for all agents (default: current dir)
 *   --iterations <n>     Max iterations (default: 3)
 *   --flow <mode>        Flow mode for metrics: single_agent | multi_agent (default: single_agent)
 *   --task-id <id>       Task ID for state store (default: auto-generated)
 *   --skip-gates         Skip orchestrator-state MCP gates (useful for testing)
 */

const { run } = require("./orchestrator");

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let maxIterations = 3;
  let flowMode = "single_agent";
  let taskId;
  let skipGates = false;
  const inputArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1])            { cwd = args[++i]; }
    else if (args[i] === "--iterations" && args[i + 1]) { maxIterations = parseInt(args[++i], 10) || 3; }
    else if (args[i] === "--flow" && args[i + 1])       { flowMode = args[++i]; }
    else if (args[i] === "--task-id" && args[i + 1])    { taskId = args[++i]; }
    else if (args[i] === "--skip-gates")                { skipGates = true; }
    else                                                 { inputArgs.push(args[i]); }
  }

  const goal = inputArgs.join(" ") || await readStdin();
  if (!goal || !goal.trim()) {
    console.error("Usage: node run-orchestrator.js [--cwd <dir>] [--iterations <n>] [--flow <mode>] \"<goal>\"");
    process.exit(1);
  }

  console.log(`\nOrchestrator starting in: ${cwd}`);
  console.log(`Flow: ${flowMode} | Max iterations: ${maxIterations}${skipGates ? " | Gates: DISABLED" : ""}\n`);

  const result = await run(goal.trim(), {
    maxIterations,
    cwd,
    flowMode,
    taskId,
    skipStateMcp: skipGates,
  });

  // Note: each agent call uses CLAUDE_CLI_TIMEOUT (default 3 min).
  // With gates enabled, budget ~5-8 min per iteration for real tasks.

  console.log("\n─── Result ───────────────────────────────────────────────");
  console.log(`Done:       ${result.done}`);
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Task ID:    ${result.taskId}`);
  console.log(`Summary:    ${result.summary}`);
  console.log("\nArtifacts:");
  result.artifacts.forEach((a, i) => {
    const blocked = a.gateBlocked ? ` [GATE BLOCKED: ${a.gateReason}]` : "";
    console.log(`\n[${i + 1}] ${a.agentId}: ${a.task}${blocked}`);
    console.log(a.result.slice(0, 500) + (a.result.length > 500 ? "..." : ""));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
