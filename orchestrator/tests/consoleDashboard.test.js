"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildDashboardText, buildBatchDashboardText, linesCountTable, sortedEntries } = require("../console-dashboard");

/** @param {string} s */
function assertAllCharsAscii(s, label) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    assert.ok(c <= 127, `${label}: non-ASCII at offset ${i} (code ${c})`);
  }
}

test("sortedEntries orders by count descending", () => {
  const s = sortedEntries({ a: 1, b: 3, c: 2 });
  assert.deepEqual(s, [["b", 3], ["c", 2], ["a", 1]]);
});

test("linesCountTable includes bars and keys", () => {
  const lines = linesCountTable("demo", { x: 2, y: 1 }, 10, 10);
  const joined = lines.join("\n");
  assert.match(joined, /demo/);
  assert.match(joined, /x/);
  assert.match(joined, /#####/);
  assertAllCharsAscii(joined, "linesCountTable");
});

test("buildDashboardText includes taxonomy and rollup header", () => {
  const rows = [
    {
      event: "session_start",
      task_id: "t1",
      flow_mode: "single_agent",
      max_iterations: 2,
      scenario_id: "S1",
    },
    {
      event: "iteration_done",
      task_id: "t1",
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "CERBERUS_BLOCKERS_ITERATE" },
      failure_type: "contract_mismatch",
      failure_axis: "cerberus",
    },
    {
      event: "context_stats",
      task_id: "t1",
      step_id: "t1-i0-dev-backend",
      agent: "dev-backend",
      iteration: 0,
      ollama_prompt_tokens: 100,
      ollama_completion_tokens: 50,
    },
    {
      event: "agent_done",
      task_id: "t1",
      step_id: "t1-i0-dev-backend",
      agent: "dev-backend",
      edge_type: "success",
    },
    { event: "session_end", task_id: "t1", done: false, iterations: 1, gate_blocks: 0 },
  ];
  const out = buildDashboardText(rows, { source: "fixture" });
  assert.match(out, /CERBERUS_BLOCKERS_ITERATE/);
  assert.match(out, /cerberus/);
  assert.match(out, /t1-i0-dev-backend/);
  assert.match(out, /rollupStepsCostOutcome/);
  assertAllCharsAscii(out, "buildDashboardText");
});

test("buildDashboardText stays ASCII-only with long step_id (ellipsis path)", () => {
  const longId = `x-${"a".repeat(60)}-x`;
  const rows = [
    { event: "session_start", task_id: "t2", flow_mode: "single_agent", max_iterations: 1 },
    {
      event: "context_stats",
      task_id: "t2",
      step_id: longId,
      agent: "dev-backend",
      iteration: 0,
      ollama_prompt_tokens: 1,
      ollama_completion_tokens: 0,
    },
    { event: "agent_done", task_id: "t2", step_id: longId, agent: "dev-backend", edge_type: "success" },
    { event: "session_end", task_id: "t2", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const out = buildDashboardText(rows, { source: "long-step" });
  assertAllCharsAscii(out, "buildDashboardText long step_id");
  assert.match(out, /\.\.\./);
});

test("buildBatchDashboardText is ASCII-only for empty traces dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-dash-ascii-"));
  try {
    const out = buildBatchDashboardText({
      tracesDir: dir,
      sinceMs: null,
      includeUntagged: true,
      validateTrace: false,
    });
    assertAllCharsAscii(out, "buildBatchDashboardText");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Integration: same entrypoint as `npm run dashboard:console -- --file <path>`,
 * reading a versioned fixture (not ~/.claude/metrics/traces). Unit tests above
 * do not replace a manual check against a real trace after a local run.
 */
test("CLI: node console-dashboard.js --file golden fixture exits 0, ASCII stdout", () => {
  const bin = path.join(__dirname, "..", "console-dashboard.js");
  const fixture = path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl");
  const r = spawnSync(process.execPath, [bin, "--file", fixture], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || "non-zero exit");
  assertAllCharsAscii(r.stdout, "CLI dashboard stdout");
  assert.match(r.stdout, /Orchestrator console dashboard/);
  assert.match(r.stdout, /RUN_COMPLETED/);
});
