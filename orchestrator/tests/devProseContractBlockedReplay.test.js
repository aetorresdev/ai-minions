"use strict";

/**
 * Deterministic replay of a known local-model failure: with thinking disabled,
 * the model answers a dev-* step in prose, makes zero tool calls, never calls
 * write_file, and the output-contract gate must block the step with
 * files_read_empty. The only acceptable outcome is BLOCKED — never PASS, never
 * a silent retry that turns the step green.
 *
 * The model response comes from a recorded-shape fixture replayed in-process at
 * the http.request boundary used by run-ollama. A network guard fails the test
 * if anything tries to open a socket, resolve DNS, or call fetch.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "ollama-replay", "dev-prose-no-write-file.json");

/**
 * Patch every outbound network primitive so any call records and throws.
 * Returns the list of attempted calls and a restore function.
 */
function installNetworkGuard() {
  /** @type {string[]} */
  const attempts = [];
  /** @type {Array<() => void>} */
  const restores = [];
  const block = (obj, key, label) => {
    const orig = obj[key];
    obj[key] = function blockedNetworkCall() {
      attempts.push(label);
      throw new Error(`network guard: ${label} called during an offline fixture test`);
    };
    restores.push(() => { obj[key] = orig; });
  };
  block(net.Socket.prototype, "connect", "net.Socket#connect");
  block(net, "connect", "net.connect");
  block(net, "createConnection", "net.createConnection");
  block(tls, "connect", "tls.connect");
  block(dns, "lookup", "dns.lookup");
  block(dns, "resolve", "dns.resolve");
  block(https, "request", "https.request");
  block(https, "get", "https.get");
  block(http, "get", "http.get");
  if (typeof globalThis.fetch === "function") block(globalThis, "fetch", "fetch");
  return {
    attempts,
    restore: () => { while (restores.length) restores.pop()(); },
  };
}

/**
 * Replace http.request with an in-process replay of the fixture body. No
 * socket is created: the fake request never touches net/tls, and the network
 * guard above stays armed for everything else.
 */
function installOllamaReplay(fixtureBody) {
  /** @type {{ path: string, body: any }[]} */
  const requests = [];
  const orig = http.request;
  http.request = function replayOllamaChat(opts, onResponse) {
    const req = new EventEmitter();
    let written = "";
    req.write = (chunk) => { written += String(chunk); return true; };
    req.destroy = () => {};
    req.end = () => {
      setImmediate(() => {
        const reqPath = String(opts?.path ?? "");
        let parsed = null;
        try { parsed = JSON.parse(written); } catch { /* recorded as null */ }
        requests.push({ path: reqPath, body: parsed });
        if (!reqPath.endsWith("/api/chat")) {
          req.emit("error", new Error(`replay: unexpected path ${reqPath}`));
          return;
        }
        const res = new EventEmitter();
        res.complete = true;
        res.destroy = () => {};
        onResponse(res);
        res.emit("data", Buffer.from(JSON.stringify(fixtureBody)));
        res.emit("end");
        res.emit("close");
      });
    };
    return req;
  };
  return { requests, restore: () => { http.request = orig; } };
}

function listFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(path.relative(dir, p));
  }
  return out;
}

describe("dev-* prose answer without write_file (offline fixture replay)", () => {
  const ENV_KEYS = [
    "ORCH_MODEL_MODE",
    "OLLAMA_MODEL",
    "OLLAMA_HOST",
    "OLLAMA_PORT",
    "OLLAMA_THINK",
    "ORCH_SKIP_NETWORK_PERMISSION_GATE",
  ];
  /** @type {Record<string, string | undefined>} */
  const savedEnv = {};
  let tmpDir;
  let guard;
  let replay;
  let fixture;

  beforeEach(() => {
    fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-prose-blocked-"));
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.ORCH_MODEL_MODE = "local_only";
    process.env.OLLAMA_MODEL = "fixture-local-model";
    // Loopback target that nothing listens on; the replay answers in-process.
    process.env.OLLAMA_HOST = "127.0.0.1";
    process.env.OLLAMA_PORT = "11434";
    // Thinking disabled: the condition under which the failure was observed.
    process.env.OLLAMA_THINK = "false";
    // The permission gate is a local policy check, not egress; skip it like
    // the other tool-loop tests so the replay is the only chat boundary.
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    guard = installNetworkGuard();
    replay = installOllamaReplay(fixture);
  });

  afterEach(() => {
    replay.restore();
    guard.restore();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fixture encodes the failure shape: prose, no tool calls, no thinking, empty files_read", () => {
    assert.equal(fixture._fixture.expected_gate_id, "files_read_empty");
    assert.equal(fixture._fixture.expected_outcome, "BLOCKED");
    assert.equal(fixture.message.tool_calls, undefined);
    assert.equal(fixture.message.thinking, undefined);
    assert.match(fixture.message.content, /files_read:\s*\[\]/);
    assert.match(fixture.message.content, /<html>/);
  });

  it("step ends BLOCKED with files_read_empty, writes nothing, and makes no network call", async (t) => {
    const { askAgent } = require("../modules/shared/agents");
    const { createPhaseContext } = require("../run-phases/phase-context");
    const { executeStepAgentInvocation } = require("../run-phases/step-execution");

    /** @type {object[]} */
    const traces = [];
    const stepStatus = { running: 0, failed: 0, completed: 0 };
    const ctx = createPhaseContext({
      taskId: "task-dev-prose-blocked",
      cwd: tmpDir,
      goal: "GOAL: build a playable Sudoku page",
      sessionEnv: null,
      iterations: () => 1,
      traceEvent: (_taskId, payload) => traces.push(payload),
      log: () => {},
      getLastBudgetMeta: () => ({}),
      emitContextStatsRows: () => {},
      emitModelFallbackLifecycleIfNeeded: () => {},
      costGuardAbort: () => false,
    });

    const out = await executeStepAgentInvocation(ctx, {
      agentId: "dev-frontend",
      step: { task: "Create sudoku.html with a playable 9x9 grid." },
      stepId: "step-dev-1",
      stepIndex: 0,
      retryNumber: 0,
      graphMeta: { graph_id: "g-dev-prose" },
      intentStep: { intent_id: "intent-dev-prose" },
      contextBlock: "(none)",
      writeAgentState: () => {},
      setStepRunning: () => { stepStatus.running += 1; },
      setStepFailedAndClear: () => { stepStatus.failed += 1; },
      setStepCompleted: () => { stepStatus.completed += 1; },
      runState: { steps: {} },
      askAgent,
      getDegradedAgents: () => [],
      clearDegradedAgents: () => {},
      degradedInRun: new Set(),
      edgeMeta: (edgeType) => ({ edge_type: edgeType }),
      qaAgentDoneTraceExtras: () => ({}),
      shouldEmitQaReviewRecord: () => false,
      traceReviewRecord: () => {},
      buildReviewRecord: (opts) => opts,
      onAfterAgentStart: async () => "proceed",
    });

    // BLOCKED: the step is gate-blocked with the exact contract reason code.
    const outcome = out.artifact?.gateBlocked === true ? "BLOCKED" : "PASS";
    assert.equal(outcome, "BLOCKED");
    assert.equal(out.artifact.gate_kind, "files_read_empty");
    assert.match(out.artifact.gateReason, /^\[output contract\] dev-frontend: files_read\[\] must not be empty/);
    assert.equal(stepStatus.failed, 1);
    assert.equal(stepStatus.completed, 0);

    const fail = traces.find((t) => t.event === "contract_fail");
    assert.ok(fail, "contract_fail trace emitted");
    assert.equal(fail.gate_id, "files_read_empty");
    assert.equal(fail.agent, "dev-frontend");
    assert.equal(traces.some((t) => t.event === "agent_done"), false, "never reported as done/PASS");

    // No silent retry-to-success: exactly one chat round trip, which offered
    // write_file with thinking disabled, and the model made no tool call.
    assert.equal(replay.requests.length, 1);
    const sent = replay.requests[0].body;
    assert.equal(sent.think, false);
    assert.ok(
      Array.isArray(sent.tools) && sent.tools.some((t) => t.function?.name === "write_file"),
      "write_file was offered to the dev role",
    );

    // No file written anywhere in the working directory.
    assert.deepEqual(listFilesRecursive(tmpDir), []);
    assert.equal(fs.existsSync(path.join(tmpDir, "sudoku.html")), false);

    // No network: the guard recorded zero attempts.
    assert.deepEqual(guard.attempts, []);

    t.diagnostic(
      `outcome=${outcome} gate_id=${fail.gate_id} chat_requests=${replay.requests.length} `
      + `files_written=${listFilesRecursive(tmpDir).length} network_attempts=${guard.attempts.length}`,
    );
  });

  it("network guard is armed: an outbound socket attempt fails the test path", () => {
    assert.throws(() => net.connect({ host: "127.0.0.1", port: 9 }), /network guard: net\.connect/);
    assert.throws(() => https.request("https://127.0.0.1/"), /network guard: https\.request/);
    assert.deepEqual(guard.attempts, ["net.connect", "https.request"]);
  });
});
