#!/usr/bin/env node
/**
 * Tester six-mode matrix — structure gate + credential-aware skip assessment.
 * Does not print secret values.
 *
 * Default / --skip-live / --run-ready: readiness only (MATRIX_READY ≠ PASS).
 * Opt-in live execution (--execute-live): runs selected rows through ai-minions
 * operator contracts via the shared live harness (never calls providers directly).
 *
 * Usage:
 *   node scripts/run-tester-six-mode-matrix.mjs [--json] [--skip-live] [--probe-local]
 *   node scripts/run-tester-six-mode-matrix.mjs --run-ready [--probe-local] [--json]
 *   node scripts/run-tester-six-mode-matrix.mjs --execute-live \
 *     --fixture sudoku-html-app --rows sa-local_only \
 *     --evidence-dir /tmp/live-harness-evidence [--probe-local] [--json]
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  REASON_CODES,
  SIX_MODE_ROWS,
  assessAllRows,
  assessCredentialPresence,
  credentialRequirementByPolicy,
  validateMatrixDoc,
} from "./lib/tester-six-mode-matrix-data.mjs";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {'pass' | 'fail' | 'skip' | 'ready' | 'blocked'} StepStatus */
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
 * Map row assessment status to step status.
 * MATRIX_READY stays "ready" — never promoted to "pass" (eligibility ≠ executed PASS).
 * @param {string} rowStatus
 * @returns {StepStatus}
 */
export function rowStatusToStepStatus(rowStatus) {
  if (rowStatus === "fail") return "fail";
  if (rowStatus === "ready") return "ready";
  if (rowStatus === "pass") return "pass";
  if (rowStatus === "blocked") return "blocked";
  return "skip";
}

/**
 * Map live harness outcome to step status (PASS ≠ MATRIX_READY).
 * @param {string} outcome
 * @returns {StepStatus}
 */
export function liveOutcomeToStepStatus(outcome) {
  const token = String(outcome || "").toUpperCase();
  if (token === "PASS") return "pass";
  if (token === "FAIL") return "fail";
  if (token === "BLOCKED") return "blocked";
  return "skip";
}

/**
 * Prefer harness aggregate_outcome; derive from rows when mocks omit it.
 * @param {{ aggregate_outcome?: string, ok?: boolean, rows?: Array<{ outcome?: string }> }} live
 * @returns {string}
 */
export function deriveLiveHarnessAggregate(live) {
  if (live && live.aggregate_outcome) return String(live.aggregate_outcome).toUpperCase();
  const rows = Array.isArray(live?.rows) ? live.rows : [];
  if (rows.length === 0) return live?.ok === false ? "FAIL" : "BLOCKED";
  const outcomes = rows.map((r) => String(r?.outcome || "").toUpperCase());
  if (outcomes.some((o) => o === "FAIL")) return "FAIL";
  if (outcomes.some((o) => o === "BLOCKED")) return "BLOCKED";
  if (outcomes.every((o) => o === "SKIP")) return "SKIP";
  if (outcomes.some((o) => o === "PASS") && outcomes.every((o) => o === "PASS" || o === "SKIP")) {
    return "PASS";
  }
  return "BLOCKED";
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
    steps.push({
      id: `row:${row.id}`,
      reason_code: row.reason_code,
      status: rowStatusToStepStatus(row.status),
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
      credential_requirement_by_policy: credentialRequirementByPolicy(),
      note:
        "Status only (present/missing). Never prints secret values. remote_ok uses any_provider (at least one supported token); local_only is not_required. any_provider does not validate selected provider or remote connectivity.",
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
 * Opt-in live execution through shared operator live harness.
 * @param {{
 *   repoRoot?: string,
 *   fixtureId?: string,
 *   rowIds?: unknown,
 *   evidenceDir?: string,
 *   probeLocal?: boolean,
 *   maxIterations?: unknown,
 *   gatePosture?: string,
 *   env?: NodeJS.ProcessEnv,
 *   localBackendReachable?: boolean | null,
 *   cwd?: string,
 *   runLiveHarnessFn?: Function,
 * }} [options]
 */
export async function runTesterSixModeMatrixLive(options = {}) {
  const readiness = await runTesterSixModeMatrix({
    repoRoot: options.repoRoot,
    skipLive: false,
    probeLocal: options.probeLocal,
    env: options.env,
    localBackendReachable: options.localBackendReachable,
  });

  const liveHarnessPath = path.join(
    options.repoRoot ?? REPO_ROOT,
    "orchestrator/modules/operator/operator-live-harness.js",
  );
  const { runLiveHarness } = options.runLiveHarnessFn
    ? { runLiveHarness: options.runLiveHarnessFn }
    : require(liveHarnessPath);

  const live = await runLiveHarness({
    executeLive: true,
    fixtureId: options.fixtureId ?? "sudoku-html-app",
    rowIds: options.rowIds,
    evidenceDir: options.evidenceDir,
    cwd: options.cwd ?? options.repoRoot ?? REPO_ROOT,
    maxIterations: options.maxIterations,
    gatePosture: options.gatePosture,
    localBackendReachable: readiness.local_backend.reachable,
    env: options.env ?? process.env,
  });

  /** @type {StepResult[]} */
  const liveSteps = [...readiness.steps];
  const aggregate = deriveLiveHarnessAggregate(live);
  liveSteps.push({
    id: "live_harness",
    reason_code: live.reason_code || (aggregate === "PASS"
      ? REASON_CODES.OK
      : aggregate === "SKIP"
        ? String(live.rows?.[0]?.reason_code || "LIVE_HARNESS_SKIP")
        : aggregate === "BLOCKED"
          ? String(live.rows?.[0]?.reason_code || "LIVE_HARNESS_BLOCKED")
          : "LIVE_HARNESS_FAIL"),
    status: liveOutcomeToStepStatus(aggregate),
    message: live.message
      || `live harness fixture=${live.fixture_id || options.fixtureId} rows=${(live.row_ids || []).join(",")} aggregate=${aggregate}`,
  });

  for (const row of live.rows || []) {
    liveSteps.push({
      id: `live:${row.row_id}`,
      reason_code: String(row.reason_code || ""),
      status: liveOutcomeToStepStatus(row.outcome),
      message: String(row.message || row.outcome || ""),
    });
  }

  const ok = readiness.ok && live.ok !== false && !(live.rows || []).some((r) => r.outcome === "FAIL");
  return {
    ...readiness,
    ok,
    evidence_class: "live_execution",
    live_harness: live,
    steps: liveSteps,
    note:
      "MATRIX_READY / readiness_live_eligible is not PASS. Live PASS requires terminal success, artifacts, verifier, status, attach, and privacy scan via shared operator adapters.",
  };
}

/**
 * @param {Awaited<ReturnType<typeof runTesterSixModeMatrix>> & { live_harness?: object }} report
 * @returns {string}
 */
export function formatReportText(report) {
  const policies = report.credential_status.credential_requirement_by_policy;
  const lines = [
    `tester-six-mode-matrix: ${report.ok ? "OK" : "FAIL"}`,
    `evidence_class: ${report.evidence_class}`,
    `credentials: anthropic=${report.credential_status.anthropic} openai=${report.credential_status.openai} any_provider=${report.credential_status.any_provider}`,
    `credential_requirement_by_policy: local_only=${policies.local_only} remote_ok=${policies.remote_ok} hybrid=${policies.hybrid}`,
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
  if (report.live_harness && Array.isArray(report.live_harness.rows)) {
    lines.push("", "live_harness:");
    lines.push(`  fixture_id: ${report.live_harness.fixture_id}`);
    for (const lr of report.live_harness.rows) {
      lines.push(`  - [${lr.outcome}] ${lr.row_id} ${lr.reason_code} run_id=${lr.run_id ?? "(none)"}`);
    }
  }
  return lines.join("\n");
}

/** Explicit rejection — there is no runtime time-limit contract on this runner. */
export const UNSUPPORTED_TIME_LIMIT_MSG =
  "--time-limit is not supported (no runtime time-limit contract); omit the flag";

/**
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function usageError(message) {
  const err = /** @type {Error & { code: string }} */ (new Error(message));
  err.code = "USAGE";
  return err;
}

/**
 * Consume the next argv token as a value for `flag`.
 * Never treats a `--...` token as the value — leave it for the next parse
 * iteration (unsupported/unknown option) or throw when argv is exhausted.
 *
 * @param {string[]} argv
 * @param {number} i index of the flag token
 * @param {string} flag
 * @returns {{ value: string, consumed: true } | { value: null, consumed: false }}
 */
function takeOptionValue(argv, i, flag) {
  const next = argv[i + 1];
  if (next === undefined) {
    throw usageError(`${flag} requires a value`);
  }
  if (typeof next === "string" && next.startsWith("--")) {
    return { value: null, consumed: false };
  }
  return { value: next, consumed: true };
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{
   *   json: boolean,
   *   skipLive: boolean,
   *   probeLocal: boolean,
   *   executeLive: boolean,
   *   fixtureId: string | null,
   *   rowIds: string | null,
   *   evidenceDir: string | null,
   *   maxIterations: string | null,
   *   help?: boolean,
   * }} */
  const out = {
    json: false,
    skipLive: true,
    probeLocal: false,
    executeLive: false,
    fixtureId: null,
    rowIds: null,
    evidenceDir: null,
    maxIterations: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--skip-live") out.skipLive = true;
    else if (a === "--run-ready") out.skipLive = false;
    else if (a === "--probe-local") out.probeLocal = true;
    else if (a === "--execute-live") {
      out.executeLive = true;
      out.skipLive = false;
    } else if (a === "--fixture") {
      const taken = takeOptionValue(argv, i, "--fixture");
      if (taken.consumed) {
        out.fixtureId = taken.value;
        i += 1;
      }
    } else if (a === "--rows") {
      const taken = takeOptionValue(argv, i, "--rows");
      if (taken.consumed) {
        out.rowIds = taken.value;
        i += 1;
      }
    } else if (a === "--evidence-dir") {
      const taken = takeOptionValue(argv, i, "--evidence-dir");
      if (taken.consumed) {
        out.evidenceDir = taken.value;
        i += 1;
      }
    } else if (a === "--max-iterations") {
      const taken = takeOptionValue(argv, i, "--max-iterations");
      if (taken.consumed) {
        out.maxIterations = taken.value;
        i += 1;
      }
    } else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--time-limit") {
      throw usageError(UNSUPPORTED_TIME_LIMIT_MSG);
    } else if (typeof a === "string" && a.startsWith("-")) {
      throw usageError(`unknown option: ${a}`);
    } else {
      throw usageError(`unexpected argument: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-tester-six-mode-matrix.mjs [--json] [--skip-live] [--probe-local]
  node scripts/run-tester-six-mode-matrix.mjs --run-ready [--probe-local] [--json]
  node scripts/run-tester-six-mode-matrix.mjs --execute-live \\
    --fixture sudoku-html-app --rows sa-local_only[,sa-remote_ok] \\
    --evidence-dir <dir> [--max-iterations N] [--probe-local] [--json]

Default path is readiness-only. --run-ready reports MATRIX_READY eligibility only
(never executes a model). --execute-live runs selected rows through ai-minions
operator contracts (shared live harness). Hybrid remains honest SKIP.`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printHelp();
    process.exit(1);
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (process.argv.includes("--skip-live")) {
    args.skipLive = true;
    args.executeLive = false;
  }

  const report = args.executeLive
    ? await runTesterSixModeMatrixLive({
      skipLive: false,
      probeLocal: args.probeLocal,
      fixtureId: args.fixtureId || "sudoku-html-app",
      rowIds: args.rowIds,
      evidenceDir: args.evidenceDir || undefined,
      maxIterations: args.maxIterations,
    })
    : await runTesterSixModeMatrix({
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
