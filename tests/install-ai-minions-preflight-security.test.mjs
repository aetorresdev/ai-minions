/**
 * Installer preflight/security negative matrix.
 * PATH · AI_MINIONS_HOME · symlink/realpath · cwd outside repo · shell rc · secret leakage.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  CLI_INSTALL_REASON_CODES,
  defaultConfigDir,
  runCliInstall,
  validateCliEntry,
} from "../scripts/lib/ai-minions-cli-install.mjs";
import {
  REPO_ROOT,
  formatReportText,
  runInstallAiMinions,
} from "../scripts/install-ai-minions.mjs";

const INSTALL_SCRIPT = path.join(REPO_ROOT, "scripts", "install-ai-minions.mjs");
const FAKE_SECRET = "sk-ant-api03-INSTALL_LEAK_PROBE_DO_NOT_COMMIT";
const SHELL_RC_FILES = [".bashrc", ".zshrc", ".profile", ".bash_profile"];

function makeHostReadyRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-preflight-"));
  const orch = path.join(tmp, "orchestrator");
  fs.mkdirSync(orch, { recursive: true });
  fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
  fs.writeFileSync(path.join(orch, "ai-minions-cli.js"), "#!/usr/bin/env node\nprocess.exit(0);\n");
  fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });
  return tmp;
}

/**
 * @param {string} shimPath
 * @param {{ homeDir: string, aiMinionsHome?: string, args?: string[] }} options
 */
function runInstalledShim(shimPath, options) {
  const env = {
    ...process.env,
    HOME: options.homeDir,
    PATH: `${path.dirname(shimPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  if (options.aiMinionsHome !== undefined) {
    if (options.aiMinionsHome) {
      env.AI_MINIONS_HOME = options.aiMinionsHome;
    } else {
      delete env.AI_MINIONS_HOME;
    }
  } else {
    delete env.AI_MINIONS_HOME;
  }
  return spawnSync(shimPath, options.args ?? ["--help"], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    env,
  });
}

/**
 * @param {string} homeDir
 * @returns {Record<string, string>}
 */
function snapshotShellRc(homeDir) {
  /** @type {Record<string, string>} */
  const snap = {};
  for (const name of SHELL_RC_FILES) {
    const file = path.join(homeDir, name);
    snap[file] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  }
  return snap;
}

/**
 * @param {Record<string, string>} before
 */
function assertShellRcUnchanged(before) {
  for (const [file, content] of Object.entries(before)) {
    const after = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    assert.equal(after, content, `shell rc mutated: ${file}`);
  }
}

/**
 * @param {string} haystack
 * @param {string} secret
 */
function assertNoSecretLeak(haystack, secret) {
  assert.ok(!haystack.includes(secret), "installer output leaked secret value");
  assert.ok(!haystack.includes("INSTALL_LEAK_PROBE"), "installer output leaked secret fragment");
}

describe("installer preflight/security negative matrix", () => {
  it("validateCliEntry blocks product CLI symlink that escapes repo root", () => {
    const repoRoot = makeHostReadyRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-outside-"));
    const outsideCli = path.join(outside, "escaped-cli.js");
    fs.writeFileSync(outsideCli, "#!/usr/bin/env node\nprocess.exit(0);\n");
    const cliLink = path.join(repoRoot, "orchestrator", "ai-minions-cli.js");
    fs.unlinkSync(cliLink);
    fs.symlinkSync(outsideCli, cliLink);

    const result = validateCliEntry(repoRoot);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, CLI_INSTALL_REASON_CODES.SHIM_VALIDATION_FAILED);
  });

  it("runCliInstall fails before shim write when CLI symlink escapes repo", async () => {
    const repoRoot = makeHostReadyRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-outside-"));
    const outsideCli = path.join(outside, "escaped-cli.js");
    fs.writeFileSync(outsideCli, "#!/usr/bin/env node\nprocess.exit(0);\n");
    const cliLink = path.join(repoRoot, "orchestrator", "ai-minions-cli.js");
    fs.unlinkSync(cliLink);
    fs.symlinkSync(outsideCli, cliLink);

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });

    assert.equal(report.ok, false);
    const layout = report.checks.find((c) => c.id === "repo_layout");
    assert.equal(layout?.reason_code, CLI_INSTALL_REASON_CODES.SHIM_VALIDATION_FAILED);
    assert.equal(fs.existsSync(path.join(binDir, "ai-minions")), false);
  });

  it("shim blocks invalid AI_MINIONS_HOME with stable reason code", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });

    const result = runInstalledShim(report.shim_path, {
      homeDir,
      aiMinionsHome: path.join(os.tmpdir(), "nonexistent-ai-minions-home"),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID}`));
  });

  it("shim blocks when home config points at invalid repo layout", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "bin");
    const configDir = defaultConfigDir(homeDir);
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir,
      pathEnv: binDir,
    });

    const badRepo = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-bad-repo-"));
    fs.writeFileSync(report.config_path, `${badRepo}\n`);

    const result = runInstalledShim(report.shim_path, { homeDir });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID}`));
  });

  it("shim blocks cwd outside repo when install context is missing", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });
    fs.unlinkSync(report.config_path);

    const result = runInstalledShim(report.shim_path, { homeDir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.HOME_UNSET}`));
    assert.doesNotMatch(result.stderr, /cd orchestrator/i);
  });

  it("runCliInstall does not mutate shell startup files", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "bin");
    for (const name of SHELL_RC_FILES) {
      fs.writeFileSync(path.join(homeDir, name), `# marker ${name}\n`);
    }
    const before = snapshotShellRc(homeDir);

    await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });

    assertShellRcUnchanged(before);
  });

  it("runCliInstall materializes with INSTALL_PATH_NOT_ON_PATH activation warn when bin dir missing from PATH", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "e20-3-home-"));
    const binDir = path.join(homeDir, "off-path-bin");

    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      pathEnv: "/usr/bin:/bin",
    });

    assert.equal(report.ok, true);
    assert.equal(report.install_materialized_ok, true);
    assert.equal(report.cli_activation_ready, false);
    const pathCheck = report.checks.find((c) => c.id === "path");
    assert.equal(pathCheck?.reason_code, CLI_INSTALL_REASON_CODES.PATH_NOT_ON_PATH);
    assert.equal(pathCheck?.status, "warn");
    assert.ok(report.path_remediation);
    assert.match(report.path_remediation, /export PATH=/);
  });

  it("runInstallAiMinions JSON/text reports omit secret env values", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_SECRET;
    try {
      const repoRoot = makeHostReadyRepo();
      const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
        repoRoot,
        nodeVersion: "22.0.0",
        commandExists: () => true,
        install: false,
        cliInstall: false,
        discoverLocalModels: async () => ({
          backends: [{ backend_id: "ollama", available: false, host: "localhost", port: 11434, reason: "down" }],
          models: [],
          missing_local_backend: "missing local backend: ollama unreachable",
        }),
      });

      const json = JSON.stringify(report);
      const text = formatReportText(report);
      assertNoSecretLeak(json, FAKE_SECRET);
      assertNoSecretLeak(text, FAKE_SECRET);

      const subprocess = spawnSync(process.execPath, [INSTALL_SCRIPT, "--skip-cli", "--json"], {
        encoding: "utf8",
        cwd: repoRoot,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: FAKE_SECRET,
          OPENAI_API_KEY: "sk-openai-INSTALL_LEAK_PROBE",
        },
      });

      assertNoSecretLeak(subprocess.stdout ?? "", FAKE_SECRET);
      assertNoSecretLeak(subprocess.stderr ?? "", FAKE_SECRET);
      assertNoSecretLeak(subprocess.stdout ?? "", "sk-openai-INSTALL_LEAK_PROBE");
    } finally {
      if (previous === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
  });
});
