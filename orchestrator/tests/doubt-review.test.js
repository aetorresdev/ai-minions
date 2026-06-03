"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { validateTraceLine } = require("../trace-schema");
const {
  claimRequiresDoubtReview,
  buildDoubtReviewCycleFromCerberusOutput,
  buildDoubtReviewStartedPayload,
  traceDoubtReviewCycle,
} = require("../doubt-review");

function traceEnvelope(overrides) {
  return {
    ts: "2026-06-04T12:00:00.000Z",
    ts_ms: 1749038400000,
    trace_schema_version: "2",
    task_id: "task-doubt-1",
    ...overrides,
  };
}

test("claimRequiresDoubtReview matrix", () => {
  assert.equal(claimRequiresDoubtReview("lint_only"), false);
  assert.equal(claimRequiresDoubtReview("runtime_contract"), true);
  assert.equal(claimRequiresDoubtReview("release_claim"), true);
});

test("buildDoubtReviewCycleFromCerberusOutput emits block verdict on blocker", () => {
  const output = `blocker: contract regression in orchestrator.js
improvement: (none)
nice-to-have: (none)`;
  const cycle = buildDoubtReviewCycleFromCerberusOutput(output, { iteration: 2 });
  assert.equal(cycle.verdict.verdict, "block");
  assert.ok(cycle.findings.length >= 1);
  assert.equal(cycle.findings[0].finding_kind, "blocker");
});

test("fixture JSONL lines validate against trace schema v2", () => {
  const fixturePath = path.join(__dirname, "fixtures", "doubt-review-cycle.jsonl");
  const lines = fs.readFileSync(fixturePath, "utf8").trim().split("\n");
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    const row = JSON.parse(line);
    const v = validateTraceLine(traceEnvelope(row));
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  }
});

test("traceDoubtReviewCycle invokes traceEvent for started, findings, verdict", () => {
  const cycle = buildDoubtReviewCycleFromCerberusOutput(
    "blocker: (none)\nimprovement: docs drift\nnice-to-have: (none)",
    { iteration: 0 },
  );
  /** @type {string[]} */
  const events = [];
  traceDoubtReviewCycle((_taskId, ev) => events.push(String(ev.event)), "t1", cycle);
  assert.ok(events.includes("doubt_review_started"));
  assert.ok(events.includes("doubt_review_verdict"));
  assert.ok(events.some((e) => e === "doubt_review_finding"));
});

test("buildDoubtReviewStartedPayload requires review_id", () => {
  assert.throws(() => buildDoubtReviewStartedPayload({ review_id: "short" }));
});
