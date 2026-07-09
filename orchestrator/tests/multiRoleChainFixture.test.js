"use strict";

/**
 * Capability-flow §7 style multi-role trace (synthetic): dev-backend → qa → cerberus in one iteration.
 */

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine, validateTraceRunGraph } = require("../modules/trace/trace-schema");
const { deriveExplain } = require("../modules/operator/explain-run");

const FIXTURE = path.join(__dirname, "fixtures", "golden-multi-role-chain-v1.jsonl");
const META = path.join(__dirname, "fixtures", "golden-multi-role-chain-v1.meta.json");

function assertMetaBounds(rows, meta) {
  const b = meta.bounds;
  const sessionStart = rows.find((r) => r.event === "session_start");
  const sessionEnd = rows.find((r) => r.event === "session_end");
  assert.ok(sessionStart && sessionEnd);
  const wall = sessionEnd.ts_ms - sessionStart.ts_ms;
  const span = /** @type {{ min: number, max: number }} */ (b.wall_span_ts_ms);
  assert.ok(wall >= span.min && wall <= span.max, `wall_span_ts_ms ${wall} not in [${span.min}, ${span.max}]`);
  let agentDoneMs = 0;
  for (const r of rows) {
    if (r.event === "agent_done" && typeof r.duration_ms === "number") agentDoneMs += r.duration_ms;
  }
  const dur = /** @type {{ min: number, max: number }} */ (b.agent_done_duration_ms_total);
  assert.ok(agentDoneMs >= dur.min && agentDoneMs <= dur.max);
  const costSpec = b.cost_usd_explain_sum;
  const explain = deriveExplain(rows);
  if (costSpec && costSpec.expect_absent) {
    assert.equal(explain.cost_usd, undefined);
  }
}

test("golden multi-role chain fixture — schema, graph, agents order", () => {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines.length, 9);
  const rows = lines.map((ln) => JSON.parse(ln));
  const sessionStart = rows.find((r) => r.event === "session_start");
  assert.equal(sessionStart?.flow_mode, "multi_agent");
  for (const row of rows) {
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  }
  const graphRows = rows.filter((r) => r.step_id != null || r.parent_step_id != null);
  const g = validateTraceRunGraph(graphRows);
  assert.equal(g.ok, true, JSON.stringify(g.violations));
  assert.equal(g.warnings.length, 0, JSON.stringify(g.warnings));
  const agentsFromStarts = rows.filter((r) => r.event === "agent_start").map((r) => r.agent);
  assert.deepEqual(agentsFromStarts, ["dev-backend", "qa", "cerberus"]);
  const sessionEnd = rows.find((r) => r.event === "session_end");
  assert.deepEqual(sessionEnd?.agents_run, ["dev-backend", "qa", "cerberus"]);
});

test("golden multi-role chain fixture — meta bounds", () => {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const meta = JSON.parse(fs.readFileSync(META, "utf8"));
  const rows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((ln) => JSON.parse(ln));
  if (process.env.UPDATE_GOLDEN_MULTI_META === "1") {
    const sessionStart = rows.find((r) => r.event === "session_start");
    const sessionEnd = rows.find((r) => r.event === "session_end");
    let agentDoneMs = 0;
    for (const r of rows) {
      if (r.event === "agent_done" && typeof r.duration_ms === "number") agentDoneMs += r.duration_ms;
    }
    const wall = sessionEnd.ts_ms - sessionStart.ts_ms;
    const explain = deriveExplain(rows);
    console.log(JSON.stringify({
      wall_span_ts_ms: wall,
      agent_done_duration_ms_total: agentDoneMs,
      cost_usd_explain: explain.cost_usd ?? null,
    }, null, 2));
    return;
  }
  assertMetaBounds(rows, meta);
});
