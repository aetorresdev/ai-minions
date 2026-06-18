import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  MODEL_POLICY_MODE,
  REASON_CODES,
  REPO_ROOT,
  formatReportText,
  normalizeModelPolicy,
  parseArgs,
  parseNodeMajor,
  runInstallAiMinions,
} from "../scripts/install-ai-minions.mjs";

const BASH_WRAPPER = path.join(REPO_ROOT, "install.sh");

describe("install-ai-minions", () => {
  it("parseNodeMajor reads major version", () => {
    assert.equal(parseNodeMajor("20.11.0"), 20);
    assert.equal(parseNodeMajor("invalid"), null);
  });

  it("normalizeModelPolicy accepts local_only and remote_ok", () => {
    assert.equal(normalizeModelPolicy("local_only"), "local_only");
    assert.equal(normalizeModelPolicy("REMOTE_OK"), "remote_ok");
    assert.equal(normalizeModelPolicy("bogus"), null);
    assert.equal(normalizeModelPolicy(null), null);
  });

  it("parseArgs reads install, json, and model-policy", () => {
    const args = parseArgs(["--install", "--json", "--model-policy", "local_only"]);
    assert.equal(args.install, true);
    assert.equal(args.json, true);
    assert.equal(args.modelPolicy, "local_only");
  });

  it("fails when orchestrator package.json is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      commandExists: () => true,
    });
    assert.equal(report.ok, false);
    assert.equal(report.phase, "host_prereqs");
    const layout = report.checks.find((c) => c.id === "repo_layout");
    assert.equal(layout?.reason_code, REASON_CODES.NPM_CI_FAILED);
  });

  it("fails on old Node with INSTALL_NODE_MISSING", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "16.0.0",
      commandExists: () => true,
    });
    const node = report.checks.find((c) => c.id === "node_version");
    assert.equal(node?.reason_code, REASON_CODES.NODE_MISSING);
    assert.equal(report.ok, false);
  });

  it("fails when ruff or uv are missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      commandExists: (cmd) => cmd === "node",
    });
    const ruff = report.checks.find((c) => c.id === "ruff");
    const uv = report.checks.find((c) => c.id === "uv");
    assert.equal(ruff?.reason_code, REASON_CODES.RUFF_MISSING);
    assert.equal(uv?.reason_code, REASON_CODES.UV_MISSING);
    assert.equal(report.ok, false);
  });

  it("passes host prereqs when layout, node, tools, and node_modules exist", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      modelPolicy: "local_only",
      commandExists: () => true,
    });
    assert.equal(report.ok, true);
    assert.equal(report.model_policy, "local_only");
    assert.ok(report.checks.every((c) => c.reason_code === REASON_CODES.OK));
  });

  it("runs npm ci with --install when node_modules is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');

    let npmCiCalled = false;
    const report = await runInstallAiMinions({
      repoRoot: tmp,
      install: true,
      nodeVersion: "20.0.0",
      commandExists: () => true,
      runNpmCi: (dir) => {
        npmCiCalled = true;
        assert.equal(dir, orch);
        fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });
        return { status: 0 };
      },
    });
    assert.equal(npmCiCalled, true);
    assert.equal(report.ok, true);
    const npmCi = report.checks.find((c) => c.id === "npm_ci");
    assert.equal(npmCi?.reason_code, REASON_CODES.OK);
  });

  it("records model_policy as declarative install intent only (current installer phase)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
    fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });

    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      modelPolicy: "remote_ok",
      commandExists: () => true,
    });
    assert.equal(report.model_policy, "remote_ok");
    assert.equal(report.model_policy_mode, MODEL_POLICY_MODE);
    assert.equal(report.phase, "host_prereqs");
  });

  it("formatReportText includes phase and INSTALL_* codes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const report = await runInstallAiMinions({ repoRoot: tmp, nodeVersion: "20.0.0" });
    const text = formatReportText(report);
    assert.match(text, /host prereqs/);
    assert.match(text, /INSTALL_NPM_CI_FAILED/);
  });

  it("bash wrapper delegates to install-ai-minions.mjs (--help)", () => {
    const result = spawnSync("bash", [BASH_WRAPPER, "--help"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install-ai-minions/);
    assert.match(result.stdout, /install\.sh/);
  });
});
