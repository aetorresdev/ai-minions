/**
 * Optional system-path E2E with `ORCH_TEST_SYSTEM_PATH_HARNESS=1` (deterministic stubs + alignment bypass).
 * **Not** part of default `npm run test:e2e:strict` (CI strict job). Run: `npm run test:e2e:strict:harness`.
 */

"use strict";

process.env.ORCH_MCP_TRANSPORT = "direct";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { run } = require("../orchestrator");
const {
  TEST_TIMEOUT_MS,
  getMcpDirectPath,
  makeTempDir,
  removeTempDir,
  loadEvents,
  assertHashChain,
  initE2eStrictSuite,
} = require("./e2e-strict-shared");

describe("System-path E2E — harness (ORCH_TEST_SYSTEM_PATH_HARNESS)", { timeout: TEST_TIMEOUT_MS, concurrency: 1 }, () => {
  const MCP_DIRECT = getMcpDirectPath();
  let ollamaAvailable = false;

  before(async () => {
    const st = await initE2eStrictSuite();
    ollamaAvailable = st.ollamaAvailable;
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

  function strictE2eRun(t, goal, opts = {}) {
    const sid = typeof t?.name === "string" ? t.name.slice(0, 240) : "";
    return run(goal, sid ? { ...opts, traceScenarioId: sid } : opts);
  }

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
        "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
      );

      const result = await strictE2eRun(t, "E2E system-path harness (deterministic stubs)", {
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
        `expected ≥3 mode_advanced (ORCH→DEV, DEV→…, CERBERUS→ORCH), got ${types.filter((x) => x === "mode_advanced").length}`,
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
