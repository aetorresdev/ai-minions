#!/usr/bin/env node
/**
 * Bootstrap + preflight for a clean ai-minions clone (operator entry path).
 * Fail-closed with stable reason_code values — no secrets in output.
 *
 * Usage:
 *   node scripts/bootstrap-preflight.mjs [--json] [--install] [--test] [--live]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  MIN_NODE_MAJOR,
  NODE_VERSION_UNSUPPORTED,
  assessNodeRuntime,
} = require("./lib/node-runtime-policy.cjs");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const ORCHESTRATOR_DIR = path.join(REPO_ROOT, "orchestrator");

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string }} CheckResult */

export const REASON_CODES = {
  OK: "PREFLIGHT_OK",
  REPO_LAYOUT: "PREFLIGHT_REPO_LAYOUT",
  /** @deprecated Prefer NODE_VERSION_UNSUPPORTED — kept as alias for older docs/tests. */
  NODE_VERSION: NODE_VERSION_UNSUPPORTED,
  NODE_VERSION_UNSUPPORTED,
  NPM_CI: "PREFLIGHT_NPM_CI",
  NPM_TEST: "PREFLIGHT_NPM_TEST",
  CLAUDE_CLI: "PREFLIGHT_CLAUDE_CLI_MISSING",
  CLAUDE_AUTH: "PREFLIGHT_CLAUDE_AUTH",
  TRACE_DIR: "PREFLIGHT_TRACE_DIR_NOT_WRITABLE",
};

export { MIN_NODE_MAJOR };

/**
 * @param {string} tracesDir
 * @returns {boolean}
 */
export function isTraceDirWritable(tracesDir) {
  try {
    fs.mkdirSync(tracesDir, { recursive: true });
    const probe = path.join(tracesDir, `.preflight-write-${process.pid}`);
    fs.writeFileSync(probe, "ok", { encoding: "utf8" });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string}
 */
export function resolveTracesDir() {
  const env = process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim();
  return env ? path.resolve(env) : path.join(os.homedir(), ".claude", "metrics", "traces");
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  const which = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return which.status === 0 && String(which.stdout || "").trim().length > 0;
}

/**
 * @param {{ install?: boolean, runTest?: boolean, live?: boolean, repoRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, checks: CheckResult[], traces_dir: string }>}
 */
export async function runBootstrapPreflight(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const orchDir = path.join(repoRoot, "orchestrator");
  const tracesDir = resolveTracesDir();
  /** @type {CheckResult[]} */
  const checks = [];

  const pkgPath = path.join(orchDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    checks.push({
      id: "repo_layout",
      reason_code: REASON_CODES.REPO_LAYOUT,
      status: "fail",
      message: `missing ${path.relative(repoRoot, pkgPath)} — run from ai-minions clone root`,
    });
    return { ok: false, checks, traces_dir: tracesDir };
  }
  checks.push({
    id: "repo_layout",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: "orchestrator/package.json present",
  });

  const nodeAssessment = assessNodeRuntime(process.versions.node, { minMajor: MIN_NODE_MAJOR });
  if (!nodeAssessment.ok) {
    checks.push({
      id: "node_version",
      reason_code: REASON_CODES.NODE_VERSION_UNSUPPORTED,
      status: "fail",
      message: nodeAssessment.message,
    });
  } else {
    checks.push({
      id: "node_version",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: nodeAssessment.message,
    });
  }

  const nodeModules = path.join(orchDir, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    if (options.install) {
      const npmCi = spawnSync("npm", ["ci"], { cwd: orchDir, encoding: "utf8", stdio: "pipe" });
      if (npmCi.status !== 0) {
        checks.push({
          id: "npm_ci",
          reason_code: REASON_CODES.NPM_CI,
          status: "fail",
          message: "npm ci failed in orchestrator/ (see stderr)",
        });
      } else {
        checks.push({
          id: "npm_ci",
          reason_code: REASON_CODES.OK,
          status: "pass",
          message: "npm ci completed in orchestrator/",
        });
      }
    } else {
      checks.push({
        id: "npm_ci",
        reason_code: REASON_CODES.NPM_CI,
        status: "fail",
        message: "orchestrator/node_modules missing — run: cd ai-minions/orchestrator && npm ci (or pass --install)",
      });
    }
  } else {
    checks.push({
      id: "npm_ci",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "orchestrator/node_modules present",
    });
  }

  if (isTraceDirWritable(tracesDir)) {
    checks.push({
      id: "trace_dir",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `trace dir writable: ${tracesDir}`,
    });
  } else {
    checks.push({
      id: "trace_dir",
      reason_code: REASON_CODES.TRACE_DIR,
      status: "fail",
      message: `trace dir not writable: ${tracesDir}`,
    });
  }

  const live = options.live === true;
  if (live) {
    if (!commandExists("claude")) {
      checks.push({
        id: "claude_cli",
        reason_code: REASON_CODES.CLAUDE_CLI,
        status: "fail",
        message: "claude CLI not found in PATH (required for --live)",
      });
    } else {
      const ver = spawnSync("claude", ["--version"], { encoding: "utf8", stdio: "pipe" });
      const versionLine = (ver.stdout || ver.stderr || "").trim().split("\n")[0] || "present";
      checks.push({
        id: "claude_cli",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: `claude CLI: ${versionLine}`,
      });

      const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", stdio: "pipe" });
      if (auth.status !== 0) {
        checks.push({
          id: "claude_auth",
          reason_code: REASON_CODES.CLAUDE_AUTH,
          status: "fail",
          message: "claude auth status failed — run: claude auth login",
        });
      } else {
        checks.push({
          id: "claude_auth",
          reason_code: REASON_CODES.OK,
          status: "pass",
          message: "claude auth status ok",
        });
      }
    }
  } else {
    checks.push({
      id: "claude_cli",
      reason_code: REASON_CODES.OK,
      status: "warn",
      message: "claude CLI not checked (pass --live for worker-agent preflight)",
    });
  }

  if (options.runTest) {
    const npmTest = spawnSync("npm", ["test"], { cwd: orchDir, encoding: "utf8", stdio: "pipe" });
    if (npmTest.status !== 0) {
      checks.push({
        id: "npm_test",
        reason_code: REASON_CODES.NPM_TEST,
        status: "fail",
        message: "npm test failed in orchestrator/",
      });
    } else {
      checks.push({
        id: "npm_test",
        reason_code: REASON_CODES.OK,
        status: "pass",
        message: "npm test passed in orchestrator/",
      });
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks, traces_dir: tracesDir };
}

/**
 * @param {Awaited<ReturnType<typeof runBootstrapPreflight>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = ["ai-minions bootstrap-preflight", `  traces_dir: ${report.traces_dir}`, `  ok: ${report.ok}`];
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    install: argv.includes("--install"),
    test: argv.includes("--test"),
    live: argv.includes("--live"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: node scripts/bootstrap-preflight.mjs [options]

Options:
  --install   Run npm ci when orchestrator/node_modules is missing
  --test      Run npm test after bootstrap checks (slow)
  --live      Require claude CLI + auth (live orchestration path)
  --json      Machine-readable report on stdout
  -h, --help  Show this help

Exit codes: 0 = pass, 1 = blocker(s)
`);
    process.exit(0);
  }

  const report = await runBootstrapPreflight({
    install: args.install,
    runTest: args.test,
    live: args.live,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  if (!report.ok) {
    const blockers = report.checks.filter((c) => c.status === "fail");
    for (const b of blockers) {
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
