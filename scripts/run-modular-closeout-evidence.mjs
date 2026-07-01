#!/usr/bin/env node
/**
 * Modular monolith closeout dry-run evidence (v0.17).
 * Claim audit + root/import guards + layout/export parity tests.
 *
 * Usage: node scripts/run-modular-closeout-evidence.mjs [--json]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import {
  CLOSEOUT_DOC_PATHS,
  CLOSEOUT_HONESTY_MARKERS,
  CLOSEOUT_PARITY_TESTS,
  FORBIDDEN_CLOSEOUT_CLAIMS,
} from "./lib/modular-closeout-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "CLOSEOUT_OK",
  CLAIM_AUDIT: "CLOSEOUT_CLAIM_AUDIT_FAIL",
  ROOT_IMPORT_GUARD: "CLOSEOUT_ROOT_IMPORT_GUARD_FAIL",
  MODULE_BOUNDARIES: "CLOSEOUT_MODULE_BOUNDARIES_FAIL",
  DOC_RUNTIME_CLAIMS: "CLOSEOUT_DOC_RUNTIME_CLAIMS_FAIL",
  CLOSEOUT_DOCS: "CLOSEOUT_DOC_HONESTY_FAIL",
  HARNESS_SCOPE: "CLOSEOUT_HARNESS_SCOPE_FAIL",
  PARITY_TESTS: "CLOSEOUT_PARITY_TESTS_FAIL",
};

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 * @returns {{ ok: boolean, output: string }}
 */
function runCommand(cmd, args, opts = {}) {
  const run = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  return { ok: run.status === 0, output };
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function lineIsNegatedCloseout(line) {
  return /\b(not|no|without|never|forbidden|do not|must not|is not|are not|not claimed|out of scope)\b/i.test(
    line,
  );
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkCloseoutDocHonesty(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {string[]} */
  const failures = [];

  for (const rel of CLOSEOUT_DOC_PATHS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing closeout doc: ${rel}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    if (!CLOSEOUT_HONESTY_MARKERS.some((re) => re.test(text))) {
      failures.push(`${rel}: missing honesty marker (partial / not architecture complete / shim)`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (lineIsNegatedCloseout(line)) continue;
      for (const rule of FORBIDDEN_CLOSEOUT_CLAIMS) {
        if (rule.re.test(line)) {
          failures.push(`${rel}: forbidden closeout claim (${rule.id})`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runModularCloseoutEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {StepResult[]} */
  const steps = [];

  const claimAudit = runClaimAudit({ repoRoot });
  steps.push({
    id: "claim_audit",
    reason_code: claimAudit.ok ? REASON_CODES.OK : REASON_CODES.CLAIM_AUDIT,
    status: claimAudit.ok ? "pass" : "fail",
    message: claimAudit.ok ? "audit-product-claims passed" : "audit-product-claims failed",
  });

  const rootGuard = runCommand(process.execPath, [
    path.join(repoRoot, "orchestrator/scripts/check-root-import-guard.js"),
  ]);
  steps.push({
    id: "root_import_guard",
    reason_code: rootGuard.ok ? REASON_CODES.OK : REASON_CODES.ROOT_IMPORT_GUARD,
    status: rootGuard.ok ? "pass" : "fail",
    message: rootGuard.ok ? "root import guard passed" : "root import guard failed",
  });

  const moduleBoundaries = runCommand("npm", ["run", "lint:module-boundaries"], {
    cwd: path.join(repoRoot, "orchestrator"),
  });
  steps.push({
    id: "module_boundaries",
    reason_code: moduleBoundaries.ok ? REASON_CODES.OK : REASON_CODES.MODULE_BOUNDARIES,
    status: moduleBoundaries.ok ? "pass" : "fail",
    message: moduleBoundaries.ok ? "module boundary lint passed" : "module boundary lint failed",
  });

  const docClaims = runCommand("npm", ["run", "lint:docs-claims"], {
    cwd: path.join(repoRoot, "orchestrator"),
  });
  steps.push({
    id: "doc_runtime_claims",
    reason_code: docClaims.ok ? REASON_CODES.OK : REASON_CODES.DOC_RUNTIME_CLAIMS,
    status: docClaims.ok ? "pass" : "fail",
    message: docClaims.ok ? "doc runtime claims lint passed" : "doc runtime claims lint failed",
  });

  const closeoutDocs = checkCloseoutDocHonesty({ repoRoot });
  steps.push({
    id: "closeout_doc_honesty",
    reason_code: closeoutDocs.ok ? REASON_CODES.OK : REASON_CODES.CLOSEOUT_DOCS,
    status: closeoutDocs.ok ? "pass" : "fail",
    message: closeoutDocs.ok
      ? "closeout docs state honest partial layout"
      : closeoutDocs.failures.join("; "),
  });

  const harnessScope = runCommand("bash", [
    path.join(repoRoot, "orchestrator/scripts/ci-check-harness-scope.sh"),
  ]);
  steps.push({
    id: "harness_scope",
    reason_code: harnessScope.ok ? REASON_CODES.OK : REASON_CODES.HARNESS_SCOPE,
    status: harnessScope.ok ? "pass" : "fail",
    message: harnessScope.ok ? "harness env scope check passed" : "harness env scope check failed",
  });

  const parityTests = runCommand(
    process.execPath,
    ["--test", ...CLOSEOUT_PARITY_TESTS.map((rel) => path.join(repoRoot, rel))],
    { cwd: repoRoot },
  );
  steps.push({
    id: "parity_tests",
    reason_code: parityTests.ok ? REASON_CODES.OK : REASON_CODES.PARITY_TESTS,
    status: parityTests.ok ? "pass" : "fail",
    message: parityTests.ok
      ? `parity/layout tests passed (${CLOSEOUT_PARITY_TESTS.length} files)`
      : "parity/layout tests failed",
  });

  const ok = steps.every((s) => s.status !== "fail");
  return { ok, steps, evidence_class: "modular_closeout_dry_run" };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions modular closeout dry-run evidence",
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
    process.stdout.write(`Usage: node scripts/run-modular-closeout-evidence.mjs [--json]

Runs claim audit, root import guard, module boundaries, doc runtime claims,
closeout doc honesty checks, harness scope, and layout/export parity tests.

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: CLOSEOUT_OK, CLOSEOUT_CLAIM_AUDIT_FAIL, CLOSEOUT_ROOT_IMPORT_GUARD_FAIL,
CLOSEOUT_MODULE_BOUNDARIES_FAIL, CLOSEOUT_DOC_RUNTIME_CLAIMS_FAIL, CLOSEOUT_DOC_HONESTY_FAIL,
CLOSEOUT_HARNESS_SCOPE_FAIL, CLOSEOUT_PARITY_TESTS_FAIL
`);
    process.exit(0);
  }

  const report = await runModularCloseoutEvidence();
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
