#!/usr/bin/env node
/**
 * Local report bundle collector for operator feedback attachment.
 * Copies trace + runner panel captures + inspect report into one directory.
 * Fail-closed with stable BUNDLE_* reason codes — no secrets in output.
 *
 * Usage:
 *   node scripts/collect-run-report.mjs <task_id> [--out <dir>] [--json] [--skip-panels]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, resolveTracesDir } from "./bootstrap-preflight.mjs";
import { traceFilePath } from "./run-primary-smoke.mjs";
import {
  invokeExplainRun,
  invokeRunnerPanel,
  invokeRunnerStatus,
  runInspectRunEvidence,
  validateTraceJsonl,
} from "./inspect-run-evidence.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REASON_CODES = {
  OK: "BUNDLE_OK",
  TASK_ID_MISSING: "BUNDLE_TASK_ID_MISSING",
  TRACE_NOT_FOUND: "BUNDLE_TRACE_NOT_FOUND",
  TRACE_NOT_READABLE: "BUNDLE_TRACE_NOT_READABLE",
  OUTPUT_DIR_FAILED: "BUNDLE_OUTPUT_DIR_FAILED",
  COLLECT_FAILED: "BUNDLE_COLLECT_FAILED",
  INSPECT_BLOCKED: "BUNDLE_INSPECT_BLOCKED",
};

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{ id: string, layer: string, reason_code: string, status: CheckStatus, message: string }} BundleCheck */

/**
 * @param {string} [repoRoot]
 * @returns {string | null}
 */
export function resolveRepoCommit(repoRoot = REPO_ROOT) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    return null;
  }
  return String(result.stdout).trim() || null;
}

/**
 * @param {string} taskId
 * @param {string} [tracesDir]
 * @returns {{ ok: boolean, traceFile: string | null, checks: BundleCheck[] }}
 */
export function validateTraceForBundle(taskId, tracesDir = resolveTracesDir()) {
  /** @type {BundleCheck[]} */
  const checks = [];
  const traceFile = traceFilePath(tracesDir, taskId);

  if (!fs.existsSync(traceFile)) {
    checks.push({
      id: "trace_file",
      layer: "trace_file",
      reason_code: REASON_CODES.TRACE_NOT_FOUND,
      status: "fail",
      message: `trace file not found: ${traceFile}`,
    });
    return { ok: false, traceFile, checks };
  }

  const jsonlValidation = validateTraceJsonl(traceFile);
  if (!jsonlValidation.ok) {
    checks.push({
      id: "trace_file",
      layer: "trace_file",
      reason_code: REASON_CODES.TRACE_NOT_READABLE,
      status: "fail",
      message: `trace file is not valid JSONL: ${traceFile}`,
    });
    return { ok: false, traceFile, checks };
  }

  checks.push({
    id: "trace_file",
    layer: "trace_file",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: "trace file is readable JSONL",
  });
  return { ok: true, traceFile, checks };
}

/**
 * @param {string} bundleDir
 */
export function ensureBundleDir(bundleDir) {
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.mkdirSync(path.join(bundleDir, "trace"), { recursive: true });
  fs.mkdirSync(path.join(bundleDir, "artifacts"), { recursive: true });
}

/**
 * @param {string} taskId
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function defaultBundleDir(taskId, repoRoot = REPO_ROOT) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(repoRoot, "report-bundles", `${taskId}-${stamp}`);
}

/** @type {Record<string, string>} */
const BUNDLE_FILE_PURPOSES = {
  "manifest.json": "Machine-readable index",
  "inspect-report.json": "Full `INSPECT_*` check report",
  "artifacts/status.txt": "`runner:tui status` capture",
  "artifacts/trace-panel.txt": "`runner:tui trace` capture",
  "artifacts/budget-panel.txt": "`runner:tui budget` capture",
  "artifacts/explain-run.txt": "`explain-run` capture",
};

/**
 * @param {string} relPath
 * @param {string} taskId
 * @returns {string}
 */
export function describeBundleFile(relPath, taskId) {
  if (relPath.startsWith("trace/") && relPath.endsWith(".jsonl")) {
    return `Trace copy for \`${taskId}\``;
  }
  return BUNDLE_FILE_PURPOSES[relPath] ?? "Bundle artifact";
}

/**
 * @param {string[]} files
 * @param {string} taskId
 * @returns {string}
 */
export function buildFilesTableRows(files, taskId) {
  return files
    .filter((f) => f !== "ATTACH.md")
    .map((f) => `| \`${f}\` | ${describeBundleFile(f, taskId)} |`)
    .join("\n");
}

/**
 * @param {{
 *   taskId: string,
 *   traceFile: string,
 *   bundleDir: string,
 *   inspectReport: Awaited<ReturnType<typeof runInspectRunEvidence>>,
 *   panelOutputs: Record<string, { exit_code: number, stdout: string, stderr: string }>,
 *   repoCommit?: string | null,
 *   tracesDir?: string,
 * }} input
 * @returns {{ manifestPath: string, attachPath: string, files: string[] }}
 */
export function writeBundleFiles(input) {
  const { taskId, traceFile, bundleDir, inspectReport, panelOutputs, repoCommit, tracesDir } =
    input;
  ensureBundleDir(bundleDir);

  const traceDest = path.join(bundleDir, "trace", `${taskId}.jsonl`);
  fs.copyFileSync(traceFile, traceDest);

  const inspectPath = path.join(bundleDir, "inspect-report.json");
  fs.writeFileSync(inspectPath, `${JSON.stringify(inspectReport, null, 2)}\n`, "utf8");

  /** @type {string[]} */
  const files = [path.relative(bundleDir, traceDest), path.relative(bundleDir, inspectPath)];

  for (const [name, payload] of Object.entries(panelOutputs)) {
    const rel = path.join("artifacts", `${name}.txt`);
    const abs = path.join(bundleDir, rel);
    const body = [
      `# ${name}`,
      `exit_code: ${payload.exit_code}`,
      "",
      "## stdout",
      payload.stdout.trimEnd(),
      "",
      "## stderr",
      payload.stderr.trimEnd(),
      "",
    ].join("\n");
    fs.writeFileSync(abs, body, "utf8");
    files.push(rel);
  }

  const manifestPath = path.join(bundleDir, "manifest.json");
  const bundleFiles = ["manifest.json", ...files];
  const manifest = {
    bundle_version: "1",
    task_id: taskId,
    created_at: new Date().toISOString(),
    repo_commit: repoCommit ?? null,
    traces_dir: tracesDir ?? resolveTracesDir(),
    bundle_dir: bundleDir,
    inspect_ok: inspectReport.ok,
    files: bundleFiles,
    inspect_reason_codes: inspectReport.checks.map((c) => c.reason_code),
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const attachPath = path.join(bundleDir, "ATTACH.md");
  const attachBody = buildAttachTemplate({
    taskId,
    bundleDir,
    repoCommit: repoCommit ?? null,
    inspectOk: inspectReport.ok,
    inspectChecks: inspectReport.checks,
    files: bundleFiles,
  });
  fs.writeFileSync(attachPath, attachBody, "utf8");
  bundleFiles.push("ATTACH.md");

  return { manifestPath, attachPath, files: bundleFiles };
}

/**
 * @param {{
 *   taskId: string,
 *   bundleDir: string,
 *   repoCommit: string | null,
 *   inspectOk: boolean,
 *   inspectChecks: { reason_code: string, status: string, message: string }[],
 *   files: string[],
 * }} ctx
 * @returns {string}
 */
export function buildAttachTemplate(ctx) {
  const failed = ctx.inspectChecks.filter((c) => c.status === "fail");
  const blockerLines =
    failed.length > 0
      ? failed.map((c) => `- \`${c.reason_code}\` — ${c.message}`).join("\n")
      : "- (none — inspect passed)";
  const fileRows = buildFilesTableRows(ctx.files, ctx.taskId);

  return `# Operator report bundle

Attach this directory (or zip it) to a GitHub issue. Redact secrets before upload.

- **Task ID:** \`${ctx.taskId}\`
- **Bundle dir:** \`${ctx.bundleDir}\`
- **Repo commit:** \`${ctx.repoCommit ?? "unknown"}\`
- **Inspect verdict:** ${ctx.inspectOk ? "PASS" : "FAIL"}

## Inspect blockers

${blockerLines}

## Files in this bundle

| File | Purpose |
|------|---------|
${fileRows}

## GitHub issue template (copy below)

\`\`\`markdown
## Smoke report

- **Date:** ${new Date().toISOString().slice(0, 10)}
- **Path:** runner:tui guided run
- **Repo commit:** ${ctx.repoCommit ?? "unknown"}
- **Task ID:** ${ctx.taskId}
- **Verdict:** ${ctx.inspectOk ? "PASS" : "BLOCK"}

### Steps

1. (what you ran)

### Expected

### Actual

### Evidence

- Report bundle: \`${ctx.bundleDir}\`
- Inspect blockers: see ATTACH.md

### Severity

- [ ] BLOCKER
- [ ] BUG
- [ ] USABILITY
- [ ] DOCS
\`\`\`

Feedback templates (GitHub issue forms) are planned for a later release — this bundle is the v0.12 local attachment path.
`;
}

/**
 * @param {{
 *   taskId?: string,
 *   outDir?: string,
 *   skipPanels?: boolean,
 *   tracesDir?: string,
 *   repoRoot?: string,
 *   invokeStatus?: typeof import("./inspect-run-evidence.mjs").invokeRunnerStatus,
 *   invokePanel?: typeof import("./inspect-run-evidence.mjs").invokeRunnerPanel,
 *   invokeExplain?: typeof import("./inspect-run-evidence.mjs").invokeExplainRun,
 * }} [options]
 */
export async function runCollectRunReport(options = {}) {
  const taskId = options.taskId ? String(options.taskId).trim() : "";
  const tracesDir = options.tracesDir ?? resolveTracesDir();
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {BundleCheck[]} */
  const checks = [];

  if (!taskId) {
    checks.push({
      id: "task_id",
      layer: "input",
      reason_code: REASON_CODES.TASK_ID_MISSING,
      status: "fail",
      message: "task_id is required",
    });
    return {
      ok: false,
      task_id: taskId,
      bundle_dir: null,
      traces_dir: tracesDir,
      checks,
      manifest: null,
    };
  }

  const traceValidation = validateTraceForBundle(taskId, tracesDir);
  checks.push(...traceValidation.checks);
  if (!traceValidation.ok || !traceValidation.traceFile) {
    return {
      ok: false,
      task_id: taskId,
      bundle_dir: null,
      traces_dir: tracesDir,
      checks,
      manifest: null,
    };
  }

  const bundleDir = options.outDir
    ? path.resolve(options.outDir)
    : defaultBundleDir(taskId, repoRoot);

  try {
    ensureBundleDir(bundleDir);
  } catch (err) {
    checks.push({
      id: "bundle_dir",
      layer: "output",
      reason_code: REASON_CODES.OUTPUT_DIR_FAILED,
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      task_id: taskId,
      bundle_dir: bundleDir,
      traces_dir: tracesDir,
      checks,
      manifest: null,
    };
  }

  const statusFn = options.invokeStatus ?? invokeRunnerStatus;
  const panelFn = options.invokePanel ?? invokeRunnerPanel;
  const explainFn = options.invokeExplain ?? invokeExplainRun;

  const status = statusFn({ taskId });

  /** @type {Record<string, { exit_code: number, stdout: string, stderr: string }>} */
  const panelOutputs = {
    status: {
      exit_code: status.exitCode,
      stdout: status.stdout,
      stderr: status.stderr,
    },
  };

  if (!options.skipPanels) {
    const tracePanel = panelFn({ taskId, subcommand: "trace" });
    const budgetPanel = panelFn({ taskId, subcommand: "budget" });
    panelOutputs["trace-panel"] = {
      exit_code: tracePanel.exitCode,
      stdout: tracePanel.stdout,
      stderr: tracePanel.stderr,
    };
    panelOutputs["budget-panel"] = {
      exit_code: budgetPanel.exitCode,
      stdout: budgetPanel.stdout,
      stderr: budgetPanel.stderr,
    };
  }

  const explain = explainFn({ taskId });
  panelOutputs["explain-run"] = {
    exit_code: explain.exitCode,
    stdout: explain.stdout,
    stderr: explain.stderr,
  };

  const inspectReport = await runInspectRunEvidence({
    taskId,
    tracesDir,
    skipPanels: options.skipPanels,
    invokeStatus: statusFn,
    invokePanel: panelFn,
    invokeExplain: explainFn,
  });

  let written;
  try {
    written = writeBundleFiles({
      taskId,
      traceFile: traceValidation.traceFile,
      bundleDir,
      inspectReport,
      panelOutputs,
      repoCommit: resolveRepoCommit(repoRoot),
      tracesDir,
    });
  } catch (err) {
    checks.push({
      id: "bundle_write",
      layer: "output",
      reason_code: REASON_CODES.COLLECT_FAILED,
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      task_id: taskId,
      bundle_dir: bundleDir,
      traces_dir: tracesDir,
      checks,
      manifest: null,
    };
  }

  checks.push({
    id: "bundle_write",
    layer: "output",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: `bundle written to ${bundleDir}`,
  });

  if (!inspectReport.ok) {
    checks.push({
      id: "inspect",
      layer: "inspect",
      reason_code: REASON_CODES.INSPECT_BLOCKED,
      status: "fail",
      message: "inspect-run-evidence reported blockers — bundle still collected for attachment",
    });
  } else {
    checks.push({
      id: "inspect",
      layer: "inspect",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "inspect-run-evidence passed",
    });
  }

  const ok = checks.every((c) => c.status !== "fail");
  return {
    ok,
    task_id: taskId,
    bundle_dir: bundleDir,
    traces_dir: tracesDir,
    checks,
    manifest: {
      bundle_version: "1",
      task_id: taskId,
      bundle_dir: bundleDir,
      files: written.files,
      inspect_ok: inspectReport.ok,
    },
    inspect_report: inspectReport,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runCollectRunReport>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions collect-run-report",
    `  ok: ${report.ok}`,
    `  task_id: ${report.task_id}`,
    `  bundle_dir: ${report.bundle_dir ?? "(none)"}`,
    `  traces_dir: ${report.traces_dir}`,
  ];
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    lines.push(`  [${tag}] ${c.reason_code} — [${c.layer}] ${c.message}`);
  }
  if (report.manifest?.files?.length) {
    lines.push("  files:");
    for (const f of report.manifest.files) {
      lines.push(`    - ${f}`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {Awaited<ReturnType<typeof runCollectRunReport>>} report
 */
export function writeBlockersToStderr(report) {
  for (const c of report.checks) {
    if (c.status === "fail") {
      process.stderr.write(`blocker: ${c.reason_code}\n`);
    }
  }
  for (const c of report.inspect_report?.checks ?? []) {
    if (c.status === "fail") {
      process.stderr.write(`blocker: ${c.reason_code}\n`);
    }
  }
}

function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith("-"));
  let outDir = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      outDir = argv[i + 1];
      i += 1;
    }
  }
  return {
    taskId: positional[0] ?? "",
    outDir,
    json: argv.includes("--json"),
    skipPanels: argv.includes("--skip-panels"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/collect-run-report.mjs <task_id> [options]

Collect a local report bundle for operator feedback attachment.

Options:
  --out <dir>     Output directory (default: report-bundles/<task_id>-<timestamp> under repo root)
  --skip-panels   Skip runner:tui trace/budget panel captures
  --json          Machine-readable report on stdout
  -h, --help      Show this help

Exit codes: 0 = all checks pass, 1 = blocker(s)
`);
    process.exit(0);
  }

  const report = await runCollectRunReport({
    taskId: args.taskId,
    outDir: args.outDir || undefined,
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
