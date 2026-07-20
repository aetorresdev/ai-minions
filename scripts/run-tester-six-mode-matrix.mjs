#!/usr/bin/env node
/**
 * Tester six-mode matrix — structure gate + credential-aware skip assessment.
 * Does not print secret values. Live smoke is opt-in (--run-ready reports READY only;
 * execution stays in the how-to runbook).
 *
 * Usage:
 *   node scripts/run-tester-six-mode-matrix.mjs [--json] [--skip-live] [--probe-local]
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REASON_CODES,
  SIX_MODE_ROWS,
  assessAllRows,
  assessCredentialPresence,
  validateMatrixDoc,
} from "./lib/tester-six-mode-matrix-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {'pass' | 'fail' | 'skip'} StepStatus */
/** @typedef {{ id: string, reason_code: string, status: StepStatus, message: string }} StepResult */

/**
 * Probe Ollama /api/tags without logging response bodies that could contain secrets.
 * @param {{ host: string, port: string, timeoutMs?: number }} opts
 * @returns {Promise<boolean>}
 */
export function probeLocalBackend(opts) {
  const host = opts.host || "127.0.0.1";
  const port = opts.port || "11434";
  const timeoutMs = opts.timeoutMs ?? 2000;
  const url = `http://${host}:${port}/api/tags`;

  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

/**
 * @param {{
 *   repoRoot?: string,
 *   skipLive?: boolean,
 *   probeLocal?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   localBackendReachable?: boolean | null,
 * }} [options]
 */
export async function runTesterSixModeMatrix(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const matrixDocPath = path.join(repoRoot, "docs/how-to/tester-six-mode-matrix.md");
  const skipLive = options.skipLive !== false;
  const env = options.env ?? process.env;
  /** @type {StepResult[]} */
  const steps = [];

  const docText = fs.existsSync(matrixDocPath)
    ? fs.readFileSync(matrixDocPath, "utf8")
    : "";
  const docCheck = validateMatrixDoc(docText);
  if (!docCheck.ok) {
    steps.push({
      id: "matrix_doc",
      reason_code: REASON_CODES.DOC_FAIL,
      status: "fail",
      message: docCheck.errors.join("; "),
    });
  } else {
    steps.push({
      id: "matrix_doc",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `six-mode matrix doc valid (${SIX_MODE_ROWS.length} rows)`,
    });
  }

  const credentials = assessCredentialPresence(env);
  let localBackendReachable =
    options.localBackendReachable === undefined
      ? null
      : options.localBackendReachable;

  if (options.probeLocal === true && localBackendReachable === null) {
    localBackendReachable = await probeLocalBackend({
      host: credentials.ollama_host,
      port: credentials.ollama_port,
    });
  }

  const rowResults = assessAllRows({
    credentials,
    localBackendReachable,
    skipLive,
  });

  for (const row of rowResults) {
    const stepStatus =
      row.status === "fail" ? "fail" : row.status === "ready" ? "pass" : "skip";
    steps.push({
      id: `row:${row.id}`,
      reason_code: row.reason_code,
      status: stepStatus,
      message: row.message,
    });
  }

  const ok = steps.every((s) => s.status !== "fail");
  return {
    ok,
    schema_version: 1,
    evidence_class: skipLive ? "structure_and_readiness" : "readiness_live_eligible",
    credential_status: {
      anthropic: credentials.anthropic,
      openai: credentials.openai,
      any_provider: credentials.any_provider,
      credential_sufficiency: "any_provider",
      note:
        "Status only (present/missing). Never prints secret values. any_provider does not validate selected provider or remote connectivity.",
    },
    local_backend: {
      probed: options.probeLocal === true,
      reachable: localBackendReachable,
      host: credentials.ollama_host,
      port: credentials.ollama_port,
    },
    rows: rowResults,
    steps,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runTesterSixModeMatrix>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    `tester-six-mode-matrix: ${report.ok ? "OK" : "FAIL"}`,
    `evidence_class: ${report.evidence_class}`,
    `credentials: anthropic=${report.credential_status.anthropic} openai=${report.credential_status.openai} any_provider=${report.credential_status.any_provider}`,
    `local_backend: probed=${report.local_backend.probed} reachable=${report.local_backend.reachable}`,
    "",
    "steps:",
  ];
  for (const s of report.steps) {
    lines.push(`  - [${s.status}] ${s.id} ${s.reason_code} — ${s.message}`);
  }
  lines.push("", "rows:");
  for (const r of report.rows) {
    lines.push(`  - [${r.status}] ${r.id} ${r.reason_code}`);
    lines.push(`      command: ${r.command}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    skipLive: !argv.includes("--run-ready"),
    probeLocal: argv.includes("--probe-local"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --skip-live is the default; accept explicit flag for CI copy-paste
  if (process.argv.includes("--skip-live")) {
    args.skipLive = true;
  }
  const report = await runTesterSixModeMatrix({
    skipLive: args.skipLive,
    probeLocal: args.probeLocal,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportText(report));
  }
  if (!report.ok) {
    const blocker = report.steps.find((s) => s.status === "fail");
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
