/**
 * Env kill-switches: ORCH_MAX_ITERATIONS, ORCH_MAX_RETRIES, ORCH_MAX_COST_USD.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const ollamaRuntime = require("../agents/runtime/run-ollama");

const PLAN_TWO_DEV = JSON.stringify({
  steps: [
    { agentId: "dev-backend", task: "Step one" },
    { agentId: "dev-backend", task: "Step two" },
  ],
});

const DEV_OK = [
  "files_read:",
  "  - src/x.js",
  "files_modified:",
  "  - src/x.js",
  "validation_run: npm test — passed",
].join("\n");

const CERB_OK = "- improvement: reviewed deliverables; no blockers identified";

const origSpawnSync = cp.spawnSync;
const origRunOllama = ollamaRuntime.runOllama;

function guardSpawnSync(cmd, args, opts) {
  if (cmd !== "claude") return origSpawnSync.call(cp, cmd, args, opts);

  const arg1 = args[1];
  if (arg1 === "-") {
    const input = opts && opts.input != null ? String(opts.input) : "";
    if (input.includes("MODE: ORCHESTRATOR") && input.includes("Decompose")) {
      return { error: null, status: 0, stdout: `${PLAN_TWO_DEV}\n`, stderr: "" };
    }
    if (input.includes("Your task:") && !input.includes("Classify each finding")) {
      return { error: null, status: 0, stdout: `${DEV_OK}\n`, stderr: "" };
    }
    if (input.includes("Classify each finding")) {
      return { error: null, status: 0, stdout: `${CERB_OK}\n`, stderr: "" };
    }
    return { error: null, status: 0, stdout: "{}\n", stderr: "" };
  }

  const p = String(arg1);
  if (p.includes("compact_handoff") || p.includes("compact-handoff.compact_handoff")) {
    return {
      error: null,
      status: 0,
      stdout: "files_modified:\n  - src/x.js\nvalidation_run: ok\n",
      stderr: "",
    };
  }

  return { error: null, status: 0, stdout: "{}\n", stderr: "" };
}

function clearOrchestratorModuleCaches() {
  const agentsPath = path.resolve(__dirname, "..", "agents.js");
  const orchPath = path.resolve(__dirname, "..", "orchestrator.js");
  const modelRoutingPath = path.resolve(__dirname, "..", "agents", "routing", "model-routing.js");
  for (const k of Object.keys(require.cache)) {
    if (k === agentsPath || k === orchPath || k === modelRoutingPath) delete require.cache[k];
  }
}

describe("resolveMaxIterations", () => {
  it("uses explicit options over ORCH_MAX_ITERATIONS", () => {
    const prev = process.env.ORCH_MAX_ITERATIONS;
    process.env.ORCH_MAX_ITERATIONS = "2";
    try {
      const { resolveMaxIterations } = require("../orchestrator");
      assert.equal(resolveMaxIterations({ maxIterations: 7 }), 7);
    } finally {
      if (prev === undefined) delete process.env.ORCH_MAX_ITERATIONS;
      else process.env.ORCH_MAX_ITERATIONS = prev;
    }
  });

  it("reads ORCH_MAX_ITERATIONS when options omit maxIterations", () => {
    const prev = process.env.ORCH_MAX_ITERATIONS;
    process.env.ORCH_MAX_ITERATIONS = "5";
    try {
      const { resolveMaxIterations } = require("../orchestrator");
      assert.equal(resolveMaxIterations({}), 5);
    } finally {
      if (prev === undefined) delete process.env.ORCH_MAX_ITERATIONS;
      else process.env.ORCH_MAX_ITERATIONS = prev;
    }
  });

  it("throws when ORCH_MAX_COST_USD set without USD rate envs", async () => {
    const prevCost = process.env.ORCH_MAX_COST_USD;
    const prevP = process.env.ORCH_USD_PER_MTOK_PROMPT;
    const prevC = process.env.ORCH_USD_PER_MTOK_COMPLETION;
    process.env.ORCH_MAX_COST_USD = "1";
    delete process.env.ORCH_USD_PER_MTOK_PROMPT;
    delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
    try {
      const { run } = require("../orchestrator");
      await assert.rejects(
        () => run("x", { cwd: os.tmpdir(), maxIterations: 1, skipStateMcp: true }),
        /Budget guards require both ORCH_USD_PER_MTOK/,
      );
    } finally {
      if (prevCost === undefined) delete process.env.ORCH_MAX_COST_USD;
      else process.env.ORCH_MAX_COST_USD = prevCost;
      if (prevP === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
      else process.env.ORCH_USD_PER_MTOK_PROMPT = prevP;
      if (prevC === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
      else process.env.ORCH_USD_PER_MTOK_COMPLETION = prevC;
    }
  });

  it("clamps ORCH_MAX_ITERATIONS to 500", () => {
    const prev = process.env.ORCH_MAX_ITERATIONS;
    process.env.ORCH_MAX_ITERATIONS = "9999";
    try {
      const { resolveMaxIterations } = require("../orchestrator");
      assert.equal(resolveMaxIterations({}), 500);
    } finally {
      if (prev === undefined) delete process.env.ORCH_MAX_ITERATIONS;
      else process.env.ORCH_MAX_ITERATIONS = prev;
    }
  });
});

describe("ORCH_MAX_RETRIES integration (spawn stub)", () => {
  it("aborts before second same-agent step when ORCH_MAX_RETRIES=0", async () => {
    const prevRetries = process.env.ORCH_MAX_RETRIES;
    const prevOllama = process.env.OLLAMA_MODEL;
    const prevTraces = process.env.ORCH_TRACES_DIR;
    process.env.ORCH_MAX_RETRIES = "0";
    delete process.env.OLLAMA_MODEL;
    const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-guard-trace-"));
    process.env.ORCH_TRACES_DIR = traceDir;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-guard-retry-"));
    let run;
    try {
      clearOrchestratorModuleCaches();
      cp.spawnSync = guardSpawnSync;
      ({ run } = require("../orchestrator"));
      const result = await run("guard retry test", {
        cwd: tmp,
        maxIterations: 1,
        flowMode: "single_agent",
        skipStateMcp: true,
        stepSummary: false,
      });

      assert.equal(result.done, false);
      assert.match(result.summary, /ORCH_MAX_RETRIES/i, result.summary);

      const files = fs.readdirSync(traceDir).filter((f) => f.endsWith(".jsonl"));
      assert.equal(files.length, 1, "expected one trace file");
      const lines = fs.readFileSync(path.join(traceDir, files[0]), "utf8").trim().split("\n").filter(Boolean);
      const iterDone = lines.map((l) => JSON.parse(l)).filter((r) => r.event === "iteration_done");
      assert.ok(iterDone.some((r) => r.transition_reason?.reason_code === "GUARD_STEP_RETRY_LIMIT"));
      assert.ok(iterDone.some((r) => r.failure_type === "retry_exceeded"));
      const evs = lines.map((l) => JSON.parse(l));
      const devStarts = evs.filter((r) => r.event === "agent_start" && r.agent === "dev-backend");
      assert.equal(devStarts.length, 1, "second dev-backend step must not start (retry guard)");
    } finally {
      cp.spawnSync = origSpawnSync;
      if (prevRetries === undefined) delete process.env.ORCH_MAX_RETRIES;
      else process.env.ORCH_MAX_RETRIES = prevRetries;
      if (prevOllama === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = prevOllama;
      if (prevTraces === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prevTraces;
      try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch { /* ok */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }
      clearOrchestratorModuleCaches();
    }
  });
});

describe("budget guard trace events", () => {
  it("emits budget_warning before budget_block and budget_exhausted on hard stop", async () => {
    const prev = {
      cost: process.env.ORCH_MAX_COST_USD,
      prompt: process.env.ORCH_USD_PER_MTOK_PROMPT,
      completion: process.env.ORCH_USD_PER_MTOK_COMPLETION,
      warning: process.env.ORCH_BUDGET_WARNING_RATIO,
      ollama: process.env.OLLAMA_MODEL,
      traces: process.env.ORCH_TRACES_DIR,
      skipNetwork: process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE,
    };
    const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-budget-trace-"));
    try {
      process.env.ORCH_MAX_COST_USD = "1";
      process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
      process.env.ORCH_USD_PER_MTOK_COMPLETION = "1";
      process.env.ORCH_BUDGET_WARNING_RATIO = "0.5";
      process.env.OLLAMA_MODEL = "unit-budget";
      process.env.ORCH_TRACES_DIR = traceDir;
      process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
      ollamaRuntime.runOllama = async () => ({
        content: JSON.stringify({ steps: [{ agentId: "dev-backend", task: "will not run" }] }),
        prompt_eval_count: 600_000,
        eval_count: 500_000,
      });
      clearOrchestratorModuleCaches();

      const agents = require("../agents");
      agents.setBackend("ollama");
      const { run } = require("../orchestrator");
      const result = await run("budget guard test", {
        cwd: os.tmpdir(),
        maxIterations: 1,
        skipStateMcp: true,
        stepSummary: false,
      });

      assert.equal(result.done, false);
      assert.match(result.summary, /budget limit/i);

      const files = fs.readdirSync(traceDir).filter((f) => f.endsWith(".jsonl"));
      assert.equal(files.length, 1, "expected one trace file");
      const events = fs.readFileSync(path.join(traceDir, files[0]), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const warningIdx = events.findIndex((e) => e.event === "budget_warning");
      const blockIdx = events.findIndex((e) => e.event === "budget_block");
      const exhaustedIdx = events.findIndex((e) => e.event === "budget_exhausted");
      const iterationDoneIdx = events.findIndex((e) => e.event === "iteration_done" && e.transition_reason?.reason_code === "GUARD_COST_LIMIT");
      assert.ok(warningIdx >= 0);
      assert.ok(blockIdx > warningIdx);
      assert.ok(exhaustedIdx > blockIdx);
      assert.ok(iterationDoneIdx > exhaustedIdx);
      const warning = events.find((e) => e.event === "budget_warning");
      assert.equal(warning.cost_basis, "actual_env_pricing_ollama_tokens");
      assert.equal(warning.phase, "plan");
    } finally {
      ollamaRuntime.runOllama = origRunOllama;
      try { require("../agents").runOllama = origRunOllama; } catch { /* ok */ }
      try { require("../agents").setBackend(null); } catch { /* ok */ }
      if (prev.cost === undefined) delete process.env.ORCH_MAX_COST_USD;
      else process.env.ORCH_MAX_COST_USD = prev.cost;
      if (prev.prompt === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
      else process.env.ORCH_USD_PER_MTOK_PROMPT = prev.prompt;
      if (prev.completion === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
      else process.env.ORCH_USD_PER_MTOK_COMPLETION = prev.completion;
      if (prev.warning === undefined) delete process.env.ORCH_BUDGET_WARNING_RATIO;
      else process.env.ORCH_BUDGET_WARNING_RATIO = prev.warning;
      if (prev.ollama === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = prev.ollama;
      if (prev.traces === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prev.traces;
      if (prev.skipNetwork === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prev.skipNetwork;
      try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch { /* ok */ }
      clearOrchestratorModuleCaches();
    }
  });

  it("emits observable invalid config for ORCH_BUDGET_WARNING_RATIO outside 0..1", async () => {
    const prev = {
      cost: process.env.ORCH_MAX_COST_USD,
      prompt: process.env.ORCH_USD_PER_MTOK_PROMPT,
      completion: process.env.ORCH_USD_PER_MTOK_COMPLETION,
      warning: process.env.ORCH_BUDGET_WARNING_RATIO,
      traces: process.env.ORCH_TRACES_DIR,
    };
    const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-budget-invalid-"));
    try {
      process.env.ORCH_MAX_COST_USD = "10";
      process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
      process.env.ORCH_USD_PER_MTOK_COMPLETION = "1";
      process.env.ORCH_BUDGET_WARNING_RATIO = "1.2";
      process.env.ORCH_TRACES_DIR = traceDir;
      clearOrchestratorModuleCaches();
      cp.spawnSync = guardSpawnSync;
      const { run } = require("../orchestrator");
      await run("invalid budget ratio", { cwd: os.tmpdir(), maxIterations: 1, skipStateMcp: true, stepSummary: false });
      const files = fs.readdirSync(traceDir).filter((f) => f.endsWith(".jsonl"));
      assert.equal(files.length, 1);
      const events = fs.readFileSync(path.join(traceDir, files[0]), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      assert.ok(events.some((e) => e.event === "budget_config_invalid" && e.var_name === "ORCH_BUDGET_WARNING_RATIO" && e.reason === "out_of_range"));
    } finally {
      if (prev.cost === undefined) delete process.env.ORCH_MAX_COST_USD;
      else process.env.ORCH_MAX_COST_USD = prev.cost;
      if (prev.prompt === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
      else process.env.ORCH_USD_PER_MTOK_PROMPT = prev.prompt;
      if (prev.completion === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
      else process.env.ORCH_USD_PER_MTOK_COMPLETION = prev.completion;
      if (prev.warning === undefined) delete process.env.ORCH_BUDGET_WARNING_RATIO;
      else process.env.ORCH_BUDGET_WARNING_RATIO = prev.warning;
      if (prev.traces === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prev.traces;
      cp.spawnSync = origSpawnSync;
      try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch { /* ok */ }
      clearOrchestratorModuleCaches();
    }
  });

  it("reports all crossed budget scopes and blocks on the most specific scope", async () => {
    const prev = {
      cost: process.env.ORCH_MAX_COST_USD,
      limits: process.env.ORCH_BUDGET_LIMITS_JSON,
      prompt: process.env.ORCH_USD_PER_MTOK_PROMPT,
      completion: process.env.ORCH_USD_PER_MTOK_COMPLETION,
      ollama: process.env.OLLAMA_MODEL,
      traces: process.env.ORCH_TRACES_DIR,
      skipNetwork: process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE,
    };
    const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-budget-dim-"));
    try {
      process.env.ORCH_MAX_COST_USD = "10";
      process.env.ORCH_BUDGET_LIMITS_JSON = JSON.stringify({
        run: 1,
        roles: { orchestrator: 1 },
        steps: { "task-budget-dim-i1-dev-backend": 0.2 },
        models: { "unknown/unknown": 1 },
      });
      process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
      process.env.ORCH_USD_PER_MTOK_COMPLETION = "1";
      process.env.OLLAMA_MODEL = "unit-budget";
      process.env.ORCH_TRACES_DIR = traceDir;
      process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
      ollamaRuntime.runOllama = async () => ({
        content: JSON.stringify({ steps: [{ agentId: "dev-backend", task: "will not run" }] }),
        prompt_eval_count: 1_200_000,
        eval_count: 0,
      });
      clearOrchestratorModuleCaches();

      const agents = require("../agents");
      agents.setBackend("ollama");
      const { run } = require("../orchestrator");
      const result = await run("dimension budget guard", {
        cwd: os.tmpdir(),
        taskId: "task-budget-dim",
        maxIterations: 1,
        skipStateMcp: true,
        stepSummary: false,
      });

      assert.equal(result.done, false);
      const files = fs.readdirSync(traceDir).filter((f) => f.endsWith(".jsonl"));
      assert.equal(files.length, 1);
      const events = fs.readFileSync(path.join(traceDir, files[0]), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const block = events.find((e) => e.event === "budget_block");
      assert.ok(block);
      assert.equal(block.reason_code, "GUARD_COST_LIMIT");
      assert.equal(block.budget_scope, "role");
      assert.deepEqual([...block.triggered_budgets].sort(), ["model", "role", "run"]);
      assert.equal(block.attributed_to_role, "orchestrator");
      assert.equal(block.model, "unknown/unknown");
    } finally {
      ollamaRuntime.runOllama = origRunOllama;
      try { require("../agents").setBackend(null); } catch { /* ok */ }
      if (prev.cost === undefined) delete process.env.ORCH_MAX_COST_USD;
      else process.env.ORCH_MAX_COST_USD = prev.cost;
      if (prev.limits === undefined) delete process.env.ORCH_BUDGET_LIMITS_JSON;
      else process.env.ORCH_BUDGET_LIMITS_JSON = prev.limits;
      if (prev.prompt === undefined) delete process.env.ORCH_USD_PER_MTOK_PROMPT;
      else process.env.ORCH_USD_PER_MTOK_PROMPT = prev.prompt;
      if (prev.completion === undefined) delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
      else process.env.ORCH_USD_PER_MTOK_COMPLETION = prev.completion;
      if (prev.ollama === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = prev.ollama;
      if (prev.traces === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prev.traces;
      if (prev.skipNetwork === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prev.skipNetwork;
      try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch { /* ok */ }
      clearOrchestratorModuleCaches();
    }
  });
});
