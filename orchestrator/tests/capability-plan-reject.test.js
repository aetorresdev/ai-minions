/**
 * Runtime regression: unknown plan agentId stops before workers (capability flow / CERBERUS gate).
 * Requires ORCH_TEST_SYSTEM_PATH_HARNESS + ORCH_TEST_PLAN_UNKNOWN_ROLE (see agents.js).
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

function clearOrchestratorAndAgentsCache() {
  const agentsPath = path.resolve(__dirname, "..", "agents.js");
  const orchPath = path.resolve(__dirname, "..", "orchestrator.js");
  for (const k of Object.keys(require.cache)) {
    if (k === agentsPath || k === orchPath) delete require.cache[k];
  }
}

describe("plan_capability_reject — unknown role in harness plan", () => {
  it("done=false, summary Plan rejected, trace plan_capability_reject, no agent_start, no decide phase", async () => {
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-tr-cap-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cwd-cap-"));
    const taskId = `cap-reject-${Date.now()}`;

    const prevHarness = process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;
    const prevUnknown = process.env.ORCH_TEST_PLAN_UNKNOWN_ROLE;
    const prevTraces = process.env.ORCH_TRACES_DIR;

    process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = "1";
    process.env.ORCH_TEST_PLAN_UNKNOWN_ROLE = "1";
    process.env.ORCH_TRACES_DIR = tracesDir;
    clearOrchestratorAndAgentsCache();

    try {
      const { run } = require("../orchestrator");
      const result = await run("capability regression goal", {
        taskId,
        cwd,
        maxIterations: 2,
        skipStateMcp: true,
        flowMode: "single_agent",
      });

      assert.equal(result.done, false);
      assert.match(result.summary, /Plan rejected/i);

      const traceFile = path.join(tracesDir, `${taskId}.jsonl`);
      assert.ok(fs.existsSync(traceFile), `expected trace at ${traceFile}`);
      const raw = fs.readFileSync(traceFile, "utf8").trim();
      const lines = raw ? raw.split("\n").map((ln) => JSON.parse(ln)) : [];
      const events = lines.map((o) => o.event);

      assert.ok(
        events.includes("plan_capability_reject"),
        `expected plan_capability_reject in ${events.join(",")}`,
      );
      assert.ok(
        !events.includes("agent_start"),
        `did not expect agent_start; got ${events.join(",")}`,
      );

      const decideCtx = lines.filter((o) => o.event === "context_stats" && o.phase === "decide");
      assert.equal(
        decideCtx.length,
        0,
        "orchestrator decide must not run when plan is rejected before the main loop",
      );
    } finally {
      if (prevHarness === undefined) delete process.env.ORCH_TEST_SYSTEM_PATH_HARNESS;
      else process.env.ORCH_TEST_SYSTEM_PATH_HARNESS = prevHarness;
      if (prevUnknown === undefined) delete process.env.ORCH_TEST_PLAN_UNKNOWN_ROLE;
      else process.env.ORCH_TEST_PLAN_UNKNOWN_ROLE = prevUnknown;
      if (prevTraces === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prevTraces;
      clearOrchestratorAndAgentsCache();
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch { /* ignore */ }
      try {
        fs.rmSync(tracesDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  });
});
