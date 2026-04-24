"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectRunsFromDir, buildByStage, buildUsdExportMeta } = require("../scenario-metrics-export");

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

test("buildByStage aggregates by_role and by_phase from by_agent_phase", () => {
  const runs = [
    {
      by_agent_phase: {
        "orchestrator | plan": { prompt: 10, completion: 2, n: 1 },
        "dev-backend | worker": { prompt: 100, completion: 50, n: 1 },
      },
    },
    {
      by_agent_phase: {
        "orchestrator | plan": { prompt: 5, completion: 1, n: 1 },
        "qa | worker": { prompt: 20, completion: 10, n: 1 },
      },
    },
  ];
  const st = buildByStage(runs);
  assert.equal(st.by_role.orchestrator.ollama_prompt_tokens, 15);
  assert.equal(st.by_role["dev-backend"].ollama_prompt_tokens, 100);
  assert.equal(st.by_role.qa.ollama_completion_tokens, 10);
  assert.equal(st.by_phase.plan.ollama_prompt_tokens, 15);
  assert.equal(st.by_phase.worker.ollama_prompt_tokens, 120);
});

test("collectRunsFromDir attaches ollama_usd_estimate when USD env is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-scen-usd-"));
  process.env.ORCH_USD_PER_MTOK_PROMPT = "0.5";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "1.5";
  try {
    const row = [
      { ts: "t0", task_id: "tid-u", event: "session_start", flow_mode: "single_agent", scenario_id: "Sc-USD", max_iterations: 1 },
      { ts: "t1", task_id: "tid-u", event: "session_end", iterations: 1, done: true, ollama_prompt_tokens_total: 2e6, ollama_completion_tokens_total: 2e6 },
    ].map((o) => JSON.stringify(o)).join("\n");
    fs.writeFileSync(path.join(dir, "tid-u.jsonl"), row, "utf8");
    const runs = collectRunsFromDir(dir, { includeUntagged: false });
    assert.equal(runs.length, 1);
    assert.ok(runs[0].ollama_usd_estimate);
    assert.equal(runs[0].ollama_usd_estimate.usd_note, "estimated");
  } finally {
    delete process.env.ORCH_USD_PER_MTOK_PROMPT;
    delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildUsdExportMeta reflects env presence", () => {
  delete process.env.ORCH_USD_PER_MTOK_PROMPT;
  delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
  let m = buildUsdExportMeta();
  assert.equal(m.usd_rates_configured, false);
  process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "2";
  try {
    m = buildUsdExportMeta();
    assert.equal(m.usd_rates_configured, true);
  } finally {
    delete process.env.ORCH_USD_PER_MTOK_PROMPT;
    delete process.env.ORCH_USD_PER_MTOK_COMPLETION;
  }
});
