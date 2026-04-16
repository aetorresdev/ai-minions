/**
 * E2E-STRICT: `skipStateMcp: false` with `ORCH_MCP_TRANSPORT=direct` so gates use
 * `mcp-direct.py` (Python + mcp-servers venvs) instead of the claude CLI.
 *
 * Prerequisites: Ollama; `uv sync` in mcp-servers/orchestrator-state and compact-handoff
 * (same as main E2E). Isolated disk state via ORCHESTRATOR_STATE_ROOT per test.
 *
 * Run: npm run test:e2e:strict
 */

"use strict";

process.env.ORCH_MCP_TRANSPORT = "direct";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run } = require("../orchestrator");
const { setBackend } = require("../agents");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost";
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || "11434", 10);
const PREFERRED_MODEL = "qwen2.5-coder:7b";
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

function listOllamaModels() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: OLLAMA_HOST, port: OLLAMA_PORT, path: "/api/tags", timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const names = (data.models || []).map((m) => m.name);
            resolve(names);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "ai-minions-e2e-strict-"));
}

function removeTempDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ }
}

let ollamaAvailable = false;
let ollamaModel = null;

describe("E2E-STRICT — MCP direct + state store", { timeout: TEST_TIMEOUT_MS, concurrency: 1 }, () => {
  const MCP_DIRECT = path.join(__dirname, "..", "mcp-direct.py");

  before(async () => {
    if (!fs.existsSync(MCP_DIRECT)) {
      console.log("[e2e-strict] mcp-direct.py missing — skipping");
      return;
    }
    const models = await listOllamaModels();
    if (!models || models.length === 0) {
      console.log(`[e2e-strict] Ollama not reachable at ${OLLAMA_HOST}:${OLLAMA_PORT} — skipping`);
      return;
    }
    ollamaAvailable = true;
    const envModel = process.env.OLLAMA_MODEL;
    if (envModel && models.includes(envModel)) {
      ollamaModel = envModel;
    } else if (models.includes(PREFERRED_MODEL)) {
      ollamaModel = PREFERRED_MODEL;
    } else {
      ollamaModel = models[0];
    }
    process.env.OLLAMA_MODEL = ollamaModel;
    setBackend("ollama");
    console.log(`[e2e-strict] Ollama model: ${ollamaModel} | ORCH_MCP_TRANSPORT=direct`);
  });

  function skipIfNoDeps(t) {
    if (!fs.existsSync(MCP_DIRECT)) {
      t.skip("mcp-direct.py not found");
      return true;
    }
    if (!ollamaAvailable) {
      t.skip("Ollama not available");
      return true;
    }
    return false;
  }

  test("run with skipStateMcp:false registers task and writes events.jsonl under ORCHESTRATOR_STATE_ROOT", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-");
    const cwd = makeTempDir("orch-cwd-");
    const taskId = `strict-${Date.now()}`;
    const prevStateRoot = process.env.ORCHESTRATOR_STATE_ROOT;

    try {
      process.env.ORCHESTRATOR_STATE_ROOT = stateRoot;
      fs.writeFileSync(
        path.join(cwd, "utils.js"),
        "function add(a, b) { return a + b; }\nmodule.exports = { add };\n"
      );

      await run(
        "Add a multiply function to utils.js that multiplies two numbers",
        {
          taskId,
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: false,
          stepSummary: true,
        }
      );

      const eventsPath = path.join(stateRoot, taskId, "events.jsonl");
      assert.ok(fs.existsSync(eventsPath), `expected events at ${eventsPath}`);
      const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
      assert.ok(lines.length >= 1, "events.jsonl should have at least one line");
      const types = lines.map((l) => JSON.parse(l).type);
      assert.ok(types.includes("task_registered"), `expected task_registered in ${types.join(",")}`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      removeTempDir(stateRoot);
      removeTempDir(cwd);
    }
  });
});
