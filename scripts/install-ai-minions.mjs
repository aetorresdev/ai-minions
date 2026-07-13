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
 *   node scripts/install-ai-minions.mjs [--skip-cli] [--no-install]   # bootstrap-only (repo-local setup)
 *   ./install.sh [same options]
 *
 * Product install (default): writes ~/.local/bin/ai-minions shim + ~/.config/ai-minions/home.
 * Requires bin dir on PATH or exits blocked with INSTALL_PATH_NOT_ON_PATH remediation.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  CLI_INSTALL_REASON_CODES,
  productCliInstallOk,
  runCliInstall,
} from "./lib/ai-minions-cli-install.mjs";
import {
  ansi,
  formatStatusTag,
  shouldUseAnsiStdout,
} from "./lib/terminal-style.mjs";

export { CLI_INSTALL_REASON_CODES, productCliInstallOk, runCliInstall };

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
 * @returns {typeof import('../orchestrator/local-runtime-endpoint.js').resolveLocalRuntimeEndpoint}
 */
function defaultResolveLocalRuntimeEndpoint() {
  const require = createRequire(import.meta.url);
  const { resolveLocalRuntimeEndpoint } = require(path.join(ORCHESTRATOR_DIR, "local-runtime-endpoint.js"));
  return resolveLocalRuntimeEndpoint;
}

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
      message:
        (missing || backend?.reason || "ollama unreachable")
        + " — start Ollama (app or: ollama serve), pull a model, then re-run install",
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
      message:
        "ruff not found in PATH — install: brew install ruff  (required for orchestrator npm test / lint:py)",
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
      message:
        "uv not found in PATH — install: brew install uv  (required for MCP venv sync; see docs/mcp-installation.md)",
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
 *   resolveLocalRuntimeEndpoint?: typeof import('../orchestrator/local-runtime-endpoint.js').resolveLocalRuntimeEndpoint,
 *   normalizeInstallDiscovery?: (result: import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult) => object,
 *   writeInstallModelConfig?: typeof import('../orchestrator/install-model-config.js').writeInstallModelConfig,
 *   configWriteOptions?: object,
 *   cliInstall?: boolean,
 *   cliInstallOptions?: object,
 *   localProvider?: string | null,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   model?: string | null,
 *   migrateModelPolicy?: boolean,
 *   force?: boolean,
 * }} [options]
 */
export async function runInstallAiMinions(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const orchDir = path.join(repoRoot, "orchestrator");
  const modelPolicy = normalizeModelPolicy(options.modelPolicy);

  if (options.localProvider != null && String(options.localProvider).trim().toLowerCase() !== "ollama") {
    return attachProductFields({
      ok: false,
      phase: "host_prereqs",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: [{
        id: "local_provider",
        reason_code: REASON_CODES.MODEL_POLICY_WRITE_FAILED,
        status: "fail",
        message: `unsupported --local-provider: ${String(options.localProvider).trim()} (only ollama is supported)`,
      }],
      discovery: null,
    }, null);
  }

  const { checks: hostChecks, hostOk } = await runHostPrereqChecks(repoRoot, orchDir, options);

  /** @type {Awaited<ReturnType<typeof runCliInstall>> | null} */
  let cliInstall = null;
  if (options.cliInstall !== false && hostOk) {
    cliInstall = await runCliInstall({
      repoRoot,
      ...(options.cliInstallOptions ?? {}),
    });
  }

  if (!hostOk) {
    return attachProductFields({
      ok: false,
      phase: "host_prereqs",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: hostChecks,
      discovery: null,
    }, cliInstall);
  }

  const discoverLocalModels =
    options.discoverLocalModels ?? defaultDiscoverLocalModels();
  const normalizeInstallDiscovery =
    options.normalizeInstallDiscovery ?? defaultNormalizeInstallDiscovery();
  const resolveLocalRuntimeEndpoint =
    options.resolveLocalRuntimeEndpoint ?? defaultResolveLocalRuntimeEndpoint();

  /** @type {import('../orchestrator/local-runtime-endpoint.js').resolveLocalRuntimeEndpoint extends (...args: infer A) => infer R ? R : never} */
  let resolvedEndpoint;
  try {
    resolvedEndpoint = resolveLocalRuntimeEndpoint({
      cwd: repoRoot,
      ollamaHost: options.ollamaHost,
      ollamaPort: options.ollamaPort,
      ollamaBaseUrl: options.ollamaBaseUrl,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime === true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return attachProductFields({
      ok: false,
      phase: "model_discovery",
      model_policy: modelPolicy,
      model_policy_mode: MODEL_POLICY_MODE,
      repo_root: repoRoot,
      checks: [
        ...hostChecks,
        {
          id: "ollama_endpoint",
          reason_code: REASON_CODES.OLLAMA_UNREACHABLE,
          status: "fail",
          message,
        },
      ],
      discovery: null,
    }, cliInstall);
  }

  const rawDiscovery = await discoverLocalModels({
    cwd: repoRoot,
    host: resolvedEndpoint.host,
    port: resolvedEndpoint.port,
  });
  if (rawDiscovery.backends?.[0]) {
    rawDiscovery.backends[0].base_url = resolvedEndpoint.base_url;
    rawDiscovery.backends[0].endpoint_scope = resolvedEndpoint.endpoint_scope;
  }
  const discovery = normalizeInstallDiscovery(rawDiscovery);
  const discoveryChecks = buildDiscoveryChecks(rawDiscovery, modelPolicy);
  const checks = [...hostChecks, ...discoveryChecks];
  const discoveryOk = checksOk(checks);
  const modelCount = discovery.models?.length ?? 0;

  /** @type {Record<string, unknown> | null} */
  let configWrite = null;

  if (!discoveryOk || modelCount === 0) {
    return attachProductFields({
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
    }, cliInstall);
  }

  const writeInstallModelConfig =
    options.writeInstallModelConfig ?? defaultWriteInstallModelConfig();

  try {
    const writeResult = writeInstallModelConfig(repoRoot, discovery, modelPolicy, {
      ...(options.configWriteOptions ?? {}),
      defaultModelOverride: options.model ?? null,
      migrateModelPolicy: options.migrateModelPolicy === true,
      force: options.force === true,
    });
    const configChecks = buildConfigWriteChecks(writeResult);
    const allChecks = [...checks, ...configChecks];
    configWrite = writeResult;

    return attachProductFields({
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
    }, cliInstall);
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
    return attachProductFields({
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
    }, cliInstall);
  }
}

/**
 * @param {Record<string, unknown>} report
 * @param {Awaited<ReturnType<typeof runCliInstall>> | null} cliInstall
 */
function attachProductFields(report, cliInstall) {
  const withCli = { ...report, cli_install: cliInstall ?? null };
  return {
    ...withCli,
    product_cli_ok: productCliInstallOk(withCli),
  };
}

/**
 * @param {Awaited<ReturnType<typeof runInstallAiMinions>>} report
 * @returns {string}
 */
export function deriveInstallNextSafeAction(report) {
  if (report.ok && report.phase === "config_write") {
    return "Run: ai-minions --help from outside orchestrator/ (product install complete)";
  }

  const fails = report.checks.filter((c) => c.status === "fail");
  const codes = new Set(fails.map((f) => f.reason_code));

  if (report.phase === "host_prereqs") {
    if (codes.has(REASON_CODES.RUFF_MISSING) || codes.has(REASON_CODES.UV_MISSING)) {
      return "Install host tools: brew install ruff uv — then re-run: node scripts/install-ai-minions.mjs";
    }
    if (codes.has(REASON_CODES.NODE_MISSING)) {
      return "Install Node.js 18+, then re-run: node scripts/install-ai-minions.mjs";
    }
    if (codes.has(REASON_CODES.NPM_CI_FAILED)) {
      return "Run: cd orchestrator && npm ci  (or re-run install with --install)";
    }
    return "Fix host prerequisites above, then re-run: node scripts/install-ai-minions.mjs";
  }

  if (report.phase === "model_discovery") {
    if (codes.has(REASON_CODES.OLLAMA_UNREACHABLE)) {
      return "Start Ollama (open app or: ollama serve), pull a model (ollama pull <name>), then re-run install";
    }
    if (codes.has(REASON_CODES.LOCAL_MODELS_EMPTY)) {
      return "Pull a local model: ollama pull qwen2.5-coder:7b — then re-run install";
    }
    return "Fix model discovery blockers, then re-run: node scripts/install-ai-minions.mjs";
  }

  return "Review blockers above, then re-run: node scripts/install-ai-minions.mjs";
}

/**
 * @param {Awaited<ReturnType<typeof runInstallAiMinions>>} report
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
export function formatReportText(report, options = {}) {
  const useColor = options.useColor ?? shouldUseAnsiStdout();
  const phaseLabels = {
    host_prereqs: "host prereqs",
    model_discovery: "model discovery",
    config_write: "config write",
  };
  const phaseLabel = phaseLabels[report.phase] ?? report.phase;
  /** @type {string[]} */
  const lines = [];

  const checkFails = report.checks.filter((c) => c.status === "fail").length;
  const cliFails = (report.cli_install?.checks ?? []).filter((c) => c.status === "fail").length;
  const totalFails = checkFails + cliFails;
  const productOk = report.product_cli_ok === true;

  if (!productOk && totalFails > 0) {
    lines.push(ansi(useColor, "1;31", `✗ INSTALL BLOCKED — ${totalFails} blocker(s)`));
  } else if (report.ok && productOk) {
    lines.push(ansi(useColor, "1;32", "✓ install complete"));
  }

  lines.push(
    `ai-minions install (${phaseLabel})`,
    `  phase: ${report.phase}`,
    `  repo_root: ${report.repo_root}`,
    `  model_policy: ${report.model_policy ?? "(not set)"}`,
    `  model_policy_mode: ${report.model_policy_mode} (declarative intent — discovery enforcement active for local inventory)`,
    `  ok: ${ansi(useColor, report.ok ? "32" : "1;31", String(report.ok))}`,
    `  product_cli_ok: ${ansi(useColor, productOk ? "32" : "1;31", String(productOk))}`,
  );

  if (report.cli_install) {
    lines.push(`  cli_install.phase: ${report.cli_install.phase}`);
    lines.push(`  cli_install.shim_path: ${report.cli_install.shim_path ?? "(none)"}`);
    lines.push(`  cli_install.config_path: ${report.cli_install.config_path ?? "(none)"}`);
    if (report.cli_install.path_remediation) {
      lines.push(`  path_remediation: ${report.cli_install.path_remediation}`);
    }
    for (const c of report.cli_install.checks ?? []) {
      const tag = formatStatusTag(c.status, useColor).replace("[", "[CLI ");
      lines.push(`  ${tag} ${c.reason_code} — ${c.message}`);
    }
  }

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
    const tag = formatStatusTag(c.status, useColor);
    lines.push(`  ${tag} ${c.reason_code} — ${c.message}`);
  }

  if (!productOk) {
    lines.push(`  next_safe_action: ${deriveInstallNextSafeAction(report)}`);
  }

  return lines.join("\n");
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let modelPolicyRaw = null;
  /** @type {string | null} */
  let binDir = null;
  /** @type {string | null} */
  let localProvider = null;
  /** @type {string | null} */
  let ollamaHost = null;
  /** @type {string | null} */
  let ollamaPort = null;
  /** @type {string | null} */
  let ollamaBaseUrl = null;
  /** @type {string | null} */
  let model = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model-policy" && argv[i + 1]) {
      modelPolicyRaw = argv[i + 1];
      i += 1;
    } else if (arg === "--bin-dir" && argv[i + 1]) {
      binDir = argv[i + 1];
      i += 1;
    } else if (arg === "--local-provider" && argv[i + 1]) {
      localProvider = argv[i + 1];
      i += 1;
    } else if (arg === "--ollama-host" && argv[i + 1]) {
      ollamaHost = argv[i + 1];
      i += 1;
    } else if (arg === "--ollama-port" && argv[i + 1]) {
      ollamaPort = argv[i + 1];
      i += 1;
    } else if (arg === "--ollama-base-url" && argv[i + 1]) {
      ollamaBaseUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--model" && argv[i + 1]) {
      model = argv[i + 1];
      i += 1;
    }
  }
  const modelPolicy = modelPolicyRaw == null ? null : normalizeModelPolicy(modelPolicyRaw);
  return {
    json: argv.includes("--json"),
    install: argv.includes("--install"),
    noInstall: argv.includes("--no-install"),
    skipCli: argv.includes("--skip-cli"),
    allowPublicLocalRuntime: argv.includes("--allow-public-local-runtime"),
    migrateModelPolicy: argv.includes("--migrate-model-policy"),
    force: argv.includes("--force"),
    help: argv.includes("-h") || argv.includes("--help"),
    modelPolicy,
    modelPolicyRaw,
    binDir,
    localProvider,
    ollamaHost,
    ollamaPort,
    ollamaBaseUrl,
    model,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage:
  ./install.sh [options]
  node scripts/install-ai-minions.mjs [options]

Options:
  --install              Run npm ci when orchestrator/node_modules is missing (also default for product install)
  --no-install           Skip npm ci even when node_modules is missing
  --skip-cli             Repo-local bootstrap only — do not install ~/.local/bin/ai-minions shim
  --bin-dir <path>       Override CLI shim directory (default: ~/.local/bin)
  --model-policy <mode>  local_only | remote_ok
                         local_only: fail when Ollama unreachable or no local models
                         remote_ok: warn when local inventory missing (not remote provider setup)
  --migrate-model-policy Explicitly rewrite model_policy.json (never silent overwrite)
  --force                Does NOT rewrite model_policy.json without --migrate-model-policy
  --json                 Machine-readable report on stdout
  -h, --help             Show this help

Phases: host prereqs → CLI shim install (product) → model discovery (Ollama) → config write (.ai-minions/).

Product install writes ~/.config/ai-minions/home and ~/.local/bin/ai-minions (PATH required).
CLI reason codes include INSTALL_PATH_NOT_ON_PATH, INSTALL_PATH_BIN_WRITE_FAILED,
INSTALL_HOME_CONFIG_WRITE_FAILED, INSTALL_CLI_SHIM_VALIDATION_FAILED.

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
    install: args.noInstall ? false : true,
    cliInstall: !args.skipCli,
    cliInstallOptions: args.binDir ? { binDir: path.resolve(args.binDir) } : {},
    modelPolicy: args.modelPolicy,
    localProvider: args.localProvider,
    ollamaHost: args.ollamaHost,
    ollamaPort: args.ollamaPort,
    ollamaBaseUrl: args.ollamaBaseUrl,
    allowPublicLocalRuntime: args.allowPublicLocalRuntime,
    model: args.model,
    migrateModelPolicy: args.migrateModelPolicy,
    force: args.force,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }

  const exitOk = args.skipCli ? report.ok : report.product_cli_ok === true;

  if (!exitOk) {
    const useColor = shouldUseAnsiStdout();
    process.stderr.write(
      `${ansi(useColor, "1;31", "install failed")} — phase=${report.phase} exit=1\n`,
    );
    const blockers = report.checks.filter((c) => c.status === "fail");
    for (const b of blockers) {
      process.stderr.write(`${ansi(useColor, "1;31", "blocker:")} ${b.reason_code}\n`);
    }
    if (report.cli_install) {
      for (const b of report.cli_install.checks.filter((c) => c.status === "fail")) {
        process.stderr.write(`${ansi(useColor, "1;31", "blocker:")} ${b.reason_code}\n`);
      }
    }
    process.stderr.write(`next_safe_action: ${deriveInstallNextSafeAction(report)}\n`);
  }

  process.exit(exitOk ? 0 : 1);
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
