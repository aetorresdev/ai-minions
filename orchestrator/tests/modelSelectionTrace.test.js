"use strict";

const assert = require("node:assert/strict");
const cp = require("child_process");
const { describe, it, beforeEach, afterEach } = require("node:test");

cp.spawnSync = () => ({
  error: null,
  status: 0,
  stdout: "files_read:\n  - utils.js\nfiles_modified:\n  - utils.js\nvalidation_run: node -c utils.js → exit 0\n",
  stderr: "",
});

const { validateTraceLine } = require("../trace-schema");
const {
  inferModelTier,
  buildModelSelectionPayload,
  emitModelSelection,
} = require("../modules/trace/model-selection-trace");
const {
  askAgent,
  setModelSelectionTraceReporter,
  describeModelSelectionSource,
  clearDegradedAgents,
  MODEL_ROUTING,
} = require("../agents");

function traceEnvelopeBase(overrides = {}) {
  return {
    ts: "2026-05-18T12:00:00.000Z",
    ts_ms: 1747574400000,
    trace_schema_version: "2",
    task_id: "task-model-gov",
    ...overrides,
  };
}

function modelSelectionBase(overrides = {}) {
  return traceEnvelopeBase({
    event: "model_selection",
    role: "DEV",
    step_id: "s-dev-1",
    model: "claude-sonnet-4-6",
    model_tier: "standard",
    selection_source: "default",
    selection_reason: "model_routing_primary",
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    estimated_cost_usd: 0,
    agent: "dev-backend",
    iteration: 1,
    ...overrides,
  });
}

describe("model-selection trace", () => {
  it("inferModelTier maps known model ids", () => {
    assert.equal(inferModelTier("claude-haiku-4-5-20251001"), "cheap");
    assert.equal(inferModelTier("claude-sonnet-4-6"), "standard");
    assert.equal(inferModelTier("claude-opus-4-20250514"), "frontier");
  });

  it("validateTraceLine accepts model_selection envelope", () => {
    const v = validateTraceLine(modelSelectionBase());
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("validateTraceLine rejects model_selection without model_tier", () => {
    const row = modelSelectionBase();
    delete row.model_tier;
    const v = validateTraceLine(row);
    assert.equal(v.ok, false);
  });

  it("validateTraceLine rejects frontier tier without substantive selection_reason", () => {
    const v = validateTraceLine(
      modelSelectionBase({
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_reason: "x",
      }),
    );
    assert.equal(v.ok, false);
  });

  it("validateTraceLine accepts frontier tier with selection_reason", () => {
    const v = validateTraceLine(
      modelSelectionBase({
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_reason: "operator_manual_frontier_override",
      }),
    );
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("buildModelSelectionPayload rejects frontier without explicit selection_reason", () => {
    assert.throws(
      () => buildModelSelectionPayload({
        role: "DEV",
        step_id: "s1",
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "",
      }),
      /selection_reason is required/,
    );
    assert.throws(
      () => buildModelSelectionPayload({
        role: "DEV",
        step_id: "s1",
        model: "claude-opus-4",
        selection_source: "default",
        selection_reason: "short",
      }),
      /at least 8 characters/,
    );
  });

  it("buildModelSelectionPayload supplies default cost estimates as zero", () => {
    const payload = buildModelSelectionPayload({
      role: "QA",
      step_id: "s-qa",
      model: "claude-sonnet-4-6",
      selection_source: "default",
      selection_reason: "model_routing_primary",
    });
    assert.equal(payload.estimated_cost_usd, 0);
    assert.equal(payload.model_tier, "standard");
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "provider_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "route_source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "endpoint_scope"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "usage_accounting_status"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "tier"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "base_url"), false);
  });

  it("buildModelSelectionPayload emits Phase A routing fields only when supplied", () => {
    const payload = buildModelSelectionPayload({
      role: "ARCHITECT",
      step_id: "s-arch",
      model: "qwen3.6:35b-a3b",
      tier: "strong",
      selection_source: "policy",
      selection_reason: "role_defaults:tier=strong",
      provider_id: "ollama",
      model_backend: "ollama",
      endpoint_ref: "default",
      endpoint_scope: "localhost",
      route_source: "role_defaults",
      usage_accounting_status: "unavailable",
    });
    assert.equal(payload.tier, "strong");
    assert.equal(payload.model_tier, "strong");
    assert.equal(payload.route_source, "role_defaults");
    assert.equal(payload.endpoint_scope, "localhost");
    assert.equal(payload.provider_id, "ollama");
    assert.equal(payload.model_backend, "ollama");
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "base_url"), false);
    const v = validateTraceLine(traceEnvelopeBase(payload));
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("buildModelSelectionPayload omits endpoint_scope when not supplied (no localhost invent)", () => {
    const payload = buildModelSelectionPayload({
      role: "DEV",
      step_id: "s-dev",
      model: "qwen2.5-coder:7b",
      tier: "cheap",
      selection_source: "policy",
      selection_reason: "role_defaults:tier=cheap",
      provider_id: "ollama",
      model_backend: "ollama",
      endpoint_ref: "default",
      route_source: "role_defaults",
      usage_accounting_status: "unavailable",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "endpoint_scope"), false);
  });

  it("emitModelSelection writes schema-valid trace rows", () => {
    const lines = [];
    emitModelSelection((_taskId, payload) => {
      const row = traceEnvelopeBase(payload);
      const v = validateTraceLine(row);
      assert.equal(v.ok, true, (v.errors || []).join(" | "));
      lines.push(row);
    }, "task-model-gov", {
      role: "ORCHESTRATOR",
      step_id: "phase:plan",
      model: "qwen2.5-coder:7b",
      selection_source: "default",
      selection_reason: "model_routing_primary",
      agent: "orchestrator",
      iteration: 0,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].event, "model_selection");
  });

  it("describeModelSelectionSource returns default without overrides", () => {
    const src = describeModelSelectionSource("dev-backend");
    assert.equal(src.selection_source, "default");
    assert.match(src.selection_reason, /model_routing/);
  });

  it("askAgent enforces frontier gate even without trace reporter", async () => {
    clearDegradedAgents();
    const originalPrimary = MODEL_ROUTING["dev-backend"].primary;
    setModelSelectionTraceReporter(null);
    MODEL_ROUTING["dev-backend"].primary = "claude-opus-4-20250514";
    try {
      await assert.rejects(
        () => askAgent("dev-backend", "test", { cwd: process.cwd() }),
        (err) => err && err.gate_id === "model_tier_gate"
          && /FRONTIER_UNAUTHORIZED_SOURCE|selection_source=default/.test(String(err.message)),
      );
    } finally {
      MODEL_ROUTING["dev-backend"].primary = originalPrimary;
    }
  });

  it("askAgent emits model_selection when reporter is wired", async () => {
    clearDegradedAgents();
    const events = [];
    setModelSelectionTraceReporter((payload) => events.push(payload));
    try {
      const { output } = await askAgent("dev-backend", "implement X", {
        traceContext: { step_id: "s1", iteration: 1 },
      });
      assert.ok(output);
      assert.equal(events.length, 1);
      assert.equal(events[0].event, "model_selection");
      assert.equal(events[0].role, "DEV");
      assert.equal(events[0].step_id, "s1");
      // Claude/legacy path: no fabricated Ollama Phase A metadata.
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], "provider_id"), false);
      assert.notEqual(events[0].provider_id, "ollama");
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], "endpoint_scope"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], "endpoint_ref"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], "route_source"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], "base_url"), false);
      assert.match(String(events[0].model), /claude|sonnet|haiku|opus/i);
      const v = validateTraceLine(traceEnvelopeBase(events[0]));
      assert.equal(v.ok, true, (v.errors || []).join(" | "));
    } finally {
      setModelSelectionTraceReporter(null);
    }
  });
});

describe("model-selection Phase A local_only emission", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const policy = require("../modules/model-runtime/local-model-policy");

  const keys = ["ORCH_MODEL_MODE", "ORCH_LOCAL_MODEL", "OLLAMA_MODEL", "MODEL_OVERRIDE_DEV"];
  /** @type {Record<string, string | undefined>} */
  let prevEnv = {};
  /** @type {string | null} */
  let tmpDir = null;

  beforeEach(() => {
    prevEnv = {};
    for (const k of keys) {
      prevEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.ORCH_MODEL_MODE = "local_only";
    policy.resetLocalModelPolicy();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-sel-phase-a-"));
    fs.mkdirSync(path.join(tmpDir, ".ai-minions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".ai-minions", "model_policy.json"),
      `${JSON.stringify({
        model_policy_version: 1,
        default_tier: "cheap",
        tiers: {
          cheap: ["qwen2.5-coder:7b"],
          standard: ["qwen2.5-coder:14b"],
          strong: ["qwen3.6:35b-a3b"],
          frontier: [],
        },
        role_defaults: {
          OWNER: "strong",
          ARCHITECT: "strong",
          DEV: "cheap",
          QA: "cheap",
          CERBERUS: "strong",
          ORCHESTRATOR: "standard",
        },
        rules: [],
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(tmpDir, ".ai-minions", "model-policy.yaml"),
      "model_policy_version: 1\ndefault_model: qwen2.5-coder:7b\n",
    );
    policy.configureLocalModelPolicy({
      cwd: tmpDir,
      endpointMeta: {
        host: "127.0.0.1",
        port: 40114,
        base_url: "http://127.0.0.1:40114/olla/ollama",
        endpoint_scope: "localhost",
      },
      selectionResult: {
        selected_model: "qwen2.5-coder:7b",
        override_source: "model_policy_yaml",
        discovered_models: ["qwen2.5-coder:7b", "qwen3.6:35b-a3b", "qwen2.5-coder:14b"],
      },
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    policy.resetLocalModelPolicy();
    setModelSelectionTraceReporter(null);
    clearDegradedAgents();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("local_only askAgent emits exact provider/tier/route/endpoint (no base_url)", async () => {
    const events = [];
    setModelSelectionTraceReporter((payload) => events.push(payload));
    // Emission runs before model invoke; architect may fail later without a live Ollama backend.
    try {
      await askAgent("architect", "design X", {
        cwd: tmpDir,
        traceContext: { step_id: "s-arch", iteration: 1 },
      });
    } catch {
      // ignore post-emit invoke failures
    }
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.provider_id, "ollama");
    assert.equal(ev.model_backend, "ollama");
    assert.equal(ev.model, "qwen3.6:35b-a3b");
    assert.equal(ev.tier, "strong");
    assert.equal(ev.route_source, "role_defaults");
    assert.equal(ev.endpoint_ref, "default");
    assert.equal(ev.endpoint_scope, "localhost");
    assert.equal(ev.usage_accounting_status, "unavailable");
    assert.match(String(ev.selection_reason), /role_defaults:tier=strong/);
    assert.equal(Object.prototype.hasOwnProperty.call(ev, "base_url"), false);
    const v = validateTraceLine(traceEnvelopeBase(ev));
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("local_only omits endpoint_scope when endpoint meta is absent", async () => {
    policy.configureLocalModelPolicy({
      cwd: tmpDir,
      endpointMeta: null,
      selectionResult: {
        selected_model: "qwen2.5-coder:7b",
        override_source: "model_policy_yaml",
        discovered_models: ["qwen2.5-coder:7b", "qwen3.6:35b-a3b"],
      },
    });
    const events = [];
    setModelSelectionTraceReporter((payload) => events.push(payload));
    // Emission runs before model invoke; ignore post-emit backend failures.
    try {
      await askAgent("dev-backend", "implement X", {
        cwd: tmpDir,
        traceContext: { step_id: "s-dev" },
      });
    } catch {
      // ignore post-emit invoke failures
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].provider_id, "ollama");
    assert.equal(events[0].model, "qwen2.5-coder:7b");
    assert.equal(events[0].tier, "cheap");
    assert.equal(events[0].route_source, "role_defaults");
    assert.equal(Object.prototype.hasOwnProperty.call(events[0], "endpoint_scope"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(events[0], "base_url"), false);
  });
});
