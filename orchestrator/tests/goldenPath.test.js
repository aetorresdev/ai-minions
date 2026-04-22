"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine, validateTraceRunGraph } = require("../trace-schema");
const { deriveExplain } = require("../explain-run");

/** Expected event spine for golden-path baseline (single iteration, clean path). */
const GOLDEN_PATH_EVENT_SPINE = [
  "session_start",
  "agent_start",
  "agent_done",
  "iteration_done",
  "session_end",
];

test("golden path fixture — schema-valid lines + event spine + graph", () => {
  const fixturePath = path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl");
  const raw = fs.readFileSync(fixturePath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((ln) => JSON.parse(ln));
  assert.deepEqual(
    rows.map((r) => r.event),
    GOLDEN_PATH_EVENT_SPINE,
  );
  for (const row of rows) {
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  }
  const graphRows = rows.filter((r) => r.step_id != null || r.parent_step_id != null);
  const g = validateTraceRunGraph(graphRows);
  assert.equal(g.ok, true, JSON.stringify(g.violations));
});

/**
 * @param {object[]} rows
 * @param {{ bounds: Record<string, unknown> }} meta
 */
function assertGoldenMetaBounds(rows, meta) {
  const b = meta.bounds;
  const sessionStart = rows.find((r) => r.event === "session_start");
  const sessionEnd = rows.find((r) => r.event === "session_end");
  assert.ok(sessionStart && sessionEnd, "fixture must include session_start and session_end");
  assert.equal(typeof sessionStart.ts_ms, "number");
  assert.equal(typeof sessionEnd.ts_ms, "number");
  const wall = sessionEnd.ts_ms - sessionStart.ts_ms;
  const span = /** @type {{ min: number, max: number }} */ (b.wall_span_ts_ms);
  assert.ok(wall >= span.min && wall <= span.max, `wall_span_ts_ms ${wall} not in [${span.min}, ${span.max}]`);

  let agentDoneMs = 0;
  for (const r of rows) {
    if (r.event === "agent_done" && typeof r.duration_ms === "number") agentDoneMs += r.duration_ms;
  }
  const dur = /** @type {{ min: number, max: number }} */ (b.agent_done_duration_ms_total);
  assert.ok(
    agentDoneMs >= dur.min && agentDoneMs <= dur.max,
    `agent_done duration sum ${agentDoneMs} not in [${dur.min}, ${dur.max}]`,
  );

  const costSpec = /** @type {{ expect_absent?: boolean, min?: number, max?: number }} */ (b.cost_usd_explain_sum);
  const explain = deriveExplain(rows);
  if (costSpec.expect_absent) {
    assert.equal(explain.cost_usd, undefined, "expected no cost_usd in trace for explain sum");
  } else {
    assert.equal(typeof costSpec.min, "number");
    assert.equal(typeof costSpec.max, "number");
    assert.ok(
      typeof explain.cost_usd === "number",
      "expected deriveExplain.cost_usd when meta bounds omit expect_absent",
    );
    assert.ok(
      explain.cost_usd >= costSpec.min && explain.cost_usd <= costSpec.max,
      `explain cost_usd ${explain.cost_usd} not in [${costSpec.min}, ${costSpec.max}]`,
    );
  }
}

test("golden path fixture — meta bounds (wall time, agent duration, cost)", () => {
  const fixtureDir = path.join(__dirname, "fixtures");
  const fixturePath = path.join(fixtureDir, "golden-path-clean-v1.jsonl");
  const metaPath = path.join(fixtureDir, "golden-path-clean-v1.meta.json");
  const raw = fs.readFileSync(fixturePath, "utf8");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((ln) => JSON.parse(ln));

  if (process.env.UPDATE_GOLDEN_META === "1") {
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

  assertGoldenMetaBounds(rows, meta);
});
