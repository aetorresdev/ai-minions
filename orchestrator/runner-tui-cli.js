#!/usr/bin/env node
/**
 * Runner TUI/CLI — create and execute orchestrator runs (product surface MVP).
 *
 * Usage:
 *   node runner-tui-cli.js preflight --model-policy local_only [--cwd DIR] [--model NAME] [--interactive]
 *   node runner-tui-cli.js routing [--model-policy local_only|remote_ok] [--model NAME] [--flow single_agent]
 *   node runner-tui-cli.js run --goal "..." [--flow single_agent|multi_agent] [--model-policy local_only] [--interactive]
 *   node runner-tui-cli.js status --run-id <task_id> [--show-routing]
 *   node runner-tui-cli.js trace --run-id <task_id> [--follow] [--file <path>]
 */

'use strict';

const {
  buildRunPreflight,
  formatPreflightText,
  resolveModelPolicyInput,
} = require('./runner-preflight');
const {
  launchRun,
  loadRunStatusFromTrace,
  formatRunStatusText,
  formatTraceRoleRoutingText,
} = require('./runner-launcher');
const {
  buildRoleRoutingPreview,
  formatModelPolicyCatalogText,
  formatRoleRoutingText,
  resolveInteractiveModelPolicy,
} = require('./runner-model-routing');
const { runTraceViewer } = require('./runner-trace-viewer');

function printHelp() {
  console.log(`Runner TUI/CLI — launch orchestrator runs

Commands:
  preflight   Resolve model policy + Ollama reachability (no agents executed)
  routing     Show model policy catalog + per-role routing preview
  run         Preflight then execute orchestrator run()
  status      Read terminal status from trace JSONL
  trace       Step graph + gate blocks from trace JSONL (read-only)

Options (preflight / run / routing):
  --cwd <dir>              Project directory (default: cwd)
  --model-policy <name>    local_only | remote_ok (default: local_only)
  --model <name>           Explicit local model override
  --interactive            TTY: prompt for policy (and model when ambiguous)
  --flow <mode>            single_agent | multi_agent (routing / run)

Options (run only):
  --goal <text>            Run goal
  --skip-gates             Pass --skip-gates to orchestrator
  --iterations <n>         Max iterations

Options (status / trace):
  --run-id <id>            Task id / trace basename
  --show-routing           Include resolved models from trace (status only)
  --file <path>            Trace JSONL path (trace only; overrides --run-id resolution)
  --follow                 Poll trace file until session_end (trace only)

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
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (a === '--iterations' && argv[i + 1]) out.maxIterations = argv[++i];
    else if (a === '--skip-gates') out.skipGates = true;
    else if (a === '--interactive') out.interactive = true;
    else if (a === '--show-routing') out.showRouting = true;
    else if (a === '--follow') out.follow = true;
  }
  return out;
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parseMaxIterations(value) {
  if (value == null) return undefined;
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return Number.NaN;
  return n;
}

/**
 * @param {Record<string, string | boolean>} opts
 * @returns {Promise<string | undefined>}
 */
async function resolveModelPolicyOption(opts) {
  if (opts.modelPolicy) return String(opts.modelPolicy);
  if (opts.interactive !== true) return undefined;
  const picked = await resolveInteractiveModelPolicy({ interactive: true });
  return picked ?? undefined;
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
  const modelPolicy = await resolveModelPolicyOption(opts);

  if (cmd === 'preflight') {
    const preflight = await buildRunPreflight({
      cwd: opts.cwd,
      modelPolicy: modelPolicy ?? opts.modelPolicy,
      model: opts.model,
      interactive: opts.interactive === true,
    });
    console.log(formatPreflightText(preflight));
    process.exit(preflight.ok ? 0 : 2);
  }

  if (cmd === 'routing') {
    const rawPolicy = modelPolicy ?? opts.modelPolicy;
    const resolvedPolicyInput = resolveModelPolicyInput(rawPolicy);
    if (!resolvedPolicyInput.ok) {
      console.error(formatPreflightText({
        ok: false,
        model_policy: 'local_only',
        provider: 'ollama',
        selected_model: null,
        override_source: null,
        selection_reason: null,
        discovered_models: [],
        ollama_reachable: null,
        blockers: [resolvedPolicyInput.blocker],
      }));
      process.exit(2);
    }

    console.log(formatModelPolicyCatalogText());
    console.log('');

    let localModel = opts.model ? String(opts.model) : null;
    const policy = resolvedPolicyInput.policy;
    const needsLocalResolve = policy === 'local_only' && !localModel;

    if (needsLocalResolve) {
      process.stderr.write('Resolving local model (Ollama preflight)…\n');
      const pf = await buildRunPreflight({
        cwd: opts.cwd,
        modelPolicy: policy,
        model: opts.model,
        interactive: opts.interactive === true,
      });
      if (pf.model_policy === 'local_only' && pf.selected_model) {
        localModel = pf.selected_model;
      }
    }

    const preview = buildRoleRoutingPreview({
      modelPolicy: policy,
      localModel,
      flowMode: opts.flowMode,
    });
    console.log(formatRoleRoutingText(preview));
    process.exit(0);
  }

  if (cmd === 'run') {
    if (!opts.goal) {
      console.error('run requires --goal');
      process.exit(1);
    }
    const maxIterations = parseMaxIterations(opts.maxIterations);
    if (opts.maxIterations != null && Number.isNaN(maxIterations)) {
      console.error('--iterations requires a positive integer');
      process.exit(1);
    }
    try {
      const launched = await launchRun({
        goal: String(opts.goal),
        cwd: opts.cwd,
        flowMode: opts.flowMode,
        modelPolicy: modelPolicy ?? opts.modelPolicy,
        model: opts.model,
        skipStateMcp: opts.skipGates === true,
        maxIterations,
        interactive: opts.interactive === true,
      });
      console.log(formatPreflightText(launched.preflight));
      console.log('');
      const routingPreview = buildRoleRoutingPreview({
        modelPolicy: launched.preflight.model_policy,
        localModel: launched.preflight.selected_model,
        flowMode: opts.flowMode,
      });
      console.log(formatRoleRoutingText(routingPreview));
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
    if (opts.showRouting === true && status.role_routing) {
      console.log('');
      console.log(formatTraceRoleRoutingText(status.role_routing));
    }
    process.exit(status.error ? 2 : 0);
  }

  if (cmd === 'trace') {
    if (!opts.runId && !opts.file) {
      console.error('trace requires --run-id or --file');
      process.exit(1);
    }
    const result = await runTraceViewer({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
      follow: opts.follow === true,
    });
    if (!result.ok) {
      console.error(result.error || 'trace failed');
      process.exit(result.error === 'trace file not found' ? 2 : 1);
    }
    if (opts.follow !== true && result.text) {
      console.log(result.text);
    }
    process.exit(result.interrupted ? 130 : 0);
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

module.exports = {
  printHelp,
  parseCommonArgs,
  parseMaxIterations,
  resolveModelPolicyOption,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
