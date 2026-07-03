/**
 * Installed CLI evidence helpers — Mac/Docker live rehearsal via PATH shim.
 * Proves product install + ai-minions dispatch from outside clone root.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultBinDir, defaultConfigDir, runCliInstall } from "./ai-minions-cli-install.mjs";

export const INSTALLED_CLI_REASON_CODES = {
  OK: "INSTALLED_CLI_EVIDENCE_OK",
  INSTALL: "INSTALLED_CLI_INSTALL_FAIL",
  PRODUCT_CLI: "INSTALLED_CLI_PRODUCT_FAIL",
  HELP: "INSTALLED_CLI_HELP_FAIL",
  DOCTOR: "INSTALLED_CLI_DOCTOR_FAIL",
  SKIPPED: "INSTALLED_CLI_SKIPPED",
};

/**
 * @param {string} shimPath
 * @param {string[]} args
 * @param {{ homeDir: string, binDir: string, cwd?: string }} options
 */
export function spawnInstalledShim(shimPath, args, options) {
  const env = {
    ...process.env,
    HOME: options.homeDir,
    PATH: `${options.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  delete env.AI_MINIONS_HOME;
  return spawnSync(shimPath, args, {
    encoding: "utf8",
    cwd: options.cwd ?? os.tmpdir(),
    env,
    stdio: "pipe",
  });
}

/**
 * @param {{
 *   repoRoot: string,
 *   homeDir?: string,
 *   binDir?: string,
 *   skipDoctor?: boolean,
 *   modelPolicy?: string,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   shim_path?: string,
 *   home_dir: string,
 *   bin_dir: string,
 *   steps: Array<{ id: string, reason_code: string, status: 'pass'|'fail'|'skip', message: string }>,
 * }>}
 */
export async function runInstalledCliEvidence(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const homeDir = options.homeDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "installed-cli-home-"));
  const binDir = options.binDir ?? defaultBinDir(homeDir);
  const configDir = defaultConfigDir(homeDir);
  /** @type {Array<{ id: string, reason_code: string, status: 'pass'|'fail'|'skip', message: string }>} */
  const steps = [];

  const installReport = await runCliInstall({
    repoRoot,
    homeDir,
    binDir,
    configDir,
    pathEnv: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  });

  if (installReport.ok !== true) {
    const blocker = installReport.checks?.find((c) => c.status === "fail");
    steps.push({
      id: "product_cli_install",
      reason_code: INSTALLED_CLI_REASON_CODES.PRODUCT_CLI,
      status: "fail",
      message: blocker?.message ?? "runCliInstall failed",
    });
    return { ok: false, home_dir: homeDir, bin_dir: binDir, steps };
  }

  steps.push({
    id: "product_cli_install",
    reason_code: INSTALLED_CLI_REASON_CODES.OK,
    status: "pass",
    message: `product CLI shim installed (${installReport.shim_path})`,
  });

  const shimPath = installReport.shim_path;
  if (!shimPath || !fs.existsSync(shimPath)) {
    steps.push({
      id: "installed_help",
      reason_code: INSTALLED_CLI_REASON_CODES.HELP,
      status: "fail",
      message: "missing shim after install",
    });
    return { ok: false, home_dir: homeDir, bin_dir: binDir, steps };
  }

  const help = spawnInstalledShim(shimPath, ["--help"], { homeDir, binDir, cwd: os.tmpdir() });
  if (help.status !== 0 || !help.stdout.includes("ai-minions")) {
    steps.push({
      id: "installed_help",
      reason_code: INSTALLED_CLI_REASON_CODES.HELP,
      status: "fail",
      message: `ai-minions --help failed from outside repo (exit ${help.status})`,
    });
  } else {
    steps.push({
      id: "installed_help",
      reason_code: INSTALLED_CLI_REASON_CODES.OK,
      status: "pass",
      message: "ai-minions --help OK from outside clone root",
    });
  }

  if (options.skipDoctor) {
    steps.push({
      id: "installed_doctor",
      reason_code: INSTALLED_CLI_REASON_CODES.SKIPPED,
      status: "skip",
      message: "ai-minions doctor skipped (CI / --skip-installed-doctor)",
    });
  } else {
    const doctor = spawnInstalledShim(
      shimPath,
      ["doctor", "--model-policy", options.modelPolicy ?? "local_only"],
      { homeDir, binDir, cwd: repoRoot },
    );
    if (doctor.status === 0) {
      steps.push({
        id: "installed_doctor",
        reason_code: INSTALLED_CLI_REASON_CODES.OK,
        status: "pass",
        message: "ai-minions doctor OK from target repo via installed shim",
      });
    } else {
      steps.push({
        id: "installed_doctor",
        reason_code: INSTALLED_CLI_REASON_CODES.DOCTOR,
        status: "fail",
        message: `ai-minions doctor blocked (exit ${doctor.status}) — live Mac/Docker needs Ollama`,
      });
    }
  }

  const ok = steps.every((s) => s.status !== "fail");
  return {
    ok,
    shim_path: shimPath,
    home_dir: homeDir,
    bin_dir: binDir,
    steps,
  };
}

/**
 * Lightweight install-only check using runCliInstall directly (unit tests).
 * @param {string} repoRoot
 */
export async function verifyShimHelpFromOutsideRepo(repoRoot) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "installed-cli-verify-"));
  const binDir = path.join(homeDir, "bin");
  const report = await runCliInstall({
    repoRoot,
    homeDir,
    binDir,
    configDir: defaultConfigDir(homeDir),
    pathEnv: binDir,
  });
  if (!report.ok || !report.shim_path) {
    return { ok: false, message: "cli install failed" };
  }
  const help = spawnInstalledShim(report.shim_path, ["--help"], { homeDir, binDir });
  if (help.status !== 0) {
    return { ok: false, message: help.stderr || help.stdout };
  }
  return { ok: true, message: "help OK" };
}
