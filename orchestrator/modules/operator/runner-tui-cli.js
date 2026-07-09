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
 *   node runner-tui-cli.js budget --run-id <task_id> [--file <path>]
 *   node runner-tui-cli.js worktree create --run-id <task_id> [--cwd DIR]
 *   node runner-tui-cli.js worktree remove --run-id <task_id> [--force]
 *   node runner-tui-cli.js worktree list [--cwd DIR]
 *   node runner-tui-cli.js worktree status [--run-id <id>|--cwd DIR]
 *   node runner-tui-cli.js worktree contract [--run-id <id>|--cwd DIR]
 *   node runner-tui-cli.js worktree promote --run-id <id> --artifact <rel> [--approve] [--overwrite] [--dest-rel <prefix>]
 *   node runner-tui-cli.js worktree promote-deny --run-id <id> [--reason-code <code>]
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
} = require('../../runner-model-routing');
const { runTraceViewer } = require('./runner-trace-viewer');
const { runBudgetView } = require('./runner-budget-view');
const {
  createIsolatedWorktree,
  removeIsolatedWorktree,
  listManagedWorktrees,
  statusWorktree,
  formatWorktreeListText,
} = require('../worktree/worktree-isolation');
const {
  readRunWorkdirContract,
  formatRunWorkdirContractText,
} = require('../worktree/run-workdir-contract');
const {
  promoteWorktreeResults,
  denyWorktreePromotion,
  readPromotionRecord,
  formatPromotionRecordText,
} = require('../worktree/worktree-result-promotion');
const { printRunnerTuiHelp } = require('./operator-cli-help');

function printHelp() {
  printRunnerTuiHelp();
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
    else if (a === '--local-provider' && argv[i + 1]) out.localProvider = argv[++i];
    else if (a === '--ollama-host' && argv[i + 1]) out.ollamaHost = argv[++i];
    else if (a === '--ollama-port' && argv[i + 1]) out.ollamaPort = argv[++i];
    else if (a === '--ollama-base-url' && argv[i + 1]) out.ollamaBaseUrl = argv[++i];
    else if (a === '--allow-public-local-runtime') out.allowPublicLocalRuntime = true;
    else if (a === '--show-routing') out.showRouting = true;
    else if (a === '--follow') out.follow = true;
    else if (a === '--worktree-isolated') out.worktreeIsolated = true;
    else if (a === '--force') out.force = true;
    else if (a === '--base-ref' && argv[i + 1]) out.baseRef = argv[++i];
  }
  return out;
}

/**
 * @param {string[]} argv
 */
function parseWorktreeArgs(argv) {
  const out = parseCommonArgs(argv);
  /** @type {string[]} */
  const artifacts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--artifact' && argv[i + 1]) artifacts.push(argv[++i]);
    else if (a === '--approve') out.approve = true;
    else if (a === '--overwrite') out.overwrite = true;
    else if (a === '--dest-rel' && argv[i + 1]) out.destRel = argv[++i];
    else if (a === '--reason-code' && argv[i + 1]) out.reasonCode = argv[++i];
  }
  if (artifacts.length) out.artifacts = artifacts;
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

/**
 * @param {Record<string, string | boolean>} opts
 * @returns {Record<string, unknown>}
 */
function endpointOptionsFromCli(opts) {
  return {
    localProvider: opts.localProvider ? String(opts.localProvider) : undefined,
    ollamaHost: opts.ollamaHost ? String(opts.ollamaHost) : undefined,
    ollamaPort: opts.ollamaPort != null ? opts.ollamaPort : undefined,
    ollamaBaseUrl: opts.ollamaBaseUrl ? String(opts.ollamaBaseUrl) : undefined,
    allowPublicLocalRuntime: opts.allowPublicLocalRuntime === true,
  };
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
      ...endpointOptionsFromCli(opts),
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
        ...endpointOptionsFromCli(opts),
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
        worktreeIsolated: opts.worktreeIsolated === true,
        taskId: opts.runId ? String(opts.runId) : undefined,
        worktreeBaseRef: opts.baseRef ? String(opts.baseRef) : undefined,
        ...endpointOptionsFromCli(opts),
      });
      console.log(formatPreflightText(launched.preflight));
      if (launched.worktree) {
        console.log('');
        console.log('Worktree isolation');
        console.log(`  task_id:       ${launched.worktree.task_id}`);
        console.log(`  worktree_path: ${launched.worktree.worktree_path}`);
        console.log(`  branch:        ${launched.worktree.branch}`);
        console.log(`  run_cwd:       ${launched.run_cwd}`);
        if (launched.run_workdir_contract) {
          console.log('');
          console.log(formatRunWorkdirContractText(launched.run_workdir_contract));
        }
      }
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
      } else if (err && err.worktree) {
        console.error(err instanceof Error ? err.message : String(err));
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      const code = err && err.code;
      process.exit(code === 'RUNNER_PREFLIGHT_BLOCKED' || code === 'RUNNER_WORKTREE_BLOCKED' ? 2 : 1);
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

  if (cmd === 'budget') {
    if (!opts.runId && !opts.file) {
      console.error('budget requires --run-id or --file');
      process.exit(1);
    }
    const result = await runBudgetView({
      runId: opts.runId ? String(opts.runId) : undefined,
      filePath: opts.file ? String(opts.file) : undefined,
    });
    if (!result.ok) {
      console.error(result.error || 'budget failed');
      process.exit(result.error === 'trace file not found' ? 2 : 1);
    }
    if (result.text) {
      console.log(result.text);
    }
    process.exit(0);
  }

  if (cmd === 'worktree') {
    const sub = rest[0];
    const wopts = parseWorktreeArgs(rest.slice(1));
    const repoRoot = wopts.cwd;

    if (sub === 'create') {
      if (!wopts.runId) {
        console.error('worktree create requires --run-id');
        process.exit(1);
      }
      const created = createIsolatedWorktree({
        repoRoot,
        primaryCwd: repoRoot,
        taskId: String(wopts.runId),
        baseRef: wopts.baseRef ? String(wopts.baseRef) : undefined,
      });
      if (!created.ok) {
        console.error(created.error || 'worktree create failed');
        if (created.detail) console.error(created.detail);
        process.exit(created.error === 'not_a_git_repository' ? 2 : 1);
      }
      console.log('Worktree created');
      console.log(`  task_id:       ${created.task_id}`);
      console.log(`  worktree_path: ${created.worktree_path}`);
      console.log(`  branch:        ${created.branch}`);
      console.log(`  created:       ${created.created ? 'yes' : 'already_exists'}`);
      if (created.contract) {
        console.log('');
        console.log(formatRunWorkdirContractText(created.contract));
      }
      process.exit(0);
    }

    if (sub === 'remove') {
      if (!wopts.runId) {
        console.error('worktree remove requires --run-id');
        process.exit(1);
      }
      const removed = removeIsolatedWorktree({
        repoRoot,
        taskId: String(wopts.runId),
        force: wopts.force === true,
      });
      if (!removed.ok) {
        console.error(removed.error || 'worktree remove failed');
        if (removed.detail) console.error(removed.detail);
        if (removed.reason_code) console.error(`reason_code: ${removed.reason_code}`);
        process.exit(removed.error === 'worktree_not_found' ? 2 : 1);
      }
      if (removed.already_removed) {
        console.log(`Worktree already removed (${removed.worktree_path})`);
      } else {
        console.log(`Removed worktree ${removed.worktree_path}`);
      }
      process.exit(0);
    }

    if (sub === 'list') {
      const listed = listManagedWorktrees({ repoRoot });
      if (!listed.ok) {
        console.error(listed.error || 'worktree list failed');
        process.exit(listed.error === 'not_a_git_repository' ? 2 : 1);
      }
      console.log(formatWorktreeListText(listed));
      console.log(`  dir: ${listed.worktrees_dir}`);
      process.exit(0);
    }

    if (sub === 'status') {
      const st = statusWorktree({
        repoRoot,
        taskId: wopts.runId ? String(wopts.runId) : undefined,
        cwd: wopts.cwd,
      });
      if (!st.ok) {
        console.error(st.error || 'worktree status failed');
        process.exit(st.error === 'not_a_git_repository' ? 2 : 1);
      }
      if (wopts.runId) {
        console.log(`task_id:       ${String(wopts.runId)}`);
        console.log(`exists:        ${st.exists}`);
        console.log(`managed:       ${st.managed}`);
        console.log(`worktree_path: ${st.worktree_path}`);
        if (st.contract) {
          console.log('');
          console.log(formatRunWorkdirContractText(st.contract));
          if (st.contract_source) console.log(`  (source: ${st.contract_source})`);
        }
      } else {
        console.log(`cwd:           ${st.cwd}`);
        console.log(`managed:       ${st.managed}`);
        console.log(`git_root:      ${st.git_root ?? '(none)'}`);
        if (st.binding) {
          console.log(`task_id:       ${st.binding.task_id}`);
          console.log(`branch:        ${st.binding.branch}`);
        }
        if (st.contract) {
          console.log('');
          console.log(formatRunWorkdirContractText(st.contract));
          if (st.contract_source) console.log(`  (source: ${st.contract_source})`);
        }
      }
      process.exit(0);
    }

    if (sub === 'contract') {
      let contractCwd = wopts.cwd || process.cwd();
      if (wopts.runId) {
        const st = statusWorktree({ repoRoot, taskId: String(wopts.runId) });
        if (!st.ok) {
          console.error(st.error || 'worktree status failed');
          process.exit(st.error === 'not_a_git_repository' ? 2 : 1);
        }
        if (!st.exists) {
          console.error('worktree_not_found');
          process.exit(2);
        }
        contractCwd = st.worktree_path;
      }
      const contractRead = readRunWorkdirContract(contractCwd);
      if (!contractRead.ok) {
        console.error(contractRead.errors?.join(', ') || 'contract not found');
        process.exit(2);
      }
      console.log(formatRunWorkdirContractText(contractRead.contract));
      console.log(`  (source: ${contractRead.source})`);
      process.exit(0);
    }

    if (sub === 'promote') {
      if (!wopts.runId) {
        console.error('worktree promote requires --run-id');
        process.exit(1);
      }
      const artifacts = Array.isArray(wopts.artifacts) ? wopts.artifacts : [];
      if (!artifacts.length) {
        console.error('worktree promote requires at least one --artifact <rel>');
        process.exit(1);
      }
      const result = promoteWorktreeResults({
        repoRoot,
        taskId: String(wopts.runId),
        artifacts,
        destRelPrefix: wopts.destRel ? String(wopts.destRel) : undefined,
        operatorApproved: wopts.approve === true,
        allowOverwrite: wopts.overwrite === true,
      });
      if (!result.ok) {
        console.error(result.error || 'worktree promote failed');
        if (result.reason_code) console.error(`reason_code: ${result.reason_code}`);
        process.exit(result.error === 'worktree_not_found' ? 2 : 1);
      }
      console.log('Promotion completed');
      console.log(`  task_id:       ${result.task_id}`);
      console.log(`  worktree_path: ${result.worktree_path}`);
      console.log(`  repo_root:     ${result.repo_root}`);
      for (const a of result.artifacts) {
        console.log(`  promoted:      ${a.source_rel} → ${a.dest_rel}`);
      }
      if (result.promotion_record) {
        console.log('');
        console.log(formatPromotionRecordText(result.promotion_record));
      }
      process.exit(0);
    }

    if (sub === 'promote-deny') {
      if (!wopts.runId) {
        console.error('worktree promote-deny requires --run-id');
        process.exit(1);
      }
      const result = denyWorktreePromotion({
        repoRoot,
        taskId: String(wopts.runId),
        reasonCode: wopts.reasonCode ? String(wopts.reasonCode) : undefined,
      });
      if (!result.ok) {
        console.error(result.error || 'worktree promote-deny failed');
        if (result.reason_code) console.error(`reason_code: ${result.reason_code}`);
        process.exit(result.error === 'worktree_not_found' ? 2 : 1);
      }
      console.log('Promotion denied (no cleanup side effects)');
      console.log(`  task_id:       ${result.task_id}`);
      console.log(`  worktree_path: ${result.worktree_path}`);
      console.log(`  reason_code:   ${result.reason_code}`);
      if (result.promotion_record) {
        console.log('');
        console.log(formatPromotionRecordText(result.promotion_record));
      }
      process.exit(0);
    }

    if (sub === 'promotion') {
      if (!wopts.runId) {
        console.error('worktree promotion requires --run-id');
        process.exit(1);
      }
      const st = statusWorktree({ repoRoot, taskId: String(wopts.runId) });
      if (!st.ok || !st.exists) {
        console.error(st.error || 'worktree_not_found');
        process.exit(2);
      }
      const record = readPromotionRecord(st.worktree_path);
      console.log(formatPromotionRecordText(record));
      process.exit(0);
    }

    console.error('worktree requires create|remove|list|status|contract|promote|promote-deny|promotion');
    process.exit(1);
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
  endpointOptionsFromCli,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
