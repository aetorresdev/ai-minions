#!/usr/bin/env node
/**
 * Stable primary smoke command + trace/evidence path for ai-minions.
 * Fail-closed with stable reason_code values — no secrets in output.
 *
 * Usage:
 *   node scripts/run-primary-smoke.mjs [--json] [--run] [--inspect <task_id>]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ORCHESTRATOR_DIR, REPO_ROOT, resolveTracesDir } from "./bootstrap-preflight.mjs";

/** Canonical degraded smoke goal — keep in sync with docs/how-to/primary-smoke.md */
export const DEFAULT_GOAL = "Smoke: list three files under orchestrator/ and stop";

export const REASON_CODES = {
  OK: "SMOKE_OK",
  REPO_LAYOUT: "SMOKE_REPO_LAYOUT",
  TRACE_NOT_FOUND: "SMOKE_TRACE_NOT_FOUND",
  TRACE_NOT_READABLE: "SMOKE_TRACE_NOT_READABLE",
  RUN_FAILED: "SMOKE_RUN_FAILED",
  TASK_ID_MISSING: "SMOKE_TASK_ID_MISSING",
};

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string }} CheckResult */

/**
 * @param {{ goal?: string, skipGates?: boolean, iterations?: number }} [options]
 * @returns {{ cwd: string, argv: string[], shellCommand: string }}
 */
export function buildSmokeInvocation(options = {}) {
  const goal = options.goal ?? DEFAULT_GOAL;
  const iterations = options.iterations ?? 1;
  const skipGates = options.skipGates !== false;
  const runner = path.join(ORCHESTRATOR_DIR, "run-orchestrator.js");
  const argv = [
    runner,
    ...(skipGates ? ["--skip-gates"] : []),
    "--iterations",
    String(iterations),
    goal,
  ];
  const flagPart = skipGates ? "--skip-gates " : "";
  const shellCommand =
    `cd ${path.relative(REPO_ROOT, ORCHESTRATOR_DIR) || "orchestrator"} && ` +
    `node run-orchestrator.js ${flagPart}--iterations ${iterations} ${JSON.stringify(goal)}`;
  return { cwd: ORCHESTRATOR_DIR, argv, shellCommand };
}

/**
 * @param {string} output
 * @returns {string | null}
 */
export function extractTaskId(output) {
  const match = String(output).match(/Task ID:\s+(\S+)/);
  return match?.[1] ?? null;
}

/**
 * @param {string} tracesDir
 * @param {string} taskId
 * @returns {string}
 */
export function traceFilePath(tracesDir, taskId) {
  return path.join(tracesDir, `${taskId}.jsonl`);
}

/**
 * @param {string} taskId
 * @param {string} [tracesDir]
 * @returns {{ ok: boolean, checks: CheckResult[], traces_dir: string, trace_file: string, task_id: string }}
 */
export function inspectSmokeTrace(taskId, tracesDir = resolveTracesDir()) {
  const traceFile = traceFilePath(tracesDir, taskId);
  /** @type {CheckResult[]} */
  const checks = [];

  if (!taskId || !String(taskId).trim()) {
    checks.push({
      id: "task_id",
      reason_code: REASON_CODES.TASK_ID_MISSING,
      status: "fail",
      message: "task_id is required for --inspect",
    });
    return { ok: false, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
  }

  if (!fs.existsSync(traceFile)) {
    checks.push({
      id: "trace_file",
      reason_code: REASON_CODES.TRACE_NOT_FOUND,
      status: "fail",
      message: `trace file not found: ${traceFile}`,
    });
    return { ok: false, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
  }

  try {
    const stat = fs.statSync(traceFile);
    if (!stat.isFile() || stat.size === 0) {
      checks.push({
        id: "trace_file",
        reason_code: REASON_CODES.TRACE_NOT_READABLE,
        status: "fail",
        message: `trace file empty or not readable: ${traceFile}`,
      });
      return { ok: false, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
    }
    const sample = fs.readFileSync(traceFile, { encoding: "utf8", flag: "r" }).slice(0, 200);
    if (!sample.includes("{")) {
      checks.push({
        id: "trace_file",
        reason_code: REASON_CODES.TRACE_NOT_READABLE,
        status: "fail",
        message: `trace file does not look like JSONL: ${traceFile}`,
      });
      return { ok: false, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
    }
  } catch {
    checks.push({
      id: "trace_file",
      reason_code: REASON_CODES.TRACE_NOT_READABLE,
      status: "fail",
      message: `cannot read trace file: ${traceFile}`,
    });
    return { ok: false, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
  }

  checks.push({
    id: "trace_file",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: `trace file present: ${traceFile}`,
  });
  return { ok: true, checks, traces_dir: tracesDir, trace_file: traceFile, task_id: taskId };
}

/**
 * @param {{ repoRoot?: string, goal?: string }} [options]
 * @returns {{ ok: boolean, checks: CheckResult[], traces_dir: string, invocation: ReturnType<typeof buildSmokeInvocation>, expected: { exit_code: number, stdout_fields: string[] } }}
 */
export function planPrimarySmoke(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const orchDir = path.join(repoRoot, "orchestrator");
  const tracesDir = resolveTracesDir();
  /** @type {CheckResult[]} */
  const checks = [];

  const runnerPath = path.join(orchDir, "run-orchestrator.js");
  if (!fs.existsSync(path.join(orchDir, "package.json")) || !fs.existsSync(runnerPath)) {
    checks.push({
      id: "repo_layout",
      reason_code: REASON_CODES.REPO_LAYOUT,
      status: "fail",
      message: "orchestrator/ layout missing (run from ai-minions clone)",
    });
    return {
      ok: false,
      checks,
      traces_dir: tracesDir,
      invocation: buildSmokeInvocation({ goal: options.goal }),
      expected: { exit_code: 0, stdout_fields: ["Done", "Task ID"] },
    };
  }

  checks.push({
    id: "repo_layout",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: "orchestrator/ layout present",
  });

  const invocation = buildSmokeInvocation({ goal: options.goal });
  return {
    ok: true,
    checks,
    traces_dir: tracesDir,
    invocation,
    expected: {
      exit_code: 0,
      stdout_fields: ["Done", "Task ID"],
      trace_pattern: `${tracesDir}/<task_id>.jsonl`,
      inspect_command: "node scripts/run-primary-smoke.mjs --inspect <task_id>",
      explain_command: "cd orchestrator && npm run explain-run -- --run-id <task_id>",
    },
  };
}

/**
 * @param {{ goal?: string, repoRoot?: string }} [options]
 * @returns {{ ok: boolean, checks: CheckResult[], traces_dir: string, task_id: string | null, trace_file: string | null, invocation: ReturnType<typeof buildSmokeInvocation> }}
 */
export function runPrimarySmokeLive(options = {}) {
  const plan = planPrimarySmoke(options);
  if (!plan.ok) {
    return {
      ok: false,
      checks: plan.checks,
      traces_dir: plan.traces_dir,
      task_id: null,
      trace_file: null,
      invocation: plan.invocation,
    };
  }

  const { cwd, argv } = plan.invocation;
  const run = spawnSync(process.execPath, argv, { cwd, encoding: "utf8", stdio: "pipe" });
  const combined = `${run.stdout || ""}${run.stderr || ""}`;
  /** @type {CheckResult[]} */
  const checks = [...plan.checks];

  if (run.status !== 0) {
    checks.push({
      id: "smoke_run",
      reason_code: REASON_CODES.RUN_FAILED,
      status: "fail",
      message: `run-orchestrator.js exited ${run.status ?? "unknown"}`,
    });
    return {
      ok: false,
      checks,
      traces_dir: plan.traces_dir,
      task_id: extractTaskId(combined),
      trace_file: null,
      invocation: plan.invocation,
    };
  }

  const taskId = extractTaskId(combined);
  if (!taskId) {
    checks.push({
      id: "task_id",
      reason_code: REASON_CODES.TASK_ID_MISSING,
      status: "fail",
      message: "stdout missing Task ID line",
    });
    return {
      ok: false,
      checks,
      traces_dir: plan.traces_dir,
      task_id: null,
      trace_file: null,
      invocation: plan.invocation,
    };
  }

  const traceReport = inspectSmokeTrace(taskId, plan.traces_dir);
  checks.push(...traceReport.checks);
  const ok = traceReport.ok;
  if (ok) {
    checks.push({
      id: "smoke_run",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "primary smoke run completed",
    });
  }

  return {
    ok,
    checks,
    traces_dir: plan.traces_dir,
    task_id: taskId,
    trace_file: traceReport.trace_file,
    invocation: plan.invocation,
  };
}

/**
 * @param {{ mode: 'plan' | 'inspect' | 'run', plan?: ReturnType<typeof planPrimarySmoke>, inspect?: ReturnType<typeof inspectSmokeTrace>, live?: ReturnType<typeof runPrimarySmokeLive> }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = ["ai-minions primary-smoke"];

  if (report.mode === "plan" && report.plan) {
    const p = report.plan;
    lines.push(`  ok: ${p.ok}`);
    lines.push(`  traces_dir: ${p.traces_dir}`);
    lines.push(`  command: ${p.invocation.shellCommand}`);
    lines.push(`  wrapper: node scripts/run-primary-smoke.mjs --run`);
    lines.push(`  expected_exit: ${p.expected.exit_code}`);
    lines.push(`  expected_stdout: ${p.expected.stdout_fields.join(", ")}`);
    lines.push(`  trace_file: ${p.expected.trace_pattern}`);
    lines.push(`  inspect: ${p.expected.inspect_command}`);
    lines.push(`  explain: ${p.expected.explain_command}`);
    for (const c of p.checks) {
      const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
      lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
    }
    return lines.join("\n");
  }

  if (report.mode === "inspect" && report.inspect) {
    const i = report.inspect;
    lines.push(`  ok: ${i.ok}`);
    lines.push(`  task_id: ${i.task_id}`);
    lines.push(`  traces_dir: ${i.traces_dir}`);
    lines.push(`  trace_file: ${i.trace_file}`);
    for (const c of i.checks) {
      const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
      lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
    }
    return lines.join("\n");
  }

  if (report.mode === "run" && report.live) {
    const l = report.live;
    lines.push(`  ok: ${l.ok}`);
    lines.push(`  traces_dir: ${l.traces_dir}`);
    if (l.task_id) lines.push(`  task_id: ${l.task_id}`);
    if (l.trace_file) lines.push(`  trace_file: ${l.trace_file}`);
    lines.push(`  command: ${l.invocation.shellCommand}`);
    for (const c of l.checks) {
      const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
      lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
    }
    return lines.join("\n");
  }

  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, run: boolean, inspect: string | null, help: boolean, goal: string | null }}
 */
function parseArgs(argv) {
  let inspect = null;
  let goal = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--inspect" && argv[i + 1]) {
      inspect = argv[++i];
    } else if (argv[i] === "--goal" && argv[i + 1]) {
      goal = argv[++i];
    }
  }
  return {
    json: argv.includes("--json"),
    run: argv.includes("--run"),
    inspect,
    help: argv.includes("-h") || argv.includes("--help"),
    goal,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/run-primary-smoke.mjs [options]

Default (no flags): print stable smoke command + trace path (smoke note).

Options:
  --run                 Execute live degraded smoke via run-orchestrator.js
  --inspect <task_id>   Verify trace JSONL exists on known evidence path
  --goal <text>         Override default smoke goal (advanced)
  --json                Machine-readable report on stdout
  -h, --help            Show this help

Exit codes: 0 = pass, 1 = blocker(s)

Reason codes: SMOKE_REPO_LAYOUT, SMOKE_RUN_FAILED, SMOKE_TASK_ID_MISSING,
SMOKE_TRACE_NOT_FOUND, SMOKE_TRACE_NOT_READABLE, SMOKE_OK
`);
    process.exit(0);
  }

  let ok = true;
  let payload;

  if (args.inspect) {
    const inspect = inspectSmokeTrace(args.inspect);
    ok = inspect.ok;
    payload = { mode: "inspect", inspect };
  } else if (args.run) {
    const live = runPrimarySmokeLive({ goal: args.goal ?? undefined });
    ok = live.ok;
    payload = { mode: "run", live };
  } else {
    const plan = planPrimarySmoke({ goal: args.goal ?? undefined });
    ok = plan.ok;
    payload = { mode: "plan", plan };
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(payload)}\n`);
  }

  const checks =
    payload.mode === "plan"
      ? payload.plan.checks
      : payload.mode === "inspect"
        ? payload.inspect.checks
        : payload.live.checks;

  if (!ok) {
    for (const b of checks.filter((c) => c.status === "fail")) {
      process.stderr.write(`blocker: ${b.reason_code}\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
