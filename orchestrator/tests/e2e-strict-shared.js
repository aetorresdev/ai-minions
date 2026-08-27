/**
 * Shared helpers for system-path E2E (`e2e.strict*.test.js`).
 * Entry files must set `process.env.ORCH_MCP_TRANSPORT = "direct"` before requiring orchestrator.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
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
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "ai-minions-e2e-strict-"));
}

function removeTempDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

function parseMcpDirectStdout(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* fallthrough */
  }
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* continue */
    }
  }
  return t;
}

function resolveRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

/**
 * Materialize install-time model-policy.yaml for E2E/MCP-direct legs.
 * CI sets OLLAMA_MODEL for the orchestrator Node path; compact-handoff reads
 * default_model from YAML (not env). Does not overwrite model_policy.json routing.
 * @param {{ repoRoot?: string, model?: string, host?: string, port?: number }} [options]
 */
function materializeE2eModelPolicy(options = {}) {
  const repoRoot = options.repoRoot || resolveRepoRoot();
  const model = options.model || process.env.OLLAMA_MODEL;
  if (!model || !String(model).trim()) {
    throw new Error("materializeE2eModelPolicy: model required");
  }
  let host = String(options.host || process.env.OLLAMA_HOST || "127.0.0.1").trim();
  if (host === "localhost" || host === "0.0.0.0") host = "127.0.0.1";
  const port = Number(options.port || process.env.OLLAMA_PORT || 11434);
  const configDir = path.join(repoRoot, ".ai-minions");
  fs.mkdirSync(configDir, { recursive: true });
  const yaml = [
    "model_policy_version: 1",
    `default_model: ${String(model).trim()}`,
    "local_backend:",
    "  backend_id: ollama",
    "  support_status: supported",
    `  host: ${host}`,
    `  port: ${port}`,
    `  base_url: http://${host}:${port}`,
    "  endpoint_scope: localhost",
    "",
  ].join("\n");
  const configPath = path.join(configDir, "model-policy.yaml");
  fs.writeFileSync(configPath, yaml, "utf8");
  process.env.REPO_ROOT = repoRoot;
  return { repoRoot, configPath };
}

function callMcpDirect(mcpScript, server, tool, args) {
  const py = process.env.ORCH_PYTHON || "python3";
  const payload = JSON.stringify({ server, tool, args });
  const r = spawnSync(py, [mcpScript], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env, REPO_ROOT: resolveRepoRoot() },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "").trim() || `mcp-direct exited ${r.status}`);
  }
  return parseMcpDirectStdout(r.stdout);
}

function loadEvents(eventsPath) {
  const raw = fs.readFileSync(eventsPath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function assertHashChain(events) {
  const assert = require("node:assert/strict");
  assert.ok(events.length >= 1, "events must be non-empty");
  for (let i = 1; i < events.length; i++) {
    assert.equal(
      events[i].prev_hash,
      events[i - 1].hash,
      `hash chain broken at seq ${events[i].seq}`,
    );
  }
}

function traceDir() {
  return process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim()
    ? path.resolve(String(process.env.ORCH_TRACES_DIR).trim())
    : path.join(os.homedir(), ".claude", "metrics", "traces");
}

/**
 * Count `gate_result` rows for real `validate_goal_alignment` outcomes (excludes harness-only `test_system_path_harness: true`).
 * @param {string} taskId
 * @returns {{ checks: number, failures: number }}
 */
function countGoalAlignmentInTrace(taskId) {
  const p = path.join(traceDir(), `${taskId}.jsonl`);
  if (!fs.existsSync(p)) return { checks: 0, failures: 0 };
  let checks = 0;
  let failures = 0;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.event !== "gate_result" || ev.gate !== "goal_alignment") continue;
      if (ev.test_system_path_harness === true) continue;
      checks++;
      if (ev.passed === false) failures++;
    } catch {
      /* skip bad line */
    }
  }
  return { checks, failures };
}

/**
 * @returns {Promise<{ ollamaAvailable: boolean, ollamaModel: string | null, mcpDirectExists: boolean }>}
 */
async function initE2eStrictSuite() {
  const MCP_DIRECT = path.join(__dirname, "..", "mcp-direct.py");
  if (!fs.existsSync(MCP_DIRECT)) {
    console.log("[e2e-strict] mcp-direct.py missing — skipping");
    return { ollamaAvailable: false, ollamaModel: null, mcpDirectExists: false };
  }
  const models = await listOllamaModels();
  if (!models || models.length === 0) {
    console.log(`[e2e-strict] Ollama not reachable at ${OLLAMA_HOST}:${OLLAMA_PORT} — skipping`);
    return { ollamaAvailable: false, ollamaModel: null, mcpDirectExists: true };
  }
  let ollamaModel = null;
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
  materializeE2eModelPolicy({ model: ollamaModel, host: OLLAMA_HOST, port: OLLAMA_PORT });
  console.log(`[e2e-strict] Ollama model: ${ollamaModel} | ORCH_MCP_TRANSPORT=direct`);
  return { ollamaAvailable: true, ollamaModel, mcpDirectExists: true };
}

module.exports = {
  OLLAMA_HOST,
  OLLAMA_PORT,
  PREFERRED_MODEL,
  TEST_TIMEOUT_MS,
  getMcpDirectPath: () => path.join(__dirname, "..", "mcp-direct.py"),
  listOllamaModels,
  makeTempDir,
  removeTempDir,
  parseMcpDirectStdout,
  callMcpDirect,
  loadEvents,
  assertHashChain,
  traceDir,
  countGoalAlignmentInTrace,
  initE2eStrictSuite,
  materializeE2eModelPolicy,
  resolveRepoRoot,
};
