import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  INSTALLED_CLI_REASON_CODES,
  runInstalledCliEvidence,
  spawnInstalledShim,
  verifyShimHelpFromOutsideRepo,
} from "../scripts/lib/installed-cli-evidence.mjs";
import { REPO_ROOT } from "../scripts/install-ai-minions.mjs";

function makeHostReadyRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "installed-evidence-"));
  const orch = path.join(tmp, "orchestrator");
  fs.mkdirSync(orch, { recursive: true });
  fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
  fs.writeFileSync(path.join(orch, "ai-minions-cli.js"), "#!/usr/bin/env node\nconsole.log('ai-minions help');\n");
  fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });
  return tmp;
}

describe("installed-cli-evidence", () => {
  it("verifyShimHelpFromOutsideRepo passes with minimal host-ready repo", async () => {
    const repoRoot = makeHostReadyRepo();
    const result = await verifyShimHelpFromOutsideRepo(repoRoot);
    assert.equal(result.ok, true);
  });

  it("runInstalledCliEvidence installs shim and passes --help from outside repo", async () => {
    const report = await runInstalledCliEvidence({
      repoRoot: REPO_ROOT,
      skipDoctor: true,
      discoverLocalModels: async () => ({
        backends: [{ backend_id: "ollama", available: false, host: "localhost", port: 11434, reason: "down" }],
        models: [],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });
    const install = report.steps.find((s) => s.id === "product_cli_install");
    const help = report.steps.find((s) => s.id === "installed_help");
    const doctor = report.steps.find((s) => s.id === "installed_doctor");
    assert.equal(install?.status, "pass");
    assert.equal(help?.status, "pass");
    assert.equal(doctor?.status, "skip");
    assert.equal(report.ok, true);
    assert.ok(report.shim_path);
  });

  it("runInstalledCliEvidence fails when product CLI missing from repo layout", async () => {
    const repoRoot = makeHostReadyRepo();
    fs.unlinkSync(path.join(repoRoot, "orchestrator", "ai-minions-cli.js"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "installed-evidence-home-"));
    const report = await runInstalledCliEvidence({
      repoRoot,
      homeDir,
      skipDoctor: true,
      discoverLocalModels: async () => ({
        backends: [],
        models: [],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });
    const install = report.steps.find((s) => s.id === "product_cli_install");
    assert.equal(install?.status, "fail");
    assert.equal(install?.reason_code, INSTALLED_CLI_REASON_CODES.PRODUCT_CLI);
    assert.equal(report.ok, false);
  });

  it("spawnInstalledShim runs from cwd outside repo", async () => {
    const repoRoot = makeHostReadyRepo();
    const verify = await verifyShimHelpFromOutsideRepo(repoRoot);
    assert.equal(verify.ok, true);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "installed-evidence-shim-"));
    const binDir = path.join(homeDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const { runCliInstall } = await import("../scripts/lib/ai-minions-cli-install.mjs");
    const { defaultConfigDir } = await import("../scripts/lib/ai-minions-cli-install.mjs");
    const installed = await runCliInstall({
      repoRoot,
      homeDir,
      binDir,
      configDir: defaultConfigDir(homeDir),
      pathEnv: binDir,
    });
    const help = spawnInstalledShim(installed.shim_path, ["--help"], {
      homeDir,
      binDir,
      cwd: os.tmpdir(),
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /ai-minions/);
  });
});
