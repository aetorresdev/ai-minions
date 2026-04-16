/**
 * System-path E2E suite (`npm run test:e2e:strict` or `test:e2e:system-path`):
 * `skipStateMcp: false` + `ORCH_MCP_TRANSPORT=direct` so gates use `mcp-direct.py`
 * instead of the claude CLI.
 *
 * **Naming:** this is *not* full "strict" in the product sense — one test sets
 * `ORCH_TEST_SYSTEM_PATH_HARNESS=1` (deterministic stubs + controlled alignment bypass) to
 * prove store/transitions/compact_handoff only. See README.
 *
 * Prerequisites: Ollama; `uv sync` in mcp-servers/orchestrator-state and compact-handoff.
 * Isolated disk state via ORCHESTRATOR_STATE_ROOT per test.
 */

"use strict";

process.env.ORCH_MCP_TRANSPORT = "direct";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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

/** Parse first JSON object or last parseable JSON line (mcp-direct stdout). */
function parseMcpDirectStdout(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch { /* fallthrough */ }
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line);
    } catch { /* continue */ }
  }
  return t;
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
  assert.ok(events.length >= 1, "events must be non-empty");
  for (let i = 1; i < events.length; i++) {
    assert.equal(
      events[i].prev_hash,
      events[i - 1].hash,
      `hash chain broken at seq ${events[i].seq}`
    );
  }
}

let ollamaAvailable = false;
let ollamaModel = null;

describe("System-path E2E — MCP direct + state store", { timeout: TEST_TIMEOUT_MS, concurrency: 1 }, () => {
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

  test("run() strict: task_registered, mode_advanced, task_closed + intact hash chain", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-");
    const cwd = makeTempDir("orch-cwd-");
    const taskId = `strict-run-${Date.now()}`;
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
      const events = loadEvents(eventsPath);
      assert.ok(events.length >= 1, "events.jsonl should have at least one line");
      assertHashChain(events);

      const types = events.map((e) => e.type);
      assert.ok(types.includes("task_registered"), `expected task_registered in ${types.join(",")}`);
      assert.ok(types.includes("mode_advanced"), `expected mode_advanced (ORCH→first MODE) in ${types.join(",")}`);
      assert.ok(types.includes("task_closed"), `expected task_closed in ${types.join(",")}`);

      t.diagnostic(`strict run events: ${types.join(" → ")} (${events.length} total)`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      removeTempDir(stateRoot);
      removeTempDir(cwd);
    }
  });

  /**
   * Deterministic transition path on disk: alignment enforcement disabled so we do not
   * depend on Ollama's validate_goal_alignment verdict. Still exercises real advance_mode,
   * validate_transition, and append-only events (handoff_yaml non-empty).
   */
  test("mcp-direct strict chain: register → advance → validate_transition → advance → close + hash chain", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-chain-");
    const taskId = `strict-chain-${Date.now()}`;
    const prevStateRoot = process.env.ORCHESTRATOR_STATE_ROOT;

    try {
      process.env.ORCHESTRATOR_STATE_ROOT = stateRoot;

      const reg = callMcpDirect(MCP_DIRECT, "orchestrator-state", "register_task", {
        goal: "Add multiply to utils.js",
        task_id: taskId,
        flow_mode: "single_agent",
        max_iterations: 3,
        approved_artifacts: "[]",
        enforce_goal_alignment: false,
        enforce_approved_artifacts: false,
      });
      assert.equal(reg.ok, true, `register_task: ${JSON.stringify(reg)}`);

      const adv1 = callMcpDirect(MCP_DIRECT, "orchestrator-state", "advance_mode", {
        task_id: taskId,
        from_mode: "ORCHESTRATOR",
        to_mode: "DEV",
        handoff_yaml: "",
        iteration: -1,
      });
      assert.equal(adv1.ok, true, `advance ORCH→DEV: ${JSON.stringify(adv1)}`);

      const handoffYaml = [
        "files_modified:",
        "  - utils.js",
        "validation_run: node -c utils.js → exit 0",
        "iteration: 1",
      ].join("\n");

      const vt = callMcpDirect(MCP_DIRECT, "orchestrator-state", "validate_transition", {
        task_id: taskId,
        from_mode: "DEV",
        to_mode: "ORCHESTRATOR",
        handoff_yaml: handoffYaml,
        iteration: 1,
      });
      assert.equal(vt.ok, true, `validate_transition response: ${JSON.stringify(vt)}`);
      assert.equal(vt.allowed, true, `transition must be allowed: ${JSON.stringify(vt.errors || [])}`);

      const adv2 = callMcpDirect(MCP_DIRECT, "orchestrator-state", "advance_mode", {
        task_id: taskId,
        from_mode: "DEV",
        to_mode: "ORCHESTRATOR",
        handoff_yaml: handoffYaml,
        iteration: 1,
      });
      assert.equal(adv2.ok, true, `advance DEV→ORCH: ${JSON.stringify(adv2)}`);

      const close = callMcpDirect(MCP_DIRECT, "orchestrator-state", "close_task", {
        task_id: taskId,
        reason: "e2e-strict chain complete",
      });
      assert.equal(close.ok, true, `close_task: ${JSON.stringify(close)}`);

      const eventsPath = path.join(stateRoot, taskId, "events.jsonl");
      const events = loadEvents(eventsPath);
      assertHashChain(events);
      const types = events.map((e) => e.type);
      assert.ok(types.filter((x) => x === "mode_advanced").length >= 2, "expected ≥2 mode_advanced events");
      assert.ok(types.includes("task_registered"), `missing task_registered: ${types}`);
      assert.ok(types.includes("task_closed"), `missing task_closed: ${types}`);

      const lastAdvance = events.filter((e) => e.type === "mode_advanced").pop();
      assert.ok(
        lastAdvance && lastAdvance.payload && lastAdvance.payload.handoff_yaml_present === true,
        "last mode_advanced should record handoff_yaml_present: true"
      );

      t.diagnostic(`strict chain events: ${types.join(" → ")}`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      removeTempDir(stateRoot);
    }
  });

  test("compact_handoff (direct) returns YAML with DEV handoff keys when Ollama compacts contract-shaped text", async (t) => {
    if (skipIfNoDeps(t)) return;

    const devText = [
      "files_read: [utils.js]",
      "files_modified: [utils.js]",
      "validation_run: node -c utils.js → OK",
      "Added multiply() exporting { add, multiply }.",
    ].join("\n");

    const out = callMcpDirect(MCP_DIRECT, "compact-handoff", "compact_handoff", {
      text: devText,
      mode_completed: "DEV",
      next_mode: "ORCHESTRATOR",
      iteration: 1,
      max_iterations: 1,
      flow_mode: "single_agent",
    });

    const yaml = typeof out === "string" ? out : "";
    if (!yaml || yaml.startsWith("error:")) {
      t.skip(`compact_handoff unavailable: ${String(yaml).slice(0, 120)}`);
      return;
    }
    const low = yaml.toLowerCase();
    assert.ok(
      low.includes("files_modified") || low.includes("validation_run"),
      `expected DEV keys in compact output, got: ${yaml.slice(0, 200)}`
    );
    t.diagnostic(`compact_handoff sample: ${yaml.slice(0, 160).replace(/\n/g, " ")}…`);
  });

  test("validate_transition rejects when handoff is non-empty but goal alignment never validated (default register)", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-negalign-");
    const taskId = `strict-negalign-${Date.now()}`;
    const prevStateRoot = process.env.ORCHESTRATOR_STATE_ROOT;

    try {
      process.env.ORCHESTRATOR_STATE_ROOT = stateRoot;

      const reg = callMcpDirect(MCP_DIRECT, "orchestrator-state", "register_task", {
        goal: "Add multiply",
        task_id: taskId,
        flow_mode: "single_agent",
        max_iterations: 3,
        approved_artifacts: "[]",
      });
      assert.equal(reg.ok, true, JSON.stringify(reg));

      const adv1 = callMcpDirect(MCP_DIRECT, "orchestrator-state", "advance_mode", {
        task_id: taskId,
        from_mode: "ORCHESTRATOR",
        to_mode: "DEV",
        handoff_yaml: "",
        iteration: -1,
      });
      assert.equal(adv1.ok, true, JSON.stringify(adv1));

      const handoffYaml = "files_modified:\n  - utils.js\nvalidation_run: npm test\n";
      const vt = callMcpDirect(MCP_DIRECT, "orchestrator-state", "validate_transition", {
        task_id: taskId,
        from_mode: "DEV",
        to_mode: "ORCHESTRATOR",
        handoff_yaml: handoffYaml,
        iteration: 1,
      });
      assert.equal(vt.ok, true, JSON.stringify(vt));
      assert.equal(vt.allowed, false, "transition must be blocked until validate_goal_alignment passes");
      const errText = (vt.errors || []).join(" ");
      assert.match(errText, /goal_alignment/i, `expected alignment error, got: ${errText}`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      removeTempDir(stateRoot);
    }
  });

  test("validate_transition rejects when iteration exceeds max_iterations", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-negit-");
    const taskId = `strict-negit-${Date.now()}`;
    const prevStateRoot = process.env.ORCHESTRATOR_STATE_ROOT;

    try {
      process.env.ORCHESTRATOR_STATE_ROOT = stateRoot;

      const reg = callMcpDirect(MCP_DIRECT, "orchestrator-state", "register_task", {
        goal: "x",
        task_id: taskId,
        flow_mode: "single_agent",
        max_iterations: 1,
        approved_artifacts: "[]",
        enforce_goal_alignment: false,
        enforce_approved_artifacts: false,
      });
      assert.equal(reg.ok, true, JSON.stringify(reg));

      callMcpDirect(MCP_DIRECT, "orchestrator-state", "advance_mode", {
        task_id: taskId,
        from_mode: "ORCHESTRATOR",
        to_mode: "DEV",
        handoff_yaml: "",
        iteration: -1,
      });

      const vt = callMcpDirect(MCP_DIRECT, "orchestrator-state", "validate_transition", {
        task_id: taskId,
        from_mode: "DEV",
        to_mode: "ORCHESTRATOR",
        handoff_yaml: "files_modified:\n  - a.js\nvalidation_run: pass\n",
        iteration: 99,
      });
      assert.equal(vt.ok, true, JSON.stringify(vt));
      assert.equal(vt.allowed, false);
      const errText = (vt.errors || []).join(" ");
      assert.match(errText, /max_iterations|exceeds/i, `expected iteration cap error, got: ${errText}`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      removeTempDir(stateRoot);
    }
  });

  test("run() + ORCH_TEST_SYSTEM_PATH_HARNESS: compact_handoff, goal_alignment_validated, transitions on disk", async (t) => {
    if (skipIfNoDeps(t)) return;

    const stateRoot = makeTempDir("orch-state-gatepath-");
    const cwd = makeTempDir("orch-cwd-gatepath-");
    const taskId = `strict-gate-${Date.now()}`;
    const prevStateRoot = process.env.ORCHESTRATOR_STATE_ROOT;
    const prevHarness = process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;

    try {
      process.env.ORCHESTRATOR_STATE_ROOT = stateRoot;
      process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = "1";
      fs.writeFileSync(
        path.join(cwd, "utils.js"),
        "function add(a, b) { return a + b; }\nmodule.exports = { add };\n"
      );

      const result = await run("E2E system-path harness (deterministic stubs)", {
        taskId,
        maxIterations: 1,
        cwd,
        flowMode: "single_agent",
        skipStateMcp: false,
        stepSummary: true,
      });

      assert.equal(result.done, true, `expected done=true, got ${JSON.stringify(result)}`);

      const eventsPath = path.join(stateRoot, taskId, "events.jsonl");
      const events = loadEvents(eventsPath);
      assertHashChain(events);
      const types = events.map((e) => e.type);
      assert.ok(types.includes("goal_alignment_validated"), `expected goal_alignment_validated in ${types.join(",")}`);
      assert.ok(types.includes("task_closed"), `expected task_closed in ${types.join(",")}`);
      assert.ok(
        types.filter((x) => x === "mode_advanced").length >= 3,
        `expected ≥3 mode_advanced (ORCH→DEV, DEV→…, CERBERUS→ORCH), got ${types.filter((x) => x === "mode_advanced").length}`
      );

      t.diagnostic(`gate-path events: ${types.join(" → ")}`);
    } finally {
      if (prevStateRoot === undefined) delete process.env.ORCHESTRATOR_STATE_ROOT;
      else process.env.ORCHESTRATOR_STATE_ROOT = prevStateRoot;
      if (prevHarness === undefined) delete process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;
      else process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = prevHarness;
      removeTempDir(stateRoot);
      removeTempDir(cwd);
    }
  });
});
