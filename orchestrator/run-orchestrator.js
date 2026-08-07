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
 *   --iterations <n>     Max iterations (default: 3). If omitted, **ORCH_MAX_ITERATIONS** (1–500) applies when set.
 *   --flow <mode>        Flow mode for metrics: single_agent | multi_agent (default: single_agent)
 *   --task-id <id>       Task ID for state store (default: auto-generated)
 *   --skip-gates         Skip orchestrator-state MCP gates (useful for testing)
 *   --model <name>       Local model override (requires local-only or Ollama path)
 *
 * Traces: optional env ORCH_TRACE_SCENARIO_ID labels session_start/session_end (scenario_id) for batch metrics export.
 * Local-only: ORCH_MODEL_MODE=local_only or ORCH_ALLOW_REMOTE_MODELS=0; ORCH_LOCAL_MODEL / OLLAMA_MODEL.
 */

const path = require("path");
const fs   = require("fs");
const { run } = require("./orchestrator");
const { setModelProfile } = require("./agents");
const { configureLocalModelPolicy } = require("./local-model-policy");
const { loadMinionsProjectConfig } = require("./minions-config");
const { printOperatorCliHelp, printRunOrchestratorUsageBrief } = require("./operator-cli-help");
const { activateAiMinionsEnv } = require("./modules/shared/ai-minions-activation");
const { randomUUID } = require("crypto");

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
  /** @type {number | null} null = let run() use ORCH_MAX_ITERATIONS or default */
  let maxIterationsFromCli = null;
  let flowMode = "single_agent";
  let taskId;
  let skipGates = false;
  let profile = null;
  let cliModel = null;
  /** @type {boolean | null} */
  let requireHandoffOverride = null;
  const inputArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printOperatorCliHelp();
      process.exit(0);
    }
    if (args[i] === "--cwd" && args[i + 1])            { cwd = args[++i]; }
    else if (args[i] === "--iterations" && args[i + 1]) { maxIterationsFromCli = parseInt(args[++i], 10) || 3; }
    else if (args[i] === "--flow" && args[i + 1])       { flowMode = args[++i]; }
    else if (args[i] === "--task-id" && args[i + 1])    { taskId = args[++i]; }
    else if (args[i] === "--skip-gates")                { skipGates = true; }
    else if (args[i] === "--require-handoff")           { requireHandoffOverride = true; }
    else if (args[i] === "--no-require-handoff")       { requireHandoffOverride = false; }
    else if (args[i] === "--profile" && args[i + 1])    { profile = args[++i]; }
    else if (args[i] === "--model" && args[i + 1])        { cliModel = args[++i]; }
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

  configureLocalModelPolicy({ cliModel });

  const goal = inputArgs.join(" ") || await readStdin();
  if (!goal || !goal.trim()) {
    printRunOrchestratorUsageBrief();
    process.exit(1);
  }

  console.log(`\nOrchestrator starting in: ${cwd}`);
  const minions = loadMinionsProjectConfig(cwd);
  if (minions.error) {
    console.error(minions.error);
    process.exit(2);
  }
  const traceScenarioFromMinions =
    minions.config?.orchestrator?.trace_scenario_id &&
    !(process.env.ORCH_TRACE_SCENARIO_ID && String(process.env.ORCH_TRACE_SCENARIO_ID).trim())
      ? String(minions.config.orchestrator.trace_scenario_id).trim()
      : undefined;

  const handoffNote = requireHandoffOverride === true ? " | require_handoff: forced ON"
    : requireHandoffOverride === false ? " | require_handoff: forced OFF"
      : "";
  const maxIterDisplay = maxIterationsFromCli != null ? maxIterationsFromCli : "(env ORCH_MAX_ITERATIONS or 3)";
  console.log(`Flow: ${flowMode} | Max iterations: ${maxIterDisplay}${profile ? ` | Profile: ${profile}` : ""}${cliModel ? ` | Model: ${cliModel}` : ""}${skipGates ? " | Gates: DISABLED" : ""}${handoffNote}\n`);

  if (!taskId) taskId = `task-${randomUUID().slice(0, 8)}`;
  activateAiMinionsEnv(process.env, { runId: taskId });

  const result = await run(goal.trim(), {
    ...(maxIterationsFromCli != null ? { maxIterations: maxIterationsFromCli } : {}),
    cwd,
    flowMode,
    taskId,
    skipStateMcp: skipGates,
    ...(cliModel ? { localModel: cliModel } : {}),
    ...(requireHandoffOverride !== null ? { requireHandoff: requireHandoffOverride } : {}),
    ...(traceScenarioFromMinions ? { traceScenarioId: traceScenarioFromMinions } : {}),
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
