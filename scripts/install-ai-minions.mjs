#!/usr/bin/env node
/**
 * Repo install entrypoint — host prereqs, model discovery, and config write (current installer flow).
 * Fail-closed with stable INSTALL_* reason codes — no secrets in output.
 *
 * Host phase: Node, ruff, uv, npm ci.
 * Discovery phase: Ollama via discoverLocalModels() + local backend adapter contract.
 * Config-write phase: .ai-minions/model-policy.yaml + model_policy.json + install-profile.json.
 * No remote token handling (later installer phases).
 *
 * Usage:
 *   node scripts/install-ai-minions.mjs [--json] [--install] [--model-policy local_only|remote_ok]
 *   ./install.sh [same options]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const ORCHESTRATOR_DIR = path.join(REPO_ROOT, "orchestrator");

export const REASON_CODES = {
  OK: "INSTALL_OK",
  NODE_MISSING: "INSTALL_NODE_MISSING",
  NPM_CI_FAILED: "INSTALL_NPM_CI_FAILED",
  RUFF_MISSING: "INSTALL_RUFF_MISSING",
  UV_MISSING: "INSTALL_UV_MISSING",
  OLLAMA_UNREACHABLE: "INSTALL_OLLAMA_UNREACHABLE",
  LOCAL_MODELS_EMPTY: "INSTALL_LOCAL_MODELS_EMPTY",
  MODEL_DISCOVERY_DENIED: "INSTALL_MODEL_DISCOVERY_DENIED",
  MODEL_POLICY_WRITE_FAILED: "INSTALL_MODEL_POLICY_WRITE_FAILED",
  ROLE_MODEL_CONFIG_WRITTEN: "INSTALL_ROLE_MODEL_CONFIG_WRITTEN",
  ROLE_MODEL_DEGRADED_SINGLE_MODEL: "INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL",
};

export const MIN_NODE_MAJOR = 18;
export const MODEL_POLICIES = new Set(["local_only", "remote_ok"]);
export const MODEL_POLICY_MODE = "declarative";

/** @typedef {'pass' | 'fail' | 'warn'} CheckStatus */
/** @typedef {{ id: string, reason_code: string, status: CheckStatus, message: string }} CheckResult */

/**
 * @returns {typeof import('../orchestrator/local-model-discovery.js').discoverLocalModels}
 */
function defaultDiscoverLocalModels() {
  const require = createRequire(import.meta.url);
  const { discoverLocalModels } = require(path.join(ORCHESTRATOR_DIR, "local-model-discovery.js"));
  return discoverLocalModels;
}

/**
 * @returns {typeof import('../orchestrator/local-backend-adapter.js').normalizeInstallDiscovery}
 */
function defaultNormalizeInstallDiscovery() {
  const require = createRequire(import.meta.url);
  const { normalizeInstallDiscovery } = require(path.join(ORCHESTRATOR_DIR, "local-backend-adapter.js"));
  return normalizeInstallDiscovery;
}

/**
 * @returns {typeof import('../orchestrator/install-model-config.js').writeInstallModelConfig}
 */
function defaultWriteInstallModelConfig() {
  const require = createRequire(import.meta.url);
  const { writeInstallModelConfig } = require(path.join(ORCHESTRATOR_DIR, "install-model-config.js"));
  return writeInstallModelConfig;
}

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
 * @param {import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult} rawDiscovery
 * @param {'local_only' | 'remote_ok' | null} modelPolicy
 * @returns {CheckResult[]}
 */
export function buildDiscoveryChecks(rawDiscovery, modelPolicy) {
  /** @type {CheckResult[]} */
  const checks = [];
  const missing = rawDiscovery.missing_local_backend ?? "";
  const backend = rawDiscovery.backends?.[0];
  const modelCount = rawDiscovery.models?.length ?? 0;

  if (missing.includes("network egress denied") || backend?.reason === "network_denied") {
    checks.push({
      id: "model_discovery",
      reason_code: REASON_CODES.MODEL_DISCOVERY_DENIED,
      status: "fail",
      message: "local model discovery denied by network permission gate",
    });
    return checks;
  }

  if (missing || !backend?.available) {
    const severity = modelPolicy === "remote_ok" ? "warn" : "fail";
    checks.push({
      id: "ollama_reachable",
      reason_code: REASON_CODES.OLLAMA_UNREACHABLE,
      status: severity,
      message: missing || backend?.reason || "ollama unreachable",
    });
    return checks;
  }

  if (modelCount === 0) {
    const severity = modelPolicy === "remote_ok" ? "warn" : "fail";
    checks.push({
      id: "local_models",
      reason_code: REASON_CODES.LOCAL_MODELS_EMPTY,
      status: severity,
      message: "ollama reachable but no local models installed",
    });
    return checks;
  }

  checks.push({
    id: "model_discovery",
    reason_code: REASON_CODES.OK,
    status: "pass",
    message: `discovered ${modelCount} local model(s) via ollama`,
  });
  return checks;
}

/**
 * @param {{
 *   files_written: string[],
 *   degraded_single_model: boolean,
 * }} writeResult
 * @returns {CheckResult[]}
 */
export function buildConfigWriteChecks(writeResult) {
  /** @type {CheckResult[]} */
  const checks = [
    {
      id: "config_write",
      reason_code: REASON_CODES.ROLE_MODEL_CONFIG_WRITTEN,
      status: "pass",
      message: `wrote ${writeResult.files_written.join(", ")} under .ai-minions/`,
    },
  ];
  if (writeResult.degraded_single_model) {
    checks.push({
      id: "role_model_tier",
      reason_code: REASON_CODES.ROLE_MODEL_DEGRADED_SINGLE_MODEL,
      status: "warn",
      message: "single discovered model — all tiers map to the same model",
    });
  }
  return checks;
}

/**
 * @param {CheckResult[]} checks
 * @returns {boolean}
 */
export function checksOk(checks) {
  return checks.every((check) => check.status !== "fail");
}

/**
 * @param {string} repoRoot
 * @param {string} orchDir
 * @param {{
 *   install?: boolean,
 *   nodeVersion?: string,
 *   commandExists?: (cmd: string) => boolean,
 *   runNpmCi?: (orchDir: string) => { status: number },
 * }} options
 * @returns {Promise<{ checks: CheckResult[], hostOk: boolean }>}
 */
export async function runHostPrereqChecks(repoRoot, orchDir, options = {}) {
  const commandExists = options.commandExists ?? defaultCommandExists;
  const runNpmCi = options.runNpmCi ?? defaultRunNpmCi;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
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
    return { checks, hostOk: false };
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

  return { checks, hostOk: checksOk(checks) };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   install?: boolean,
 *   modelPolicy?: string | null,
 *   nodeVersion?: string,
 *   commandExists?: (cmd: string) => boolean,
 *   runNpmCi?: (orchDir: string) => { status: number },
 *   discoverLocalModels?: (options?: object) => Promise<import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult>,
 *   normalizeInstallDiscovery?: (result: import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult) => object,
 *   writeInstallModelConfig?: typeof import('../orchestrator/install-model-config.js').writeInstallModelConfig,
 *   configWriteOptions?: object,
 * }} [options]
 */
export async function runInstallAiMinions(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const orchDir = path.join(repoRoot, "orchestrator");
  const modelPolicy = normalizeModelPolicy(options.modelPolicy);

  const { checks: hostChecks, hostOk } = await runHostPrereqChecks(repoRoot, orchDir, options);
  if (!hostOk) {
    return {
      ok: false,
      phase: "host_prereqs",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: hostChecks,
      discovery: null,
    };
  }

  const discoverLocalModels =
    options.discoverLocalModels ?? defaultDiscoverLocalModels();
  const normalizeInstallDiscovery =
    options.normalizeInstallDiscovery ?? defaultNormalizeInstallDiscovery();

  const rawDiscovery = await discoverLocalModels({ cwd: repoRoot });
  const discovery = normalizeInstallDiscovery(rawDiscovery);
  const discoveryChecks = buildDiscoveryChecks(rawDiscovery, modelPolicy);
  const checks = [...hostChecks, ...discoveryChecks];
  const discoveryOk = checksOk(checks);
  const modelCount = discovery.models?.length ?? 0;

  /** @type {Record<string, unknown> | null} */
  let configWrite = null;

  if (!discoveryOk || modelCount === 0) {
    return {
      ok: discoveryOk,
      phase: "model_discovery",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks,
      discovery,
      config_write: null,
      inference_profiles_written: false,
      inference_profile_mode: null,
    };
  }

  const writeInstallModelConfig =
    options.writeInstallModelConfig ?? defaultWriteInstallModelConfig();

  try {
    const writeResult = writeInstallModelConfig(repoRoot, discovery, modelPolicy, options.configWriteOptions);
    const configChecks = buildConfigWriteChecks(writeResult);
    const allChecks = [...checks, ...configChecks];
    configWrite = writeResult;

    return {
      ok: checksOk(allChecks),
      phase: "config_write",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: allChecks,
      discovery,
      config_write: configWrite,
      inference_profiles_written: writeResult.inference_profiles_written,
      inference_profile_mode: writeResult.inference_profile_mode,
      default_model: writeResult.default_model,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failChecks = [
      ...checks,
      {
        id: "config_write",
        reason_code: REASON_CODES.MODEL_POLICY_WRITE_FAILED,
        status: /** @type {CheckStatus} */ ("fail"),
        message,
      },
    ];
    return {
      ok: false,
      phase: "config_write",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: failChecks,
      discovery,
      config_write: null,
      inference_profiles_written: false,
      inference_profile_mode: null,
    };
  }
}

/**
 * @param {Awaited<ReturnType<typeof runInstallAiMinions>>} report
 * @returns {string}
 */
export function formatReportText(report) {
  const phaseLabels = {
    host_prereqs: "host prereqs",
    model_discovery: "model discovery",
    config_write: "config write",
  };
  const phaseLabel = phaseLabels[report.phase] ?? report.phase;
  const lines = [
    `ai-minions install (${phaseLabel})`,
    `  phase: ${report.phase}`,
    `  repo_root: ${report.repo_root}`,
    `  model_policy: ${report.model_policy ?? "(not set)"}`,
    `  model_policy_mode: ${report.model_policy_mode} (declarative intent — discovery enforcement active for local inventory)`,
    `  ok: ${report.ok}`,
  ];

  if (report.default_model) {
    lines.push(`  default_model: ${report.default_model}`);
  }
  if (report.inference_profile_mode) {
    lines.push(`  inference_profile_mode: ${report.inference_profile_mode}`);
    lines.push(`  inference_profiles_written: ${report.inference_profiles_written}`);
  }

  if (report.discovery) {
    for (const backend of report.discovery.backends) {
      lines.push(
        `  backend: ${backend.backend_id} support_status=${backend.support_status} available=${backend.available} ${backend.host}:${backend.port}`,
      );
    }
    if (report.discovery.models.length > 0) {
      lines.push(`  models: ${report.discovery.models.map((m) => m.name).join(", ")}`);
    }
  }

  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    lines.push(`  [${tag}] ${c.reason_code} — ${c.message}`);
  }
  return lines.join("\n");
}

/**
 * @param {string[]} argv
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
  --model-policy <mode>  local_only | remote_ok
                         local_only: fail when Ollama unreachable or no local models
                         remote_ok: warn when local inventory missing (not remote provider setup)
  --json                 Machine-readable report on stdout
  -h, --help             Show this help

Phases: host prereqs → model discovery (Ollama) → config write (.ai-minions/).

Install reason codes include INSTALL_OLLAMA_UNREACHABLE, INSTALL_LOCAL_MODELS_EMPTY,
INSTALL_MODEL_DISCOVERY_DENIED during discovery; INSTALL_ROLE_MODEL_CONFIG_WRITTEN,
INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL, INSTALL_MODEL_POLICY_WRITE_FAILED during config write.

Config write requires discovered local models. No remote token handling · no additional local backends in this release.
See docs/how-to/install-ollama-docker-paths.md for Mac/Docker Ollama reachability.
See docs/orchestrator/model-config-ownership.md for YAML vs JSON ownership.
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
