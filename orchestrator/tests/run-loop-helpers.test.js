"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");
const {
  resolveMaxIterations,
  detectBlockers,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  validateStepGraph,
  edgeMeta,
  EDGE_TYPE_CATEGORY,
  extractJson,
  roundUsd6,
  parseOptionalRatioWithInvalid,
  AGENT_TO_MODE,
  VALID_WORKER_AGENTS,
  checkOllama,
} = require("../run-loop-helpers");

describe("run-loop-helpers — characterization", () => {
  it("resolveMaxIterations honors options then env default", () => {
    const prev = process.env.ORCH_MAX_ITERATIONS;
    delete process.env.ORCH_MAX_ITERATIONS;
    try {
      assert.equal(resolveMaxIterations({ maxIterations: 5 }), 5);
      assert.equal(resolveMaxIterations({}), 3);
    } finally {
      if (prev !== undefined) process.env.ORCH_MAX_ITERATIONS = prev;
    }
  });

  it("detectBlockers finds blocker lines deterministically", () => {
    const r = detectBlockers("- blocker: missing auth");
    assert.equal(r.count, 1);
    assert.match(r.items[0], /blocker/);
  });

  it("stripLeadingOwnerArchitectForDegradedMultiAgent trims leading owner/architect when dev follows", () => {
    const steps = [
      { agentId: "owner", task: "a" },
      { agentId: "architect", task: "b" },
      { agentId: "dev-backend", task: "c" },
    ];
    const out = stripLeadingOwnerArchitectForDegradedMultiAgent(steps);
    assert.equal(out.length, 1);
    assert.equal(out[0].agentId, "dev-backend");
  });

  it("validateStepGraph rejects missing agentId", () => {
    const r = validateStepGraph([{ task: "x" }], VALID_WORKER_AGENTS);
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /missing agentId/);
  });

  it("edgeMeta maps known edge types", () => {
    assert.deepEqual(edgeMeta("success"), { edge_type: "success", edge_category: "control_flow" });
    assert.equal(EDGE_TYPE_CATEGORY.gate_block, "policy");
  });

  it("extractJson parses fenced JSON", () => {
    assert.deepEqual(extractJson('```json\n{"steps":[]}\n```'), { steps: [] });
  });

  it("roundUsd6 rounds to six decimal places", () => {
    assert.equal(roundUsd6(1.23456789), 1.234568);
  });

  it("parseOptionalRatioWithInvalid rejects out-of-range values", () => {
    const prev = process.env.ORCH_BUDGET_WARNING_RATIO;
    process.env.ORCH_BUDGET_WARNING_RATIO = "2";
    try {
      const r = parseOptionalRatioWithInvalid("ORCH_BUDGET_WARNING_RATIO");
      assert.equal(r.value, null);
      assert.equal(r.invalid.reason, "out_of_range");
    } finally {
      if (prev === undefined) delete process.env.ORCH_BUDGET_WARNING_RATIO;
      else process.env.ORCH_BUDGET_WARNING_RATIO = prev;
    }
  });

  it("AGENT_TO_MODE covers worker agents used by run loop", () => {
    for (const id of ["dev-backend", "qa", "cerberus"]) {
      assert.ok(AGENT_TO_MODE[id]);
      assert.ok(VALID_WORKER_AGENTS.has(id));
    }
  });

  it("orchestrator re-exports full run-loop-helpers facade surface", () => {
    const cp = require("child_process");
    cp.spawnSync = () => ({ error: null, status: 0, stdout: "\n", stderr: "" });
    const orch = require("../orchestrator");
    const rl = require("../run-loop-helpers");
    const RUN_LOOP_FACADE_KEYS = [
      "resolveMaxIterations",
      "detectBlockers",
      "validateHandoffStructure",
      "stripLeadingOwnerArchitectForDegradedMultiAgent",
      "edgeMeta",
      "EDGE_TYPE_CATEGORY",
      "validateStepGraph",
      "assertParentStepExists",
    ];
    for (const key of RUN_LOOP_FACADE_KEYS) {
      assert.equal(orch[key], rl[key], `orchestrator.${key}`);
    }
  });
});

describe("run-loop-helpers — checkOllama endpoint resolution", () => {
  it("probes configured base_path from model-policy.yaml", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-ollama-"));
    const policyDir = path.join(tmp, ".ai-minions");
    fs.mkdirSync(policyDir, { recursive: true });
    const fixtureBody = JSON.stringify({ models: [] });
    const server = http.createServer((req, res) => {
      if (req.url === "/olla/ollama/api/tags" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fixtureBody);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    fs.writeFileSync(
      path.join(policyDir, "model-policy.yaml"),
      `model_policy_version: 1\nlocal_backend:\n  backend_id: ollama\n  support_status: supported\n  base_url: http://127.0.0.1:${port}/olla/ollama\n  endpoint_scope: localhost\n`,
      "utf8",
    );
    const prevSkip = process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    try {
      const ok = await checkOllama({ cwd: tmp });
      assert.equal(ok, true);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (prevSkip === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prevSkip;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("probes env OLLAMA_HOST when cwd has no model-policy local_backend", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-ollama-env-"));
    const fixtureBody = JSON.stringify({ models: [] });
    const server = http.createServer((req, res) => {
      if (req.url === "/api/tags" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fixtureBody);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    const prevHost = process.env.OLLAMA_HOST;
    const prevPort = process.env.OLLAMA_PORT;
    const prevSkip = process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    process.env.OLLAMA_HOST = "0.0.0.0";
    process.env.OLLAMA_PORT = String(port);
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    try {
      const ok = await checkOllama({ cwd: tmp });
      assert.equal(ok, true);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      if (prevHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prevHost;
      if (prevPort === undefined) delete process.env.OLLAMA_PORT;
      else process.env.OLLAMA_PORT = prevPort;
      if (prevSkip === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prevSkip;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
