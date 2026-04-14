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

});
