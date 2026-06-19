#!/usr/bin/env node
/**
 * Install evidence chain — Mac/Docker install path + claim audit.
 * Always resolves scripts from repo root (safe after `cd orchestrator && npm test`).
 *
 * Usage:
 *   node scripts/run-install-evidence.mjs [--json] [--with-npm-test] [--skip-live]
 *       [--model-policy local_only|remote_ok]
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import { runInstallAiMinions } from "./install-ai-minions.mjs";
import { runOperatorPreflight } from "./operator-preflight.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "INSTALL_EVIDENCE_OK",
  INSTALL: "INSTALL_EVIDENCE_INSTALL_FAIL",
  OPERATOR: "INSTALL_EVIDENCE_OPERATOR_FAIL",
  CLAIM_AUDIT: "INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL",
  NPM_TEST: "INSTALL_EVIDENCE_NPM_TEST_FAIL",
};

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {{
 *   repoRoot?: string,
 *   modelPolicy?: string,
 *   withNpmTest?: boolean,
 *   skipLive?: boolean,
 * }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runInstallEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const modelPolicy = options.modelPolicy ?? "local_only";
  /** @type {StepResult[]} */
  const steps = [];

  if (options.skipLive) {
    steps.push({
      id: "install",
      reason_code: REASON_CODES.OK,
      status: "skip",
      message: "install skipped (--skip-live; use Mac/Docker attestation for live path)",
    });
    steps.push({
      id: "operator_preflight",
      reason_code: REASON_CODES.OK,
      status: "skip",
      message: "operator-preflight skipped (--skip-live)",
    });
  } else {
    const install = await runInstallAiMinions({
      repoRoot,
      install: true,
      modelPolicy,
    });
    if (!install.ok) {
      steps.push({
        id: "install",
        reason_code: REASON_CODES.INSTALL,
        status: "fail",
        message: `install-ai-minions failed at phase ${install.phase}`,
      });
    } else {
      steps.push({
        id: "install",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: `install-ai-minions passed (phase ${install.phase})`,
      });
    }

    if (install.ok) {
      const operator = await runOperatorPreflight({
        repoRoot,
        install: true,
        modelPolicy,
      });
      if (!operator.ok) {
        steps.push({
          id: "operator_preflight",
          reason_code: REASON_CODES.OPERATOR,
          status: "fail",
          message: `operator-preflight stopped at ${operator.layer_stopped ?? "unknown"}`,
        });
      } else {
        steps.push({
          id: "operator_preflight",
          reason_code: REASON_CODES.OK,
          status: "pass",
          message: "operator-preflight passed (bootstrap + runtime + runner)",
        });
      }
    } else {
      steps.push({
        id: "operator_preflight",
        reason_code: REASON_CODES.OK,
        status: "skip",
        message: "operator-preflight skipped (install failed)",
      });
    }
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
      message: "npm test skipped (use --with-npm-test after install chain)",
    });
  }

  const ok = steps.every((s) => s.status !== "fail");
  const evidenceClass = options.skipLive
    ? "ci_claim_audit"
    : options.withNpmTest
      ? "mac_docker_live_plus_unit"
      : "mac_docker_live";

  return { ok, steps, evidence_class: evidenceClass };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions install evidence",
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
  /** @type {string | undefined} */
  let modelPolicy;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--model-policy" && argv[i + 1]) {
      modelPolicy = argv[++i];
    }
  }
  return {
    json: argv.includes("--json"),
    withNpmTest: argv.includes("--with-npm-test"),
    skipLive: argv.includes("--skip-live"),
    modelPolicy,
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/run-install-evidence.mjs [options]

Install evidence chain. Run from repo root, or from orchestrator/ via npm run evidence:install / shim scripts.

Options:
  --model-policy <mode>  local_only (default) | remote_ok
  --with-npm-test        Also run cd orchestrator && npm test (slow)
  --skip-live            Skip install + operator-preflight (CI claim-audit gate only)
  --json                 Machine-readable report on stdout
  -h, --help             Show this help

Live Mac/Docker attestation (Ollama required on host):
  node scripts/run-install-evidence.mjs --json
  node scripts/run-install-evidence.mjs --with-npm-test --json

Claim audit only (CI-safe):
  node scripts/run-install-evidence.mjs --skip-live

From orchestrator/: use npm run evidence:claims or orchestrator/scripts/audit-product-claims.mjs (shim).

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: INSTALL_EVIDENCE_INSTALL_FAIL, INSTALL_EVIDENCE_OPERATOR_FAIL,
INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL, INSTALL_EVIDENCE_NPM_TEST_FAIL, INSTALL_EVIDENCE_OK
`);
    process.exit(0);
  }

  const report = await runInstallEvidence({
    withNpmTest: args.withNpmTest,
    skipLive: args.skipLive,
    modelPolicy: args.modelPolicy,
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
