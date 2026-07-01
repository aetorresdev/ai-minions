"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const policy = require("../local-model-policy");
const ollamaRuntime = require("../agents/runtime/run-ollama");

const ORCH_ROOT = path.resolve(__dirname, "..");

function saveEnv(keys) {
  /** @type {Record<string, string | undefined>} */
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  return prev;
}

function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearModuleCache(prefix) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(prefix)) delete require.cache[key];
  }
}

function clearOrchestratorModuleCaches() {
  const paths = new Set([
    path.join(ORCH_ROOT, "agents.js"),
    path.join(ORCH_ROOT, "modules", "shared", "agents.js"),
    path.join(ORCH_ROOT, "orchestrator.js"),
    path.join(ORCH_ROOT, "modules", "run-control", "orchestrator.js"),
    path.join(ORCH_ROOT, "agents", "runtime", "run-ollama.js"),
    path.join(ORCH_ROOT, "modules", "model-runtime", "run-ollama.js"),
    path.join(ORCH_ROOT, "agents", "runtime", "summarize-handoff.js"),
    path.join(ORCH_ROOT, "modules", "model-runtime", "summarize-handoff.js"),
    path.join(ORCH_ROOT, "agents", "routing", "model-routing.js"),
    path.join(ORCH_ROOT, "modules", "model-runtime", "model-routing.js"),
  ]);
  for (const key of Object.keys(require.cache)) {
    if (paths.has(key)) delete require.cache[key];
  }
}

function readTraceEvents(traceDir) {
  const files = fs.readdirSync(traceDir).filter((f) => f.endsWith(".jsonl"));
  assert.equal(files.length, 1, `expected one trace file in ${traceDir}, got: ${files.join(",")}`);
  return fs
    .readFileSync(path.join(traceDir, files[0]), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("local-model-policy — mode detection", () => {
  const keys = ["ORCH_MODEL_MODE", "ORCH_ALLOW_REMOTE_MODELS"];
  let prev;

  beforeEach(() => {
    prev = saveEnv(keys);
    delete process.env.ORCH_MODEL_MODE;
    delete process.env.ORCH_ALLOW_REMOTE_MODELS;
    policy.resetLocalModelPolicy();
  });

  afterEach(() => {
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
  });

  it("is off by default", () => {
    assert.equal(policy.isLocalOnlyModeEnabled(), false);
  });

  it("enables on ORCH_MODEL_MODE=local_only", () => {
    process.env.ORCH_MODEL_MODE = "local_only";
    assert.equal(policy.isLocalOnlyModeEnabled(), true);
  });

  it("enables on ORCH_ALLOW_REMOTE_MODELS=0", () => {
    process.env.ORCH_ALLOW_REMOTE_MODELS = "0";
    assert.equal(policy.isLocalOnlyModeEnabled(), true);
  });
});

describe("local-model-policy — override precedence", () => {
  const keys = ["ORCH_LOCAL_MODEL", "OLLAMA_MODEL"];
  let prev;

  beforeEach(() => {
    prev = saveEnv(keys);
    delete process.env.ORCH_LOCAL_MODEL;
    delete process.env.OLLAMA_MODEL;
    policy.resetLocalModelPolicy();
  });

  afterEach(() => {
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
  });

  it("prefers CLI over env", () => {
    process.env.ORCH_LOCAL_MODEL = "env-model";
    process.env.OLLAMA_MODEL = "ollama-model";
    policy.configureLocalModelPolicy({ cliModel: "cli-model" });
    const resolved = policy.resolveLocalModelOverride();
    assert.deepEqual(resolved, { model: "cli-model", override_source: "cli" });
  });

  it("prefers ORCH_LOCAL_MODEL over OLLAMA_MODEL", () => {
    process.env.ORCH_LOCAL_MODEL = "local-env";
    process.env.OLLAMA_MODEL = "ollama-env";
    assert.deepEqual(policy.resolveLocalModelOverride(), {
      model: "local-env",
      override_source: "env_orchestr_local_model",
    });
  });
});

describe("local-model-policy — prerequisites", () => {
  const keys = ["ORCH_MODEL_MODE", "ORCH_LOCAL_MODEL", "OLLAMA_MODEL"];
  let prev;

  beforeEach(() => {
    prev = saveEnv(keys);
    process.env.ORCH_MODEL_MODE = "local_only";
    delete process.env.ORCH_LOCAL_MODEL;
    delete process.env.OLLAMA_MODEL;
    policy.resetLocalModelPolicy();
  });

  afterEach(() => {
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
  });

  it("fails when no model configured", async () => {
    await assert.rejects(
      () =>
        policy.validateLocalOnlyRunPrerequisites({
          checkOllama: async () => true,
          selectLocalModel: async () => {
            throw new Error("[local-model-selection] No local models discovered.");
          },
        }),
      (err) => {
        assert.match(err.message, /No local models discovered/);
        assert.equal(err.gate_id, policy.GATE_ID);
        return true;
      },
    );
  });

  it("fails when backend unreachable", async () => {
    process.env.ORCH_LOCAL_MODEL = "unit-test-model";
    await assert.rejects(
      () => policy.validateLocalOnlyRunPrerequisites({ checkOllama: async () => false }),
      /Local model backend unreachable/,
    );
  });

  it("passes with model and reachable backend", async () => {
    process.env.ORCH_LOCAL_MODEL = "unit-test-model";
    const ctx = await policy.validateLocalOnlyRunPrerequisites({ checkOllama: async () => true });
    assert.equal(ctx.local_only_mode, true);
    assert.equal(ctx.selected_model, "unit-test-model");
  });
});

describe("askAgent — local-only blocks remote", () => {
  const envKeys = [
    "ORCH_MODEL_MODE",
    "ORCH_LOCAL_MODEL",
    "OLLAMA_MODEL",
  ];
  let prevEnv;
  let callCount = 0;
  const origSpawnSync = cp.spawnSync;

  beforeEach(() => {
    prevEnv = saveEnv(envKeys);
    process.env.ORCH_MODEL_MODE = "local_only";
    process.env.ORCH_LOCAL_MODEL = "mock-local-model";
    policy.resetLocalModelPolicy();
    policy.configureLocalModelPolicy({ cliModel: null, skipBackendCheck: true });
    callCount = 0;
    cp.spawnSync = (...args) => {
      callCount++;
      return origSpawnSync(...args);
    };
    clearModuleCache(`${path.sep}agents.js`);
  });

  afterEach(() => {
    cp.spawnSync = origSpawnSync;
    restoreEnv(prevEnv);
    policy.resetLocalModelPolicy();
    clearModuleCache(`${path.sep}agents.js`);
  });

  it("does not invoke claude CLI for dev-backend", async () => {
    const traceEvents = [];
    policy.setLocalModelTraceReporter((payload) => traceEvents.push(payload));

    const origRunOllama = ollamaRuntime.runOllama;
    ollamaRuntime.runOllama = async () => ({
      content: [
        "files_read:",
        "  - src/api.py",
        "files_modified:",
        "  - src/api.py",
        "validation_run: pytest — 5 passed",
      ].join("\n"),
      prompt_eval_count: 10,
      eval_count: 20,
    });

    try {
      const { askAgent } = require("../agents");
      const { output } = await askAgent("dev-backend", "implement X");
      assert.ok(output.includes("files_modified"));
      assert.equal(callCount, 0, "claude CLI must not be invoked in local-only mode");
      assert.ok(traceEvents.length === 0, "no block event when routing through ollama");
    } finally {
      ollamaRuntime.runOllama = origRunOllama;
    }
  });

  it("emits model_policy_block when remote would be used without model", async () => {
    delete process.env.ORCH_LOCAL_MODEL;
    policy.resetLocalModelPolicy();
    policy.configureLocalModelPolicy({ skipBackendCheck: true });

    const traceEvents = [];
    policy.setLocalModelTraceReporter((payload) => traceEvents.push(payload));

    const { askAgent } = require("../agents");
    await assert.rejects(() => askAgent("dev-backend", "implement X"), /Remote model provider blocked/);
    assert.equal(callCount, 0);
    assert.equal(traceEvents.length, 1);
    assert.equal(traceEvents[0].event, "model_policy_block");
    assert.equal(traceEvents[0].gate_id, "model_policy_block");
    assert.equal(traceEvents[0].agent, "dev-backend");
  });
});

describe("summarizeHandoff — local-only model precedence", () => {
  const keys = ["ORCH_MODEL_MODE", "ORCH_LOCAL_MODEL", "AI_TEAM_SUMMARY_MODEL"];
  const summarizeCachePaths = [
    path.join(ORCH_ROOT, "agents", "runtime", "summarize-handoff.js"),
    path.join(ORCH_ROOT, "modules", "model-runtime", "summarize-handoff.js"),
    path.join(ORCH_ROOT, "agents", "runtime", "run-ollama.js"),
    path.join(ORCH_ROOT, "modules", "model-runtime", "run-ollama.js"),
  ];
  let prev;

  function clearSummarizeHandoffCaches() {
    for (const p of summarizeCachePaths) delete require.cache[p];
  }

  beforeEach(() => {
    prev = saveEnv(keys);
    process.env.ORCH_MODEL_MODE = "local_only";
    process.env.ORCH_LOCAL_MODEL = "run-model";
    process.env.AI_TEAM_SUMMARY_MODEL = "summary-model";
    policy.resetLocalModelPolicy();
    clearSummarizeHandoffCaches();
  });

  afterEach(() => {
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
    clearSummarizeHandoffCaches();
  });

  it("uses resolved local model instead of AI_TEAM_SUMMARY_MODEL", async () => {
    /** @type {string | undefined} */
    let capturedModel;
    const runtime = require("../agents/runtime/run-ollama");
    const origRunOllama = runtime.runOllama;
    runtime.runOllama = async (_system, _messages, opts) => {
      capturedModel = opts.model;
      return { content: "handoff summary", prompt_eval_count: 1, eval_count: 1 };
    };

    try {
      const { summarizeHandoff } = require("../agents/runtime/summarize-handoff");
      await summarizeHandoff({
        agentId: "dev-backend",
        task: "implement feature",
        result: "files_modified:\n  - app.js",
        cwd: ORCH_ROOT,
      });

      assert.equal(capturedModel, "run-model");
    } finally {
      runtime.runOllama = origRunOllama;
      clearSummarizeHandoffCaches();
    }
  });
});

describe("session_start trace contract", () => {
  const keys = ["ORCH_MODEL_MODE", "ORCH_LOCAL_MODEL"];
  let prev;

  beforeEach(() => {
    prev = saveEnv(keys);
    process.env.ORCH_MODEL_MODE = "local_only";
    policy.resetLocalModelPolicy();
    policy.configureLocalModelPolicy({ cliModel: "cli-override-model" });
  });

  afterEach(() => {
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
  });

  it("getLocalOnlySessionContext matches fields spread into session_start", () => {
    const ctx = policy.getLocalOnlySessionContext();
    assert.equal(ctx.local_only_mode, true);
    assert.equal(ctx.selected_model, "cli-override-model");
    assert.equal(ctx.override_source, "cli");
  });
});

describe("run() — session_start trace emission", () => {
  const keys = [
    "ORCH_MODEL_MODE",
    "ORCH_LOCAL_MODEL",
    "ORCH_TRACES_DIR",
    "ORCH_SKIP_NETWORK_PERMISSION_GATE",
  ];
  let prev;
  let traceDir;
  let runCwd;
  const origRunOllama = ollamaRuntime.runOllama;
  const origSpawnSync = cp.spawnSync;

  beforeEach(() => {
    prev = saveEnv(keys);
    const tmpRoot = path.join(__dirname, ".tmp-local-only-traces");
    fs.mkdirSync(tmpRoot, { recursive: true });
    traceDir = fs.mkdtempSync(path.join(tmpRoot, "trace-"));
    runCwd = fs.mkdtempSync(path.join(tmpRoot, "cwd-"));
    process.env.ORCH_MODEL_MODE = "local_only";
    process.env.ORCH_LOCAL_MODEL = "trace-fallback-model";
    process.env.ORCH_TRACES_DIR = traceDir;
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    policy.resetLocalModelPolicy();
    policy.configureLocalModelPolicy({ skipBackendCheck: true });

    ollamaRuntime.runOllama = async () => ({
      content: JSON.stringify({ steps: [{ agentId: "dev-backend", task: "trace regression" }] }),
      prompt_eval_count: 1,
      eval_count: 1,
    });

    cp.spawnSync = (...args) => {
      if (String(args[0]).includes("claude")) {
        throw new Error("claude CLI must not run in local-only trace regression test");
      }
      return origSpawnSync(...args);
    };

    clearOrchestratorModuleCaches();
  });

  afterEach(() => {
    ollamaRuntime.runOllama = origRunOllama;
    cp.spawnSync = origSpawnSync;
    restoreEnv(prev);
    policy.resetLocalModelPolicy();
    try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { fs.rmSync(runCwd, { recursive: true, force: true }); } catch { /* ok */ }
    clearOrchestratorModuleCaches();
  });

  it("writes local_only_mode fields on session_start in trace JSONL", async () => {
    const { run } = require("../orchestrator");
    try {
      await run("local-only trace regression", {
        cwd: runCwd,
        maxIterations: 1,
        skipStateMcp: true,
        stepSummary: false,
        localModel: "cli-override-model",
      });
    } catch {
      // session_start is emitted before the agent loop; later steps may fail without a full mock chain.
    }

    const events = readTraceEvents(traceDir);
    const start = events.find((e) => e.event === "session_start");
    assert.ok(start, `session_start missing; events: ${events.map((e) => e.event).join(",")}`);
    assert.equal(start.local_only_mode, true);
    assert.equal(start.selected_model, "cli-override-model");
    assert.equal(start.override_source, "cli");
  });
});

describe("run-orchestrator help — local-only flags", () => {
  it("documents --model and local-only env vars", () => {
    const runner = path.join(__dirname, "..", "run-orchestrator.js");
    const r = cp.spawnSync(process.execPath, [runner, "--help"], {
      encoding: "utf8",
      cwd: path.join(__dirname, ".."),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--model/);
    assert.match(r.stdout, /ORCH_MODEL_MODE/);
    assert.match(r.stdout, /ORCH_LOCAL_MODEL/);
  });
});
