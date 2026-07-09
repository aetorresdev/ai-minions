#!/usr/bin/env node
/**
 * Operator preflight bridge — chains bootstrap (PREFLIGHT_*) then runner:tui launch preflight (OPERATOR_*).
 * Does not rename or replace PREFLIGHT_* codes from bootstrap-preflight.mjs.
 *
 * Usage:
 *   node scripts/operator-preflight.mjs [--json] [--install] [--live] [--bootstrap-only]
 *       [--model-policy local_only|remote_ok]
 */

import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ORCHESTRATOR_DIR,
  REPO_ROOT,
  runBootstrapPreflight,
} from "./bootstrap-preflight.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * @returns {typeof import('../orchestrator/runtime-preflight.js').runRuntimePreflight}
 */
function defaultRunRuntimePreflight() {
  const require = createRequire(import.meta.url);
  return require(path.join(ORCHESTRATOR_DIR, "runtime-preflight.js")).runRuntimePreflight;
}

export const OPERATOR_REASON_CODES = {
  OK: "OPERATOR_OK",
  BOOTSTRAP_BLOCKED: "OPERATOR_BOOTSTRAP_BLOCKED",
  RUNNER_INVOKE_FAILED: "OPERATOR_RUNNER_INVOKE_FAILED",
  MODEL_POLICY_UNKNOWN: "OPERATOR_MODEL_POLICY_UNKNOWN",
  OLLAMA_UNREACHABLE: "OPERATOR_OLLAMA_UNREACHABLE",
  LOCAL_BACKEND_MISSING: "OPERATOR_LOCAL_BACKEND_MISSING",
  MODEL_SELECTION_FAILED: "OPERATOR_MODEL_SELECTION_FAILED",
  RUNNER_PREFLIGHT_BLOCKED: "OPERATOR_RUNNER_PREFLIGHT_BLOCKED",
};

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{
 *   id: string,
 *   layer: 'bootstrap' | 'runtime' | 'runner',
 *   reason_code: string | null,
 *   operator_reason_code: string,
 *   status: CheckStatus,
 *   message: string,
 * }} BridgeCheck */

/**
 * @param {string} blocker
 * @returns {string}
 */
export function classifyRunnerBlocker(blocker) {
  const text = String(blocker).trim();
  if (/^unknown model policy:/i.test(text)) {
    return OPERATOR_REASON_CODES.MODEL_POLICY_UNKNOWN;
  }
  if (/ollama backend unreachable/i.test(text)) {
    return OPERATOR_REASON_CODES.OLLAMA_UNREACHABLE;
  }
  if (/missing local backend/i.test(text) || /network egress denied/i.test(text)) {
    return OPERATOR_REASON_CODES.LOCAL_BACKEND_MISSING;
  }
  if (/^\[local-model-selection\]/i.test(text) || /model selection/i.test(text)) {
    return OPERATOR_REASON_CODES.MODEL_SELECTION_FAILED;
  }
  if (/MODEL_NOT_FOUND/i.test(text)) {
    return OPERATOR_REASON_CODES.MODEL_SELECTION_FAILED;
  }
  if (/MODEL_RUNTIME_UNREACHABLE/i.test(text)) {
    return OPERATOR_REASON_CODES.OLLAMA_UNREACHABLE;
  }
  return OPERATOR_REASON_CODES.RUNNER_PREFLIGHT_BLOCKED;
}

/**
 * @param {import('../orchestrator/runtime-preflight.js').runRuntimePreflight extends (...args: infer A) => infer R ? R : never} runtimeResult
 * @returns {BridgeCheck[]}
 */
export function buildRuntimePreflightChecks(runtimeResult) {
  /** @type {BridgeCheck[]} */
  const checks = [];
  const components = runtimeResult.runtime_preflight?.components ?? [];
  for (const component of components) {
    if (component.status === "ok") continue;
    const bridgeStatus =
      component.status === "blocked" ? "fail" : /** @type {CheckStatus} */ ("warn");
    checks.push({
      id: `runtime_${component.component_id.replace(/[^a-z0-9]+/gi, "_")}`,
      layer: "runtime",
      reason_code: component.reason_code,
      operator_reason_code: component.reason_code,
      status: bridgeStatus,
      message: `[${component.component_id}] ${component.message}`,
    });
  }
  if (components.length > 0 && components.every((c) => c.status === "ok")) {
    checks.push({
      id: "runtime_preflight",
      layer: "runtime",
      reason_code: "RUNTIME_PREFLIGHT_OK",
      operator_reason_code: OPERATOR_REASON_CODES.OK,
      status: "pass",
      message: `runtime preflight ok (${runtimeResult.runtime_preflight.overall_status})`,
    });
  }
  return checks;
}

/**
 * @param {string} stdout
 * @returns {{ ok: boolean, blockers: string[] }}
 */
export function parseRunnerPreflightOutput(stdout) {
  const text = String(stdout);
  const okMatch = text.match(/^\s*ok:\s*(true|false)/m);
  const ok = okMatch ? okMatch[1] === "true" : false;
  /** @type {string[]} */
  const blockers = [];
  let inBlockers = false;
  for (const line of text.split("\n")) {
    if (/^\s*blockers:\s*$/.test(line)) {
      inBlockers = true;
      continue;
    }
    if (inBlockers) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        blockers.push(item[1].trim());
      } else if (line.trim() && !/^\s+/.test(line)) {
        inBlockers = false;
      }
    }
  }
  return { ok, blockers };
}

/**
 * @param {{ orchestratorDir?: string, modelPolicy?: string }} [options]
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function runRunnerPreflightInvoke(options = {}) {
  const orchDir = options.orchestratorDir ?? ORCHESTRATOR_DIR;
  const modelPolicy = options.modelPolicy ?? "local_only";
  const result = spawnSync(
    "npm",
    ["run", "runner:tui", "--", "preflight", "--model-policy", modelPolicy],
    { cwd: orchDir, encoding: "utf8", stdio: "pipe" },
  );
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   install?: boolean,
 *   live?: boolean,
 *   test?: boolean,
 *   bootstrapOnly?: boolean,
 *   modelPolicy?: string,
 *   invokeRunner?: typeof runRunnerPreflightInvoke,
 *   runRuntimePreflight?: typeof import('../orchestrator/runtime-preflight.js').runRuntimePreflight,
 *   skipRuntimePreflight?: boolean,
 * }} [options]
 */
export async function runOperatorPreflight(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const bootstrap = await runBootstrapPreflight({
    repoRoot,
    install: options.install,
    live: options.live,
    runTest: options.test,
  });

  /** @type {BridgeCheck[]} */
  const checks = [];

  for (const c of bootstrap.checks) {
    if (c.status === "fail") {
      checks.push({
        id: `bootstrap_${c.id}`,
        layer: "bootstrap",
        reason_code: c.reason_code,
        operator_reason_code: OPERATOR_REASON_CODES.BOOTSTRAP_BLOCKED,
        status: "fail",
        message: c.message,
      });
    }
  }

  if (!bootstrap.ok) {
    return {
      ok: false,
      layer_stopped: "bootstrap",
      bootstrap,
      runner: null,
      runtime_preflight: null,
      checks,
      traces_dir: bootstrap.traces_dir,
    };
  }

  checks.push({
    id: "bootstrap_layer",
    layer: "bootstrap",
    reason_code: "PREFLIGHT_OK",
    operator_reason_code: OPERATOR_REASON_CODES.OK,
    status: "pass",
    message: "bootstrap layer passed",
  });

  /** @type {ReturnType<typeof defaultRunRuntimePreflight> extends (...args: infer A) => infer R ? R : null} */
  let runtimePreflight = null;

  if (!options.skipRuntimePreflight && !options.bootstrapOnly) {
    const runRuntimePreflight = options.runRuntimePreflight ?? defaultRunRuntimePreflight();
    runtimePreflight = runRuntimePreflight({
      repoRoot,
      modelPolicy: options.modelPolicy ?? "local_only",
    });
    checks.push(...buildRuntimePreflightChecks(runtimePreflight));

    const runtimeBlocked = runtimePreflight.runtime_preflight.components.some(
      (c) => c.status === "blocked",
    );
    if (runtimeBlocked) {
      return {
        ok: false,
        layer_stopped: "runtime",
        bootstrap,
        runner: null,
        runtime_preflight: runtimePreflight.runtime_preflight,
        checks,
        traces_dir: bootstrap.traces_dir,
      };
    }
  }

  if (options.bootstrapOnly) {
    return {
      ok: true,
      layer_stopped: "bootstrap",
      bootstrap,
      runner: null,
      runtime_preflight: runtimePreflight?.runtime_preflight ?? null,
      checks,
      traces_dir: bootstrap.traces_dir,
    };
  }

  const invoke = options.invokeRunner ?? runRunnerPreflightInvoke;
  const runner = invoke({
    orchestratorDir: path.join(repoRoot, "orchestrator"),
    modelPolicy: options.modelPolicy,
  });

  if (!runner.stdout.includes("Runner preflight") && runner.exitCode === 1) {
    checks.push({
      id: "runner_invoke",
      layer: "runner",
      reason_code: null,
      operator_reason_code: OPERATOR_REASON_CODES.RUNNER_INVOKE_FAILED,
      status: "fail",
      message: "failed to invoke runner:tui preflight",
    });
    return {
      ok: false,
      layer_stopped: "runner",
      bootstrap,
      runner,
      runtime_preflight: runtimePreflight?.runtime_preflight ?? null,
      checks,
      traces_dir: bootstrap.traces_dir,
    };
  }

  const parsed = parseRunnerPreflightOutput(runner.stdout);
  const runnerBlocked = !parsed.ok || runner.exitCode === 2;

  if (runnerBlocked) {
    if (parsed.blockers.length) {
      for (const [i, blocker] of parsed.blockers.entries()) {
        checks.push({
          id: `runner_blocker_${i}`,
          layer: "runner",
          reason_code: null,
          operator_reason_code: classifyRunnerBlocker(blocker),
          status: "fail",
          message: blocker,
        });
      }
    } else {
      checks.push({
        id: "runner_preflight",
        layer: "runner",
        reason_code: null,
        operator_reason_code: OPERATOR_REASON_CODES.RUNNER_PREFLIGHT_BLOCKED,
        status: "fail",
        message: "runner preflight blocked (no blocker detail)",
      });
    }
  } else {
    checks.push({
      id: "runner_layer",
      layer: "runner",
      reason_code: null,
      operator_reason_code: OPERATOR_REASON_CODES.OK,
      status: "pass",
      message: "runner launch preflight passed",
    });
  }

  const ok = checks.every((c) => c.status !== "fail");
  return {
    ok,
    layer_stopped: ok ? null : "runner",
    bootstrap,
    runner,
    runtime_preflight: runtimePreflight?.runtime_preflight ?? null,
    checks,
    traces_dir: bootstrap.traces_dir,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runOperatorPreflight>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions operator-preflight",
    `  traces_dir: ${report.traces_dir}`,
    `  ok: ${report.ok}`,
  ];
  if (report.layer_stopped) {
    lines.push(`  layer_stopped: ${report.layer_stopped}`);
  }
  if (report.runtime_preflight?.overall_status) {
    lines.push(`  runtime_preflight: ${report.runtime_preflight.overall_status}`);
  }
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    const bootstrapCode = c.reason_code ? ` ${c.reason_code}` : "";
    lines.push(
      `  [${tag}] ${c.operator_reason_code}${bootstrapCode} — [${c.layer}] ${c.message}`,
    );
  }
  return lines.join("\n");
}

/**
 * @param {Awaited<ReturnType<typeof runOperatorPreflight>>} report
 */
export function writeBlockersToStderr(report) {
  for (const c of report.checks) {
    if (c.status !== "fail") continue;
    if ((c.layer === "bootstrap" || c.layer === "runtime") && c.reason_code) {
      process.stderr.write(`blocker: ${c.reason_code}\n`);
    } else {
      process.stderr.write(`blocker: ${c.operator_reason_code}\n`);
    }
  }
}

function parseArgs(argv) {
  let modelPolicy = "local_only";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model-policy" && argv[i + 1]) {
      modelPolicy = argv[++i];
    }
  }
  return {
    json: argv.includes("--json"),
    install: argv.includes("--install"),
    live: argv.includes("--live"),
    test: argv.includes("--test"),
    bootstrapOnly: argv.includes("--bootstrap-only"),
    modelPolicy,
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/operator-preflight.mjs [options]

Chains bootstrap-preflight (PREFLIGHT_*) → runtime preflight (RUNTIME_PREFLIGHT_*) → runner:tui preflight (OPERATOR_*).

Options:
  --install          Run npm ci when orchestrator/node_modules is missing
  --live             Require claude CLI + auth on bootstrap layer
  --test             Run npm test on bootstrap layer (slow)
  --bootstrap-only   Stop after bootstrap layer (skip runtime + runner preflight)
  --model-policy     local_only (default) | remote_ok — runner launch layer only
  --json             Machine-readable report on stdout
  -h, --help         Show this help

Exit codes: 0 = all layers pass, 1 = blocker(s)
`);
    process.exit(0);
  }

  const report = await runOperatorPreflight({
    install: args.install,
    live: args.live,
    test: args.test,
    bootstrapOnly: args.bootstrapOnly,
    modelPolicy: args.modelPolicy,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  if (!report.ok) {
    writeBlockersToStderr(report);
  }

  process.exit(report.ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
