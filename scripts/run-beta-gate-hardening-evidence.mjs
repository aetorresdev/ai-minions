#!/usr/bin/env node
/**
 * Beta gate hardening evidence — verify-usage-docs + claim audit + matrix structure + contract tests.
 * Always resolves scripts from repo root (safe after `cd orchestrator && npm test`).
 *
 * Usage: node scripts/run-beta-gate-hardening-evidence.mjs [--json]
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import { runBetaSmokeMatrix } from "./run-beta-smoke-matrix.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT_TEST_FILES = [
  "tests/beta-limitations-onboarding.test.mjs",
  "tests/degraded-mode-evidence.test.mjs",
];

export const REASON_CODES = {
  OK: "GATE_HARDENING_OK",
  DOCS_VERIFY: "GATE_HARDENING_DOCS_VERIFY_FAIL",
  CLAIM_AUDIT: "GATE_HARDENING_CLAIM_AUDIT_FAIL",
  SMOKE_MATRIX: "GATE_HARDENING_SMOKE_MATRIX_FAIL",
  CONTRACT_TESTS: "GATE_HARDENING_CONTRACT_TESTS_FAIL",
};

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {string} scriptRel
 * @param {string[]} extraArgs
 * @returns {{ ok: boolean, output: string }}
 */
function runNodeScript(scriptRel, extraArgs = []) {
  const abs = path.join(REPO_ROOT, scriptRel);
  const run = spawnSync(process.execPath, [abs, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  return { ok: run.status === 0, output };
}

/**
 * @param {string[]} testFiles
 * @returns {{ ok: boolean, output: string }}
 */
function runContractTests(testFiles) {
  const run = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  return { ok: run.status === 0, output };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runBetaGateHardeningEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {StepResult[]} */
  const steps = [];

  const docsVerify = runNodeScript("scripts/verify-usage-docs.mjs");
  if (!docsVerify.ok) {
    steps.push({
      id: "verify_usage_docs",
      reason_code: REASON_CODES.DOCS_VERIFY,
      status: "fail",
      message: "verify-usage-docs failed",
    });
  } else {
    steps.push({
      id: "verify_usage_docs",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "verify-usage-docs passed",
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

  const matrix = await runBetaSmokeMatrix({ repoRoot, skipLive: true });
  if (!matrix.ok) {
    steps.push({
      id: "smoke_matrix",
      reason_code: REASON_CODES.SMOKE_MATRIX,
      status: "fail",
      message: "run-beta-smoke-matrix --skip-live failed",
    });
  } else {
    steps.push({
      id: "smoke_matrix",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "beta smoke matrix structure passed",
    });
  }

  const contractTests = runContractTests(CONTRACT_TEST_FILES);
  if (!contractTests.ok) {
    steps.push({
      id: "contract_tests",
      reason_code: REASON_CODES.CONTRACT_TESTS,
      status: "fail",
      message: "gate-hardening contract tests failed",
    });
  } else {
    steps.push({
      id: "contract_tests",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `contract tests passed (${CONTRACT_TEST_FILES.length} files)`,
    });
  }

  const ok = steps.every((s) => s.status !== "fail");
  return { ok, steps, evidence_class: "ci_gate_hardening" };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions beta gate hardening evidence",
    `  ok: ${report.ok}`,
    `  evidence_class: ${report.evidence_class}`,
  ];
  for (const s of report.steps) {
    const tag = s.status === "pass" ? "PASS" : s.status === "skip" ? "SKIP" : "FAIL";
    lines.push(`  [${tag}] ${s.reason_code} — ${s.message}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/run-beta-gate-hardening-evidence.mjs [--json]

Runs verify-usage-docs, audit-product-claims, beta smoke matrix structure,
and gate-hardening contract unit tests.

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: GATE_HARDENING_OK, GATE_HARDENING_DOCS_VERIFY_FAIL,
GATE_HARDENING_CLAIM_AUDIT_FAIL, GATE_HARDENING_SMOKE_MATRIX_FAIL,
GATE_HARDENING_CONTRACT_TESTS_FAIL
`);
    process.exit(0);
  }

  const report = await runBetaGateHardeningEvidence();
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
  main();
}
