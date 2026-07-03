/**
 * Path-independent ai-minions CLI install — local shim + home config (E20-1).
 * No shell rc mutation · no secrets in output · realpath validation on CLI entry.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_INSTALL_REASON_CODES = {
  OK: "INSTALL_CLI_OK",
  PATH_NOT_ON_PATH: "INSTALL_PATH_NOT_ON_PATH",
  BIN_WRITE_FAILED: "INSTALL_PATH_BIN_WRITE_FAILED",
  CONFIG_WRITE_FAILED: "INSTALL_HOME_CONFIG_WRITE_FAILED",
  REPO_LAYOUT_INVALID: "INSTALL_REPO_LAYOUT_INVALID",
  SHIM_VALIDATION_FAILED: "INSTALL_CLI_SHIM_VALIDATION_FAILED",
};

/** Relative path from repo root to product CLI entry (validated at install time). */
export const CLI_ENTRY_REL = path.join("orchestrator", "ai-minions-cli.js");

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
export function defaultBinDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".local", "bin");
}

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
export function defaultConfigDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "ai-minions");
}

/**
 * @param {string | undefined | null} pathEnv
 * @param {string} dir
 * @returns {boolean}
 */
export function pathIncludesDir(pathEnv, dir) {
  const target = path.resolve(dir);
  const parts = String(pathEnv ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  let targetReal;
  try {
    targetReal = fs.realpathSync(target);
  } catch {
    targetReal = target;
  }
  for (const part of parts) {
    try {
      if (fs.realpathSync(path.resolve(part)) === targetReal) {
        return true;
      }
    } catch {
      if (path.resolve(part) === target) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Self-contained shim installed onto PATH. Reads repo root from AI_MINIONS_HOME or config file.
 * @returns {string}
 */
export function buildShimSource() {
  return `#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILE = path.join(process.env.HOME || os.homedir(), '.config', 'ai-minions', 'home');
const CLI_REL = ${JSON.stringify(CLI_ENTRY_REL.split(path.sep).join("/"))};

function readConfiguredHome() {
  if (process.env.AI_MINIONS_HOME && String(process.env.AI_MINIONS_HOME).trim()) {
    return path.resolve(String(process.env.AI_MINIONS_HOME).trim());
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').trim();
    if (raw) {
      return path.resolve(raw);
    }
  } catch (_) {
    // fall through
  }
  return null;
}

function fail(reasonCode, message) {
  process.stderr.write(\`blocker: \${reasonCode}\\n\${message}\\n\`);
  process.exit(1);
}

const repoRoot = readConfiguredHome();
if (!repoRoot) {
  fail(
    'INSTALL_HOME_UNSET',
    'AI_MINIONS_HOME unset and ~/.config/ai-minions/home missing — re-run: node scripts/install-ai-minions.mjs',
  );
}

const cliPath = path.join(repoRoot, ...CLI_REL.split('/'));
let realCli;
try {
  realCli = fs.realpathSync(cliPath);
} catch {
  fail('INSTALL_REPO_LAYOUT_INVALID', \`missing product CLI at \${cliPath}\`);
}

let realRepo;
try {
  realRepo = fs.realpathSync(repoRoot);
} catch {
  fail('INSTALL_REPO_LAYOUT_INVALID', \`invalid AI_MINIONS_HOME: \${repoRoot}\`);
}

if (!realCli.startsWith(realRepo + path.sep) && realCli !== realRepo) {
  fail('INSTALL_CLI_SHIM_VALIDATION_FAILED', 'product CLI path escapes AI_MINIONS_HOME');
}

const env = {
  ...process.env,
  AI_MINIONS_HOME: realRepo,
  REPO_ROOT: realRepo,
};

const result = spawnSync(process.execPath, [realCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: realRepo,
  env,
});

if (result.error) {
  fail('INSTALL_CLI_DISPATCH_FAILED', result.error.message);
}

process.exit(result.status == null ? 1 : result.status);
`;
}

/**
 * @param {import('../install-ai-minions.mjs').CheckResult[]} checks
 * @returns {boolean}
 */
export function cliChecksOk(checks) {
  return checks.every((check) => check.status !== "fail");
}

/**
 * @param {string} repoRoot
 * @returns {{ ok: boolean, realCliPath?: string, message?: string, reason_code?: string }}
 */
export function validateCliEntry(repoRoot) {
  const cliPath = path.join(repoRoot, CLI_ENTRY_REL);
  if (!fs.existsSync(cliPath)) {
    return {
      ok: false,
      reason_code: CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID,
      message: `missing ${CLI_ENTRY_REL} under ${repoRoot}`,
    };
  }

  let realCliPath;
  let realRepoRoot;
  try {
    realCliPath = fs.realpathSync(cliPath);
    realRepoRoot = fs.realpathSync(repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason_code: CLI_INSTALL_REASON_CODES.SHIM_VALIDATION_FAILED,
      message,
    };
  }

  if (!realCliPath.startsWith(`${realRepoRoot}${path.sep}`)) {
    return {
      ok: false,
      reason_code: CLI_INSTALL_REASON_CODES.SHIM_VALIDATION_FAILED,
      message: "product CLI realpath escapes repo root",
    };
  }

  return { ok: true, realCliPath };
}

/**
 * @param {{
 *   repoRoot: string,
 *   homeDir?: string,
 *   binDir?: string,
 *   configDir?: string,
 *   pathEnv?: string,
 *   shimName?: string,
 *   fsImpl?: typeof fs,
 * }} options
 */
export async function runCliInstall(options) {
  const fsImpl = options.fsImpl ?? fs;
  const repoRoot = path.resolve(options.repoRoot);
  const homeDir = options.homeDir ?? os.homedir();
  const binDir = options.binDir ?? defaultBinDir(homeDir);
  const configDir = options.configDir ?? defaultConfigDir(homeDir);
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const shimName = options.shimName ?? "ai-minions";

  /** @type {import('../install-ai-minions.mjs').CheckResult[]} */
  const checks = [];

  const layout = validateCliEntry(repoRoot);
  if (!layout.ok) {
    checks.push({
      id: "repo_layout",
      reason_code: layout.reason_code ?? CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID,
      status: "fail",
      message: layout.message ?? "invalid repo layout",
    });
    return {
      ok: false,
      phase: "cli_install",
      repo_root: repoRoot,
      bin_dir: binDir,
      config_dir: configDir,
      checks,
    };
  }

  checks.push({
    id: "repo_layout",
    reason_code: CLI_INSTALL_REASON_CODES.OK,
    status: "pass",
    message: `validated ${CLI_ENTRY_REL} via realpath`,
  });

  const configFile = path.join(configDir, "home");
  try {
    fsImpl.mkdirSync(configDir, { recursive: true });
    fsImpl.writeFileSync(configFile, `${repoRoot}\n`, { encoding: "utf8", mode: 0o644 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      id: "home_config",
      reason_code: CLI_INSTALL_REASON_CODES.CONFIG_WRITE_FAILED,
      status: "fail",
      message: `failed to write ${configFile}: ${message}`,
    });
    return {
      ok: false,
      phase: "cli_install",
      repo_root: repoRoot,
      bin_dir: binDir,
      config_dir: configDir,
      config_path: configFile,
      checks,
    };
  }

  checks.push({
    id: "home_config",
    reason_code: CLI_INSTALL_REASON_CODES.OK,
    status: "pass",
    message: `wrote ${configFile}`,
  });

  const shimPath = path.join(binDir, shimName);
  try {
    fsImpl.mkdirSync(binDir, { recursive: true });
    fsImpl.writeFileSync(shimPath, buildShimSource(), { encoding: "utf8", mode: 0o755 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      id: "cli_shim",
      reason_code: CLI_INSTALL_REASON_CODES.BIN_WRITE_FAILED,
      status: "fail",
      message: `failed to write ${shimPath}: ${message}`,
    });
    return {
      ok: false,
      phase: "cli_install",
      repo_root: repoRoot,
      bin_dir: binDir,
      config_dir: configDir,
      config_path: configFile,
      shim_path: shimPath,
      checks,
    };
  }

  checks.push({
    id: "cli_shim",
    reason_code: CLI_INSTALL_REASON_CODES.OK,
    status: "pass",
    message: `installed ${shimPath}`,
  });

  const onPath = pathIncludesDir(pathEnv, binDir);
  /** @type {string | null} */
  let pathRemediation = null;
  if (!onPath) {
    pathRemediation = `export PATH="${binDir}:\$PATH"`;
    checks.push({
      id: "path",
      reason_code: CLI_INSTALL_REASON_CODES.PATH_NOT_ON_PATH,
      status: "fail",
      message: `${binDir} is not on PATH — ${pathRemediation}`,
    });
  } else {
    checks.push({
      id: "path",
      reason_code: CLI_INSTALL_REASON_CODES.OK,
      status: "pass",
      message: `${binDir} is on PATH`,
    });
  }

  return {
    ok: cliChecksOk(checks),
    phase: "cli_install",
    repo_root: repoRoot,
    bin_dir: binDir,
    config_dir: configDir,
    config_path: configFile,
    shim_path: shimPath,
    cli_entry: layout.realCliPath,
    path_remediation: pathRemediation,
    checks,
  };
}

/**
 * Product install succeeds when host prereqs + CLI shim checks pass.
 * Model discovery failures do not block CLI availability.
 * @param {{
 *   checks: import('../install-ai-minions.mjs').CheckResult[],
 *   cli_install?: Awaited<ReturnType<typeof runCliInstall>> | null,
 * }} report
 * @returns {boolean}
 */
export function productCliInstallOk(report) {
  const hostIds = new Set(["repo_layout", "node_version", "ruff", "uv", "npm_ci"]);
  const hostOk = (report.checks ?? []).filter((c) => hostIds.has(c.id)).every((c) => c.status !== "fail");
  if (!hostOk) {
    return false;
  }
  return report.cli_install?.ok === true;
}

const isSelfTest =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isSelfTest) {
  process.stdout.write(`${buildShimSource().length} bytes shim template\n`);
}
