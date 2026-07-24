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
  buildConfigWriteChecks,
  buildDiscoveryChecks,
  checksOk,
  formatReportText,
  deriveInstallNextSafeAction,
  normalizeModelPolicy,
  parseArgs,
  parseNodeMajor,
  runHostPrereqChecks,
  runInstallAiMinions,
} from "../scripts/install-ai-minions.mjs";

const BASH_WRAPPER = path.join(REPO_ROOT, "install.sh");

/** @returns {() => Promise<import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult>} */
function mockDiscoverSuccess(modelNames = ["qwen2.5-coder:7b"]) {
  return async () => ({
    backends: [
      {
        backend_id: "ollama",
        available: true,
        host: "localhost",
        port: 11434,
        reason: null,
      },
    ],
    models: modelNames.map((name) => ({
      name,
      backend: "ollama",
      family: "qwen2",
      size_bytes: 100,
      context_length: null,
    })),
    missing_local_backend: null,
  });
}

/** @param {Partial<import('../orchestrator/local-model-discovery.js').LocalModelDiscoveryResult>} result */
function mockDiscoverResult(result) {
  return async () => ({
    backends: result.backends ?? [],
    models: result.models ?? [],
    missing_local_backend: result.missing_local_backend ?? null,
  });
}

function makeHostReadyRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
  const orch = path.join(tmp, "orchestrator");
  fs.mkdirSync(orch, { recursive: true });
  fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');
  fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });
  return tmp;
}

describe("install-ai-minions", () => {
  it("parseNodeMajor reads major version", () => {
    assert.equal(parseNodeMajor("22.11.0"), 22);
    assert.equal(parseNodeMajor("v22.0.0"), 22);
    assert.equal(parseNodeMajor("22.0.0-rc.1"), 22);
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
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: () => true,
    });
    assert.equal(report.ok, false);
    assert.equal(report.phase, "host_prereqs");
    assert.equal(report.discovery, null);
    const layout = report.checks.find((c) => c.id === "repo_layout");
    assert.equal(layout?.reason_code, REASON_CODES.NPM_CI_FAILED);
  });

  it("fails on old Node with NODE_VERSION_UNSUPPORTED", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
    });
    const node = report.checks.find((c) => c.id === "node_version");
    assert.equal(node?.reason_code, REASON_CODES.NODE_VERSION_UNSUPPORTED);
    assert.equal(report.ok, false);
    assert.equal(report.phase, "host_prereqs");
    assert.match(node?.message || "", /Node\.js >= 22/);
  });

  it("short-circuits on Node 20 and does not invoke npm ci with --install", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');

    let npmCiCalled = false;
    const { checks, hostOk } = await runHostPrereqChecks(tmp, orch, {
      install: true,
      nodeVersion: "20.0.0",
      commandExists: () => true,
      runNpmCi: () => {
        npmCiCalled = true;
        return { status: 0 };
      },
    });
    assert.equal(hostOk, false);
    assert.equal(npmCiCalled, false);
    const node = checks.find((c) => c.id === "node_version");
    assert.equal(node?.reason_code, REASON_CODES.NODE_VERSION_UNSUPPORTED);
    assert.equal(
      checks.some((c) => c.id === "npm_ci" || c.id === "ruff" || c.id === "uv"),
      false,
    );
  });

  it("fails when ruff or uv are missing", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: (cmd) => cmd === "node",
      discoverLocalModels: mockDiscoverSuccess(),
    });
    const ruff = report.checks.find((c) => c.id === "ruff");
    const uv = report.checks.find((c) => c.id === "uv");
    assert.equal(ruff?.reason_code, REASON_CODES.RUFF_MISSING);
    assert.equal(uv?.reason_code, REASON_CODES.UV_MISSING);
    assert.equal(report.ok, false);
  });

  it("passes host prereqs and discovery when layout, tools, and models exist", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "local_only",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
    });
    assert.equal(report.ok, true);
    assert.equal(report.phase, "config_write");
    assert.equal(report.model_policy, "local_only");
    assert.equal(report.discovery?.backends[0].support_status, "supported");
    assert.equal(report.discovery?.backends[0].backend_id, "ollama");
    assert.equal(report.discovery?.models.length, 1);
    assert.equal(report.inference_profiles_written, true);
    assert.equal(report.inference_profile_mode, "declarative");
    const discovery = report.checks.find((c) => c.id === "model_discovery");
    assert.equal(discovery?.reason_code, REASON_CODES.OK);
    const configWrite = report.checks.find((c) => c.id === "config_write");
    assert.equal(configWrite?.reason_code, REASON_CODES.ROLE_MODEL_CONFIG_WRITTEN);
    assert.ok(fs.existsSync(path.join(tmp, ".ai-minions", "model-policy.yaml")));
    assert.ok(fs.existsSync(path.join(tmp, ".ai-minions", "model_policy.json")));
  });

  it("runs npm ci with --install when node_modules is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const orch = path.join(tmp, "orchestrator");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "package.json"), '{"name":"test"}\n');

    let npmCiCalled = false;
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      install: true,
      nodeVersion: "22.0.0",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
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

  it("records model_policy as declarative install intent", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "remote_ok",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
    });
    assert.equal(report.model_policy, "remote_ok");
    assert.equal(report.model_policy_mode, MODEL_POLICY_MODE);
    assert.equal(report.phase, "config_write");
  });

  it("fails discovery with INSTALL_OLLAMA_UNREACHABLE when local_only and ollama down", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "local_only",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverResult({
        backends: [
          {
            backend_id: "ollama",
            available: false,
            host: "localhost",
            port: 11434,
            reason: "connect ECONNREFUSED",
          },
        ],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });
    assert.equal(report.ok, false);
    const check = report.checks.find((c) => c.id === "ollama_reachable");
    assert.equal(check?.reason_code, REASON_CODES.OLLAMA_UNREACHABLE);
    assert.equal(check?.status, "fail");
  });

  it("warns with INSTALL_OLLAMA_UNREACHABLE when remote_ok and ollama down", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "remote_ok",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverResult({
        backends: [
          {
            backend_id: "ollama",
            available: false,
            host: "localhost",
            port: 11434,
            reason: "connect ECONNREFUSED",
          },
        ],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });
    assert.equal(report.ok, true);
    const check = report.checks.find((c) => c.id === "ollama_reachable");
    assert.equal(check?.status, "warn");
    assert.equal(check?.reason_code, REASON_CODES.OLLAMA_UNREACHABLE);
  });

  it("fails with INSTALL_LOCAL_MODELS_EMPTY when local_only and zero models", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "local_only",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverResult({
        backends: [
          {
            backend_id: "ollama",
            available: true,
            host: "localhost",
            port: 11434,
            reason: null,
          },
        ],
        models: [],
      }),
    });
    assert.equal(report.ok, false);
    const check = report.checks.find((c) => c.id === "local_models");
    assert.equal(check?.reason_code, REASON_CODES.LOCAL_MODELS_EMPTY);
  });

  it("fails with INSTALL_MODEL_DISCOVERY_DENIED when network gate denies", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "local_only",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverResult({
        backends: [
          {
            backend_id: "ollama",
            available: false,
            host: "localhost",
            port: 11434,
            reason: "network_denied",
          },
        ],
        missing_local_backend: "missing local backend: ollama network egress denied",
      }),
    });
    assert.equal(report.ok, false);
    const check = report.checks.find((c) => c.id === "model_discovery");
    assert.equal(check?.reason_code, REASON_CODES.MODEL_DISCOVERY_DENIED);
    assert.equal(check?.status, "fail");
  });

  it("buildDiscoveryChecks and checksOk treat warn as non-blocking", () => {
    const checks = buildDiscoveryChecks(
      {
        backends: [
          {
            backend_id: "ollama",
            available: false,
            host: "localhost",
            port: 11434,
            reason: "down",
          },
        ],
        models: [],
        missing_local_backend: "missing local backend: ollama unreachable",
      },
      "remote_ok",
    );
    assert.equal(checks[0].status, "warn");
    assert.equal(checksOk(checks), true);
  });

  it("warns INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL for single discovered model", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(["only-model:7b"]),
    });
    assert.equal(report.ok, true);
    const warn = report.checks.find((c) => c.id === "role_model_tier");
    assert.equal(warn?.reason_code, REASON_CODES.ROLE_MODEL_DEGRADED_SINGLE_MODEL);
    assert.equal(warn?.status, "warn");
  });

  it("fails config write with INSTALL_MODEL_POLICY_WRITE_FAILED", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
      writeInstallModelConfig: () => {
        throw new Error("disk full");
      },
    });
    assert.equal(report.ok, false);
    assert.equal(report.phase, "config_write");
    const fail = report.checks.find((c) => c.id === "config_write");
    assert.equal(fail?.reason_code, REASON_CODES.MODEL_POLICY_WRITE_FAILED);
  });

  it("buildConfigWriteChecks emits pass and optional degrade warn", () => {
    const passOnly = buildConfigWriteChecks({
      files_written: ["model-policy.yaml", "model_policy.json"],
      degraded_single_model: false,
    });
    assert.equal(passOnly.length, 1);
    assert.equal(passOnly[0].reason_code, REASON_CODES.ROLE_MODEL_CONFIG_WRITTEN);

    const withWarn = buildConfigWriteChecks({
      files_written: ["model-policy.yaml"],
      degraded_single_model: true,
    });
    assert.equal(withWarn.length, 2);
    assert.equal(withWarn[1].reason_code, REASON_CODES.ROLE_MODEL_DEGRADED_SINGLE_MODEL);
  });

  it("skips config write when discovery has no models", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      modelPolicy: "remote_ok",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverResult({
        backends: [
          {
            backend_id: "ollama",
            available: false,
            host: "localhost",
            port: 11434,
            reason: "down",
          },
        ],
        models: [],
        missing_local_backend: "missing local backend: ollama unreachable",
      }),
    });
    assert.equal(report.phase, "model_discovery");
    assert.equal(report.config_write, null);
    assert.equal(report.inference_profiles_written, false);
  });

  it("formatReportText includes support_status and discovery codes", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: () => true,
      discoverLocalModels: mockDiscoverSuccess(),
    });
    const text = formatReportText(report);
    assert.match(text, /config write/);
    assert.match(text, /support_status=supported/);
    assert.match(text, /INSTALL_OK/);
    assert.match(text, /inference_profile_mode: declarative/);
  });

  it("formatReportText shows host failure without discovery", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ai-minions-"));
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true, repoRoot: tmp, nodeVersion: "22.0.0" });
    const text = formatReportText(report, { useColor: false });
    assert.match(text, /host prereqs/);
    assert.match(text, /INSTALL_NPM_CI_FAILED/);
  });

  it("formatReportText highlights blocked install and next_safe_action for missing ruff/uv", async () => {
    const tmp = makeHostReadyRepo();
    const report = await runInstallAiMinions({
      skipRuntimeIntegration: true,
      repoRoot: tmp,
      nodeVersion: "22.0.0",
      commandExists: (cmd) => cmd === "node",
      discoverLocalModels: mockDiscoverSuccess(),
      cliInstall: false,
    });
    const text = formatReportText(report, { useColor: false });
    assert.match(text, /INSTALL BLOCKED/);
    assert.match(text, /\[FAIL\] INSTALL_RUFF_MISSING/);
    assert.match(text, /\[FAIL\] INSTALL_UV_MISSING/);
    assert.match(text, /brew install ruff uv/);
    assert.match(text, /next_safe_action:/);
    assert.match(deriveInstallNextSafeAction(report), /brew install ruff uv/);
  });

  it("bash wrapper delegates to install-ai-minions.mjs (--help)", () => {
    const result = spawnSync("bash", [BASH_WRAPPER, "--help"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install-ai-minions/);
    assert.match(result.stdout, /config write/);
  });
});
