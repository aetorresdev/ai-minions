"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_RUNS_LIMIT,
  formatRunIdArg,
  normalizeRunsLimit,
  runOperatorRuns,
} = require("../../modules/operator/operator-run-list");

function writeTrace(dir, name, rows) {
  fs.writeFileSync(
    path.join(dir, `${name}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n"),
    "utf8",
  );
}

describe("operator-run-list", () => {
  it("lists valid runs newest-first and keeps invalid traces visible", () => {
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-runs-"));
    writeTrace(tracesDir, "older", [
      { event: "session_start", task_id: "older", flow_mode: "single_agent", ts_ms: 100 },
      { event: "session_end", task_id: "older", done: true, gate_blocks: 0, ts_ms: 200 },
    ]);
    writeTrace(tracesDir, "newer", [
      { event: "session_start", task_id: "newer", flow_mode: "single_agent", ts_ms: 300 },
    ]);
    fs.writeFileSync(path.join(tracesDir, "invalid.jsonl"), "\n", "utf8");

    const result = runOperatorRuns({ tracesDir, limit: 20, json: true });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.result_code, "RUNS_FOUND");
    assert.equal(result.json.run_count, 3);
    assert.deepEqual(
      result.json.runs.map((run) => run.run_id),
      ["newer", "older", "invalid"],
    );
    assert.equal(result.json.runs[0].result_code, "RUN_STATE_UNKNOWN");
    assert.equal(result.json.runs[1].result_code, "RUN_FOUND");
    assert.equal(result.json.runs[2].result_code, "RUN_TRACE_INVALID");
    assert.equal(result.json.runs[2].last_event_at, null);
    assert.equal(
      result.json.runs[0].select_command,
      "ai-minions status --run-id newer",
    );
  });

  it("returns RUNS_EMPTY with exit 0 when no traces exist", () => {
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-runs-empty-"));
    const result = runOperatorRuns({ tracesDir });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.result_code, "RUNS_EMPTY");
    assert.equal(result.json.run_count, 0);
    assert.match(result.next_safe_action, /ai-minions start/);
    assert.match(result.text, /RUNS_EMPTY/);
  });

  it("applies a deterministic limit after sorting", () => {
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minions-runs-limit-"));
    writeTrace(tracesDir, "first", [
      { event: "session_start", task_id: "first", ts_ms: 1 },
    ]);
    writeTrace(tracesDir, "second", [
      { event: "session_start", task_id: "second", ts_ms: 2 },
    ]);

    const result = runOperatorRuns({ tracesDir, limit: 1 });

    assert.equal(result.json.returned_count, 1);
    assert.equal(result.json.runs[0].run_id, "second");
  });

  it("normalizes limits and rejects invalid values", () => {
    assert.equal(normalizeRunsLimit(undefined), DEFAULT_RUNS_LIMIT);
    assert.equal(normalizeRunsLimit("5"), 5);
    assert.equal(normalizeRunsLimit("0"), null);
    assert.equal(normalizeRunsLimit("not-a-number"), null);
  });

  it("quotes unsafe run ids used in copyable commands", () => {
    assert.equal(formatRunIdArg("task-safe_1"), "task-safe_1");
    assert.equal(
      formatRunIdArg("task $(unsafe)"),
      "'task $(unsafe)'",
    );
  });
});
