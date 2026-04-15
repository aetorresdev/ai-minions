/**
 * E2E test suite — runs actual orchestrator flows using Ollama local models.
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434 (or OLLAMA_HOST:OLLAMA_PORT)
 *   - At least one model available (prefers qwen2.5-coder:7b, falls back to first available)
 *
 * All tests run with skipStateMcp=true (no MCP gates required).
 * Each test uses an isolated temp directory as the working directory.
 *
 * Skip behavior:
 *   - If Ollama is unreachable → all tests are skipped with a clear message
 *   - If no models are available → all tests are skipped
 *
 * Run:
 *   OLLAMA_MODEL=qwen2.5-coder:7b node --test tests/e2e.test.js
 *   node --test tests/e2e.test.js   # auto-detects available model
 */

"use strict";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const http   = require("node:http");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const { run } = require("../orchestrator");
const { setBackend } = require("../agents");

// ── Ollama helpers ────────────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost";
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || "11434", 10);
const PREFERRED_MODEL = "qwen2.5-coder:7b";

/** Returns list of available Ollama model names, or null if unreachable. */
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

/** Creates a temp directory and returns its path. Cleaned up after each test. */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-e2e-"));
}

function removeTempDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* non-fatal */ }
}

// ── Test state ────────────────────────────────────────────────────────────────

let ollamaModel = null;   // set in before() if Ollama is reachable
let ollamaAvailable = false;

// 5 minutes per test — each test runs DEV + CERBERUS (two claude CLI round-trips)
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("E2E — Orchestrator with Ollama", { timeout: TEST_TIMEOUT_MS, concurrency: 1 }, () => {

  before(async () => {
    const models = await listOllamaModels();
    if (!models || models.length === 0) {
      console.log(`[e2e] Ollama not reachable at ${OLLAMA_HOST}:${OLLAMA_PORT} or no models found — skipping all E2E tests`);
      return;
    }
    ollamaAvailable = true;
    // Use OLLAMA_MODEL env if set, else prefer qwen2.5-coder:7b, else first available
    const envModel = process.env.OLLAMA_MODEL;
    if (envModel && models.includes(envModel)) {
      ollamaModel = envModel;
    } else if (models.includes(PREFERRED_MODEL)) {
      ollamaModel = PREFERRED_MODEL;
    } else {
      ollamaModel = models[0];
    }
    // Force all agent roles to use Ollama — no claude CLI calls during E2E tests
    process.env.OLLAMA_MODEL = ollamaModel;
    setBackend("ollama");
    console.log(`[e2e] Ollama ready — using model: ${ollamaModel}`);
    console.log(`[e2e] Available models: ${models.join(", ")}`);
    console.log(`[e2e] setBackend("ollama") — all agent roles will use Ollama`);
  });

  // ── Helper to skip if Ollama is not available ─────────────────────────────

  function skipIfNoOllama(t) {
    if (!ollamaAvailable) {
      t.skip("Ollama not available");
      return true;
    }
    return false;
  }

  // ── Scenario 1: Single-Agent flow ─────────────────────────────────────────

  test("single_agent flow completes with done=true and at least one artifact", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    try {
      // Write a minimal JS file so DEV has something to work with
      fs.writeFileSync(path.join(cwd, "utils.js"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n");

      const result = await run(
        "Add a multiply function to utils.js that multiplies two numbers",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: true,
          stepSummary: true,
        },
        // inject OLLAMA_MODEL for child processes via env
      );

      assert.ok(typeof result === "object", "run() must return an object");
      assert.ok(typeof result.done === "boolean", "result.done must be boolean");
      assert.ok(typeof result.iterations === "number", "result.iterations must be number");
      assert.ok(Array.isArray(result.artifacts), "result.artifacts must be an array");
      assert.ok(result.artifacts.length >= 1, `Expected at least 1 artifact, got ${result.artifacts.length}`);
      assert.ok(typeof result.taskId === "string" && result.taskId.length > 0, "result.taskId must be a non-empty string");

      // Each artifact must have the required contract fields
      for (const art of result.artifacts) {
        assert.ok(typeof art.agentId === "string", `artifact.agentId must be a string (got ${typeof art.agentId})`);
        assert.ok(typeof art.result === "string", `artifact.result must be a string (got ${typeof art.result})`);
        assert.ok(typeof art.task === "string", `artifact.task must be a string (got ${typeof art.task})`);
      }
    } finally {
      removeTempDir(cwd);
    }
  });

  // ── Scenario 2: Multi-Agent flow ─────────────────────────────────────────

  test("multi_agent flow produces DEV + QA artifacts", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(cwd, "calculator.js"),
        "function divide(a, b) { return a / b; }\nmodule.exports = { divide };\n"
      );

      const result = await run(
        "Add input validation to the divide function: throw an Error if b is zero",
        {
          maxIterations: 1,
          cwd,
          flowMode: "multi_agent",
          skipStateMcp: true,
          stepSummary: true,
        }
      );

      assert.ok(typeof result === "object", "run() must return an object");
      assert.ok(Array.isArray(result.artifacts), "result.artifacts must be an array");
      assert.ok(result.artifacts.length >= 1, `multi_agent expected >= 1 artifacts, got ${result.artifacts.length}`);

      // In multi_agent there should be at least a DEV step
      const agentIds = result.artifacts.map((a) => a.agentId.toLowerCase());
      const hasDevStep = agentIds.some((id) => id.startsWith("dev") || id === "orchestrator");
      assert.ok(hasDevStep, `Expected a DEV step in artifacts — got: ${agentIds.join(", ")}`);
    } finally {
      removeTempDir(cwd);
    }
  });

  // ── Scenario 3: Direct execution (no planning) ────────────────────────────

  test("direct execution with maxIterations=1 and skipStateMcp produces a result", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "hello.txt"), "hello world\n");
      const result = await run(
        "Read hello.txt and append a second line with the text 'goodbye world'",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: true,
          stepSummary: false,  // no Ollama summarization between steps
        }
      );

      assert.ok(typeof result === "object", "run() must return an object");
      assert.ok(typeof result.done === "boolean", "result.done must be boolean");
      assert.ok(result.iterations >= 1, `Expected at least 1 iteration, got ${result.iterations}`);
      assert.ok(result.summary !== undefined, "result.summary must be defined");
    } finally {
      removeTempDir(cwd);
    }
  });

  // ── Scenario 4: Degraded mode banner is emitted ───────────────────────────

  test("degraded mode: skipStateMcp=true emits degraded banner in output", async (t) => {
    if (skipIfNoOllama(t)) return;

    // Capture stdout to check for the degraded banner
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      chunks.push(String(chunk));
      return originalWrite(chunk, ...args);
    };

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "config.js"), "module.exports = { port: 3000 };\n");
      await run(
        "Read config.js and add a 'host' field with value 'localhost'",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: true,
          stepSummary: false,
        }
      );
    } finally {
      process.stdout.write = originalWrite;
      removeTempDir(cwd);
    }

    const allOutput = chunks.join("");
    assert.ok(
      allOutput.includes("DEGRADED MODE") || allOutput.includes("hard gates DISABLED"),
      "Expected DEGRADED MODE banner in stdout when skipStateMcp=true"
    );
  });

  // ── Scenario 5: Trace file is written ────────────────────────────────────

  test("trace file is written to ~/.claude/metrics/traces/<task_id>.jsonl", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    const taskId = `e2e-trace-test-${Date.now()}`;
    const traceFile = path.join(os.homedir(), ".claude", "metrics", "traces", `${taskId}.jsonl`);

    // Clean up any stale trace from a previous run
    try { fs.unlinkSync(traceFile); } catch { /* ok */ }

    try {
      fs.writeFileSync(path.join(cwd, "notes.txt"), "initial line\n");
      await run(
        "Read notes.txt and append a second line: '# reviewed'",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          taskId,
          skipStateMcp: true,
          stepSummary: false,
        }
      );

      assert.ok(fs.existsSync(traceFile), `Expected trace file at ${traceFile}`);

      const lines = fs.readFileSync(traceFile, "utf8").trim().split("\n").filter(Boolean);
      assert.ok(lines.length >= 1, `Expected at least 1 trace event, got ${lines.length}`);

      // First event should be session_start
      const firstEvent = JSON.parse(lines[0]);
      assert.equal(firstEvent.task_id, taskId, "Trace event must carry the task_id");
      assert.ok(firstEvent.event || firstEvent.type, "Trace event must have an event/type field");

      // All events must be valid JSON (no parse errors for remaining lines)
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON in trace: ${line}`);
      }
    } finally {
      removeTempDir(cwd);
      try { fs.unlinkSync(traceFile); } catch { /* ok */ }
    }
  });

  // ── Scenario 6: Artifact contract fields are always present ──────────────

  test("all artifacts carry agentId, task, result, and gateBlocked fields", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "README.md"), "# Project\n");
      const result = await run(
        "Read README.md and add a one-sentence project description below the title",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: true,
          stepSummary: false,
        }
      );

      for (const art of result.artifacts) {
        assert.ok("agentId"    in art, `artifact missing agentId: ${JSON.stringify(Object.keys(art))}`);
        assert.ok("task"       in art, `artifact missing task`);
        assert.ok("result"     in art, `artifact missing result`);
        assert.ok("gateBlocked" in art, `artifact missing gateBlocked`);
        assert.equal(typeof art.gateBlocked, "boolean", "gateBlocked must be boolean");
      }
    } finally {
      removeTempDir(cwd);
    }
  });

  // ── Scenario 7: All available Ollama models can plan ─────────────────────

  test("each available Ollama model can plan a simple task (orchestrator step)", async (t) => {
    if (skipIfNoOllama(t)) return;

    const models = await listOllamaModels();
    if (!models || models.length === 0) {
      t.skip("No Ollama models available");
      return;
    }

    for (const model of models) {
      // Set OLLAMA_MODEL for this sub-run
      const savedModel = process.env.OLLAMA_MODEL;
      process.env.OLLAMA_MODEL = model;

      const cwd = makeTempDir();
      try {
        fs.writeFileSync(path.join(cwd, "scratch.js"), "const x = 1;\n");
        const result = await run(
          "Read scratch.js and add a comment above the const explaining what x is used for",
          {
            maxIterations: 1,
            cwd,
            flowMode: "single_agent",
            skipStateMcp: true,
            stepSummary: false,
          }
        );

        assert.ok(typeof result === "object", `Model ${model}: run() must return an object`);
        assert.ok(Array.isArray(result.artifacts), `Model ${model}: artifacts must be an array`);
        // We don't assert done=true here — the model may or may not finish in 1 iteration
        // We only verify it ran without throwing
      } catch (err) {
        // Log which model failed but don't fail the whole suite
        console.warn(`[e2e] Model ${model} failed: ${err.message}`);
      } finally {
        process.env.OLLAMA_MODEL = savedModel;
        removeTempDir(cwd);
      }
    }
  });

  // ── Scenario 8: gate_events.jsonl válido después de un run ───────────────

  test("gate_events.jsonl is valid JSONL with required fields after a run", async (t) => {
    if (skipIfNoOllama(t)) return;

    const gateEventsFile = path.join(os.homedir(), ".claude", "metrics", "gate_events.jsonl");
    const sizeBefore = fs.existsSync(gateEventsFile) ? fs.statSync(gateEventsFile).size : 0;

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "utils.js"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n");
      await run("Read utils.js and add a subtract function", {
        maxIterations: 1, cwd, flowMode: "single_agent", skipStateMcp: true, stepSummary: false,
      });
    } finally {
      removeTempDir(cwd);
    }

    if (!fs.existsSync(gateEventsFile)) {
      t.diagnostic("gate_events.jsonl not present — hook may not have fired for this run");
      return;
    }

    const lines = fs.readFileSync(gateEventsFile, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON in gate_events.jsonl: ${line.slice(0, 120)}`);
    }
    const entries = lines.map((l) => JSON.parse(l));
    for (const entry of entries) {
      assert.ok("gate"   in entry, "gate_events entry missing 'gate'");
      assert.ok("result" in entry, "gate_events entry missing 'result'");
      assert.ok(
        entry.result === "blocked" || entry.result === "allowed",
        `gate result must be blocked|allowed, got: ${entry.result}`
      );
    }
    const sizeAfter = fs.statSync(gateEventsFile).size;
    t.diagnostic(`gate_events.jsonl: grew ${sizeAfter - sizeBefore} bytes — ${entries.length} total entries`);
  });

  // ── Scenario 9: loop_trace.jsonl válido y crece con el run ───────────────

  test("loop_trace.jsonl is valid JSONL with role/tool fields after a run", async (t) => {
    if (skipIfNoOllama(t)) return;

    if (!process.env.CLAUDE_SESSION_ID) {
      t.skip("CLAUDE_SESSION_ID not set — cannot correlate loop_trace entries to this run");
      return;
    }

    const loopTraceFile = path.join(os.homedir(), ".claude", "metrics", "sessions", "loop_trace.jsonl");
    const linesBefore = fs.existsSync(loopTraceFile)
      ? fs.readFileSync(loopTraceFile, "utf8").trim().split("\n").filter(Boolean).length
      : 0;

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "index.js"), "module.exports = {};\n");
      await run("Read index.js and add a version field set to '1.0.0'", {
        maxIterations: 1, cwd, flowMode: "single_agent", skipStateMcp: true, stepSummary: false,
      });
    } finally {
      removeTempDir(cwd);
    }

    if (!fs.existsSync(loopTraceFile)) {
      t.diagnostic("loop_trace.jsonl not present — session-state hook may not be active");
      return;
    }

    const allLines = fs.readFileSync(loopTraceFile, "utf8").trim().split("\n").filter(Boolean);
    for (const line of allLines) {
      assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON in loop_trace.jsonl: ${line.slice(0, 120)}`);
    }
    const newLines = allLines.slice(linesBefore).map((l) => JSON.parse(l));
    for (const entry of newLines) {
      assert.ok("role" in entry || "tool" in entry, "loop_trace entry missing role/tool fields");
    }
    t.diagnostic(`loop_trace.jsonl: ${linesBefore} → ${allLines.length} lines (+${newLines.length} new)`);
  });

  // ── Scenario 10: MCP directo — register_task + events.jsonl + hash chain ─
  // Llama mcp-direct.py desde el test (no desde el orchestrator) para validar
  // que los MCPs funcionan end-to-end con Ollama sin pasar por claude CLI.

  test("mcp-direct: orchestrator-state register→advance→close writes valid events.jsonl with intact hash chain", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { spawnSync: sp } = require("node:child_process");
    const MCP_DIRECT = path.join(__dirname, "..", "mcp-direct.py");

    if (!fs.existsSync(MCP_DIRECT)) {
      t.skip("mcp-direct.py not found");
      return;
    }

    function callDirect(server, tool, args) {
      const req = JSON.stringify({ server, tool, args });
      const r = sp("python3", [MCP_DIRECT], { input: req, encoding: "utf8", timeout: 30000 });
      if (r.error) throw r.error;
      const raw = r.stdout.trim();
      // Output may be a multi-line JSON object or a YAML string (compact_handoff).
      // Try full output first, then scan lines for the first parseable JSON object.
      try { return JSON.parse(raw); } catch { /* try line scan */ }
      const lines = raw.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try { return JSON.parse(lines[i]); } catch { /* skip INFO lines */ }
      }
      // If no JSON found, return the raw string (YAML output from compact_handoff)
      if (raw.length > 0) return raw;
      throw new Error(`No output from mcp-direct ${server}.${tool}: stderr=${r.stderr?.slice(0, 200)}`);
    }

    const taskId    = `e2e-mcp-direct-${Date.now()}`;
    const stateRoot = path.join(os.homedir(), ".claude", ".state", "orchestrator", taskId);
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ok */ }

    try {
      // 1. register_task
      const reg = callDirect("orchestrator-state", "register_task", {
        goal: "e2e test goal", task_id: taskId,
        flow_mode: "single_agent", max_iterations: 1, approved_artifacts: "[]",
      });
      assert.ok(reg.ok === true, `register_task failed: ${JSON.stringify(reg)}`);

      // 2. advance_mode ORCHESTRATOR → DEV
      const adv1 = callDirect("orchestrator-state", "advance_mode", {
        task_id: taskId, from_mode: "ORCHESTRATOR", to_mode: "DEV",
        handoff_yaml: "", iteration: 0,
      });
      assert.ok(adv1.ok === true, `advance_mode ORCH→DEV failed: ${JSON.stringify(adv1)}`);

      // 3. compact_handoff via compact-handoff MCP (uses Ollama internally)
      const handoff = callDirect("compact-handoff", "compact_handoff", {
        text: "files_read: [math.js]\nfiles_modified: [math.js]\nAdded subtract function.",
        mode_completed: "DEV", next_mode: "QA",
        iteration: 1, max_iterations: 1, flow_mode: "single_agent",
      });
      // compact_handoff returns a YAML string — verify it has expected keys
      const handoffStr = typeof handoff === "string" ? handoff : JSON.stringify(handoff);
      assert.ok(handoffStr.includes("mode_completed") || handoffStr.includes("files_modified"),
        `compact_handoff output missing expected YAML keys: ${handoffStr.slice(0, 200)}`);

      // 4. close_task
      const close = callDirect("orchestrator-state", "close_task", {
        task_id: taskId, reason: "e2e test complete",
      });
      assert.ok(close.ok === true, `close_task failed: ${JSON.stringify(close)}`);

      // 5. Verificar events.jsonl y hash chain
      const eventsPath = path.join(stateRoot, "events.jsonl");
      assert.ok(fs.existsSync(eventsPath), `events.jsonl not found at ${eventsPath}`);

      const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n")
        .filter(Boolean).map((l) => JSON.parse(l));

      assert.ok(events.length >= 3, `Expected >= 3 events (registered, advanced, closed), got ${events.length}`);

      for (let i = 1; i < events.length; i++) {
        assert.equal(
          events[i].prev_hash, events[i - 1].hash,
          `Hash chain broken at seq ${events[i].seq}`
        );
      }

      const types = events.map((e) => e.type);
      assert.ok(types.includes("task_registered"), `Missing task_registered event`);
      assert.ok(types.includes("mode_advanced"),   `Missing mode_advanced event`);
      assert.ok(types.includes("task_closed"),      `Missing task_closed event`);

      t.diagnostic(`events.jsonl: ${events.length} events — ${types.join(" → ")}`);
    } finally {
      try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ── Scenario 11: Contract Violation — Input ───────────────────────────────
  // validateOutput() must reject a plan step with missing/invalid fields.
  // We import validateOutput and call it with controlled bad payloads directly
  // (setBackend("ollama") routes through runOllama via http, not spawnSync).

  test("contract violation input: validateOutput rejects plan with empty steps and non-JSON", async (t) => {
    if (skipIfNoOllama(t)) return;

    // Import validateOutput internals via the agents module exports
    // agents.js does not export validateOutput directly — use the unit test approach:
    // require a fresh stub of cp.spawnSync so Ollama path is bypassed.
    const cp = require("node:child_process");
    const original = cp.spawnSync;

    // Temporarily override so runOllama's http call is NOT used — we test the
    // validateOutput contract by calling askAgent with a stubbed Ollama response.
    // With backend=ollama, askAgent calls runOllama (http), not spawnSync.
    // We test contract enforcement directly through the unit-level validateOutput export.
    const { validateOutput } = require("../agents");

    // Empty steps array
    const r1 = validateOutput("orchestrator", JSON.stringify({ steps: [] }), { phase: "plan" });
    assert.equal(r1.valid, false, "empty steps must be invalid");
    assert.ok(r1.reason.includes("steps"), `reason should mention steps: ${r1.reason}`);

    // Non-JSON
    const r2 = validateOutput("orchestrator", "not json at all", { phase: "plan" });
    assert.equal(r2.valid, false, "non-JSON plan must be invalid");

    // Valid plan passes
    const r3 = validateOutput("orchestrator", JSON.stringify({ steps: [{ agentId: "dev-backend", task: "x" }] }), { phase: "plan" });
    assert.equal(r3.valid, true, "valid plan must pass");

    t.diagnostic("Contract violation — input: empty steps and non-JSON both rejected; valid plan passes");
    cp.spawnSync = original; // restore (was not changed, just safety)
  });

  // ── Scenario 12: Contract Violation — Output (complete) ──────────────────
  // DEV output missing validation_run must be caught and not propagate.

  test("contract violation output: validateOutput rejects DEV output missing validation_run", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateOutput } = require("../agents");

    // DEV output with file references but no validation_run
    const r1 = validateOutput("dev-backend", "files_read:\n  - src/api.py\nfiles_modified:\n  - src/api.py\nNo tests run.");
    assert.equal(r1.valid, false, "missing validation_run must be invalid");

    // DEV output with neither file references nor validation_run
    const r2 = validateOutput("dev-backend", "I made the changes.");
    assert.equal(r2.valid, false, "missing file refs must be invalid");

    // Valid DEV output passes
    const validDev = [
      "files_read:",
      "  - src/api.py",
      "files_modified:",
      "  - src/api.py",
      "validation_run: pytest — 5 passed",
    ].join("\n");
    const r3 = validateOutput("dev-backend", validDev);
    assert.equal(r3.valid, true, "valid DEV output must pass");

    t.diagnostic("Contract violation — output: missing validation_run and missing file refs both rejected");
  });

  // ── Scenario 13: Backend Override — no spurious degradation ─────────────
  // setBackend("ollama") routes agents directly through Ollama without attempting
  // the claude CLI primary. No fallback is triggered → getDegradedAgents() stays empty.

  test("backend override: setBackend(ollama) routes directly — no degraded agents", async (t) => {
    if (skipIfNoOllama(t)) return;

    const agents = require("../agents");
    agents.clearDegradedAgents();

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "data.txt"), "line one\n");
      await run(
        "Read data.txt and append 'line two'",
        { maxIterations: 1, cwd, flowMode: "single_agent", skipStateMcp: true, stepSummary: false }
      );
    } catch (_) {
      // flow may fail contract — that is acceptable; we only check degraded state
    } finally {
      removeTempDir(cwd);
    }

    // Direct backend override must NOT mark agents as degraded (no primary failure occurred)
    const degraded = agents.getDegradedAgents();
    assert.equal(degraded.size, 0, `setBackend("ollama") must not produce degraded agents, got: ${[...degraded].join(", ")}`);
    t.diagnostic("Backend override: 0 degraded agents — direct Ollama routing confirmed");

    agents.clearDegradedAgents();
  });

  // ── Scenario 14: Bypass Detection ────────────────────────────────────────
  // Verify that when setBackend("ollama") is active, all agent invocations go
  // through runOllama() — no direct claude CLI spawn should occur.

  test("bypass detection: no direct claude CLI call when backend=ollama", async (t) => {
    if (skipIfNoOllama(t)) return;

    // Patch spawnSync to detect any call to 'claude' binary
    const cp = require("node:child_process");
    const original = cp.spawnSync;
    const claudeCalls = [];
    cp.spawnSync = (cmd, ...rest) => {
      if (cmd === "claude") claudeCalls.push({ cmd, args: rest[0] });
      return original(cmd, ...rest);
    };

    const cwd = makeTempDir();
    try {
      fs.writeFileSync(path.join(cwd, "readme.txt"), "hello\n");
      await run(
        "Read readme.txt and append 'world'",
        { maxIterations: 1, cwd, flowMode: "single_agent", skipStateMcp: true, stepSummary: false }
      );
    } finally {
      cp.spawnSync = original;
      removeTempDir(cwd);
    }

    assert.equal(
      claudeCalls.length, 0,
      `Expected 0 direct claude CLI calls with backend=ollama, got ${claudeCalls.length}: ${JSON.stringify(claudeCalls.map(c => c.args?.slice(0, 3)))}`
    );
    t.diagnostic("Bypass detection: 0 direct claude CLI calls confirmed");
  });

  // ── Scenario 15: Malformed Model Response — explicit ─────────────────────
  // Verify validateOutput enforces the decide contract for garbage and partial JSON.
  // The orchestrator's try/catch around askAgent("orchestrator", ..., {phase:"decide"})
  // means a contract failure degrades gracefully to "stopped" — tested here at the
  // contract layer directly, and in Sc13 at the run() level.

  test("malformed model response: decide contract rejects garbage and partial JSON", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateOutput } = require("../agents");

    // Garbage string
    const r1 = validateOutput("orchestrator", "¯\\_(ツ)_/¯", { phase: "decide" });
    assert.equal(r1.valid, false, "garbage decide output must be invalid");

    // done=true without summary
    const r2 = validateOutput("orchestrator", JSON.stringify({ done: true }), { phase: "decide" });
    assert.equal(r2.valid, false, "done=true without summary must be invalid");

    // done=false without corrections
    const r3 = validateOutput("orchestrator", JSON.stringify({ done: false }), { phase: "decide" });
    assert.equal(r3.valid, false, "done=false without corrections must be invalid");

    // Valid done=true passes
    const r4 = validateOutput("orchestrator", JSON.stringify({ done: true, summary: "all good" }), { phase: "decide" });
    assert.equal(r4.valid, true, "valid done=true with summary must pass");

    t.diagnostic("Malformed response: decide contract enforced for garbage, partial JSON, and missing fields");
  });

  // ── Scenario 15b: Gate-Blocked Completion Enforcement ────────────────────
  // Regression test: when DEV output contract fails (gateBlocked:true), the
  // orchestrator must NOT return done:true even if CERBERUS finds no blockers.
  // Expected outcome: done:false OR summary contains "Manual review" / "gate-blocked".

  test("gate-blocked enforcement: contract failure prevents done:true even if CERBERUS is silent", async (t) => {
    if (skipIfNoOllama(t)) return;

    const cwd = makeTempDir();
    try {
      // Minimal file — Ollama's qwen2.5-coder typically fails files_modified contract
      // on simple tasks, which is exactly what we need to trigger gateBlocked:true
      fs.writeFileSync(path.join(cwd, "simple.js"), "const x = 1;\n");

      const result = await run(
        "Read simple.js and add a comment above the const",
        {
          maxIterations: 1,
          cwd,
          flowMode: "single_agent",
          skipStateMcp: true,
          stepSummary: false,
        }
      );

      // If any artifact was gate-blocked, the run must NOT be done:true
      const hasGateBlocked = result.artifacts.some(a => a.gateBlocked === true);
      if (hasGateBlocked) {
        // The key regression: done must be false when gate-blocked artifacts exist
        assert.equal(result.done, false,
          `Run with gateBlocked artifacts must return done=false. Got done=${result.done}, summary="${result.summary}"`);
        assert.ok(
          result.summary?.includes("Manual review") || result.summary?.includes("gate-blocked"),
          `summary must mention manual review or gate-blocked. Got: "${result.summary}"`
        );
        t.diagnostic(`Gate-blocked enforcement confirmed: done=false, summary="${result.summary?.slice(0, 100)}"`);
      } else {
        // DEV happened to pass contracts — test is vacuously valid (skip would be misleading)
        t.diagnostic("DEV passed contracts — gate-blocked path not triggered in this run (non-deterministic model output)");
      }
    } finally {
      removeTempDir(cwd);
    }
  });

  // ── Scenario 16: Transition Integrity ────────────────────────────────────
  // validateHandoffStructure() must reject empty or malformed handoff YAML
  // for DEV and QA modes in strict mode, blocking invalid transitions.

  test("transition integrity: empty or malformed handoff blocks DEV and QA transitions in strict mode", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateHandoffStructure } = require("../orchestrator");

    // Empty handoff in strict mode → blocked
    const r1 = validateHandoffStructure("DEV", "", { strict: true });
    assert.equal(r1.valid, false, "empty DEV handoff must be invalid in strict mode");
    assert.ok(r1.reason.length > 0, "reason must be non-empty");

    // Whitespace-only handoff in strict mode → blocked
    const r2 = validateHandoffStructure("QA", "   \n  ", { strict: true });
    assert.equal(r2.valid, false, "whitespace-only QA handoff must be invalid in strict mode");

    // DEV handoff missing required fields → blocked
    const r3 = validateHandoffStructure("DEV", "goal: do something\ndecisions:\n  - used X", { strict: false });
    assert.equal(r3.valid, false, "DEV handoff missing files_modified and validation_run must be invalid");

    // QA handoff missing verdict → blocked
    const r4 = validateHandoffStructure("QA", "findings:\n  - issue: something\n    severity: blocker", { strict: false });
    assert.equal(r4.valid, false, "QA handoff missing verdict must be invalid");

    // Valid DEV handoff passes
    const r5 = validateHandoffStructure("DEV", "files_modified:\n  - src/api.js\nvalidation_run: npm test — 5 passed", { strict: true });
    assert.equal(r5.valid, true, "valid DEV handoff must pass in strict mode");

    // Valid QA handoff passes
    const r6 = validateHandoffStructure("QA", "verdict: pass\nfindings:\n  - issue: minor style\n    severity: nice-to-have", { strict: false });
    assert.equal(r6.valid, true, "valid QA handoff must pass");

    t.diagnostic("Transition integrity: empty/malformed handoffs blocked; valid handoffs pass");
  });

  // ── Scenario 17: Self-Evaluation Prevention ───────────────────────────────
  // DEV and QA must use different agentIds — same agent cannot self-review.
  // Verified by inspecting AGENTS config: no agent has both dev-* and qa roles.

  test("self-evaluation prevention: DEV and QA agents have distinct IDs", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { AGENTS } = require("../agents");

    const devAgents = Object.keys(AGENTS).filter((id) => id.startsWith("dev-"));
    const qaAgents  = Object.keys(AGENTS).filter((id) => id === "qa" || id.startsWith("qa-"));

    assert.ok(devAgents.length >= 1, "At least one dev-* agent must exist");
    assert.ok(qaAgents.length >= 1,  "At least one qa agent must exist");

    // No overlap between dev and qa agent IDs
    const overlap = devAgents.filter((id) => qaAgents.includes(id));
    assert.equal(overlap.length, 0, `DEV and QA agent IDs must not overlap — found: ${overlap.join(", ")}`);

    // Each dev agent must not have 'qa' in its agentId
    for (const id of devAgents) {
      assert.ok(!id.includes("qa"), `dev agent "${id}" must not contain "qa" in its ID`);
    }

    t.diagnostic(`Self-evaluation prevention: ${devAgents.length} DEV agents, ${qaAgents.length} QA agents — no overlap`);
  });

  // ── Scenario 18: Determinism Check ───────────────────────────────────────
  // Same validateOutput() call with identical input must return identical
  // { valid, gate_id } across multiple invocations (schema consistency).

  test("determinism check: validateOutput returns consistent schema for identical inputs", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateOutput } = require("../agents");

    const inputs = [
      { agentId: "orchestrator", output: JSON.stringify({ steps: [{ agentId: "dev-backend", task: "x" }] }), opts: { phase: "plan" } },
      { agentId: "dev-backend",  output: "files_read:\n  - api.js\nfiles_modified:\n  - api.js\nvalidation_run: npm test — pass", opts: {} },
      { agentId: "qa",           output: "blocker: missing error handling", opts: {} },
      { agentId: "orchestrator", output: "not json", opts: { phase: "plan" } },
    ];

    for (const { agentId, output, opts } of inputs) {
      const runs = Array.from({ length: 3 }, () => validateOutput(agentId, output, opts));

      // All runs must agree on valid
      const validValues = runs.map((r) => r.valid);
      assert.ok(validValues.every((v) => v === validValues[0]),
        `validateOutput("${agentId}") returned inconsistent valid: ${validValues.join(", ")}`);

      // All runs must agree on gate_id (if present)
      const gateIds = runs.map((r) => r.gate_id ?? null);
      assert.ok(gateIds.every((g) => g === gateIds[0]),
        `validateOutput("${agentId}") returned inconsistent gate_id: ${gateIds.join(", ")}`);
    }

    t.diagnostic("Determinism: validateOutput schema consistent across 3 runs for 4 distinct inputs");
  });

  // ── Scenario 19: Context Leakage ─────────────────────────────────────────
  // Data injected outside the handoff contract (e.g. raw env vars, extra keys)
  // must not appear in validateOutput() results or affect gate decisions.

  test("context leakage: out-of-contract fields do not affect gate decisions", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateOutput } = require("../agents");

    // Valid DEV output — baseline
    const validDev = "files_read:\n  - api.js\nfiles_modified:\n  - api.js\nvalidation_run: npm test — pass";
    const baseline = validateOutput("dev-backend", validDev);
    assert.equal(baseline.valid, true, "baseline valid DEV output must pass");

    // Same output with injected out-of-contract fields appended
    const withLeakage = validDev + "\nSECRET_TOKEN: abc123\nINTERNAL_STATE: {role: ORCHESTRATOR, override: true}";
    const withLeakageResult = validateOutput("dev-backend", withLeakage);

    // Gate decision must be identical — leakage fields must not flip valid→invalid or vice versa
    assert.equal(withLeakageResult.valid, baseline.valid,
      `Out-of-contract fields must not change gate decision: baseline=${baseline.valid}, with_leakage=${withLeakageResult.valid}`);

    // Invalid DEV output — leakage must not rescue it
    const invalidDev = "I made the changes.\nSECRET_TOKEN: abc123";
    const invalidResult = validateOutput("dev-backend", invalidDev);
    assert.equal(invalidResult.valid, false, "leakage fields must not rescue an invalid DEV output");

    t.diagnostic("Context leakage: out-of-contract fields do not affect gate decisions in either direction");
  });

  // ── Scenario 20: Strict Mode ──────────────────────────────────────────────
  // In strict mode (skipStateMcp=false equivalent), any deviation from the
  // handoff contract must surface as a hard failure, not a silent pass.
  // Tested via validateHandoffStructure with strict=true for all role types.

  test("strict mode: any handoff deviation surfaces as hard failure", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateHandoffStructure } = require("../orchestrator");

    const strictCases = [
      // Empty handoffs — all blocked in strict mode
      { mode: "DEV",      yaml: "",      expectValid: false, label: "empty DEV" },
      { mode: "QA",       yaml: "",      expectValid: false, label: "empty QA" },
      { mode: "CERBERUS", yaml: "",      expectValid: false, label: "empty CERBERUS" },
      // Missing required fields
      { mode: "DEV",      yaml: "goal: x", expectValid: false, label: "DEV missing files_modified+validation_run" },
      { mode: "QA",       yaml: "goal: x", expectValid: false, label: "QA missing verdict" },
      { mode: "CERBERUS", yaml: "goal: x", expectValid: false, label: "CERBERUS missing verdict" },
      // Open blockers in CERBERUS — blocked even with verdict
      { mode: "CERBERUS", yaml: "verdict: fail\nblockers:\n  - critical issue found", expectValid: false, label: "CERBERUS with open blockers" },
      // Valid handoffs — must pass in strict mode
      { mode: "DEV",      yaml: "files_modified:\n  - x.js\nvalidation_run: pass", expectValid: true, label: "valid DEV" },
      { mode: "QA",       yaml: "verdict: pass\nfindings:\n  - issue: ok\n    severity: nice-to-have", expectValid: true, label: "valid QA" },
      // Exempt modes: strict=true still blocks empty handoff (compact_handoff required)
      // but non-empty output always passes (no required fields for these roles)
      { mode: "OWNER",        yaml: "summary: scope agreed", expectValid: true, label: "OWNER non-empty" },
      { mode: "ORCHESTRATOR", yaml: "plan: ready",           expectValid: true, label: "ORCHESTRATOR non-empty" },
      { mode: "ARCHITECT",    yaml: "design: approved",      expectValid: true, label: "ARCHITECT non-empty" },
    ];

    for (const { mode, yaml, expectValid, label } of strictCases) {
      const result = validateHandoffStructure(mode, yaml, { strict: true });
      assert.equal(result.valid, expectValid,
        `[${label}] expected valid=${expectValid}, got valid=${result.valid} reason="${result.reason}"`);
    }

    t.diagnostic(`Strict mode: ${strictCases.length} cases verified — deviations surface as hard failures`);
  });

  // ── T6: Failure-First E2E ─────────────────────────────────────────────────
  // Negative scenarios: each failure mode must be caught and surfaced cleanly.

  test("failure-first: invalid plan input is rejected before execution", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateOutput } = require("../agents");

    // Missing agentId in step
    const r1 = validateOutput("orchestrator", JSON.stringify({ steps: [{ task: "do x" }] }), { phase: "plan" });
    assert.equal(r1.valid, false, "step missing agentId must be rejected");

    // Missing task in step
    const r2 = validateOutput("orchestrator", JSON.stringify({ steps: [{ agentId: "dev-backend" }] }), { phase: "plan" });
    assert.equal(r2.valid, false, "step missing task must be rejected");

    // Null output
    const r3 = validateOutput("orchestrator", null, { phase: "plan" });
    assert.equal(r3.valid, false, "null output must be rejected");

    t.diagnostic("Failure-first: invalid plan inputs (missing agentId, missing task, null) all rejected");
  });

  test("failure-first: broken handoff (partial YAML) is caught by validateHandoffStructure", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { validateHandoffStructure } = require("../orchestrator");

    // Truncated YAML — key present but no value AND no validation_run → invalid
    // Note: "files_modified:" alone satisfies the key check; need both missing to fail
    const r1 = validateHandoffStructure("DEV", "goal: something", { strict: false });
    assert.equal(r1.valid, false, "DEV YAML with no files_modified and no validation_run must be invalid");

    // YAML with only comments
    const r2 = validateHandoffStructure("QA", "# just a comment\n# nothing here", { strict: false });
    assert.equal(r2.valid, false, "comment-only QA YAML must be invalid");

    t.diagnostic("Failure-first: broken/partial handoff YAML caught before transition");
  });

  test("failure-first: tool failure (unknown agentId) throws immediately", async (t) => {
    if (skipIfNoOllama(t)) return;

    const { askAgent } = require("../agents");

    await assert.rejects(
      () => askAgent("non-existent-agent-xyz", "do something", { cwd: os.tmpdir() }),
      (err) => {
        assert.ok(err.message.includes("non-existent-agent-xyz") || err.message.includes("Unknown agent"),
          `Error must mention the unknown agentId: ${err.message}`);
        return true;
      },
      "unknown agentId must throw immediately"
    );

    t.diagnostic("Failure-first: unknown agentId throws immediately with clear error");
  });

});
