"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectRunsFromDir } = require("../scenario-metrics-export");

test("collectRunsFromDir picks tagged traces and groups by_scenario", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-scen-export-"));
  try {
    const rowA = [
      { ts: "t0", task_id: "tid-a", event: "session_start", flow_mode: "single_agent", scenario_id: "Sc-A", max_iterations: 1 },
      { ts: "t1", task_id: "tid-a", event: "session_end", iterations: 1, done: true, ollama_prompt_tokens_total: 5, ollama_completion_tokens_total: 2 },
    ].map((o) => JSON.stringify(o)).join("\n");
    fs.writeFileSync(path.join(dir, "tid-a.jsonl"), rowA, "utf8");

    const rowB = [
      { ts: "t0", task_id: "tid-b", event: "session_start", flow_mode: "multi_agent", scenario_id: "Sc-B", max_iterations: 2 },
      { ts: "t1", task_id: "tid-b", event: "session_end", iterations: 1, done: false },
    ].map((o) => JSON.stringify(o)).join("\n");
    fs.writeFileSync(path.join(dir, "tid-b.jsonl"), rowB, "utf8");

    // No scenario_id — skipped by default
    fs.writeFileSync(path.join(dir, "untagged.jsonl"), '{"event":"session_start","task_id":"x","flow_mode":"single_agent"}\n', "utf8");

    const runs = collectRunsFromDir(dir, { includeUntagged: false });
    assert.equal(runs.length, 2);
    const ids = runs.map((r) => r.scenario_id).sort();
    assert.deepEqual(ids, ["Sc-A", "Sc-B"]);

    const inc = collectRunsFromDir(dir, { includeUntagged: true });
    assert.ok(inc.length >= 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
