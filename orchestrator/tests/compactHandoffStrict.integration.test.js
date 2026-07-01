/**
 * Integration: strict compact_handoff failure (requireHandoff=true) without test-only hooks on run().
 *
 * Patches child_process.spawnSync before loading orchestrator/agents (same pattern as askAgent.test.js).
 * Must run before other test files that require orchestrator with a different stub — listed first in package.json.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const PLAN = JSON.stringify({
  steps: [{ agentId: "dev-backend", task: "Add a comment to src/x.js" }],
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
let spawnCalls = 0;

function clearOrchestratorModuleCaches() {
  const paths = new Set([
    path.resolve(__dirname, "..", "agents.js"),
    path.resolve(__dirname, "..", "modules", "shared", "agents.js"),
    path.resolve(__dirname, "..", "orchestrator.js"),
    path.resolve(__dirname, "..", "modules", "run-control", "orchestrator.js"),
    path.resolve(__dirname, "..", "agents", "routing", "model-routing.js"),
  ]);
  for (const k of Object.keys(require.cache)) {
    if (paths.has(k)) delete require.cache[k];
  }
}

function integrationSpawnSync(cmd, args, opts) {
  if (cmd !== "claude") return origSpawnSync.call(cp, cmd, args, opts);

  const arg1 = args[1];
  if (arg1 === "-") {
    const input = opts && opts.input != null ? String(opts.input) : "";
    if (input.includes("MODE: ORCHESTRATOR") && input.includes("Decompose")) {
      spawnCalls++;
      return { error: null, status: 0, stdout: `${PLAN}\n`, stderr: "" };
    }
    if (input.includes("Your task:") && !input.includes("Classify each finding")) {
      spawnCalls++;
      return { error: null, status: 0, stdout: `${DEV_OK}\n`, stderr: "" };
    }
    if (input.includes("Classify each finding")) {
      spawnCalls++;
      return { error: null, status: 0, stdout: `${CERB_OK}\n`, stderr: "" };
    }
    return { error: null, status: 0, stdout: "{}\n", stderr: "" };
  }

  const p = String(arg1);
  if (p.includes("compact_handoff") || p.includes("compact-handoff.compact_handoff")) {
    spawnCalls++;
    return { error: null, status: 1, stdout: "", stderr: "simulated compact_handoff failure" };
  }

  return { error: null, status: 0, stdout: "{}\n", stderr: "" };
}

describe("compact_handoff strict path — integration", () => {
  it("requireHandoff=true + skipStateMcp: compact_handoff failure → gateBlocked artifact, done=false, summary mentions gate-blocked", async () => {
    const prevOllama = process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_MODEL;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-compact-strict-"));
    let run;
    try {
      clearOrchestratorModuleCaches();
      cp.spawnSync = integrationSpawnSync;
      ({ run } = require("../orchestrator"));

      spawnCalls = 0;
      const result = await run("integration compact_handoff strict goal", {
        cwd: tmp,
        maxIterations: 1,
        flowMode: "single_agent",
        skipStateMcp: true,
        requireHandoff: true,
        stepSummary: false,
      });

      const dev = result.artifacts.find((a) => a.agentId === "dev-backend");
      assert.ok(dev, "expected dev-backend artifact");
      assert.equal(dev.gateBlocked, true, "strict policy must set gateBlocked");
      assert.match(String(dev.gateReason || ""), /compact_handoff failed/i, `gateReason was: ${dev.gateReason}`);
      assert.equal(dev.handoff_compression, "failed");
      assert.equal(dev.handoff_error, "simulated compact_handoff failure");
      assert.equal(result.done, false);
      assert.ok(
        result.summary && (result.summary.includes("gate-blocked") || result.summary.includes("Manual review")),
        `summary: ${result.summary}`
      );
      assert.ok(spawnCalls >= 3, `expected plan + dev + compact stubs (>=3), got spawnCalls=${spawnCalls}`);
    } finally {
      cp.spawnSync = origSpawnSync;
      if (prevOllama !== undefined) process.env.OLLAMA_MODEL = prevOllama;
      else delete process.env.OLLAMA_MODEL;
      clearOrchestratorModuleCaches();
      try {
        fs.rmSync(tmp, { recursive: true });
      } catch {
        /* ignore */
      }
    }
  });
});
