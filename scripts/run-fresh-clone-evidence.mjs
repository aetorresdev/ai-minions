#!/usr/bin/env node
/**
 * Fresh-clone evidence chain for v0.11 external entry path (CI-safe by default).
 * Runs bootstrap preflight, primary smoke plan, docs verify, and claim audit.
 *
 * Usage:
 *   node scripts/run-fresh-clone-evidence.mjs [--json] [--with-npm-test]
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import { runBootstrapPreflight } from "./bootstrap-preflight.mjs";
import { planPrimarySmoke } from "./run-primary-smoke.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "EVIDENCE_OK",
  PREFLIGHT: "EVIDENCE_PREFLIGHT_FAIL",
  SMOKE_PLAN: "EVIDENCE_SMOKE_PLAN_FAIL",
  DOCS_VERIFY: "EVIDENCE_DOCS_VERIFY_FAIL",
  CLAIM_AUDIT: "EVIDENCE_CLAIM_AUDIT_FAIL",
  NPM_TEST: "EVIDENCE_NPM_TEST_FAIL",
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
 * @param {{ withNpmTest?: boolean, repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runFreshCloneEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {StepResult[]} */
  const steps = [];

  const preflight = await runBootstrapPreflight({ repoRoot });
  const entryChecks = preflight.checks.filter((c) =>
    ["repo_layout", "node_version", "trace_dir"].includes(c.id),
  );
  const preflightEntryOk = entryChecks.every((c) => c.status !== "fail");
  if (!preflightEntryOk) {
    const blockers = entryChecks.filter((c) => c.status === "fail").map((c) => c.reason_code);
    steps.push({
      id: "bootstrap_preflight",
      reason_code: REASON_CODES.PREFLIGHT,
      status: "fail",
      message: `entry-path preflight failed: ${blockers.join(", ") || "unknown"}`,
    });
  } else {
    steps.push({
      id: "bootstrap_preflight",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "entry-path preflight passed (layout, Node, trace dir)",
    });
  }

  const smokePlan = planPrimarySmoke({ repoRoot });
  if (!smokePlan.ok) {
    steps.push({
      id: "primary_smoke_plan",
      reason_code: REASON_CODES.SMOKE_PLAN,
      status: "fail",
      message: "primary-smoke plan failed (orchestrator layout)",
    });
  } else {
    steps.push({
      id: "primary_smoke_plan",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `primary-smoke command documented: ${smokePlan.invocation.shellCommand}`,
    });
  }

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

  if (options.withNpmTest) {
    const orchDir = path.join(repoRoot, "orchestrator");
    const npmTest = spawnSync("npm", ["test"], { cwd: orchDir, encoding: "utf8", stdio: "pipe" });
    if (npmTest.status !== 0) {
      steps.push({
        id: "npm_test",
        reason_code: REASON_CODES.NPM_TEST,
        status: "fail",
        message: "orchestrator npm test failed",
      });
    } else {
      steps.push({
        id: "npm_test",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "orchestrator npm test passed",
      });
    }
  } else {
    steps.push({
      id: "npm_test",
      reason_code: REASON_CODES.OK,
      status: "skip",
      message: "npm test skipped (use --with-npm-test or SHIP fresh checkout smoke workflow)",
    });
  }

  const ok = steps.every((s) => s.status !== "fail");
  return {
    ok,
    steps,
    evidence_class: options.withNpmTest ? "ci_plus_unit" : "ci_entry_path",
  };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions fresh-clone evidence",
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
    withNpmTest: argv.includes("--with-npm-test"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/run-fresh-clone-evidence.mjs [options]

CI-safe entry-path evidence chain (no live claude smoke by default).

Options:
  --with-npm-test   Also run cd orchestrator && npm test (slow)
  --json            Machine-readable report on stdout
  -h, --help        Show this help

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: EVIDENCE_PREFLIGHT_FAIL, EVIDENCE_SMOKE_PLAN_FAIL,
EVIDENCE_DOCS_VERIFY_FAIL, EVIDENCE_CLAIM_AUDIT_FAIL, EVIDENCE_NPM_TEST_FAIL, EVIDENCE_OK
`);
    process.exit(0);
  }

  const report = await runFreshCloneEvidence({ withNpmTest: args.withNpmTest });
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
