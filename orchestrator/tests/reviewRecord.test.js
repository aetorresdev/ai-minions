"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTraceLine } = require("../trace-schema");
const {
  buildReviewRecord,
  traceReviewRecord,
  summarizeReviewRecordsFromRows,
} = require("../review-record");
const { buildRunOutcomeSummary } = require("../run-outcome-summary");

test("buildReviewRecord: approve when triple is all vacuous", () => {
  const r = buildReviewRecord({
    reviewerRole: "cerberus",
    output: "blocker: none\nimprovement: none\nnice-to-have: none",
    iteration: 1,
  });
  assert.equal(r.verdict, "approve");
  assert.deepEqual(r.blockers, []);
});

test("buildReviewRecord: request_changes when improvement is substantive", () => {
  const r = buildReviewRecord({
    reviewerRole: "qa",
    output: "blocker: none\nimprovement: add test in orchestrator/review-record.test.js\nnice-to-have: none",
    iteration: 1,
    stepId: "s-qa",
  });
  assert.equal(r.verdict, "request_changes");
  assert.ok(r.non_blocking_notes.some((n) => n.includes("improvement:")));
});

test("buildReviewRecord: block when blocker is substantive", () => {
  const r = buildReviewRecord({
    reviewerRole: "cerberus",
    output: "blocker: missing schema validation in orchestrator/foo.js\nimprovement: none\nnice-to-have: none",
    iteration: 2,
  });
  assert.equal(r.verdict, "block");
  assert.equal(r.blockers.length, 1);
});

test("traceReviewRecord validates and summarizeReviewRecordsFromRows consumes", () => {
  /** @type {object[]} */
  const lines = [];
  /** @param {string} _id @param {Record<string, unknown>} ev */
  function traceEvent(_id, ev) {
    const row = {
      ...ev,
      ts: new Date(1).toISOString(),
      ts_ms: 1,
      trace_schema_version: "2",
      task_id: "t-review",
    };
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
    lines.push(row);
  }
  traceReviewRecord(
    traceEvent,
    "t-review",
    buildReviewRecord({
      reviewerRole: "cerberus",
      output: "blocker: none\nimprovement: document gap\nnice-to-have: none",
      iteration: 1,
    }),
  );
  const summary = summarizeReviewRecordsFromRows(lines);
  assert.equal(summary.cerberus_verdict, "request_changes");
  assert.equal(summary.records.length, 1);
});

test("review_record without verdict fails schema validation", () => {
  const v = validateTraceLine({
    ts: new Date(1).toISOString(),
    ts_ms: 1,
    trace_schema_version: "2",
    task_id: "t",
    event: "review_record",
    review_schema_version: "1",
    reviewer_role: "qa",
    blockers: [],
    non_blocking_notes: [],
    evidence_refs: [],
    reviewed_artifact_ids: [],
    iteration: 0,
  });
  assert.equal(v.ok, false);
});

test("buildRunOutcomeSummary includes review block from trace rows", () => {
  const rows = [
    { event: "session_start", task_id: "t1", flow_mode: "single_agent" },
    {
      event: "review_record",
      task_id: "t1",
      review_schema_version: "1",
      reviewer_role: "cerberus",
      verdict: "block",
      blockers: ["schema gap in orchestrator/foo.js"],
      non_blocking_notes: [],
      evidence_refs: ["orchestrator/foo.js"],
      reviewed_artifact_ids: ["s-dev"],
      iteration: 1,
    },
    { event: "session_end", task_id: "t1", done: false, iterations: 1, gate_blocks: 1 },
  ];
  const s = buildRunOutcomeSummary(rows);
  assert.equal(s.review.final_verdict, "block");
  assert.equal(s.review.records.length, 1);
  const text = require("../run-outcome-summary").formatRunOutcomeSummaryLines(s).join("\n");
  assert.match(text, /review: final=block/);
  assert.match(text, /schema gap/);
});
