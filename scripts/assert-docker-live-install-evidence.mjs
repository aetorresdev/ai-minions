#!/usr/bin/env node
/**
 * Validate install evidence JSON for self-hosted Docker live gate (mac_docker_live_installed_cli).
 *
 * Usage:
 *   node scripts/run-install-evidence.mjs --json | node scripts/assert-docker-live-install-evidence.mjs
 *   node scripts/assert-docker-live-install-evidence.mjs --file report.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_EVIDENCE_CLASS = "mac_docker_live_installed_cli";

/** @type {Array<[string, 'pass' | 'fail' | 'skip']>} */
export const REQUIRED_STEP_STATUSES = [
  ["installed_cli_product_cli_install", "pass"],
  ["installed_cli_installed_help", "pass"],
  ["installed_cli_installed_doctor", "pass"],
  ["operator_preflight", "skip"],
];

/**
 * @param {{
 *   ok?: boolean,
 *   evidence_class?: string,
 *   steps?: Array<{ id: string, status: string, reason_code?: string, evidence_reason_code?: string }>,
 * }} report
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function assertDockerLiveInstallEvidence(report) {
  /** @type {string[]} */
  const failures = [];

  if (!report || typeof report !== "object") {
    return { ok: false, failures: ["report must be an object"] };
  }

  if (report.ok !== true) {
    failures.push("report.ok must be true");
  }

  if (report.evidence_class !== EXPECTED_EVIDENCE_CLASS) {
    failures.push(
      `evidence_class must be ${EXPECTED_EVIDENCE_CLASS} (got ${JSON.stringify(report.evidence_class)})`,
    );
  }

  const steps = report.steps ?? [];
  for (const [id, expectedStatus] of REQUIRED_STEP_STATUSES) {
    const step = steps.find((s) => s.id === id);
    if (!step) {
      failures.push(`missing step: ${id}`);
      continue;
    }
    if (step.status !== expectedStatus) {
      failures.push(`${id}: expected status ${expectedStatus}, got ${step.status}`);
    }
    if (id === "installed_cli_installed_doctor" && step.status === "fail") {
      if (step.reason_code !== "INSTALLED_CLI_DOCTOR_FAIL") {
        failures.push(
          `${id}: expected reason_code INSTALLED_CLI_DOCTOR_FAIL, got ${JSON.stringify(step.reason_code)}`,
        );
      }
      if (step.evidence_reason_code !== "INSTALL_EVIDENCE_INSTALLED_CLI_FAIL") {
        failures.push(
          `${id}: expected evidence_reason_code INSTALL_EVIDENCE_INSTALLED_CLI_FAIL`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) {
      return { file: argv[++i] };
    }
  }
  return { file: null };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.file ? fs.readFileSync(args.file, "utf8") : fs.readFileSync(0, "utf8");
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    process.stderr.write("assert-docker-live-install-evidence: invalid JSON input\n");
    process.exit(1);
  }

  const result = assertDockerLiveInstallEvidence(report);
  if (!result.ok) {
    for (const failure of result.failures) {
      process.stderr.write(`assert-docker-live-install-evidence: ${failure}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("assert-docker-live-install-evidence: OK\n");
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}
