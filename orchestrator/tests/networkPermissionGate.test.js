"use strict";

/**
 * Ollama HTTP permission_check when MCP audit task id is active.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

describe("Network permission gate — Ollama trace", () => {
  let tmpDir;
  let savedEnv;
  let server;
  let serverPort;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-net-gate-"));
    savedEnv = {
      ORCH_TRACES_DIR: process.env.ORCH_TRACES_DIR,
      ORCH_SKIP_NETWORK_PERMISSION_GATE: process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE,
      ORCH_PERMISSION_PROFILE: process.env.ORCH_PERMISSION_PROFILE,
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      OLLAMA_PORT: process.env.OLLAMA_PORT,
    };
    process.env.ORCH_TRACES_DIR = tmpDir;
    process.env.ORCH_PERMISSION_PROFILE = "dev-local";
    delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;

    serverPort = 18080 + Math.floor(Math.random() * 2000);
    process.env.OLLAMA_HOST = "127.0.0.1";
    process.env.OLLAMA_PORT = String(serverPort);

    server = http.createServer((req, res) => {
      if (req.url === "/api/chat" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { content: "ok" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.listen(serverPort, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await new Promise((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it("runOllama emits permission_check when audit task id active", async () => {
    const { _test_beginMcpAudit, _test_clearMcpAudit } = require("../orchestrator.js");
    const { runOllama } = require("../agents/runtime/run-ollama.js");

    const taskId = "task-net-gate-1";
    _test_beginMcpAudit(taskId);

    const out = await runOllama("sys", [{ role: "user", content: "hi" }], {
      model: "m",
      cwd: tmpDir,
      traceRole: "DEV",
      timeoutMs: 5000,
    });
    assert.equal(out.content, "ok");

    _test_clearMcpAudit();

    const jsonlPath = path.join(tmpDir, `${taskId}.jsonl`);
    assert.ok(fs.existsSync(jsonlPath));
    const lines = fs
      .readFileSync(jsonlPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const gateLine = lines.find((r) => r.event === "permission_check" && r.tool === "ollama_chat");
    assert.ok(gateLine, "expected ollama_chat permission_check line");
    assert.equal(gateLine.permission_profile, "dev-local");
    assert.equal(gateLine.domain, "network");
    assert.equal(gateLine.reason_code, "network_allowlist_allowed");
    assert.equal(gateLine.role, "DEV");
  });

  it("runOllama passes the network gate for ARCHITECT (agentId architect)", async () => {
    const { _test_beginMcpAudit, _test_clearMcpAudit } = require("../orchestrator.js");
    const { runOllama } = require("../agents/runtime/run-ollama.js");

    const taskId = "task-net-gate-architect";
    _test_beginMcpAudit(taskId);
    let out;
    try {
      out = await runOllama("sys", [{ role: "user", content: "hi" }], {
        model: "m",
        cwd: tmpDir,
        traceRole: "ARCHITECT",
        traceAgentId: "architect",
        timeoutMs: 5000,
      });
    } finally {
      _test_clearMcpAudit();
    }
    assert.equal(out.content, "ok");

    const lines = fs
      .readFileSync(path.join(tmpDir, `${taskId}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const gateLine = lines.find((r) => r.event === "permission_check" && r.tool === "ollama_chat");
    assert.ok(gateLine, "expected ollama_chat permission_check line");
    assert.equal(gateLine.role, "ARCHITECT");
    assert.equal(gateLine.decision, "allow");
    assert.equal(gateLine.reason_code, "network_allowlist_allowed");
  });

  it("runOllama still denies OWNER at the network gate (matrix unchanged for other roles)", async () => {
    const { runOllama } = require("../agents/runtime/run-ollama.js");
    await assert.rejects(
      async () => runOllama("sys", [{ role: "user", content: "hi" }], {
        model: "m",
        cwd: tmpDir,
        traceRole: "OWNER",
        traceAgentId: "owner",
        timeoutMs: 5000,
      }),
      (err) => err.code === "OLLAMA_NETWORK_DENIED"
        && err.permission_decision?.reason_code === "role_capability_domain_denied",
    );
  });

  it("runOllama uses Olla path prefix for /api/chat", async () => {
    const { runOllama } = require("../agents/runtime/run-ollama.js");
    const ollaPort = serverPort + 1;
    const ollaServer = http.createServer((req, res) => {
      if (req.url === "/olla/ollama/api/chat" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { content: "olla-ok" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      ollaServer.listen(ollaPort, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    try {
      const out = await runOllama("sys", [{ role: "user", content: "hi" }], {
        model: "m",
        endpoint: {
          host: "127.0.0.1",
          port: ollaPort,
          base_path: "/olla/ollama",
          source: "cli_base_url",
        },
        timeoutMs: 5000,
      });
      assert.equal(out.content, "olla-ok");
    } finally {
      await new Promise((resolve) => ollaServer.close(() => resolve()));
    }
  });
});
