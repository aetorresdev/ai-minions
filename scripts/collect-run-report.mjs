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
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const { applyPrivacySanitizeToBundle, writeShareableManifest, REASON_CODES: PRIVACY_REASON_CODES } = require(
  "../orchestrator/security/sensitive-data-scanner.js",
);
const { writeHumanReadableAttachArtifacts } = require(
  "../orchestrator/modules/operator/operator-attach-bundle.js",
);

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
 * @param {string} relPath
 * @param {string} taskId
 * @returns {string}
 */
export function describeShareableUploadFile(relPath, taskId) {
  const inner = relPath.startsWith("shareable/") ? relPath.slice("shareable/".length) : relPath;
  if (inner === "manifest.json") return "Redacted shareable index";
  if (relPath === "privacy-scan.json") return "Privacy scan summary (counts + reason codes only)";
  if (inner.startsWith("trace/") && inner.endsWith(".jsonl")) {
    return `Redacted trace copy for \`${taskId}\``;
  }
  return describeBundleFile(inner, taskId);
}

/**
 * @param {string[]} uploadFiles
 * @param {string} taskId
 * @returns {string}
 */
export function buildUploadFilesTableRows(uploadFiles, taskId) {
  return uploadFiles
    .map((f) => `| \`${f}\` | ${describeShareableUploadFile(f, taskId)} |`)
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
 *   repoRoot?: string,
 *   tracesDir?: string,
 * }} input
 * @returns {{ manifestPath: string, attachPath: string, files: string[] }}
 */
export function writeBundleFiles(input) {
  const { taskId, traceFile, bundleDir, inspectReport, panelOutputs, repoCommit, repoRoot, tracesDir } =
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
  const localArtifactFiles = ["manifest.json", ...files];
  const manifest = {
    bundle_version: "1",
    task_id: taskId,
    created_at: new Date().toISOString(),
    repo_commit: repoCommit ?? null,
    traces_dir: tracesDir ?? resolveTracesDir(),
    bundle_dir: bundleDir,
    inspect_ok: inspectReport.ok,
    files: localArtifactFiles,
    inspect_reason_codes: inspectReport.checks.map((c) => c.reason_code),
    degraded_mode: inspectReport.degraded_assessment?.degraded_mode ?? false,
    disqualifies_beta_success: inspectReport.degraded_assessment?.disqualifies_beta_success ?? false,
    risk_acceptance_reason: inspectReport.degraded_assessment?.risk_acceptance_reason ?? null,
    degraded_assessment: inspectReport.degraded_assessment ?? null,
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const privacy = applyPrivacySanitizeToBundle(bundleDir);
  const shareableManifestRel = writeShareableManifest(bundleDir, taskId, privacy);
  if (!privacy.shareable_files.includes(shareableManifestRel)) {
    privacy.shareable_files.push(shareableManifestRel);
    privacy.upload_files.push(shareableManifestRel);
  }

  const uploadFiles = [
    ...new Set([
      "privacy-scan.json",
      shareableManifestRel,
      ...privacy.shareable_files.filter((f) => f !== "privacy-scan.json"),
    ]),
  ];

  const attachPath = path.join(bundleDir, "ATTACH.md");
  const attachBody = buildAttachTemplate({
    taskId,
    bundleDir,
    repoCommit: repoCommit ?? null,
    inspectOk: inspectReport.ok,
    inspectChecks: inspectReport.checks,
    uploadFiles,
    degradedMode: inspectReport.degraded_assessment?.degraded_mode ?? false,
    disqualifiesBetaSuccess: inspectReport.degraded_assessment?.disqualifies_beta_success ?? false,
    riskAcceptanceReason: inspectReport.degraded_assessment?.risk_acceptance_reason ?? null,
  });
  fs.writeFileSync(attachPath, attachBody, "utf8");

  const humanReadable = writeHumanReadableAttachArtifacts({
    bundleDir,
    taskId,
    traceFile,
    repoRoot: repoRoot ?? REPO_ROOT,
    inspectOk: inspectReport.ok,
    inspectChecks: inspectReport.checks,
    repoCommit: repoCommit ?? null,
    privacySummary: privacy.summary,
    shareableFiles: uploadFiles,
  });

  const allBundleFiles = [
    ...new Set([
      "manifest.json",
      "ATTACH.md",
      ...files,
      ...uploadFiles,
      ...humanReadable.files,
      humanReadable.redaction_report_path,
    ]),
  ];

  const manifestFinal = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifestFinal.upload_files = [
    ...new Set([...uploadFiles, "redaction-report.json", "SUMMARY.md", "MANAGEMENT_SUMMARY.md"]),
  ];
  manifestFinal.shareable_files = manifestFinal.upload_files;
  manifestFinal.local_only_files = files;
  manifestFinal.files = allBundleFiles;
  manifestFinal.human_readable_bundle = {
    schema_version: "1",
    summary: "SUMMARY.md",
    operator_notes: "OPERATOR_NOTES.md",
    management_summary: "MANAGEMENT_SUMMARY.md",
    redaction_report: humanReadable.redaction_report_path,
    traces_dir: "traces/",
    evidence_dir: "evidence/",
    checksums_sha256: humanReadable.checksums,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifestFinal, null, 2)}\n`, "utf8");

  return {
    manifestPath,
    attachPath,
    files: allBundleFiles,
    privacy_scan: privacy.summary,
    upload_files: manifestFinal.upload_files,
    human_readable: humanReadable,
  };
}

/**
 * @param {{ reason_code: string, status: string, message: string }[]} checks
 * @returns {string}
 */
export function formatInspectBlockersForForm(checks) {
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length === 0) return "(none)";
  return failed.map((c) => `${c.reason_code} — ${c.message}`).join("\n");
}

/**
 * @param {{
 *   taskId: string,
 *   bundleDir: string,
 *   repoCommit: string | null,
 *   inspectOk: boolean,
 *   inspectChecks: { reason_code: string, status: string, message: string }[],
 *   uploadFiles: string[],
 *   operatorPath?: string,
 *   degradedMode?: boolean,
 *   disqualifiesBetaSuccess?: boolean,
 *   riskAcceptanceReason?: string | null,
 * }} ctx
 * @returns {string}
 */
export function buildAttachTemplate(ctx) {
  const failed = ctx.inspectChecks.filter((c) => c.status === "fail");
  const blockerLines =
    failed.length > 0
      ? failed.map((c) => `- \`${c.reason_code}\` — ${c.message}`).join("\n")
      : "- (none — inspect passed)";
  const uploadRows = buildUploadFilesTableRows(ctx.uploadFiles, ctx.taskId);
  const inspectVerdict = ctx.inspectOk ? "PASS" : "FAIL";
  const operatorPath = ctx.operatorPath ?? "runner:tui guided run";
  const inspectBlockersForm = formatInspectBlockersForForm(ctx.inspectChecks);

  return `# Operator report bundle

**Upload to GitHub issues:** attach only \`privacy-scan.json\` and everything under \`shareable/\` (or zip those paths). The top-level bundle may contain **local-only raw** trace copies — do **not** upload raw \`trace/*.jsonl\` or unredacted artifacts.

- **Task ID:** \`${ctx.taskId}\`
- **Bundle dir (local):** \`${ctx.bundleDir}\`
- **Repo commit:** \`${ctx.repoCommit ?? "unknown"}\`
- **Inspect verdict:** ${inspectVerdict}
- **Degraded mode:** ${ctx.degradedMode ? "yes" : "no"}
- **Disqualifies beta success:** ${ctx.disqualifiesBetaSuccess ? "yes" : "no"}
- **Risk acceptance reason:** ${ctx.riskAcceptanceReason ?? "(none)"}

## Inspect blockers

${blockerLines}

## Files safe to upload

| File | Purpose |
|------|---------|
${uploadRows}

## GitHub issue form (Operator feedback)

Open **New issue → Operator feedback (runner:tui)**. Field guide: \`docs/how-to/operator-feedback-issue.md\`.

Copy the values below into the matching form fields:

| Form field | Value |
|------------|-------|
| Task ID | \`${ctx.taskId}\` |
| Repo commit (short SHA) | \`${ctx.repoCommit ?? "unknown"}\` |
| Operator path | ${operatorPath} |
| Inspect verdict | ${inspectVerdict} |
| Report bundle path (local) | \`${ctx.bundleDir}\` |
| Inspect blockers | see block below |
| Severity | choose one: BLOCKER · BUG · USABILITY · DOCS |

**Inspect blockers** (paste into form):

\`\`\`text
${inspectBlockersForm}
\`\`\`

**Steps to reproduce** — fill in numbered commands you ran.

**Expected** — fill in what you expected.

**Actual** — fill in what happened.

Automatic GitHub upload from this script is **not** shipped — copy fields manually and attach \`privacy-scan.json\` + \`shareable/**\` only.
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
      repoRoot,
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

  const privacyReason = written.privacy_scan?.reason_code ?? PRIVACY_REASON_CODES.OK;
  const privacyStatus =
    privacyReason === PRIVACY_REASON_CODES.FAILED_BLOCKED
      ? "fail"
      : privacyReason === PRIVACY_REASON_CODES.OK
        ? "pass"
        : "warn";
  checks.push({
    id: "privacy_scan",
    layer: "privacy",
    reason_code: privacyReason,
    status: privacyStatus,
    message: `pii=${written.privacy_scan?.redaction_counts?.pii ?? 0} secret=${written.privacy_scan?.redaction_counts?.secret ?? 0}`,
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
  lines.push("  human_readable: SUMMARY.md · OPERATOR_NOTES.md · MANAGEMENT_SUMMARY.md · redaction-report.json");
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
