"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "recovery-sweep-contract.md");

const V07_FINDING_KINDS = [
  "open_review_blockers",
  "missing_iteration_done",
  "governance_boundary_incomplete",
  "incomplete_handoff",
];

describe("recovery-sweep-contract", () => {
  it("documents v0.7 hardening finding kinds", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /no automatic retry/i);
    for (const kind of V07_FINDING_KINDS) {
      assert.match(doc, new RegExp(`\`${kind}\``));
    }
  });

  it("documents live vs post-hoc recompute semantics", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /live_before_session_end/i);
    assert.match(doc, /recomputes/i);
    assert.match(doc, /historical_sweep/i);
  });
});
