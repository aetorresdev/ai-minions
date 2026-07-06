#!/usr/bin/env node
/**
 * Beta cohort guard (v0.20 E20-6) — checklist + issue evidence + performative-beta guard.
 *
 * Chains human-ready rehearsal, installed CLI CI evidence, guided-path markers,
 * and cohort guard record validation. Does **not** open external cohort by itself.
 *
 * Usage: node scripts/run-beta-cohort-guard.mjs [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COHORT_GUARD_RECORD_KEYS,
  GUIDED_PATH_CHECKLIST_MARKERS,
  ISSUE_EVIDENCE_DOCS,
  PERFORMATIVE_BETA_SCAN_PATHS,
  checkNoPrimaryDevPathInChecklist,
  checkPerformativeBetaClaims,
} from "./lib/beta-cohort-guard-data.mjs";
import { REHEARSAL_RECORD_PATH } from "./lib/human-ready-rehearsal-data.mjs";
import { runHumanReadyRehearsalEvidence } from "./run-human-ready-rehearsal-evidence.mjs";
import { runInstallEvidence } from "./run-install-evidence.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "COHORT_GUARD_OK",
  REHEARSAL: "COHORT_GUARD_REHEARSAL_FAIL",
  INSTALLED_CLI: "COHORT_GUARD_INSTALLED_CLI_FAIL",
  GUIDED_PATH: "COHORT_GUARD_GUIDED_PATH_FAIL",
  PERFORMATIVE: "COHORT_GUARD_PERFORMATIVE_BETA_FAIL",
  PRIMARY_PATH: "COHORT_GUARD_PRIMARY_PATH_FAIL",
  ISSUE_EVIDENCE: "COHORT_GUARD_ISSUE_EVIDENCE_FAIL",
  RECORD: "COHORT_GUARD_RECORD_FAIL",
};

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkGuidedPathChecklist(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const rel = "docs/how-to/beta-dry-run-checklist.md";
  const abs = path.join(repoRoot, rel);
  /** @type {string[]} */
  const failures = [];

  if (!fs.existsSync(abs)) {
    return { ok: false, failures: [`missing ${rel}`] };
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const marker of GUIDED_PATH_CHECKLIST_MARKERS) {
    if (!text.includes(marker)) {
      failures.push(`${rel}: missing guided-path marker ${JSON.stringify(marker)}`);
    }
  }
  checkNoPrimaryDevPathInChecklist(text, rel, (msg) => failures.push(msg));
  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkPerformativeBetaGuard(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {string[]} */
  const failures = [];

  for (const rel of PERFORMATIVE_BETA_SCAN_PATHS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing doc: ${rel}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    checkPerformativeBetaClaims(text, rel, (msg) => failures.push(msg));
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkIssueEvidenceChain(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {string[]} */
  const failures = [];

  for (const rel of ISSUE_EVIDENCE_DOCS) {
    if (!fs.existsSync(path.join(repoRoot, rel))) {
      failures.push(`missing issue evidence doc: ${rel}`);
    }
  }

  const sampleRel = "docs/how-to/evidence/beta-dry-run-sample-issue.md";
  const sampleAbs = path.join(repoRoot, sampleRel);
  if (fs.existsSync(sampleAbs)) {
    const text = fs.readFileSync(sampleAbs, "utf8");
    for (const marker of ["ai-minions attach", "ATTACH.md", "PRIVACY.md", "synthetic"]) {
      if (!text.includes(marker)) {
        failures.push(`${sampleRel}: missing marker ${JSON.stringify(marker)}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkCohortGuardRecord(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const abs = path.join(repoRoot, REHEARSAL_RECORD_PATH);
  /** @type {string[]} */
  const failures = [];

  if (!fs.existsSync(abs)) {
    return { ok: false, failures: [`missing ${REHEARSAL_RECORD_PATH}`] };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return { ok: false, failures: [`invalid JSON: ${REHEARSAL_RECORD_PATH}`] };
  }

  if (parsed.schema_version !== 2) {
    failures.push(`${REHEARSAL_RECORD_PATH}: schema_version must be 2 for cohort guard`);
  }

  const cg = parsed.record?.cohort_guard;
  if (!cg || typeof cg !== "object") {
    failures.push(`${REHEARSAL_RECORD_PATH}: record.cohort_guard required`);
    return { ok: false, failures };
  }

  for (const key of COHORT_GUARD_RECORD_KEYS) {
    if (!(key in cg)) {
      failures.push(`${REHEARSAL_RECORD_PATH}: record.cohort_guard.${key} required`);
    }
  }

  if (cg.required_before_external_cohort !== true) {
    failures.push(`${REHEARSAL_RECORD_PATH}: cohort_guard.required_before_external_cohort must be true`);
  }
  if (cg.guided_cli_validated !== true) {
    failures.push(`${REHEARSAL_RECORD_PATH}: cohort_guard.guided_cli_validated must be true`);
  }
  if (cg.performative_beta_guard !== "enforced") {
    failures.push(`${REHEARSAL_RECORD_PATH}: cohort_guard.performative_beta_guard must be "enforced"`);
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   runHumanReady?: typeof runHumanReadyRehearsalEvidence,
 *   runInstalled?: typeof runInstallEvidence,
 * }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runBetaCohortGuard(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const runHumanReady = options.runHumanReady ?? runHumanReadyRehearsalEvidence;
  const runInstalled = options.runInstalled ?? runInstallEvidence;
  /** @type {StepResult[]} */
  const steps = [];

  const rehearsal = await runHumanReady({ repoRoot });
  steps.push({
    id: "human_ready_rehearsal",
    reason_code: rehearsal.ok ? REASON_CODES.OK : REASON_CODES.REHEARSAL,
    status: rehearsal.ok ? "pass" : "fail",
    message: rehearsal.ok
      ? "human-ready rehearsal chain OK"
      : rehearsal.steps.filter((s) => s.status === "fail").map((s) => s.id).join(", "),
  });

  const installed = await runInstalled({ repoRoot, installedCliCi: true });
  steps.push({
    id: "installed_cli_ci",
    reason_code: installed.ok ? REASON_CODES.OK : REASON_CODES.INSTALLED_CLI,
    status: installed.ok ? "pass" : "fail",
    message: installed.ok
      ? "installed CLI CI evidence OK"
      : installed.steps.filter((s) => s.status === "fail").map((s) => s.id).join(", "),
  });

  const guided = checkGuidedPathChecklist({ repoRoot });
  steps.push({
    id: "guided_path_checklist",
    reason_code: guided.ok ? REASON_CODES.OK : REASON_CODES.GUIDED_PATH,
    status: guided.ok ? "pass" : "fail",
    message: guided.ok ? "guided path checklist markers OK" : guided.failures.join("; "),
  });

  const performative = checkPerformativeBetaGuard({ repoRoot });
  steps.push({
    id: "performative_beta_guard",
    reason_code: performative.ok ? REASON_CODES.OK : REASON_CODES.PERFORMATIVE,
    status: performative.ok ? "pass" : "fail",
    message: performative.ok ? "no performative external-beta claims" : performative.failures.join("; "),
  });

  const issue = checkIssueEvidenceChain({ repoRoot });
  steps.push({
    id: "issue_evidence_chain",
    reason_code: issue.ok ? REASON_CODES.OK : REASON_CODES.ISSUE_EVIDENCE,
    status: issue.ok ? "pass" : "fail",
    message: issue.ok ? "issue evidence chain OK" : issue.failures.join("; "),
  });

  const record = checkCohortGuardRecord({ repoRoot });
  steps.push({
    id: "cohort_guard_record",
    reason_code: record.ok ? REASON_CODES.OK : REASON_CODES.RECORD,
    status: record.ok ? "pass" : "fail",
    message: record.ok ? "cohort guard record valid" : record.failures.join("; "),
  });

  const ok = steps.every((s) => s.status === "pass");
  return { ok, steps, evidence_class: ok ? "beta_cohort_guard_doc_chain" : "beta_cohort_guard_blocked" };
}

/**
 * @param {{ ok: boolean, steps: StepResult[], evidence_class: string }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "beta cohort guard evidence",
    `  ok: ${report.ok}`,
    `  evidence_class: ${report.evidence_class}`,
  ];
  for (const step of report.steps) {
    lines.push(`  [${step.status.toUpperCase()}] ${step.id} — ${step.message}`);
  }
  return lines.join("\n");
}

async function main() {
  const json = process.argv.includes("--json");
  const report = await runBetaCohortGuard();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportText(report));
  }

  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
