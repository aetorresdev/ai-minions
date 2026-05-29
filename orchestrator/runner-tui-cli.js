#!/usr/bin/env node
/**
 * Runner TUI/CLI — create and execute orchestrator runs (product surface MVP).
 *
 * Usage:
 *   node runner-tui-cli.js preflight --model-policy local_only [--cwd DIR] [--model NAME]
 *   node runner-tui-cli.js run --goal "..." [--flow single_agent|multi_agent] [--model-policy local_only] [--skip-gates]
 *   node runner-tui-cli.js status --run-id <task_id>
 */

'use strict';

const {
  buildRunPreflight,
  formatPreflightText,
} = require('./runner-preflight');
const {
  launchRun,
  loadRunStatusFromTrace,
  formatRunStatusText,
} = require('./runner-launcher');

function printHelp() {
  console.log(`Runner TUI/CLI — launch orchestrator runs

Commands:
  preflight   Resolve model policy + Ollama reachability (no agents executed)
  run         Preflight then execute orchestrator run()
  status      Read terminal status from trace JSONL

Options (preflight / run):
  --cwd <dir>              Project directory (default: cwd)
  --model-policy <name>    local_only | remote_ok (default: local_only)
  --model <name>           Explicit local model override
  --flow <mode>            single_agent | multi_agent (run only)
  --goal <text>            Run goal (run only)
  --skip-gates             Pass --skip-gates to orchestrator (run only)
  --iterations <n>         Max iterations (run only)

Options (status):
  --run-id <id>            Task id / trace basename

See docs/orchestrator/runner-tui-contract.md`);
}

/**
 * @param {string[]} argv
 */
function parseCommonArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' && argv[i + 1]) out.cwd = argv[++i];
    else if (a === '--model-policy' && argv[i + 1]) out.modelPolicy = argv[++i];
    else if (a === '--model' && argv[i + 1]) out.model = argv[++i];
    else if (a === '--flow' && argv[i + 1]) out.flowMode = argv[++i];
    else if (a === '--goal' && argv[i + 1]) out.goal = argv[++i];
    else if (a === '--run-id' && argv[i + 1]) out.runId = argv[++i];
    else if (a === '--iterations' && argv[i + 1]) out.maxIterations = argv[++i];
    else if (a === '--skip-gates') out.skipGates = true;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(argv.length ? 0 : 1);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const opts = parseCommonArgs(rest);

  if (cmd === 'preflight') {
    const preflight = await buildRunPreflight({
      cwd: opts.cwd,
      modelPolicy: opts.modelPolicy,
      model: opts.model,
    });
    console.log(formatPreflightText(preflight));
    process.exit(preflight.ok ? 0 : 2);
  }

  if (cmd === 'run') {
    if (!opts.goal) {
      console.error('run requires --goal');
      process.exit(1);
    }
    try {
      const launched = await launchRun({
        goal: String(opts.goal),
        cwd: opts.cwd,
        flowMode: opts.flowMode,
        modelPolicy: opts.modelPolicy,
        model: opts.model,
        skipStateMcp: opts.skipGates === true,
        maxIterations: opts.maxIterations != null ? parseInt(String(opts.maxIterations), 10) : undefined,
      });
      console.log(formatPreflightText(launched.preflight));
      console.log('');
      console.log(formatRunStatusText({
        task_id: launched.task_id,
        terminal_status: launched.terminal_status,
        trace_file: '(see ORCH_TRACES_DIR)',
        done: launched.result.done,
        iterations: launched.result.iterations,
      }));
      console.log(`  summary:          ${launched.result.summary}`);
      process.exit(launched.terminal_status === 'done' ? 0 : 3);
    } catch (err) {
      if (err && err.preflight) {
        console.error(formatPreflightText(err.preflight));
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(err && err.code === 'RUNNER_PREFLIGHT_BLOCKED' ? 2 : 1);
    }
  }

  if (cmd === 'status') {
    if (!opts.runId) {
      console.error('status requires --run-id');
      process.exit(1);
    }
    const status = loadRunStatusFromTrace(String(opts.runId));
    console.log(formatRunStatusText(status));
    process.exit(status.error ? 2 : 0);
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

module.exports = { printHelp, parseCommonArgs, main };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
