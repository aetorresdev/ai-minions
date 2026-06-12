"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRunCostAccountingFromReport } = require("../../cost-accounting-dimensions");

const KEYS = [
  "ORCH_USD_PER_MTOK_PROMPT",
  "ORCH_USD_PER_MTOK_COMPLETION",
  "ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT",
  "ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION",
  "ORCH_EQUIV_CLOUD_BASELINE_MODEL",
  "ORCH_EQUIV_CLOUD_BASELINE_PROVIDER",
];

function envSnapshot(keys) {
  const o = {};
  for (const k of keys) {
    o[k] = process.env[k];
  }
  return o;
}

function restoreEnv(o) {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("cost accounting: actual only, equivalent_cloud missing_baseline_mapping", (t) => {
  const snap = envSnapshot(KEYS);
  t.after(() => restoreEnv(snap));
  delete process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT;
  delete process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION;
  process.env.ORCH_USD_PER_MTOK_PROMPT = "0.2";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "0.6";

  const report = {
    session_end: { ollama_prompt_tokens_total: 1_000_000, ollama_completion_tokens_total: 500_000 },
    ollama_from_context_stats: { prompt: 0, completion: 0 },
  };
  const ca = buildRunCostAccountingFromReport(report);
  assert.ok(ca?.cost_accounting?.run);
  const r = ca.cost_accounting.run;
  assert.equal(r.prompt_tokens, 1_000_000);
  assert.equal(r.completion_tokens, 500_000);
  assert.equal(r.actual.total_usd, 0.5);
  assert.equal(r.actual.is_billable, false);
  assert.equal(r.equivalent_cloud.equivalent_cloud_cost_status, "missing_baseline_mapping");
});

test("cost accounting: equiv rates without baseline model → missing_baseline_model", (t) => {
  const snap = envSnapshot(KEYS);
  t.after(() => restoreEnv(snap));
  process.env.ORCH_USD_PER_MTOK_PROMPT = "0.1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "0.2";
  process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT = "3";
  process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION = "15";
  delete process.env.ORCH_EQUIV_CLOUD_BASELINE_MODEL;

  const report = {
    session_end: null,
    ollama_from_context_stats: { prompt: 2_000_000, completion: 1_000_000 },
  };
  const ca = buildRunCostAccountingFromReport(report);
  assert.equal(ca.cost_accounting.run.equivalent_cloud.equivalent_cloud_cost_status, "missing_baseline_model");
});

test("cost accounting: full equivalent_cloud with baseline model", (t) => {
  const snap = envSnapshot(KEYS);
  t.after(() => restoreEnv(snap));
  process.env.ORCH_USD_PER_MTOK_PROMPT = "0.1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "0.2";
  process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT = "1";
  process.env.ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION = "5";
  process.env.ORCH_EQUIV_CLOUD_BASELINE_MODEL = "gpt-4o-mini";
  process.env.ORCH_EQUIV_CLOUD_BASELINE_PROVIDER = "openai";

  const report = {
    session_end: null,
    ollama_from_context_stats: { prompt: 1_000_000, completion: 1_000_000 },
  };
  const ca = buildRunCostAccountingFromReport(report);
  const r = ca.cost_accounting.run;
  assert.equal(r.actual.total_usd, 0.3);
  assert.equal(r.actual.is_billable, false);
  assert.equal(r.equivalent_cloud.total_usd, 6);
  assert.equal(r.equivalent_cloud.baseline_model, "gpt-4o-mini");
  assert.equal(r.equivalent_cloud.baseline_provider, "openai");
  assert.equal(r.equivalent_cloud.is_billable, false);
});

test("cost accounting: zero tokens returns null", (t) => {
  const snap = envSnapshot(KEYS);
  t.after(() => restoreEnv(snap));
  process.env.ORCH_USD_PER_MTOK_PROMPT = "1";
  process.env.ORCH_USD_PER_MTOK_COMPLETION = "1";
  const report = {
    session_end: { ollama_prompt_tokens_total: 0, ollama_completion_tokens_total: 0 },
    ollama_from_context_stats: { prompt: 0, completion: 0 },
  };
  assert.equal(buildRunCostAccountingFromReport(report), null);
});
