"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  VALUE_VERDICTS,
  validateValueReviewTraceLine,
  validateValueReviewFixtureRows,
} = require("../bv-reviewer-design");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "value-review-trace.v1.jsonl");

/**
 * @param {string} text
 * @returns {object[]}
 */
function parseJsonl(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** @param {Partial<object>} overrides */
function minimalValidRow(overrides = {}) {
  return {
    ts: "2026-06-05T22:00:00.000Z",
    ts_ms: 1749160800000,
    trace_schema_version: "2",
    event: "value_review",
    value_review_schema_version: "1",
    task_id: "t",
    subject_type: "backlog_ticket",
    subject_id: "x",
    value_verdict: "defer",
    rationale: "ok",
    evidence_refs: [],
    outcome_verifiable: true,
    maturity_fit: "alpha_harness",
    ...overrides,
  };
}

describe("bv-reviewer-contract", () => {
  it("fixture JSONL validates three verdict examples", () => {
    const rows = parseJsonl(fs.readFileSync(FIXTURE_PATH, "utf8"));
    assert.equal(rows.length, 3);
    const v = validateValueReviewFixtureRows(rows);
    assert.equal(v.ok, true, v.errors?.join(" | "));
    const verdicts = rows.map((r) => r.value_verdict);
    assert.deepEqual(verdicts.sort(), ["defer", "proceed", "reject"].sort());
  });

  it("requires trace envelope fields and maturity_fit", () => {
    const v = validateValueReviewTraceLine({
      event: "value_review",
      value_review_schema_version: "1",
      task_id: "t",
      subject_type: "backlog_ticket",
      subject_id: "x",
      value_verdict: "defer",
      rationale: "ok",
      evidence_refs: [],
      outcome_verifiable: true,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /trace_schema_version/i.test(e)));
    assert.ok(v.errors.some((e) => /ts/i.test(e)));
    assert.ok(v.errors.some((e) => /maturity_fit/i.test(e)));
  });

  it("proceed requires outcome_verifiable true", () => {
    const v = validateValueReviewTraceLine(minimalValidRow({
      value_verdict: "proceed",
      outcome_verifiable: false,
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /proceed requires outcome_verifiable/i.test(e)));
  });

  it("reject on P1 requires human confirmation", () => {
    const v = validateValueReviewTraceLine(minimalValidRow({
      value_verdict: "reject",
      priority_band: "P1",
      outcome_verifiable: false,
      requires_human_confirmation: false,
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /requires_human_confirmation/i.test(e)));
  });

  it("rejects top-level forbidden content keys", () => {
    const v = validateValueReviewTraceLine(minimalValidRow({ prompt: "user asked to ship OTLP" }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /forbidden content key: prompt/i.test(e)));
  });

  it("rejects nested forbidden content keys", () => {
    const v = validateValueReviewTraceLine(minimalValidRow({
      heuristic_scores: { impact: "low", notes: { raw_response: "full model output" } },
    }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /forbidden content key: heuristic_scores\.notes\.raw_response/i.test(e)));
  });

  it("VALUE_VERDICTS enum is stable", () => {
    assert.deepEqual([...VALUE_VERDICTS], ["proceed", "defer", "reject"]);
  });
});
