#!/usr/bin/env node
/**
 * Mode comparison report — Markdown + JSON from matrix assessment and/or evidence records.
 * Does not print secret values. Does not invent hybrid runtime or cross-mode scores.
 * READY is never promoted to PASS. Tokens/cost render as unavailable when unmeasured.
 *
 * Usage:
 *   node scripts/generate-mode-comparison-report.mjs [--skip-live] [--probe-local]
 *   node scripts/generate-mode-comparison-report.mjs --from-matrix-json <path>
 *   node scripts/generate-mode-comparison-report.mjs --from-evidence <path>
 *   node scripts/generate-mode-comparison-report.mjs --out-dir <dir> [--md] [--json]
 *   node scripts/generate-mode-comparison-report.mjs --write-template <path>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORT_SCHEMA_VERSION,
  REASON_CODES,
  buildComparisonReport,
  emptyEvidenceTemplate,
  formatComparisonMarkdown,
  validateEvidenceInput,
  validateReportDoc,
} from "./lib/mode-comparison-report-data.mjs";
import { runTesterSixModeMatrix } from "./run-tester-six-mode-matrix.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   json: boolean,
   *   md: boolean,
   *   skipLive: boolean,
   *   probeLocal: boolean,
   *   fromMatrixJson: string | null,
   *   fromEvidence: string | null,
   *   outDir: string | null,
   *   writeTemplate: string | null,
   *   fixtureId: string | null,
   *   repoCommit: string | null,
   *   help?: boolean,
   * }} */
  const out = {
    json: false,
    md: true,
    skipLive: true,
    probeLocal: false,
    fromMatrixJson: null,
    fromEvidence: null,
    outDir: null,
    writeTemplate: null,
    fixtureId: null,
    repoCommit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--md") out.md = true;
    else if (a === "--no-md") out.md = false;
    else if (a === "--skip-live") out.skipLive = true;
    else if (a === "--run-ready") out.skipLive = false;
    else if (a === "--probe-local") out.probeLocal = true;
    else if (a === "--from-matrix-json") out.fromMatrixJson = argv[++i] ?? null;
    else if (a === "--from-evidence") out.fromEvidence = argv[++i] ?? null;
    else if (a === "--out-dir") out.outDir = argv[++i] ?? null;
    else if (a === "--write-template") out.writeTemplate = argv[++i] ?? null;
    else if (a === "--fixture") out.fixtureId = argv[++i] ?? null;
    else if (a === "--repo-commit") out.repoCommit = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  // Default: print both when writing to out-dir; stdout prefers md unless --json alone
  if (argv.includes("--json") && !argv.includes("--md") && !out.outDir) {
    out.md = false;
  }
  return out;
}

/**
 * @param {{
 *   repoRoot?: string,
 *   skipLive?: boolean,
 *   probeLocal?: boolean,
 *   matrixReport?: object | null,
 *   evidenceInput?: object | null,
 *   fixtureId?: string | null,
 *   repoCommit?: string | null,
 * }} [options]
 */
export async function generateModeComparisonReport(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const docPath = path.join(repoRoot, "docs/how-to/mode-comparison-report.md");
  /** @type {{ id: string, reason_code: string, status: 'pass' | 'fail', message: string }[]} */
  const steps = [];

  const docText = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
  const docCheck = validateReportDoc(docText);
  steps.push({
    id: "comparison_doc",
    reason_code: docCheck.ok ? REASON_CODES.OK : REASON_CODES.DOC_FAIL,
    status: docCheck.ok ? "pass" : "fail",
    message: docCheck.ok
      ? "mode-comparison-report.md markers valid"
      : docCheck.errors.join("; "),
  });

  /** @type {object | null} */
  let matrixReport = options.matrixReport ?? null;
  if (!matrixReport) {
    matrixReport = await runTesterSixModeMatrix({
      repoRoot,
      skipLive: options.skipLive !== false,
      probeLocal: options.probeLocal === true,
    });
  }

  steps.push({
    id: "matrix_assessment",
    reason_code: matrixReport.ok ? REASON_CODES.OK : REASON_CODES.INPUT_FAIL,
    status: matrixReport.ok ? "pass" : "fail",
    message: matrixReport.ok
      ? `matrix assessment ok (${(matrixReport.rows || []).length} rows)`
      : "matrix assessment reported failures",
  });

  /** @type {import("./lib/mode-comparison-report-data.mjs").RowEvidenceInput[]} */
  let evidenceRows = [];
  if (options.evidenceInput) {
    const evCheck = validateEvidenceInput(options.evidenceInput);
    steps.push({
      id: "evidence_input",
      reason_code: evCheck.ok ? REASON_CODES.OK : REASON_CODES.INPUT_FAIL,
      status: evCheck.ok ? "pass" : "fail",
      message: evCheck.ok
        ? `evidence input ok (${options.evidenceInput.rows.length} rows)`
        : evCheck.errors.join("; "),
    });
    if (evCheck.ok) {
      evidenceRows = options.evidenceInput.rows.filter(
        (r) => r && (r.result != null || r.reason_code != null || r.run_id || r.task_id),
      );
    }
  } else {
    steps.push({
      id: "evidence_input",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "no evidence file — report from matrix assessment only",
    });
  }

  const fixtureId =
    options.fixtureId ??
    options.evidenceInput?.fixture_id ??
    null;
  const repoCommit =
    options.repoCommit ??
    options.evidenceInput?.repo_commit ??
    null;

  const report = buildComparisonReport({
    matrixRows: matrixReport.rows || [],
    evidenceRows,
    fixture_id: fixtureId,
    repo_commit: repoCommit,
    source: evidenceRows.length
      ? "matrix_plus_evidence"
      : matrixReport.evidence_class || "matrix_assessment",
  });

  const markdown = formatComparisonMarkdown(report);
  const ok = steps.every((s) => s.status !== "fail") && report.ok !== false;
  // Structure gate: fail only on doc/input failures; row SKIP/READY are expected
  const structureOk = steps.every((s) => s.status !== "fail");

  return {
    ok: structureOk,
    schema_version: REPORT_SCHEMA_VERSION,
    steps,
    report,
    markdown,
    matrix_ok: matrixReport.ok,
  };
}

/**
 * @param {string} filePath
 * @returns {object}
 */
function readJsonFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function printHelp() {
  console.log(`Usage: node scripts/generate-mode-comparison-report.mjs [options]

Generate a Markdown and/or JSON mode comparison report from the six-mode matrix
assessment and optional per-row evidence. READY is not PASS. Tokens/cost are
unavailable when unmeasured. Never prints secret values.

Options:
  --skip-live              Default: structure + readiness only (no live smoke)
  --run-ready              Ask matrix for READY when credentials/endpoints suffice
  --probe-local            Probe Ollama reachability for local rows
  --from-matrix-json PATH  Use a prior matrix JSON instead of re-assessing
  --from-evidence PATH     Merge tester evidence record (see evidence template)
  --fixture ID             Fixture id label (e.g. sudoku-html-app)
  --repo-commit SHA        Record commit short/long SHA
  --out-dir DIR            Write mode-comparison-report.md + .json
  --json                   Print JSON to stdout (default when no --out-dir)
  --md                     Print Markdown to stdout
  --no-md                  Suppress Markdown stdout
  --write-template PATH    Write empty evidence JSON template and exit
  --help                   Show this help
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.writeTemplate) {
    const abs = path.isAbsolute(args.writeTemplate)
      ? args.writeTemplate
      : path.join(process.cwd(), args.writeTemplate);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(emptyEvidenceTemplate(), null, 2)}\n`, "utf8");
    console.log(`wrote evidence template: ${abs}`);
    process.exit(0);
  }

  /** @type {object | null} */
  let matrixReport = null;
  if (args.fromMatrixJson) {
    matrixReport = readJsonFile(args.fromMatrixJson);
  }

  /** @type {object | null} */
  let evidenceInput = null;
  if (args.fromEvidence) {
    evidenceInput = readJsonFile(args.fromEvidence);
  }

  const result = await generateModeComparisonReport({
    skipLive: args.skipLive,
    probeLocal: args.probeLocal,
    matrixReport,
    evidenceInput,
    fixtureId: args.fixtureId,
    repoCommit: args.repoCommit,
  });

  if (args.outDir) {
    const abs = path.isAbsolute(args.outDir)
      ? args.outDir
      : path.join(process.cwd(), args.outDir);
    fs.mkdirSync(abs, { recursive: true });
    const mdPath = path.join(abs, "mode-comparison-report.md");
    const jsonPath = path.join(abs, "mode-comparison-report.json");
    fs.writeFileSync(mdPath, `${result.markdown}\n`, "utf8");
    fs.writeFileSync(jsonPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
    console.log(`wrote ${mdPath}`);
    console.log(`wrote ${jsonPath}`);
  } else if (args.json) {
    console.log(JSON.stringify({ steps: result.steps, report: result.report }, null, 2));
  } else {
    console.log(result.markdown);
  }

  if (!result.ok) {
    const blocker = result.steps.find((s) => s.status === "fail");
    if (blocker) {
      console.error(`blocker: ${blocker.reason_code}`);
    }
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
