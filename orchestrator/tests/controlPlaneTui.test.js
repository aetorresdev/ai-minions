"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const path = require("path");
const {
  buildControlPlaneRunText,
  buildControlPlaneBatchText,
  na,
} = require("../control-plane-tui");

/** @param {string} s @param {string} label */
function assertAllCharsAscii(s, label) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    assert.ok(c <= 127, `${label}: non-ASCII at offset ${i} (code ${c})`);
  }
}

test("na formats null and empty as (not available)", () => {
  assert.equal(na(null), "(not available)");
  assert.equal(na(""), "(not available)");
  assert.equal(na("ok"), "ok");
});

const CLEAN_ROWS = fs.readFileSync(
  path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

test("buildControlPlaneRunText: golden clean run shows done=true", () => {
  const out = buildControlPlaneRunText(CLEAN_ROWS, { trace_file: "/tmp/golden.jsonl" });
  assert.match(out, /read-only/i);
  assert.match(out, /task-golden-v1/);
  assert.match(out, /done:\s+true/);
  assert.match(out, /trace_file:\s+\/tmp\/golden\.jsonl/);
  assertAllCharsAscii(out, "golden clean");
});

test("buildControlPlaneRunText: blocked review shows blockers", () => {
  const rows = [
    ...CLEAN_ROWS.slice(0, -1),
    {
      event: "review_record",
      review_schema_version: "1",
      reviewer_role: "cerberus",
      verdict: "block",
      blockers: ["missing tests"],
      non_blocking_notes: [],
      evidence_refs: [],
      reviewed_artifact_ids: [],
      iteration: 1,
    },
    {
      event: "session_end",
      task_id: "task-golden-v1",
      done: false,
      iterations: 1,
      gate_blocks: 1,
    },
  ];
  const out = buildControlPlaneRunText(rows, { trace_file: "fixture" });
  assert.match(out, /blocker:.*missing tests/);
  assert.match(out, /done:\s+false/);
  assertAllCharsAscii(out, "blocked");
});

test("buildControlPlaneRunText: missing session_end uses (not available) not inference", () => {
  const rows = CLEAN_ROWS.filter((r) => r.event !== "session_end");
  const out = buildControlPlaneRunText(rows, { trace_file: "fixture" });
  assert.match(out, /done:\s+\(not available\)/);
});

test("buildControlPlaneBatchText: empty dir yields header", () => {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "cp-tui-"));
  const out = buildControlPlaneBatchText({ tracesDir: tmp, includeUntagged: true });
  assert.match(out, /batch run list/i);
  assert.match(out, /runs: 0/);
});

test("CLI: control-plane-tui.js --file golden fixture exits 0", () => {
  const bin = path.join(__dirname, "..", "control-plane-tui.js");
  const fixture = path.join(__dirname, "fixtures", "golden-path-clean-v1.jsonl");
  const r = spawnSync(process.execPath, [bin, "--file", fixture], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /Control plane/);
  assertAllCharsAscii(r.stdout, "cli stdout");
});
