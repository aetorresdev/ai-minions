"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildDashboardText,
  buildBatchDashboardText,
  linesCountTable,
  sortedEntries,
  resolveConsoleColorMode,
  shouldUseAnsiForStdout,
} = require("../../console-dashboard");

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

test("buildDashboardText does not echo raw api-token-shaped step_id in rollup", () => {
  const sk = "sk-" + "g".repeat(25);
  const rows = [
    { event: "session_start", task_id: "t-red", flow_mode: "single_agent", max_iterations: 1, scenario_id: "S-red" },
    {
      event: "context_stats",
      task_id: "t-red",
      step_id: `step-${sk}-tail`,
      agent: "dev-backend",
      iteration: 0,
      ollama_prompt_tokens: 5,
      ollama_completion_tokens: 2,
    },
    { event: "session_end", task_id: "t-red", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const out = buildDashboardText(rows, { source: "fixture" });
  assert.ok(!out.includes(sk));
  assert.match(out, /\[REDACTED:api_token\]/);
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

test("buildDashboardText includes mixed iteration_done rows without throwing", () => {
  const rows = [
    { event: "session_start", task_id: "mix", flow_mode: "single_agent", max_iterations: 4, scenario_id: "S-mix" },
    {
      event: "iteration_done",
      task_id: "mix",
      iteration: 0,
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "CERBERUS_BLOCKERS_ITERATE" },
      failure_type: "contract_mismatch",
      failure_axis: "cerberus",
    },
    {
      event: "iteration_done",
      task_id: "mix",
      iteration: 1,
      outcome: "gate_blocked_iterate",
      transition_reason: { type: "ITERATE", reason_code: "GATE_ARTIFACT_OR_HANDOFF" },
      failure_type: "tool_error",
      failure_axis: "gate_tool",
    },
    {
      event: "iteration_done",
      task_id: "mix",
      iteration: 2,
      outcome: "stopped",
    },
    {
      event: "iteration_done",
      task_id: "mix",
      iteration: 3,
      outcome: "iterate",
      transition_reason: { type: "ITERATE", reason_code: "FUTURE_REASON_NOT_IN_SCHEMA" },
      failure_type: "hypothetical_ft",
      failure_axis: "hypothetical_axis",
    },
    { event: "session_end", task_id: "mix", done: false, iterations: 4, gate_blocks: 1 },
  ];
  const out = buildDashboardText(rows, { source: "mix-taxonomy" });
  assertAllCharsAscii(out, "buildDashboardText mixed taxonomy");
  assert.match(out, /CERBERUS_BLOCKERS_ITERATE/);
  assert.match(out, /GATE_ARTIFACT_OR_HANDOFF/);
  assert.match(out, /tool_error/);
  assert.match(out, /\(missing_reason_code\)/);
  assert.match(out, /FUTURE_REASON_NOT_IN_SCHEMA/);
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
  const bin = path.join(__dirname, "..", "..", "console-dashboard.js");
  const fixture = path.join(__dirname, "..", "fixtures", "golden-path-clean-v1.jsonl");
  const r = spawnSync(process.execPath, [bin, "--file", fixture], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || "non-zero exit");
  assertAllCharsAscii(r.stdout, "CLI dashboard stdout");
  assert.match(r.stdout, /Orchestrator console dashboard/);
  assert.match(r.stdout, /RUN_COMPLETED/);
});

test("resolveConsoleColorMode: NO_COLOR wins over --color=always", () => {
  assert.equal(resolveConsoleColorMode(["--color=always"], { NO_COLOR: "1" }), "never");
});

test("shouldUseAnsiForStdout: auto off when not TTY", () => {
  assert.equal(shouldUseAnsiForStdout("auto", false), false);
  assert.equal(shouldUseAnsiForStdout("always", false), true);
});

test("buildDashboardText useColor adds ANSI only to semantic tokens", () => {
  const rows = [
    { event: "session_start", task_id: "c1", flow_mode: "single_agent", scenario_id: "S", max_iterations: 1 },
    { event: "session_end", task_id: "c1", done: true, iterations: 1, gate_blocks: 0 },
  ];
  const plain = buildDashboardText(rows, { source: "t" }, { useColor: false });
  assertAllCharsAscii(plain, "plain dashboard");
  const color = buildDashboardText(rows, { source: "t" }, { useColor: true });
  assert.ok(color.includes("\x1b["), "expected ANSI CSI in colored dashboard");
});

test("CLI: --color=always includes escape codes (non-ASCII allowed)", () => {
  const bin = path.join(__dirname, "..", "..", "console-dashboard.js");
  const fixture = path.join(__dirname, "..", "fixtures", "golden-path-clean-v1.jsonl");
  const env = { ...process.env };
  delete env.NO_COLOR;
  const r = spawnSync(process.execPath, [bin, "--file", fixture, "--color=always"], {
    encoding: "utf8",
    env,
  });
  assert.equal(r.status, 0, r.stderr || "non-zero exit");
  assert.ok(r.stdout.includes("\x1b["), "expected ANSI in stdout");
});
