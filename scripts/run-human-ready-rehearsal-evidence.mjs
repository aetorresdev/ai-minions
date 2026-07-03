#!/usr/bin/env node
/**
 * Human-ready rehearsal evidence (v0.19) — doc chain + checklist + privacy ordering.
 *
 * Usage: node scripts/run-human-ready-rehearsal-evidence.mjs [--json]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaimAudit } from "./audit-product-claims.mjs";
import {
  CHECKLIST_HUMAN_READY_MARKERS,
  PRIVACY_BEFORE_BUNDLE_CHECKS,
  REHEARSAL_RECORD_PATH,
  REHEARSAL_REQUIRED_DOCS,
  SAMPLE_ISSUE_MARKERS,
} from "./lib/human-ready-rehearsal-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "REHEARSAL_OK",
  DOCS_VERIFY: "REHEARSAL_DOCS_VERIFY_FAIL",
  CLAIM_AUDIT: "REHEARSAL_CLAIM_AUDIT_FAIL",
  REQUIRED_DOCS: "REHEARSAL_REQUIRED_DOCS_FAIL",
  RECORD: "REHEARSAL_RECORD_FAIL",
  CHECKLIST: "REHEARSAL_CHECKLIST_FAIL",
  SAMPLE_ISSUE: "REHEARSAL_SAMPLE_ISSUE_FAIL",
  PRIVACY_ORDER: "REHEARSAL_PRIVACY_ORDER_FAIL",
};

/** @typedef {'pass' | 'fail'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * @param {string} scriptRel
 * @returns {{ ok: boolean, output: string }}
 */
function runNodeScript(scriptRel) {
  const abs = path.join(REPO_ROOT, scriptRel);
  const run = spawnSync(process.execPath, [abs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  return { ok: run.status === 0, output: `${run.stdout || ""}${run.stderr || ""}`.trim() };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkRehearsalRecord(options = {}) {
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

  if (parsed.schema_version !== 1) {
    failures.push(`${REHEARSAL_RECORD_PATH}: schema_version must be 1`);
  }
  if (parsed.rehearsal_type !== "internal_human_ready_v0.19") {
    failures.push(`${REHEARSAL_RECORD_PATH}: rehearsal_type must be internal_human_ready_v0.19`);
  }
  if (!parsed.record || typeof parsed.record !== "object") {
    failures.push(`${REHEARSAL_RECORD_PATH}: missing record object`);
  } else {
    const required = ["status", "operator_path", "checklist", "sample_issue", "privacy_notice_ack"];
    for (const key of required) {
      if (!(key in parsed.record)) {
        failures.push(`${REHEARSAL_RECORD_PATH}: record.${key} required`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkPrivacyBeforeBundle(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {string[]} */
  const failures = [];

  for (const check of PRIVACY_BEFORE_BUNDLE_CHECKS) {
    const abs = path.join(repoRoot, check.rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing doc: ${check.rel}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    const privacyIdx = text.indexOf(check.privacy);
    const beforeIdx = text.indexOf(check.before);
    if (privacyIdx === -1) {
      failures.push(`${check.rel}: missing ${check.privacy}`);
    } else if (beforeIdx === -1) {
      failures.push(`${check.rel}: missing ${check.before}`);
    } else if (privacyIdx > beforeIdx) {
      failures.push(`${check.rel}: ${check.privacy} must appear before ${check.before}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkChecklistHumanReady(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const rel = "docs/how-to/beta-dry-run-checklist.md";
  const abs = path.join(repoRoot, rel);
  /** @type {string[]} */
  const failures = [];

  if (!fs.existsSync(abs)) {
    return { ok: false, failures: [`missing ${rel}`] };
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const marker of CHECKLIST_HUMAN_READY_MARKERS) {
    if (!text.includes(marker)) {
      failures.push(`${rel}: missing marker ${JSON.stringify(marker)}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkSampleIssueHumanReady(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const rel = "docs/how-to/evidence/beta-dry-run-sample-issue.md";
  const abs = path.join(repoRoot, rel);
  /** @type {string[]} */
  const failures = [];

  if (!fs.existsSync(abs)) {
    return { ok: false, failures: [`missing ${rel}`] };
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const marker of SAMPLE_ISSUE_MARKERS) {
    if (!text.includes(marker)) {
      failures.push(`${rel}: missing marker ${JSON.stringify(marker)}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, steps: StepResult[], evidence_class: string }>}
 */
export async function runHumanReadyRehearsalEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {StepResult[]} */
  const steps = [];

  const docsVerify = runNodeScript("scripts/verify-usage-docs.mjs");
  steps.push({
    id: "verify_usage_docs",
    reason_code: docsVerify.ok ? REASON_CODES.OK : REASON_CODES.DOCS_VERIFY,
    status: docsVerify.ok ? "pass" : "fail",
    message: docsVerify.ok ? "verify-usage-docs OK" : docsVerify.output.slice(0, 200),
  });

  const claim = await runClaimAudit({ repoRoot });
  steps.push({
    id: "claim_audit",
    reason_code: claim.ok ? REASON_CODES.OK : REASON_CODES.CLAIM_AUDIT,
    status: claim.ok ? "pass" : "fail",
    message: claim.ok ? "claim audit OK" : "claim audit failed",
  });

  const missingDocs = REHEARSAL_REQUIRED_DOCS.filter(
    (rel) => !fs.existsSync(path.join(repoRoot, rel)),
  );
  steps.push({
    id: "required_docs",
    reason_code: missingDocs.length ? REASON_CODES.REQUIRED_DOCS : REASON_CODES.OK,
    status: missingDocs.length ? "fail" : "pass",
    message: missingDocs.length ? `missing: ${missingDocs.join(", ")}` : "required docs present",
  });

  const record = checkRehearsalRecord({ repoRoot });
  steps.push({
    id: "rehearsal_record",
    reason_code: record.ok ? REASON_CODES.OK : REASON_CODES.RECORD,
    status: record.ok ? "pass" : "fail",
    message: record.ok ? "rehearsal record valid" : record.failures.join("; "),
  });

  const checklist = checkChecklistHumanReady({ repoRoot });
  steps.push({
    id: "checklist_human_ready",
    reason_code: checklist.ok ? REASON_CODES.OK : REASON_CODES.CHECKLIST,
    status: checklist.ok ? "pass" : "fail",
    message: checklist.ok ? "checklist v0.19 markers OK" : checklist.failures.join("; "),
  });

  const sample = checkSampleIssueHumanReady({ repoRoot });
  steps.push({
    id: "sample_issue",
    reason_code: sample.ok ? REASON_CODES.OK : REASON_CODES.SAMPLE_ISSUE,
    status: sample.ok ? "pass" : "fail",
    message: sample.ok ? "sample issue product CLI path OK" : sample.failures.join("; "),
  });

  const privacyOrder = checkPrivacyBeforeBundle({ repoRoot });
  steps.push({
    id: "privacy_before_bundle",
    reason_code: privacyOrder.ok ? REASON_CODES.OK : REASON_CODES.PRIVACY_ORDER,
    status: privacyOrder.ok ? "pass" : "fail",
    message: privacyOrder.ok ? "privacy linked before bundle paths" : privacyOrder.failures.join("; "),
  });

  const ok = steps.every((s) => s.status === "pass");
  return { ok, steps, evidence_class: "human_ready_rehearsal_v0.19" };
}

async function main() {
  const json = process.argv.includes("--json");
  const result = await runHumanReadyRehearsalEvidence();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("human-ready rehearsal evidence");
    console.log(`  ok: ${result.ok}`);
    for (const step of result.steps) {
      console.log(`  [${step.status.toUpperCase()}] ${step.id} — ${step.message}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
