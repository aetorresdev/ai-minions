import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  CLI_INSTALL_REASON_CODES,
  buildShimSource,
  defaultBinDir,
  defaultConfigDir,
  pathIncludesDir,
  productCliInstallOk,
  runCliInstall,
  validateCliEntry,
} from "../scripts/lib/ai-minions-cli-install.mjs";
import {
  REPO_ROOT,
  productCliInstallOk as exportedProductOk,
  runInstallAiMinions,
} from "../scripts/install-ai-minions.mjs";

function makeHostReadyRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-install-"));
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
    env.AI_MINIONS_HOME = options.aiMinionsHome;
  } else {
    delete env.AI_MINIONS_HOME;
  }
  return spawnSync(shimPath, options.args ?? ["--help"], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    env,
  });
}

describe("ai-minions-cli-install", () => {
  it("buildShimSource embeds all registered CLI_INSTALL_REASON_CODES", () => {
    const src = buildShimSource();
    assert.match(src, /const SHIM_REASON = /);
    for (const code of Object.values(CLI_INSTALL_REASON_CODES)) {
      assert.match(src, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(src, /fail\(\s*'INSTALL_/);
  });

  it("shim emits INSTALL_HOME_UNSET without AI_MINIONS_HOME and config", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });
    fs.unlinkSync(report.config_path);

    const result = runInstalledShim(report.shim_path, {
      homeDir,
      aiMinionsHome: "",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.HOME_UNSET}`));
  });

  it("shim emits INSTALL_REPO_LAYOUT_INVALID when product CLI is missing", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });
    fs.unlinkSync(path.join(repoRoot, "orchestrator", "ai-minions-cli.js"));

    const result = runInstalledShim(report.shim_path, {
      homeDir,
      aiMinionsHome: repoRoot,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID}`));
  });

  it("shim emits INSTALL_CLI_DISPATCH_FAILED when node spawn fails", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");
    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });
    const shimSrc = fs.readFileSync(report.shim_path, "utf8");
    fs.writeFileSync(
      report.shim_path,
      shimSrc.replace(
        "spawnSync(process.execPath,",
        "spawnSync('/nonexistent-node-xyz',",
      ),
      { encoding: "utf8", mode: 0o755 },
    );

    const result = runInstalledShim(report.shim_path, {
      homeDir,
      aiMinionsHome: repoRoot,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`blocker: ${CLI_INSTALL_REASON_CODES.DISPATCH_FAILED}`));
  });

  it("pathIncludesDir matches real paths on PATH", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-inc-"));
    assert.equal(pathIncludesDir(`${dir}${path.delimiter}/tmp`, dir), true);
    assert.equal(pathIncludesDir("/tmp", dir), false);
  });

  it("validateCliEntry rejects missing orchestrator CLI", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-layout-"));
    const result = validateCliEntry(tmp);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, CLI_INSTALL_REASON_CODES.REPO_LAYOUT_INVALID);
  });

  it("validateCliEntry accepts real repo layout", () => {
    const result = validateCliEntry(REPO_ROOT);
    assert.equal(result.ok, true);
    assert.ok(result.realCliPath);
  });

  it("runCliInstall writes shim and home config when bin dir is on PATH", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");
    const configDir = defaultConfigDir(homeDir);

    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir,
      pathEnv: `${binDir}${path.delimiter}/usr/bin`,
    });

    assert.equal(report.ok, true);
    assert.ok(fs.existsSync(report.shim_path));
    assert.ok(fs.existsSync(report.config_path));
    assert.equal(fs.readFileSync(report.config_path, "utf8").trim(), repoRoot);
    assert.match(buildShimSource(), /AI_MINIONS_HOME/);
  });

  it("runCliInstall materializes with PATH activation warn when bin dir missing from PATH", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = defaultBinDir(homeDir);

    const report = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      pathEnv: "/usr/bin",
    });

    assert.equal(report.ok, true);
    assert.equal(report.install_materialized_ok, true);
    assert.equal(report.cli_activation_ready, false);
    const pathCheck = report.checks.find((c) => c.id === "path");
    assert.equal(pathCheck?.reason_code, CLI_INSTALL_REASON_CODES.PATH_NOT_ON_PATH);
    assert.equal(pathCheck?.status, "warn");
    assert.ok(report.path_remediation);
    assert.ok(fs.existsSync(report.shim_path));
  });

  it("installed shim runs ai-minions --help from outside repo when PATH includes bin dir", async () => {
    const repoRoot = REPO_ROOT;
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");
    const configDir = defaultConfigDir(homeDir);

    const installReport = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir,
      pathEnv: binDir,
    });
    assert.equal(installReport.ok, true);

    const result = spawnSync(installReport.shim_path, ["--help"], {
      encoding: "utf8",
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: homeDir,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /ai-minions — product CLI/);
    assert.match(result.stdout, /init\s+Validate host prereqs/);
  });

  it("runInstallAiMinions attaches product_cli_ok when host + cli install succeed", async () => {
    const repoRoot = makeHostReadyRepo();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-home-"));
    const binDir = path.join(homeDir, "bin");

    const report = await runInstallAiMinions({
      repoRoot,
      nodeVersion: "20.0.0",
      commandExists: () => true,
      install: false,
      cliInstall: true,
      cliInstallOptions: {
        homeDir,
        binDir,
        configDir: defaultConfigDir(homeDir),
        pathEnv: binDir,
      },
      discoverLocalModels: async () => ({
        backends: [{ backend_id: "ollama", available: false, host: "localhost", port: 11434, reason: "down" }],
        models: [],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });

    assert.equal(report.product_cli_ok, true);
    assert.equal(exportedProductOk(report), true);
    assert.equal(productCliInstallOk(report), true);
    assert.equal(report.cli_install?.ok, true);
  });
});
