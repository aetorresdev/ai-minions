#!/usr/bin/env node
/**
 * Operator trace/evidence inspect path for a completed run (runner:tui workflow).
 * Chains trace file check, runner:tui status/trace/budget panels, and explain-run.
 * Fail-closed with stable INSPECT_* reason codes — no secrets in output.
 *
 * Usage:
 *   node scripts/inspect-run-evidence.mjs <task_id> [--json] [--skip-panels]
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ORCHESTRATOR_DIR, resolveTracesDir } from "./bootstrap-preflight.mjs";
import { inspectSmokeTrace } from "./run-primary-smoke.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REASON_CODES = {
  OK: "INSPECT_OK",
  TASK_ID_MISSING: "INSPECT_TASK_ID_MISSING",
  TRACE_NOT_FOUND: "INSPECT_TRACE_NOT_FOUND",
  TRACE_NOT_READABLE: "INSPECT_TRACE_NOT_READABLE",
  STATUS_INVOKE_FAILED: "INSPECT_STATUS_INVOKE_FAILED",
  STATUS_TRACE_MISSING: "INSPECT_STATUS_TRACE_MISSING",
  TRACE_PANEL_FAILED: "INSPECT_TRACE_PANEL_FAILED",
  BUDGET_PANEL_FAILED: "INSPECT_BUDGET_PANEL_FAILED",
  EXPLAIN_FAILED: "INSPECT_EXPLAIN_FAILED",
};

const SMOKE_TO_INSPECT = {
  SMOKE_OK: REASON_CODES.OK,
  SMOKE_TASK_ID_MISSING: REASON_CODES.TASK_ID_MISSING,
  SMOKE_TRACE_NOT_FOUND: REASON_CODES.TRACE_NOT_FOUND,
  SMOKE_TRACE_NOT_READABLE: REASON_CODES.TRACE_NOT_READABLE,
};

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string, layer?: string }} InspectCheck */

/**
 * @param {{ reason_code: string, status: CheckStatus, message: string, id: string }} check
 * @param {string} [layer]
 * @returns {InspectCheck}
 */
export function mapTraceCheck(check, layer = "trace_file") {
  return {
    id: check.id,
    layer,
    reason_code: SMOKE_TO_INSPECT[check.reason_code] ?? REASON_CODES.TRACE_NOT_READABLE,
    status: check.status,
    message: check.message,
  };
}

/**
 * @param {{ orchestratorDir?: string, taskId: string }} options
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function invokeRunnerStatus(options) {
  const orchDir = options.orchestratorDir ?? ORCHESTRATOR_DIR;
  const result = spawnSync(
    "npm",
    ["run", "runner:tui", "--", "status", "--run-id", String(options.taskId)],
    { cwd: orchDir, encoding: "utf8", stdio: "pipe" },
  );
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * @param {{ orchestratorDir?: string, taskId: string, subcommand: 'trace' | 'budget' }} options
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function invokeRunnerPanel(options) {
  const orchDir = options.orchestratorDir ?? ORCHESTRATOR_DIR;
  const result = spawnSync(
    "npm",
    ["run", "runner:tui", "--", options.subcommand, "--run-id", String(options.taskId)],
    { cwd: orchDir, encoding: "utf8", stdio: "pipe" },
  );
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * @param {{ orchestratorDir?: string, taskId: string }} options
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function invokeExplainRun(options) {
  const orchDir = options.orchestratorDir ?? ORCHESTRATOR_DIR;
  const result = spawnSync(
    "npm",
    ["run", "explain-run", "--", "--run-id", String(options.taskId)],
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
 *   taskId?: string,
 *   tracesDir?: string,
 *   skipPanels?: boolean,
 *   invokeStatus?: typeof invokeRunnerStatus,
 *   invokePanel?: typeof invokeRunnerPanel,
 *   invokeExplain?: typeof invokeExplainRun,
 * }} [options]
 */
export async function runInspectRunEvidence(options = {}) {
  const taskId = options.taskId ? String(options.taskId).trim() : "";
  const tracesDir = options.tracesDir ?? resolveTracesDir();
  /** @type {InspectCheck[]} */
  const checks = [];

  if (!taskId) {
    checks.push({
      id: "task_id",
      layer: "input",
      reason_code: REASON_CODES.TASK_ID_MISSING,
      status: "fail",
      message: "task_id is required",
    });
    return { ok: false, task_id: taskId, traces_dir: tracesDir, trace_file: null, checks, panels: null };
  }

  const traceReport = inspectSmokeTrace(taskId, tracesDir);
  const traceFile = traceReport.trace_file;
  for (const c of traceReport.checks) {
    checks.push(mapTraceCheck(c));
  }

  if (!traceReport.ok) {
    return {
      ok: false,
      task_id: taskId,
      traces_dir: tracesDir,
      trace_file: traceFile,
      checks,
      panels: null,
    };
  }

  const invokeStatus = options.invokeStatus ?? invokeRunnerStatus;
  const invokePanel = options.invokePanel ?? invokeRunnerPanel;
  const invokeExplain = options.invokeExplain ?? invokeExplainRun;

  /** @type {{ status?: object, trace?: object, budget?: object, explain?: object }} */
  const panels = {};

  const status = invokeStatus({ taskId });
  panels.status = { exit_code: status.exitCode };
  if (status.exitCode === 0) {
    checks.push({
      id: "runner_status",
      layer: "status",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "runner:tui status read terminal state",
    });
  } else if (status.exitCode === 2) {
    checks.push({
      id: "runner_status",
      layer: "status",
      reason_code: REASON_CODES.STATUS_TRACE_MISSING,
      status: "fail",
      message: "runner:tui status could not read trace (exit 2)",
    });
  } else {
    checks.push({
      id: "runner_status",
      layer: "status",
      reason_code: REASON_CODES.STATUS_INVOKE_FAILED,
      status: "fail",
      message: `runner:tui status failed (exit ${status.exitCode})`,
    });
  }

  if (!options.skipPanels) {
    const tracePanel = invokePanel({ taskId, subcommand: "trace" });
    panels.trace = { exit_code: tracePanel.exitCode };
    if (tracePanel.exitCode === 0) {
      checks.push({
        id: "runner_trace",
        layer: "trace",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "runner:tui trace panel produced output",
      });
    } else {
      checks.push({
        id: "runner_trace",
        layer: "trace",
        reason_code:
          tracePanel.exitCode === 2 ? REASON_CODES.TRACE_NOT_FOUND : REASON_CODES.TRACE_PANEL_FAILED,
        status: "fail",
        message: `runner:tui trace panel failed (exit ${tracePanel.exitCode})`,
      });
    }

    const budgetPanel = invokePanel({ taskId, subcommand: "budget" });
    panels.budget = { exit_code: budgetPanel.exitCode };
    if (budgetPanel.exitCode === 0) {
      checks.push({
        id: "runner_budget",
        layer: "budget",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "runner:tui budget panel produced output",
      });
    } else {
      checks.push({
        id: "runner_budget",
        layer: "budget",
        reason_code:
          budgetPanel.exitCode === 2 ? REASON_CODES.TRACE_NOT_FOUND : REASON_CODES.BUDGET_PANEL_FAILED,
        status: "fail",
        message: `runner:tui budget panel failed (exit ${budgetPanel.exitCode})`,
      });
    }
  }

  const explain = invokeExplain({ taskId });
  panels.explain = { exit_code: explain.exitCode };
  if (explain.exitCode === 0 && String(explain.stdout).trim().length > 0) {
    checks.push({
      id: "explain_run",
      layer: "explain",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "explain-run produced narrative summary",
    });
  } else {
    checks.push({
      id: "explain_run",
      layer: "explain",
      reason_code: REASON_CODES.EXPLAIN_FAILED,
      status: "fail",
      message: `explain-run failed (exit ${explain.exitCode})`,
    });
  }

  const ok = checks.every((c) => c.status !== "fail");
  return {
    ok,
    task_id: taskId,
    traces_dir: tracesDir,
    trace_file: traceFile,
    checks,
    panels,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runInspectRunEvidence>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions inspect-run-evidence",
    `  ok: ${report.ok}`,
    `  task_id: ${report.task_id}`,
    `  traces_dir: ${report.traces_dir}`,
    `  trace_file: ${report.trace_file ?? "(unknown)"}`,
  ];
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    const layer = c.layer ? `[${c.layer}] ` : "";
    lines.push(`  [${tag}] ${c.reason_code} — ${layer}${c.message}`);
  }
  if (report.panels) {
    lines.push("  panels:");
    for (const [name, meta] of Object.entries(report.panels)) {
      if (meta && typeof meta === "object" && "exit_code" in meta) {
        lines.push(`    ${name}: exit ${meta.exit_code}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * @param {Awaited<ReturnType<typeof runInspectRunEvidence>>} report
 */
export function writeBlockersToStderr(report) {
  for (const c of report.checks) {
    if (c.status === "fail") {
      process.stderr.write(`blocker: ${c.reason_code}\n`);
    }
  }
}

function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith("-"));
  return {
    taskId: positional[0] ?? "",
    json: argv.includes("--json"),
    skipPanels: argv.includes("--skip-panels"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/inspect-run-evidence.mjs <task_id> [options]

Inspect trace/evidence for a completed orchestrator run (runner:tui operator path).

Options:
  --skip-panels   Skip runner:tui trace/budget panels (status + explain-run still run)
  --json          Machine-readable report on stdout
  -h, --help      Show this help

Exit codes: 0 = all checks pass, 1 = blocker(s)
`);
    process.exit(0);
  }

  const report = await runInspectRunEvidence({
    taskId: args.taskId,
    skipPanels: args.skipPanels,
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
