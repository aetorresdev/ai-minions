/**
 * Operator-facing CLI help text (stdout). Shared by run-orchestrator and tests.
 * Keep in sync with actual scripts — no aspirational commands.
 */

const DOCS_HOW_TO = "docs/how-to/usage-smoke-guide.md";
const DOCS_SLASH = "docs/how-to/operator-slash-commands.md";

function printOperatorCliHelp() {
  const lines = [
    "ai-minions orchestrator — operator CLI",
    "",
    "Command groups (from orchestrator/):",
    "",
    "  run      node run-orchestrator.js [options] \"<goal>\"",
    "           Full MODE orchestration loop (Ollama planner + Claude workers).",
    "",
    "  explain  npm run explain-run -- [--run-id <id>] [--file <path>] [--json]",
    "           Human-readable summary of one completed trace.",
    "",
    "  inspect  npm run control-plane:tui -- [--run-id <id>] [--file <path>] [--batch]",
    "           Read-only run panel (outcome, blockers, recovery, resume).",
    "",
    "  launch   npm run runner:tui -- preflight|run|status [options]",
    "           Preflight + policy-aware run launch; status from trace JSONL.",
    "",
    "  template npm run project-template -- export|import --cwd <dir> [--out|--file <path>]",
    "           Export scrubbed project config bundle; import --dry-run only.",
    "",
    "  report   npm run tokens:report -- <task_id> [--json] [--strict-traces]",
    "           Token/cost rollups from a trace JSONL file.",
    "",
    "  validate npm test",
    "           Lint + unit/integration tests for the harness (not your app repo).",
    "",
    "  check    Manual — see docs/orchestrator/pre-run-checklist.md",
    "           (no doctor subcommand yet).",
    "",
    "  resume   Not implemented — planned; use traces + explain-run for inspection.",
    "",
    "Run command — options:",
    "  --cwd <dir>              Project directory (default: cwd)",
    "  --iterations <n>         Max iterations (default 3, or ORCH_MAX_ITERATIONS)",
    "  --flow <mode>            single_agent | multi_agent (default: single_agent)",
    "  --task-id <id>           Fixed task / trace id",
    "  --skip-gates             Degraded mode (no orchestrator-state MCP gates)",
    "  --require-handoff        Force compact_handoff strictness",
    "  --no-require-handoff     Allow handoff fallback when gates skipped",
    "  --profile <name>         models.json profile: fast | balanced | quality",
    "  --model <name>           Local model override (with local-only or Ollama)",
    "  -h, --help               This help",
    "",
    "Run command — goal input:",
    "  Positional \"<goal>\" string, or pipe goal text on stdin.",
    "",
    "Run command — exit codes:",
    "  0   Completed (check Done / gate blocks in output)",
    "  1   Missing goal, usage error, or unhandled exception",
    "  2   Invalid minions.md / project config in --cwd",
    "",
    "Traces (default dir):",
    "  ~/.claude/metrics/traces/<task_id>.jsonl",
    "  Override: ORCH_TRACES_DIR",
    "  Optional label: ORCH_TRACE_SCENARIO_ID or minions.md trace_scenario_id",
    "",
    "Common env vars (run):",
    "  ORCH_MAX_ITERATIONS      Default max iterations when --iterations omitted",
    "  ORCH_TRACE_SCENARIO_ID   scenario_id on session_start/end",
    "  ORCH_MODEL_MODE          local_only blocks remote model providers",
    "  ORCH_ALLOW_REMOTE_MODELS Set 0/false to block remote providers",
    "  ORCH_LOCAL_MODEL         Explicit local model when local-only is on",
    "  OLLAMA_HOST / OLLAMA_PORT / OLLAMA_MODEL",
    "  CLAUDE_CLI_TIMEOUT       Per-agent Claude CLI timeout (seconds)",
    "",
    "Examples:",
    "  node run-orchestrator.js --help",
    "  node run-orchestrator.js --skip-gates --iterations 1 \"Smoke: list three files and stop\"",
    "  echo \"Add pagination\" | node run-orchestrator.js --cwd /path/to/app",
    "  npm run explain-run -- --run-id <task_id>",
    "  npm run tokens:report -- <task_id>",
    "",
    `Operator how-to: ${DOCS_HOW_TO}`,
    `Slash aliases (doc only): ${DOCS_SLASH}`,
    "Orchestrator detail: orchestrator/README.md",
    "",
    "Normal product path: paste MODE header in Claude Code (see README.md).",
    "This CLI is for direct runs, smoke tests, and CI-style checks.",
  ];
  console.log(lines.join("\n"));
}

function printRunOrchestratorUsageBrief() {
  console.error(`Usage: node run-orchestrator.js [options] "<goal>"
       node run-orchestrator.js --help`);
}

module.exports = {
  printOperatorCliHelp,
  printRunOrchestratorUsageBrief,
  DOCS_HOW_TO,
};
