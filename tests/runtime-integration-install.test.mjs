import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RUNTIME_INTEGRATION_STATUS,
  RUNTIME_REASON_CODES,
} from "../scripts/lib/runtime-host-contract.mjs";
import { createClaudeCodeAdapter } from "../scripts/lib/runtime-host-claude-code.mjs";
import { runRuntimeIntegrationInstall } from "../scripts/lib/runtime-integration-install.mjs";
import { parseArgs, runInstallAiMinions } from "../scripts/install-ai-minions.mjs";

function makeRepo(tmp) {
  for (const rel of [
    "mcp-servers/orchestrator-state",
    "mcp-servers/compact-handoff",
  ]) {
    const dir = path.join(tmp, rel);
    fs.mkdirSync(path.join(dir, ".venv", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "server.py"), "# stub\n");
    fs.writeFileSync(path.join(dir, ".venv", "bin", "python"), "");
  }
  fs.mkdirSync(path.join(tmp, "scripts", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "scripts", "hooks", "mode-enforcer.py"), "# stub\n");
  fs.writeFileSync(path.join(tmp, "scripts", "hooks", "handoff-enforcer.py"), "# stub\n");
  const orch = path.join(tmp, "orchestrator");
  fs.mkdirSync(path.join(orch, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(orch, "package.json"), '{"name":"t"}\n');
}

function mockSpawn({ registered = new Set(), failAdd = null, claudeMissing = false } = {}) {
  /** @type {Set<string>} */
  const servers = new Set(registered);
  return (cmd, args = []) => {
    if (cmd === "claude") {
      if (claudeMissing) {
        const err = new Error("spawn claude ENOENT");
        err.code = "ENOENT";
        return { status: null, error: err, stdout: "", stderr: "" };
      }
      if (args[0] === "--version") return { status: 0, stdout: "claude 1.0\n", stderr: "" };
      if (args[0] === "mcp" && args[1] === "list") {
        const lines = [...servers].map((s) => `- ${s}`).join("\n");
        return { status: 0, stdout: `MCP servers:\n${lines}\n`, stderr: "" };
      }
      if (args[0] === "mcp" && args[1] === "add") {
        const id = args[2];
        if (failAdd === id) {
          return { status: 1, stdout: "", stderr: `fail ${id}` };
        }
        servers.add(id);
        return { status: 0, stdout: "ok\n", stderr: "" };
      }
    }
    if (cmd === "uv") {
      return { status: 0, stdout: "synced\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unknown ${cmd}` };
  };
}

describe("runtime-integration-install", () => {
  it("parseArgs recognizes --skip-runtime-integration", () => {
    const args = parseArgs(["--skip-runtime-integration", "--json"]);
    assert.equal(args.skipRuntimeIntegration, true);
  });

  it("skip path is observable and not configured", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-skip-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const out = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      skip: true,
      homeDir: home,
      adapter: createClaudeCodeAdapter({ homeDir: home, spawnSyncFn: mockSpawn() }),
    });
    assert.equal(out.ok, true);
    assert.equal(out.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.SKIPPED);
    assert.equal(out.reason_code, RUNTIME_REASON_CODES.SKIPPED);
    assert.equal(out.mcp_registration["orchestrator-state"], "skipped");
    assert.match(out.next_safe_action, /without --skip-runtime-integration/);
  });

  it("unavailable host fails closed without silent skip", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-unavail-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const out = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter: createClaudeCodeAdapter({
        homeDir: home,
        spawnSyncFn: mockSpawn({ claudeMissing: true }),
      }),
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.UNAVAILABLE);
    assert.equal(out.reason_code, RUNTIME_REASON_CODES.UNAVAILABLE);
    assert.match(out.next_safe_action, /Claude Code|skip-runtime-integration/);
  });

  it("clean install registers MCP and wires hooks idempotently", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-clean-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const spawn = mockSpawn();
    const adapter = createClaudeCodeAdapter({
      homeDir: home,
      spawnSyncFn: spawn,
      fsModule: fs,
    });
    const first = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter,
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(first.ok, true);
    assert.equal(first.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.CONFIGURED);
    assert.equal(first.mcp_registration["orchestrator-state"], "registered");
    assert.equal(first.mcp_registration["compact-handoff"], "registered");
    assert.equal(first.hook_wiring["mode-enforcer"], "configured");
    assert.equal(first.hook_wiring["handoff-enforcer"], "configured");
    const settings = JSON.parse(fs.readFileSync(adapter.settingsPath, "utf8"));
    assert.ok(JSON.stringify(settings).includes("mode-enforcer.py"));
    assert.ok(JSON.stringify(settings).includes("handoff-enforcer.py"));
    assert.ok(settings.hooks?.PreToolUse?.length >= 2);

    const second = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter,
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(second.ok, true);
    assert.equal(second.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.CONFIGURED);
    const settings2 = JSON.parse(fs.readFileSync(adapter.settingsPath, "utf8"));
    const modeCount = JSON.stringify(settings2).split("mode-enforcer.py").length - 1;
    assert.equal(modeCount, 1);
  });

  it("preserves unrelated settings keys on merge", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-merge-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const settingsPath = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        custom_key: "keep-me",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      }),
    );
    const adapter = createClaudeCodeAdapter({
      homeDir: home,
      spawnSyncFn: mockSpawn(),
    });
    const out = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter,
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(out.ok, true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(settings.custom_key, "keep-me");
    assert.equal(settings.hooks.SessionStart.length, 1);
  });

  it("malformed settings fails without wiping file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-bad-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const settingsPath = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{not-json");
    const adapter = createClaudeCodeAdapter({
      homeDir: home,
      spawnSyncFn: mockSpawn(),
    });
    const out = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter,
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(out.ok, false);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), "{not-json");
    assert.ok(
      out.checks.some((c) => c.reason_code === RUNTIME_REASON_CODES.SETTINGS_UNREADABLE),
    );
  });

  it("partial MCP failure does not claim configured", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-partial-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const adapter = createClaudeCodeAdapter({
      homeDir: home,
      spawnSyncFn: mockSpawn({ failAdd: "compact-handoff" }),
    });
    const out = runRuntimeIntegrationInstall({
      repoRoot: tmp,
      homeDir: home,
      adapter,
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.FAILED);
    assert.equal(out.mcp_registration["orchestrator-state"], "registered");
    assert.equal(out.mcp_registration["compact-handoff"], "failed");
  });

  it("install report exposes runtime_host separate from model_backend", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-int-install-"));
    makeRepo(tmp);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-home-"));
    const report = await runInstallAiMinions({
      repoRoot: tmp,
      nodeVersion: "20.0.0",
      commandExists: () => true,
      cliInstall: false,
      homeDir: home,
      discoverLocalModels: async () => ({
        backends: [{
          backend_id: "ollama",
          available: true,
          host: "localhost",
          port: 11434,
          reason: null,
        }],
        models: [{ name: "qwen2.5-coder:7b", backend: "ollama", family: "qwen2", size_bytes: 1, context_length: null }],
        missing_local_backend: null,
      }),
      writeInstallModelConfig: () => ({
        ok: true,
        default_model: "qwen2.5-coder:7b",
        inference_profiles_written: true,
        inference_profile_mode: "single",
        files_written: ["model-policy.yaml", "model_policy.json"],
        degraded_single_model: false,
      }),
      resolveLocalRuntimeEndpoint: () => ({
        host: "127.0.0.1",
        port: 11434,
        base_url: "http://127.0.0.1:11434",
        endpoint_scope: "loopback",
      }),
      normalizeInstallDiscovery: (r) => ({
        backends: (r.backends || []).map((b) => ({
          ...b,
          support_status: "supported",
        })),
        models: r.models || [],
      }),
      runtimeHostAdapter: createClaudeCodeAdapter({
        homeDir: home,
        spawnSyncFn: mockSpawn(),
      }),
      syncMcpVenvFn: () => ({ ok: true, reason_code: null, message: "ok" }),
    });
    assert.equal(report.model_backend, "ollama");
    assert.equal(report.runtime_host, "claude_code");
    assert.equal(report.runtime_integration_status, RUNTIME_INTEGRATION_STATUS.CONFIGURED);
    assert.equal(report.phase, "runtime_integration");
    assert.equal(report.ok, true);
  });
});
