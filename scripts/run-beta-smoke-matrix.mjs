#!/usr/bin/env node
/**
 * Beta smoke matrix evidence chain — structure validation + optional release gate.
 * Always resolves scripts from repo root (safe after `cd orchestrator && npm test`).
 *
 * Usage:
 *   node scripts/run-beta-smoke-matrix.mjs [--json] [--skip-live] [--validate-gate]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import {
  MINIMUM_GATE_CELLS,
  validateGateResults,
  validateMatrixDoc,
  validateMatrixRecord,
} from "./lib/beta-smoke-matrix-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MATRIX_DOC = path.join(REPO_ROOT, "docs/how-to/beta-smoke-matrix.md");
const MATRIX_RECORD = path.join(
  REPO_ROOT,
  "docs/how-to/evidence/beta-smoke-matrix-record.json",
);

export const REASON_CODES = {
  OK: "SMOKE_MATRIX_OK",
  DOC: "SMOKE_MATRIX_DOC_FAIL",
  RECORD: "SMOKE_MATRIX_RECORD_FAIL",
  GATE: "SMOKE_MATRIX_GATE_FAIL",
  CLAIM_AUDIT: "SMOKE_MATRIX_CLAIM_AUDIT_FAIL",
};

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {{
 *   repoRoot?: string,
 *   skipLive?: boolean,
 *   validateGate?: boolean,
 * }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string, gate_summary?: Record<string, unknown> }>}
 */
export async function runBetaSmokeMatrix(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const matrixDocPath = path.join(repoRoot, "docs/how-to/beta-smoke-matrix.md");
  const matrixRecordPath = path.join(
    repoRoot,
    "docs/how-to/evidence/beta-smoke-matrix-record.json",
  );
  /** @type {StepResult[]} */
  const steps = [];

  const docText = fs.existsSync(matrixDocPath)
    ? fs.readFileSync(matrixDocPath, "utf8")
    : "";
  const docCheck = validateMatrixDoc(docText);
  if (!docCheck.ok) {
    steps.push({
      id: "matrix_doc",
      reason_code: REASON_CODES.DOC,
      status: "fail",
      message: docCheck.errors.join("; "),
    });
  } else {
    steps.push({
      id: "matrix_doc",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `matrix doc valid (${MINIMUM_GATE_CELLS.length} gate cells referenced)`,
    });
  }

  let record = null;
  if (!fs.existsSync(matrixRecordPath)) {
    steps.push({
      id: "matrix_record",
      reason_code: REASON_CODES.RECORD,
      status: "fail",
      message: "beta-smoke-matrix-record.json missing",
    });
  } else {
    try {
      record = JSON.parse(fs.readFileSync(matrixRecordPath, "utf8"));
    } catch (err) {
      steps.push({
        id: "matrix_record",
        reason_code: REASON_CODES.RECORD,
        status: "fail",
        message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (record) {
    const recordCheck = validateMatrixRecord(record);
    if (!recordCheck.ok) {
      steps.push({
        id: "matrix_record",
        reason_code: REASON_CODES.RECORD,
        status: "fail",
        message: recordCheck.errors.join("; "),
      });
    } else {
      steps.push({
        id: "matrix_record",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "matrix record schema valid",
      });
    }
  }

  if (options.validateGate && record?.cells) {
    const gateCheck = validateGateResults(
      /** @type {Record<string, unknown>} */ (record.cells),
      { requireGatePass: true },
    );
    if (!gateCheck.ok) {
      steps.push({
        id: "matrix_gate",
        reason_code: REASON_CODES.GATE,
        status: "fail",
        message: gateCheck.errors.join("; "),
      });
    } else {
      steps.push({
        id: "matrix_gate",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "all required gate cells PASS or approved EXCEPTION",
      });
    }
  } else {
    steps.push({
      id: "matrix_gate",
      reason_code: REASON_CODES.OK,
      status: "skip",
      message: options.skipLive
        ? "gate validation skipped (--skip-live; use --validate-gate before external beta)"
        : "gate validation skipped (use --validate-gate before external beta)",
    });
  }

  const claimAudit = runClaimAudit({ repoRoot });
  if (!claimAudit.ok) {
    steps.push({
      id: "claim_audit",
      reason_code: REASON_CODES.CLAIM_AUDIT,
      status: "fail",
      message: "audit-product-claims failed",
    });
  } else {
    steps.push({
      id: "claim_audit",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "audit-product-claims passed",
    });
  }

  const ok = steps.every((s) => s.status !== "fail");
  const evidenceClass = options.validateGate
    ? "release_gate"
    : options.skipLive
      ? "ci_structure_gate"
      : "structure_gate";

  /** @type {Record<string, unknown> | undefined} */
  let gateSummary;
  if (record?.cells) {
    const cells = /** @type {Record<string, { result?: string }>} */ (record.cells);
    const counts = { PASS: 0, FAIL: 0, PENDING: 0, SKIP: 0, EXCEPTION: 0 };
    for (const def of MINIMUM_GATE_CELLS) {
      const r = String(cells[def.id]?.result ?? "PENDING");
      if (r in counts) counts[/** @type {keyof typeof counts} */ (r)] += 1;
    }
    gateSummary = { cell_counts: counts, required_cells: MINIMUM_GATE_CELLS.filter((c) => c.gate === "required").length };
  }

  return { ok, steps, evidence_class: evidenceClass, gate_summary: gateSummary };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string, gate_summary?: Record<string, unknown> }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions beta smoke matrix evidence",
    `  ok: ${report.ok}`,
    `  evidence_class: ${report.evidence_class}`,
  ];
  if (report.gate_summary) {
    lines.push(`  gate_summary: ${JSON.stringify(report.gate_summary)}`);
  }
  for (const s of report.steps) {
    const tag = s.status === "pass" ? "PASS" : s.status === "skip" ? "SKIP" : "FAIL";
    lines.push(`  [${tag}] ${s.reason_code} — ${s.message}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    skipLive: argv.includes("--skip-live"),
    validateGate: argv.includes("--validate-gate"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/run-beta-smoke-matrix.mjs [options]

Beta smoke matrix evidence chain. Run from repo root, or from orchestrator/ via npm run evidence:smoke-matrix / shim.

Options:
  --skip-live       CI structure gate (doc + record schema + claim audit; default mode)
  --validate-gate   Require all required cells PASS or CERBERUS-approved EXCEPTION
  --json            Machine-readable report on stdout
  -h, --help        Show this help

CI-safe (PRs):
  node scripts/run-beta-smoke-matrix.mjs --skip-live

Pre external-beta release:
  node scripts/run-beta-smoke-matrix.mjs --validate-gate

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: SMOKE_MATRIX_DOC_FAIL, SMOKE_MATRIX_RECORD_FAIL, SMOKE_MATRIX_GATE_FAIL,
SMOKE_MATRIX_CLAIM_AUDIT_FAIL, SMOKE_MATRIX_OK
`);
    process.exit(0);
  }

  const report = await runBetaSmokeMatrix({
    skipLive: args.skipLive || !args.validateGate,
    validateGate: args.validateGate,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  if (!report.ok) {
    for (const b of report.steps.filter((s) => s.status === "fail")) {
      process.stderr.write(`blocker: ${b.reason_code}\n`);
    }
  }

  process.exit(report.ok ? 0 : 1);
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

export { MATRIX_DOC, MATRIX_RECORD };
