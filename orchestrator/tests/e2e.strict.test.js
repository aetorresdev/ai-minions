/**
 * System-path E2E (`npm run test:e2e:strict` / `test:e2e:system-path`):
 * `skipStateMcp: false` + `ORCH_MCP_TRANSPORT=direct` — real Ollama + `validate_goal_alignment` where applicable.
 *
 * **Harness-only** `run()` test lives in `e2e.strict.harness.test.js` (`npm run test:e2e:strict:harness`) — not run in default CI strict job.
 *
 * After suite: prints **`alignment_failure_rate`** from trace `gate_result` / `goal_alignment` (excludes harness rows).
 *
 * Prerequisites: Ollama; `uv sync` in mcp-servers/orchestrator-state and compact-handoff.
 * Isolated disk state via ORCHESTRATOR_STATE_ROOT per test.
 */

"use strict";

process.env.ORCH_MCP_TRANSPORT = "direct";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { run } = require("../orchestrator");
const {
  TEST_TIMEOUT_MS,
  getMcpDirectPath,
  makeTempDir,
  removeTempDir,
  callMcpDirect,
  loadEvents,
  assertHashChain,
  countGoalAlignmentInTrace,
  initE2eStrictSuite,
} = require("./e2e-strict-shared");

const alignmentSamples = [];

describe("System-path E2E — MCP direct + state store", { timeout: TEST_TIMEOUT_MS, concurrency: 1 }, () => {
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

  function recordAlignment(taskId) {
    alignmentSamples.push(countGoalAlignmentInTrace(taskId));
  }

  after(() => {
    if (!ollamaAvailable) return;
    const total = alignmentSamples.reduce(
      (a, s) => ({ checks: a.checks + s.checks, failures: a.failures + s.failures }),
      { checks: 0, failures: 0 },
    );
    if (total.checks === 0) {
      console.log(
        "[e2e-strict] alignment_failure_rate: n/a (0 goal_alignment gate_result rows in trace for this suite — model may not have reached alignment gates)",
      );
      return;
    }
    const rate = total.failures / total.checks;
    console.log(
      `[e2e-strict] alignment_failure_rate: ${rate.toFixed(6)} (${total.failures}/${total.checks} failed checks)`,
    );
  });

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
        "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
      );

      await strictE2eRun(t, "Add a multiply function to utils.js that multiplies two numbers", {
        taskId,
        maxIterations: 1,
        cwd,
        flowMode: "single_agent",
        skipStateMcp: false,
        stepSummary: true,
      });

      recordAlignment(taskId);

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
        "last mode_advanced should record handoff_yaml_present: true",
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

    const yaml =
      typeof out === "string"
        ? out
        : out && typeof out.handoff_yaml === "string"
          ? out.handoff_yaml
          : "";
    if (!yaml || yaml.startsWith("error:")) {
      t.skip(`compact_handoff unavailable: ${String(yaml).slice(0, 120)}`);
      return;
    }
    const low = yaml.toLowerCase();
    assert.ok(
      low.includes("files_modified") || low.includes("validation_run"),
      `expected DEV keys in compact output, got: ${yaml.slice(0, 200)}`,
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
});
