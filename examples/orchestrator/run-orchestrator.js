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

const path = require("path");
const fs   = require("fs");
const { run } = require("./orchestrator");
const { setModelProfile } = require("./agents");

function loadModelsConfig() {
  const configPath = path.join(__dirname, "models.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

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
  let profile = null;
  const inputArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1])            { cwd = args[++i]; }
    else if (args[i] === "--iterations" && args[i + 1]) { maxIterations = parseInt(args[++i], 10) || 3; }
    else if (args[i] === "--flow" && args[i + 1])       { flowMode = args[++i]; }
    else if (args[i] === "--task-id" && args[i + 1])    { taskId = args[++i]; }
    else if (args[i] === "--skip-gates")                { skipGates = true; }
    else if (args[i] === "--profile" && args[i + 1])    { profile = args[++i]; }
    else                                                 { inputArgs.push(args[i]); }
  }

  // Load models.json and activate profile before any agent is invoked
  const modelsConfig = loadModelsConfig();
  if (profile) {
    if (!modelsConfig) {
      console.warn(`⚠  --profile ${profile} ignored: models.json not found at ${path.join(__dirname, "models.json")}`);
    } else if (!modelsConfig.profiles?.[profile]) {
      const available = Object.keys(modelsConfig.profiles || {}).join(", ");
      console.warn(`⚠  --profile ${profile} not found. Available: ${available}`);
    } else {
      setModelProfile(profile, modelsConfig);
      console.log(`Profile: ${profile}`);
    }
  }

  const goal = inputArgs.join(" ") || await readStdin();
  if (!goal || !goal.trim()) {
    console.error("Usage: node run-orchestrator.js [--cwd <dir>] [--iterations <n>] [--flow <mode>] [--profile fast|balanced|quality] \"<goal>\"");
    process.exit(1);
  }

  console.log(`\nOrchestrator starting in: ${cwd}`);
  console.log(`Flow: ${flowMode} | Max iterations: ${maxIterations}${profile ? ` | Profile: ${profile}` : ""}${skipGates ? " | Gates: DISABLED" : ""}\n`);

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
