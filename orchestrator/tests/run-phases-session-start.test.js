"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { executeSessionStartPhase } = require("../run-phases/session-start");
const { validateTraceLine } = require("../trace-schema");

function makeDeps(overrides = {}) {
  const traces = [];
  const logs = [];
  const base = {
    taskId: "task-phase-test",
    cwd: "/tmp/orch-phase",
    flowMode: "single_agent",
    goal: "MODE: ORCHESTRATOR\nFLOW: single_agent\nGOAL: smoke",
    maxIterations: 3,
    runScope: { scope: "repo" },
    scenarioId: null,
    requireHandoff: true,
    skipStateMcp: true,
    approvedArtifacts: [],
    sessionEnv: null,
    parsedBudgetWarningRatio: { value: null },
    parsedBudgetLimits: { limits: { roles: {}, steps: {}, models: {} } },
    maxContextChars: 12000,
    stepSummary: true,
    maxCostUsd: null,
    budgetWarningRatio: null,
    budgetLimits: { roles: {}, steps: {}, models: {} },
    maxStepRetries: null,
    localModel: null,
    log: (_agent, msg) => logs.push(msg),
    traceEvent: (_taskId, payload) => traces.push(payload),
    checkOllama: async () => true,
    configureLocalModelPolicy: () => {},
    setLocalModelTraceReporter: () => {},
    setModelSelectionTraceReporter: () => {},
    validateLocalOnlyRunPrerequisites: async () => ({
      local_only_mode: false,
      selected_model: "claude-haiku",
      override_source: "default",
    }),
    clearDegradedAgents: () => {},
    buildWorktreeTraceFields: () => ({}),
    callStateMcp: () => ({ ok: true, envelope_path: "/tmp/envelope" }),
    CONTRACT_VERSION: "test-contract",
    orchTestSystemPathHarnessOn: () => false,
  };
  return { deps: { ...base, ...overrides }, traces, logs };
}

describe("run-phases/session-start — executeSessionStartPhase", () => {
  it("emits schema-valid session_start before plan phase", async () => {
    const { deps, traces } = makeDeps();
    const { localOnlyCtx } = await executeSessionStartPhase(deps);
    assert.equal(localOnlyCtx.local_only_mode, false);
    const sessionStart = traces.find((t) => t.event === "session_start");
    assert.ok(sessionStart, "session_start trace required");
    assert.equal(sessionStart.session_id, deps.taskId);
    assert.equal(sessionStart.flow_mode, "single_agent");
    assert.equal(sessionStart.flow_src, "orchestrator_cli");
    assert.equal(sessionStart.require_handoff, true);
    const row = {
      ts: "2026-06-05T12:00:00.000Z",
      ts_ms: 1,
      trace_schema_version: "2",
      task_id: deps.taskId,
      ...sessionStart,
    };
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("emits degraded_mode when skipStateMcp is true", async () => {
    const { deps, traces } = makeDeps({ skipStateMcp: true });
    await executeSessionStartPhase(deps);
    const degraded = traces.filter((t) => t.event === "degraded_mode");
    assert.equal(degraded.length, 1);
    assert.equal(degraded[0].reason, "skipStateMcp=true");
    assert.equal(traces.some((t) => t.event === "session_start"), true);
  });

  it("calls register_task when skipStateMcp is false", async () => {
    let registerCalled = false;
    const { deps, traces } = makeDeps({
      skipStateMcp: false,
      callStateMcp: (tool, payload) => {
        if (tool === "register_task") {
          registerCalled = true;
          assert.equal(payload.task_id, "task-phase-test");
          assert.equal(payload.flow_mode, "single_agent");
        }
        return { ok: true, envelope_path: "/tmp/env.json" };
      },
    });
    await executeSessionStartPhase(deps);
    assert.equal(registerCalled, true);
    assert.equal(traces.some((t) => t.event === "degraded_mode"), false);
  });

  it("emits degraded_mode when register_task fails", async () => {
    const { deps, traces } = makeDeps({
      skipStateMcp: false,
      callStateMcp: () => ({ ok: false, error: "state store down" }),
    });
    await executeSessionStartPhase(deps);
    const degraded = traces.find((t) => t.event === "degraded_mode");
    assert.ok(degraded);
    assert.match(String(degraded.reason), /state store down/);
  });

  it("emits budget_config_invalid traces when parsers report invalid config", async () => {
    const { deps, traces } = makeDeps({
      parsedBudgetWarningRatio: { value: null, invalid: { field: "ORCH_BUDGET_WARNING_RATIO", reason: "out_of_range" } },
      parsedBudgetLimits: { limits: { roles: {}, steps: {}, models: {} }, invalid: { field: "ORCH_BUDGET_LIMITS_JSON", reason: "parse_error" } },
    });
    await executeSessionStartPhase(deps);
    const invalids = traces.filter((t) => t.event === "budget_config_invalid");
    assert.equal(invalids.length, 2);
  });
});
