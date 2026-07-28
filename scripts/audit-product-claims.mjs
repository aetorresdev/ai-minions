#!/usr/bin/env node
/**
 * Deterministic product-claim audit for v0.11 operator-facing docs.
 * Fail-closed with stable CLAIM_* reason codes — no secrets in output.
 *
 * Usage: node scripts/audit-product-claims.mjs [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIM_AUDIT_PATHS,
  README_REQUIRED_MARKERS,
  SLASH_PRODUCT_HONESTY_PATHS,
  checkForbiddenClaims,
  checkSlashUnavailableProductClaims,
  mustNotHaveBacklogCaseIds,
} from "./lib/operator-doc-claims.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REASON_CODES = {
  OK: "CLAIM_OK",
  FORBIDDEN_PHRASE: "CLAIM_FORBIDDEN_PHRASE",
  BACKLOG_ID: "CLAIM_BACKLOG_ID_IN_OPERATOR_DOC",
  MISSING_README_MARKER: "CLAIM_MISSING_README_MARKER",
  MISSING_FILE: "CLAIM_MISSING_OPERATOR_DOC",
  SLASH_UNAVAILABLE: "CLAIM_SLASH_UNAVAILABLE_STALE",
};

/** @typedef {'pass' | 'fail'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string, file?: string }} CheckResult */

/**
 * @param {{ repoRoot?: string, paths?: string[] }} [options]
 * @returns {{ ok: boolean, checks: CheckResult[] }}
 */
export function runClaimAudit(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const paths = options.paths ?? CLAIM_AUDIT_PATHS;
  /** @type {CheckResult[]} */
  const checks = [];

  for (const fileRel of paths) {
    const abs = path.join(repoRoot, fileRel);
    if (!fs.existsSync(abs)) {
      checks.push({
        id: `file:${fileRel}`,
        reason_code: REASON_CODES.MISSING_FILE,
        status: "fail",
        message: `missing operator doc: ${fileRel}`,
        file: fileRel,
      });
      continue;
    }

    const text = fs.readFileSync(abs, "utf8");
    /** @type {string[]} */
    const localFailures = [];

    checkForbiddenClaims(text, fileRel, (msg) => localFailures.push(msg));
    mustNotHaveBacklogCaseIds(text, fileRel, (msg) => localFailures.push(msg));

    for (const msg of localFailures) {
      const code = msg.includes("backlog-style case IDs")
        ? REASON_CODES.BACKLOG_ID
        : REASON_CODES.FORBIDDEN_PHRASE;
      checks.push({
        id: `claims:${fileRel}`,
        reason_code: code,
        status: "fail",
        message: msg,
        file: fileRel,
      });
    }

    if (localFailures.length === 0) {
      checks.push({
        id: `claims:${fileRel}`,
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: `claim audit pass: ${fileRel}`,
        file: fileRel,
      });
    }
  }

  if (paths.includes("README.md") && fs.existsSync(path.join(repoRoot, "README.md"))) {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    let readmeMarkersOk = true;
    for (const { needle, label } of README_REQUIRED_MARKERS) {
      if (!readme.includes(needle)) {
        readmeMarkersOk = false;
        checks.push({
          id: `readme:${needle}`,
          reason_code: REASON_CODES.MISSING_README_MARKER,
          status: "fail",
          message: `README.md missing required marker — ${label}`,
          file: "README.md",
        });
      }
    }
    if (readmeMarkersOk) {
      checks.push({
        id: "readme:markers",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "README.md has limitations / not-claimed markers",
        file: "README.md",
      });
    }
  }

  for (const fileRel of SLASH_PRODUCT_HONESTY_PATHS) {
    const abs = path.join(repoRoot, fileRel);
    if (!fs.existsSync(abs)) {
      checks.push({
        id: `slash-honesty:${fileRel}`,
        reason_code: REASON_CODES.MISSING_FILE,
        status: "fail",
        message: `missing slash honesty contract doc: ${fileRel}`,
        file: fileRel,
      });
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    /** @type {string[]} */
    const slashFailures = [];
    checkSlashUnavailableProductClaims(text, fileRel, (msg) => slashFailures.push(msg));
    for (const msg of slashFailures) {
      checks.push({
        id: `slash-honesty:${fileRel}`,
        reason_code: REASON_CODES.SLASH_UNAVAILABLE,
        status: "fail",
        message: msg,
        file: fileRel,
      });
    }
    if (slashFailures.length === 0) {
      checks.push({
        id: `slash-honesty:${fileRel}`,
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: `slash product honesty pass: ${fileRel}`,
        file: fileRel,
      });
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
}

/**
 * @param {{ ok: boolean, checks: CheckResult[] }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = ["ai-minions product-claim audit", `  ok: ${report.ok}`];
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : "FAIL";
    lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/audit-product-claims.mjs [--json]

Scans operator-facing docs for inflated product claims and missing README guardrails.

Exit codes: 0 = pass, 1 = blocker(s)
Reason codes: CLAIM_FORBIDDEN_PHRASE, CLAIM_BACKLOG_ID_IN_OPERATOR_DOC,
CLAIM_MISSING_README_MARKER, CLAIM_MISSING_OPERATOR_DOC,
CLAIM_SLASH_UNAVAILABLE_STALE, CLAIM_OK
`);
    process.exit(0);
  }

  const report = runClaimAudit();
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  if (!report.ok) {
    for (const b of report.checks.filter((c) => c.status === "fail")) {
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
