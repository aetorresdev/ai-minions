"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveMcpTransport,
  mapClaudeCliTransportError,
  GATE_TRANSPORT_UNAVAILABLE,
  callStateMcp,
} = require("../modules/tools/mcp-client");

describe("resolveMcpTransport", () => {
  it("honors ORCH_MCP_TRANSPORT=direct", () => {
    assert.equal(
      resolveMcpTransport({ env: { ORCH_MCP_TRANSPORT: "direct" }, modelPolicy: "remote_ok" }),
      "direct",
    );
  });

  it("honors ORCH_MCP_TRANSPORT=claude_cli even under local_only", () => {
    assert.equal(
      resolveMcpTransport({
        env: { ORCH_MCP_TRANSPORT: "claude_cli", ORCH_MODEL_MODE: "local_only" },
      }),
      "claude_cli",
    );
  });

  it("defaults to direct when ORCH_MODEL_MODE=local_only", () => {
    assert.equal(
      resolveMcpTransport({ env: { ORCH_MODEL_MODE: "local_only" } }),
      "direct",
    );
  });

  it("defaults to direct when modelPolicy local_only", () => {
    assert.equal(
      resolveMcpTransport({ env: {}, modelPolicy: "local_only" }),
      "direct",
    );
  });

  it("defaults to claude_cli when remote_ok and no env override", () => {
    assert.equal(
      resolveMcpTransport({ env: {}, modelPolicy: "remote_ok" }),
      "claude_cli",
    );
  });
});

describe("mapClaudeCliTransportError", () => {
  it("maps ENOENT to GATE_TRANSPORT_UNAVAILABLE", () => {
    const err = new Error("spawn claude ENOENT");
    err.code = "ENOENT";
    const mapped = mapClaudeCliTransportError(err, "orchestrator-state");
    assert.equal(mapped.code, GATE_TRANSPORT_UNAVAILABLE);
    assert.match(mapped.message, /GATE_TRANSPORT_UNAVAILABLE/);
    assert.match(mapped.message, /ORCH_MCP_TRANSPORT=direct/);
    assert.doesNotMatch(mapped.message, /spawnSync/);
  });

  it("passes through non-ENOENT errors", () => {
    const err = new Error("timeout");
    const mapped = mapClaudeCliTransportError(err);
    assert.equal(mapped, err);
  });
});

describe("callStateMcp claude_cli ENOENT", () => {
  let savedEnv;
  let spawnMock;

  beforeEach(() => {
    savedEnv = {
      ORCH_MCP_TRANSPORT: process.env.ORCH_MCP_TRANSPORT,
      ORCH_MODEL_MODE: process.env.ORCH_MODEL_MODE,
      ORCH_SKIP_MCP_PERMISSION_GATE: process.env.ORCH_SKIP_MCP_PERMISSION_GATE,
      ORCH_SKIP_CONTEXT_AUTHORITY_GATE: process.env.ORCH_SKIP_CONTEXT_AUTHORITY_GATE,
    };
    process.env.ORCH_MCP_TRANSPORT = "claude_cli";
    delete process.env.ORCH_MODEL_MODE;
    process.env.ORCH_SKIP_MCP_PERMISSION_GATE = "1";
    process.env.ORCH_SKIP_CONTEXT_AUTHORITY_GATE = "1";

    const cp = require("child_process");
    spawnMock = mock.method(cp, "spawnSync", () => {
      const err = new Error("spawn claude ENOENT");
      err.code = "ENOENT";
      return { status: null, error: err, stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    spawnMock.mock.restore();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("throws GATE_TRANSPORT_UNAVAILABLE instead of raw ENOENT", () => {
    assert.throws(
      () => callStateMcp("get_status", { task_id: "t1" }),
      (err) => {
        assert.equal(err.code, GATE_TRANSPORT_UNAVAILABLE);
        assert.doesNotMatch(err.message, /spawnSync/);
        return true;
      },
    );
  });
});

describe("runOllama budget + done_reason", () => {
  let server;
  let serverPort;
  let tmpDir;
  let savedEnv;
  /** @type {object | null} */
  let lastBody = null;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-budget-"));
    savedEnv = {
      ORCH_SKIP_NETWORK_PERMISSION_GATE: process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE,
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      OLLAMA_PORT: process.env.OLLAMA_PORT,
      OLLAMA_NUM_PREDICT: process.env.OLLAMA_NUM_PREDICT,
    };
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    delete process.env.OLLAMA_NUM_PREDICT;
    serverPort = 19080 + Math.floor(Math.random() * 1000);
    process.env.OLLAMA_HOST = "127.0.0.1";
    process.env.OLLAMA_PORT = String(serverPort);
    lastBody = null;

    server = http.createServer((req, res) => {
      if (req.url === "/api/chat" && req.method === "POST") {
        let data = "";
        req.on("data", (c) => { data += c; });
        req.on("end", () => {
          lastBody = JSON.parse(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            message: { content: "" },
            done_reason: "length",
            eval_count: 512,
          }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.listen(serverPort, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });

    fs.mkdirSync(path.join(tmpDir, ".ai-minions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".ai-minions", "model_policy.json"),
      JSON.stringify({
        model_policy_version: 1,
        default_tier: "standard",
        tiers: { cheap: ["m"], standard: ["m"], strong: ["m"], frontier: [] },
        role_defaults: {
          ORCHESTRATOR: "standard",
          OWNER: "standard",
          ARCHITECT: "strong",
          DEV: "standard",
          QA: "standard",
          CERBERUS: "strong",
        },
        rules: [],
        provider_inference_profiles: {
          ollama: {
            default: { effort: "medium", thinking_mode: "disabled", thinking_display: "omit", max_tokens: 8192, profile_source: "installer_default" },
            by_role: {
              ARCHITECT: { effort: "high", thinking_mode: "adaptive", thinking_display: "omit", max_tokens: 16384, profile_source: "installer_default" },
            },
          },
        },
      }),
    );
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

  it("applies profile max_tokens as num_predict and returns done_reason", async () => {
    const { runOllama } = require("../modules/model-runtime/run-ollama");
    const out = await runOllama("sys", [{ role: "user", content: "hi" }], {
      model: "m",
      cwd: tmpDir,
      traceRole: "ARCHITECT",
      timeoutMs: 5000,
    });
    assert.equal(lastBody.options.num_predict, 16384);
    assert.equal(out.content, "");
    assert.equal(out.done_reason, "length");
    assert.equal(out.num_predict, 16384);
    assert.equal(out.inference_profile_mode, "applied");
  });
});
