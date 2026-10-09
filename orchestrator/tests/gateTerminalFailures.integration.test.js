/**
 * Integration: terminal gate failures through the real `run()` loop — deterministic, no LLM, no network, no Ollama.
 *
 * The `claude` CLI is replaced by a scripted `child_process.spawnSync` stub (same pattern as
 * compactHandoffStrict.integration.test.js). Traces go to a per-test temp dir (`ORCH_TRACES_DIR`).
 *
 * Covered defects (each test fails on the pre-fix tree and passes with the fix):
 *   1. `blocker: (none)` must not count as a blocker.
 *   2. A CERBERUS output-contract failure must stop the run for manual review, never `done`.
 *   3. A failed or invalid orchestrator decide must stop the run for manual review, never `done`.
 *   4. A strict-mode CERBERUS compact_handoff failure must keep blocking success now that `blocker: (none)`
 *      no longer forces an iteration.
 *   5. Without --skip-gates, a state-MCP failure (register_task, per-step gates, CERBERUS transition) must stop
 *      the run for manual review instead of continuing ungated and finishing done.
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

// Valid DEV → next handoff (compact_handoff MCP is also served by the scripted `claude` stub).
const DEV_HANDOFF_YAML = [
  "from_mode: DEV",
  "files_modified:",
  "  - src/x.js",
  "validation_run: npm test — passed",
].join("\n");

// Architect handoff satisfies the real approval policy so a later DEV step may run
// without a test-only system-path bypass. `design_summary` keeps the handoff structurally valid.
const ARCHITECT_APPROVAL_YAML = [
  "design_summary: scope and design accepted",
  "scope_validation_passed: true",
  "architecture_validation_passed: true",
  "validation_passed: true",
  "required_fields_present: true",
  "human_product_scope_granted: true",
  "human_architecture_granted: true",
  "human_dev_execution_granted: true",
  "input_type: task",
  "risk_level: low",
  "unresolved_assumptions: 0",
].join("\n");

const PLAN_WITH_ARCHITECT = JSON.stringify({
  steps: [
    { agentId: "architect", task: "Confirm scope and design" },
    { agentId: "dev-backend", task: "Add a comment to src/x.js" },
  ],
});

const CERB_VACUOUS_BLOCKER = [
  "blocker: (none)",
  "improvement: reviewed `src/x.js` and the validation_run output; no change required",
  "nice-to-have: (none)",
].join("\n");

// No `blocker` token anywhere — isolates decide behavior from blocker parsing.
const CERB_CLEAN = "- improvement: reviewed deliverables; no further issues";

// No blocker/improvement/nice-to-have classification at all → output contract failure.
const CERB_CONTRACT_FAIL = "Looks fine to me.";

const DECIDE_DONE = JSON.stringify({ done: true, summary: "All good" });

const origSpawnSync = cp.spawnSync;

function clearOrchestratorModuleCaches() {
  const paths = new Set([
    path.resolve(__dirname, "..", "agents.js"),
    path.resolve(__dirname, "..", "modules", "shared", "agents.js"),
    path.resolve(__dirname, "..", "orchestrator.js"),
    path.resolve(__dirname, "..", "modules", "run-control", "orchestrator.js"),
    path.resolve(__dirname, "..", "agents", "routing", "model-routing.js"),
    path.resolve(__dirname, "..", "modules", "model-runtime", "model-routing.js"),
  ]);
  for (const k of Object.keys(require.cache)) {
    if (paths.has(k)) delete require.cache[k];
  }
}

/**
 * @param {{ cerberus: string, decide: string, plan?: string, failCerberusCompactHandoff?: boolean, mcpFail?: (tool: string, prompt: string) => boolean }} script
 * @param {{ calls: string[] }} record
 */
function makeSpawnSync(script, record) {
  return function scriptedSpawnSync(cmd, args, opts) {
    if (cmd !== "claude") return origSpawnSync.call(cp, cmd, args, opts);
    if (args[1] !== "-") {
      const prompt = String(args[1]);
      if (prompt.includes("compact-handoff.compact_handoff")) {
        record.calls.push("compact_handoff");
        if (script.failCerberusCompactHandoff && prompt.includes('mode_completed="CERBERUS"')) {
          return { error: null, status: 1, stdout: "", stderr: "compactor unavailable" };
        }
        const yaml = prompt.includes('mode_completed="ARCHITECT"') ? ARCHITECT_APPROVAL_YAML : DEV_HANDOFF_YAML;
        return { error: null, status: 0, stdout: `${yaml}\n`, stderr: "" };
      }
      const mcp = /orchestrator-state\.(\w+)/.exec(prompt);
      if (mcp) {
        const tool = mcp[1];
        record.calls.push(`mcp:${tool}`);
        if (script.mcpFail && script.mcpFail(tool, prompt)) {
          return { error: null, status: 1, stdout: "", stderr: `simulated ${tool} outage` };
        }
        const body =
          tool === "register_task" ? { ok: true, envelope_path: "/tmp/envelope.json" }
            : tool === "validate_goal_alignment" ? { ok: true, aligned: true, confidence: 1, notes: "" }
              : tool === "validate_transition" ? { allowed: true, errors: [] }
                : { ok: true };
        return { error: null, status: 0, stdout: `${JSON.stringify(body)}\n`, stderr: "" };
      }
      return { error: null, status: 0, stdout: "{}\n", stderr: "" };
    }

    const input = opts && opts.input != null ? String(opts.input) : "";
    const reply = (stdout) => ({ error: null, status: 0, stdout: `${stdout}\n`, stderr: "" });

    if (input.includes("MODE: ORCHESTRATOR") && input.includes("Decompose")) {
      record.calls.push("plan");
      return reply(script.plan || PLAN);
    }
    if (input.includes("Classify each finding")) {
      record.calls.push("cerberus");
      return reply(script.cerberus);
    }
    if (input.includes("Confirm completion or list any remaining corrections")) {
      record.calls.push("decide");
      return reply(script.decide);
    }
    if (input.includes("List the correction steps required")) {
      record.calls.push("correct");
      return reply("{}");
    }
    if (input.includes("Your task:")) {
      record.calls.push("dev");
      return reply(DEV_OK);
    }
    return reply("{}");
  };
}

/**
 * Runs `run()` with the scripted backend and returns result + parsed trace rows.
 * @param {{ cerberus: string, decide: string, plan?: string, failCerberusCompactHandoff?: boolean, mcpFail?: (tool: string, prompt: string) => boolean }} script
 * @param {Record<string, unknown>} [runOptions] overrides for run()
 * @param {Record<string, string>} [envOverrides] env set for the duration of the run
 */
async function runScripted(script, runOptions = {}, envOverrides = {}) {
  const prev = {
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    ORCH_TRACES_DIR: process.env.ORCH_TRACES_DIR,
    ...Object.fromEntries(Object.keys(envOverrides).map((k) => [k, process.env[k]])),
  };
  delete process.env.OLLAMA_MODEL;
  Object.assign(process.env, envOverrides);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-gate-terminal-"));
  const tracesDir = path.join(tmp, "traces");
  fs.mkdirSync(tracesDir, { recursive: true });
  process.env.ORCH_TRACES_DIR = tracesDir;
  const record = { calls: [] };
  const taskId = `task-gate-${Math.random().toString(16).slice(2, 10)}`;
  try {
    clearOrchestratorModuleCaches();
    cp.spawnSync = makeSpawnSync(script, record);
    const { run } = require("../orchestrator");
    const result = await run("gate terminal failure goal", {
      cwd: tmp,
      taskId,
      maxIterations: 3,
      flowMode: "single_agent",
      skipStateMcp: true,
      requireHandoff: false,
      stepSummary: false,
      ...runOptions,
    });
    const tracePath = path.join(tracesDir, `${taskId}.jsonl`);
    const rows = fs.existsSync(tracePath)
      ? fs.readFileSync(tracePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { result, rows, calls: record.calls };
  } finally {
    cp.spawnSync = origSpawnSync;
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    clearOrchestratorModuleCaches();
    try {
      fs.rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

/** The run must not present itself as success in result, final run state, or trace. */
function assertManualReviewStop({ result, rows, calls }, { summaryMatches }) {
  assert.equal(result.done, false, "result.done must be false");
  assert.equal(result.runState.run.status, "aborted", "final run state must be aborted, not done");
  assert.match(result.summary, /manual review/i);
  for (const re of summaryMatches) assert.match(result.summary, re);

  const sessionEnd = rows.find((r) => r.event === "session_end");
  assert.ok(sessionEnd, "session_end must be traced");
  assert.equal(sessionEnd.done, false, "session_end.done must be false");
  assert.equal(sessionEnd.manual_review_recommended, true);

  const iterRows = rows.filter((r) => r.event === "iteration_done");
  assert.equal(iterRows.length, 1, "stop must happen in the first iteration (no new automatic cycle)");
  assert.notEqual(iterRows[0].outcome, "done");
  assert.equal(iterRows.some((r) => r.outcome === "done"), false);
  assert.equal(iterRows[0].transition_reason.type, "CONTRACT_FAIL");
  assert.equal(iterRows[0].transition_reason.reason_code, "CONTRACT_OR_DECIDE_FAILURE");

  assert.equal(calls.filter((c) => c === "dev").length, 1, "DEV must not be retried");
  assert.equal(calls.filter((c) => c === "correct").length, 0, "no correction round");
}

describe("terminal gate failures — through run()", () => {
  it("blocker: (none) does not block: run completes in one iteration", async () => {
    const out = await runScripted({ cerberus: CERB_VACUOUS_BLOCKER, decide: DECIDE_DONE });

    assert.equal(out.result.done, true);
    assert.equal(out.result.iterations, 1);
    assert.deepEqual(out.calls.filter((c) => c !== "compact_handoff"), ["plan", "dev", "cerberus", "decide"]);
    const check = out.rows.find((r) => r.event === "cerberus_check");
    assert.equal(check.blockers, 0);
    const sessionEnd = out.rows.find((r) => r.event === "session_end");
    assert.equal(sessionEnd.done, true);
  });

  it("CERBERUS contract failure stops for manual review and never reaches decide or done", async () => {
    const out = await runScripted({ cerberus: CERB_CONTRACT_FAIL, decide: DECIDE_DONE });

    assertManualReviewStop(out, { summaryMatches: [/CERBERUS/, /contract/i] });
    assert.equal(out.calls.includes("decide"), false, "decide must not run after a CERBERUS failure");
    assert.equal(out.calls.filter((c) => c === "cerberus").length, 1, "CERBERUS must not be retried");
    assert.equal(
      out.rows.some((r) => r.event === "contract_fail" && r.agent === "cerberus"),
      true,
    );
    const blocked = out.result.artifacts.find((a) => a.agentId === "cerberus");
    assert.ok(blocked && blocked.gateBlocked === true, "gate-blocked CERBERUS artifact must stay visible");
  });

  it("decide returning invalid output stops for manual review and never reports done", async () => {
    const out = await runScripted({ cerberus: CERB_CLEAN, decide: "We are all done, nice work." });

    assertManualReviewStop(out, { summaryMatches: [/decide/i] });
    assert.equal(out.calls.filter((c) => c === "decide").length, 1, "decide must not be retried");
  });

  it("decide returning JSON that is neither done nor corrections stops for manual review", async () => {
    const out = await runScripted({ cerberus: CERB_CLEAN, decide: '{"status": "ok"}' });

    assertManualReviewStop(out, { summaryMatches: [/decide/i] });
  });
  it("strict CERBERUS compact_handoff failure + blocker: (none) never reaches decide or done", async () => {
    const out = await runScripted(
      { cerberus: CERB_VACUOUS_BLOCKER, decide: DECIDE_DONE, failCerberusCompactHandoff: true },
      { skipStateMcp: false, requireHandoff: true, maxIterations: 1 },
    );

    assert.equal(out.calls.includes("decide"), false, "decide must not run when a mandatory handoff failed");
    assert.equal(out.result.done, false, "result.done must be false");
    assert.equal(out.result.runState.run.status, "aborted", "final run state must be aborted, not done");
    assert.match(out.result.summary, /manual review/i);
    assert.match(out.result.summary, /cerberus/i);
    const blocked = out.result.artifacts.find((a) => a.agentId === "cerberus" && a.gateBlocked === true);
    assert.ok(blocked, "gate-blocked CERBERUS artifact must stay visible");
    assert.equal(blocked.gate_kind, "compact_handoff");

    const sessionEnd = out.rows.find((r) => r.event === "session_end");
    assert.equal(sessionEnd.done, false, "session_end.done must be false");
    assert.equal(sessionEnd.manual_review_recommended, true);
    const iterRows = out.rows.filter((r) => r.event === "iteration_done");
    assert.equal(iterRows.some((r) => r.outcome === "done"), false);
    assert.equal(iterRows[iterRows.length - 1].outcome, "max_iterations_with_gate_blocks");
    assert.equal(
      out.rows.some((r) => r.event === "compact_handoff_failed" && r.agent === "cerberus"),
      true,
    );
  });
  describe("state-MCP failure without --skip-gates is terminal", () => {
    const strict = { skipStateMcp: false, requireHandoff: false, maxIterations: 3 };
    const agentStarts = (rows, agent) => rows.filter((r) => r.event === "agent_start" && r.agent === agent).length;

    function assertStateMcpStop(out, tool) {
      assert.equal(out.result.done, false, "result.done must be false");
      assert.equal(out.result.runState.run.status, "aborted", "final run state must be aborted, not done");
      assert.match(out.result.summary, /manual review required/i);
      assert.match(out.result.summary, new RegExp(`state-MCP ${tool} failed`));
      const fail = out.rows.find((r) => r.event === "state_mcp_failure");
      assert.ok(fail, "state_mcp_failure must be traced");
      assert.equal(fail.tool, tool);
      const sessionEnd = out.rows.find((r) => r.event === "session_end");
      assert.equal(sessionEnd.done, false);
      assert.equal(sessionEnd.manual_review_recommended, true);
      assert.equal(out.rows.some((r) => r.event === "iteration_done" && r.outcome === "done"), false);
    }

    it("register_task outage: no agent runs, run stops for manual review", async () => {
      const out = await runScripted(
        { cerberus: CERB_CLEAN, decide: DECIDE_DONE, mcpFail: (tool) => tool === "register_task" },
        strict,
      );
      assertStateMcpStop(out, "register_task");
      assert.equal(out.rows.some((r) => r.event === "agent_start"), false, "no agent may run without the state store");
      assert.equal(out.result.artifacts.length, 0);
      assert.equal(out.rows.some((r) => r.event === "degraded_mode"), false, "not a degraded continue");
    });

    it("per-step gate outage (validate_goal_alignment): step blocked, no CERBERUS, no done", async () => {
      const out = await runScripted(
        {
          cerberus: CERB_CLEAN,
          decide: DECIDE_DONE,
          plan: PLAN_WITH_ARCHITECT,
          mcpFail: (tool, prompt) => tool === "validate_goal_alignment" && prompt.includes("files_modified"),
        },
        strict,
      );
      assertStateMcpStop(out, "validate_goal_alignment");
      assert.equal(agentStarts(out.rows, "dev-backend"), 1, "DEV must not be retried");
      assert.equal(out.rows.some((r) => r.event === "cerberus_check"), false, "review must not run on an ungated step");
      const blocked = out.result.artifacts.find((a) => a.gate_kind === "state_mcp");
      assert.ok(blocked && blocked.gateBlocked === true);
    });

    it("CERBERUS transition outage (validate_transition from CERBERUS): no decide, no done", async () => {
      const out = await runScripted(
        {
          cerberus: CERB_CLEAN,
          decide: DECIDE_DONE,
          plan: PLAN_WITH_ARCHITECT,
          mcpFail: (tool, prompt) => tool === "validate_transition" && prompt.includes('from_mode="CERBERUS"'),
        },
        strict,
      );
      assertStateMcpStop(out, "validate_transition");
      assert.equal(out.rows.some((r) => r.event === "cerberus_check"), false);
    });

    it("healthy state-MCP still completes (control)", async () => {
      const out = await runScripted({ cerberus: CERB_CLEAN, decide: DECIDE_DONE, plan: PLAN_WITH_ARCHITECT }, strict);
      assert.equal(out.result.done, true);
      assert.equal(out.rows.some((r) => r.event === "state_mcp_failure"), false);
    });
  });
});
