"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine } = require("../trace-schema");

/** Expected event spine for golden-path baseline (single iteration, clean path). */
const GOLDEN_PATH_EVENT_SPINE = [
  "session_start",
  "agent_start",
  "agent_done",
  "iteration_done",
  "session_end",
];

test("golden path fixture — schema-valid lines + event spine", () => {
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
  // Note: validateTraceRunGraph flags duplicate step_id across agent_start + agent_done
  // (same id is intentional in the writer). Graph hardening is tracked separately.
});
