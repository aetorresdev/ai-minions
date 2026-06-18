#!/usr/bin/env node
/**
 * Repo install entrypoint — host/container prereqs (current installer phase).
 * Fail-closed with stable INSTALL_* reason codes — no secrets in output.
 *
 * Current installer phase: --model-policy is declarative only (recorded in install report as intent).
 * No discovery, no config writes, no remote token collect/validate/print (separate credential slice).
 * Later installer phase: discovery; local_only vs remote_ok enforcement for missing local models begins.
 * Later installer phase: writes .ai-minions model config from discovered capabilities.
 *
 * Usage:
 *   node scripts/install-ai-minions.mjs [--json] [--install] [--model-policy local_only|remote_ok]
 *   ./install.sh [same options]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const ORCHESTRATOR_DIR = path.join(REPO_ROOT, "orchestrator");

/** Host-prereq codes only in current installer phase — discovery/config codes ship in later installer phases. */
export const REASON_CODES = {
  OK: "INSTALL_OK",
  NODE_MISSING: "INSTALL_NODE_MISSING",
  NPM_CI_FAILED: "INSTALL_NPM_CI_FAILED",
  RUFF_MISSING: "INSTALL_RUFF_MISSING",
  UV_MISSING: "INSTALL_UV_MISSING",
};

export const MIN_NODE_MAJOR = 18;
export const MODEL_POLICIES = new Set(["local_only", "remote_ok"]);

/** Current installer phase: policy flag is recorded only — enforcement begins in later installer phases. */
export const MODEL_POLICY_MODE = "declarative";

/** @typedef {'pass' | 'fail'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string }} CheckResult */

/**
 * @param {string} cmd
 * @returns {boolean}
 */
export function defaultCommandExists(cmd) {
  const which = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return which.status === 0 && String(which.stdout || "").trim().length > 0;
}

/**
 * @param {string} orchDir
 * @returns {{ status: number }}
 */
export function defaultRunNpmCi(orchDir) {
  return spawnSync("npm", ["ci"], { cwd: orchDir, encoding: "utf8", stdio: "pipe" });
}

/**
 * @param {string} nodeVersion
 * @returns {number | null}
 */
export function parseNodeMajor(nodeVersion) {
  const major = Number.parseInt(String(nodeVersion).split(".")[0], 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {'local_only' | 'remote_ok' | null}
 */
export function normalizeModelPolicy(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  return MODEL_POLICIES.has(normalized) ? /** @type {'local_only' | 'remote_ok'} */ (normalized) : null;
}

/**
 * @param {{
 *   repoRoot?: string,
 *   install?: boolean,
 *   modelPolicy?: string | null,
 *   nodeVersion?: string,
 *   commandExists?: (cmd: string) => boolean,
 *   runNpmCi?: (orchDir: string) => { status: number },
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   phase: 'host_prereqs',
 *   model_policy: 'local_only' | 'remote_ok' | null,
 *   model_policy_mode: 'declarative',
 *   repo_root: string,
 *   checks: CheckResult[],
 * }>}
 */
export async function runInstallAiMinions(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const orchDir = path.join(repoRoot, "orchestrator");
  const commandExists = options.commandExists ?? defaultCommandExists;
  const runNpmCi = options.runNpmCi ?? defaultRunNpmCi;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const modelPolicy = normalizeModelPolicy(options.modelPolicy);
  /** @type {CheckResult[]} */
  const checks = [];

  const pkgPath = path.join(orchDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    checks.push({
      id: "repo_layout",
      reason_code: REASON_CODES.NPM_CI_FAILED,
      status: "fail",
      message: `missing ${path.relative(repoRoot, pkgPath)} — run from ai-minions clone root`,
    });
    return {
      ok: false,
      phase: "host_prereqs",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks,
    };
  }

  checks.push({
    id: "repo_layout",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: "orchestrator/package.json present",
  });

  const nodeMajor = parseNodeMajor(nodeVersion);
  if (nodeMajor == null || nodeMajor < MIN_NODE_MAJOR) {
    checks.push({
      id: "node_version",
      reason_code: REASON_CODES.NODE_MISSING,
      status: "fail",
      message: `Node.js >= ${MIN_NODE_MAJOR} required (got ${nodeVersion})`,
    });
  } else {
    checks.push({
      id: "node_version",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: `Node.js ${nodeVersion}`,
    });
  }

  if (commandExists("ruff")) {
    checks.push({
      id: "ruff",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "ruff CLI present",
    });
  } else {
    checks.push({
      id: "ruff",
      reason_code: REASON_CODES.RUFF_MISSING,
      status: "fail",
      message: "ruff not found in PATH — required for orchestrator npm test (lint:py)",
    });
  }

  if (commandExists("uv")) {
    checks.push({
      id: "uv",
      reason_code: REASON_CODES.OK,
      status: "pass",
      message: "uv CLI present",
    });
  } else {
    checks.push({
      id: "uv",
      reason_code: REASON_CODES.UV_MISSING,
      status: "fail",
      message: "uv not found in PATH — required for MCP server sync (see docs/mcp-installation.md)",
    });
  }

  const nodeModules = path.join(orchDir, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    if (options.install) {
      const npmCi = runNpmCi(orchDir);
      if (npmCi.status !== 0) {
        checks.push({
          id: "npm_ci",
          reason_code: REASON_CODES.NPM_CI_FAILED,
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
        reason_code: REASON_CODES.NPM_CI_FAILED,
        status: "fail",
        message:
          "orchestrator/node_modules missing — run with --install or: cd orchestrator && npm ci",
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

  const ok = checks.every((c) => c.status !== "fail");
  return {
    ok,
    phase: "host_prereqs",
    model_policy: modelPolicy,
    model_policy_mode: MODEL_POLICY_MODE,
    repo_root: repoRoot,
    checks,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runInstallAiMinions>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const lines = [
    "ai-minions install (host prereqs)",
    `  phase: ${report.phase}`,
    `  repo_root: ${report.repo_root}`,
    `  model_policy: ${report.model_policy ?? "(not set)"}`,
    `  model_policy_mode: ${report.model_policy_mode} (declarative intent in current installer phase — enforcement in later installer phases)`,
    `  ok: ${report.ok}`,
  ];
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : "FAIL";
    lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
  }
  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @returns {{
 *   json: boolean,
 *   install: boolean,
 *   help: boolean,
 *   modelPolicy: string | null,
 *   modelPolicyRaw: string | null,
 * }}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let modelPolicyRaw = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model-policy" && argv[i + 1]) {
      modelPolicyRaw = argv[i + 1];
      i += 1;
    }
  }
  const modelPolicy = modelPolicyRaw == null ? null : normalizeModelPolicy(modelPolicyRaw);
  return {
    json: argv.includes("--json"),
    install: argv.includes("--install"),
    help: argv.includes("-h") || argv.includes("--help"),
    modelPolicy,
    modelPolicyRaw,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage:
  ./install.sh [options]
  node scripts/install-ai-minions.mjs [options]

Options:
  --install              Run npm ci when orchestrator/node_modules is missing
  --model-policy <mode>  local_only | remote_ok — declarative intent only in current installer phase
                         (later phases: local_only fail / remote_ok warn when no local models;
                          remote_ok = do not block on missing local inventory — not remote provider setup)
  --json                 Machine-readable report on stdout
  -h, --help             Show this help

Exit codes: 0 = pass, 1 = blocker(s)

Current installer phase scope: host prereqs only (Node, ruff, uv, npm ci). No discovery · no .ai-minions writes ·
no remote token collect/validate/print. Model behavior enforcement ships in later installer phases.
`);
    process.exit(0);
  }

  if (args.modelPolicyRaw != null && args.modelPolicy == null) {
    process.stderr.write(
      `blocker: unknown --model-policy value (expected local_only or remote_ok)\n`,
    );
    process.exit(1);
  }

  const report = await runInstallAiMinions({
    install: args.install,
    modelPolicy: args.modelPolicy,
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
