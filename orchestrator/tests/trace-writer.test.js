"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  transitionReason,
  composeIterationDonePayload,
  _sanitize,
  _hashGoal,
} = require("../trace-writer");
const { validateTraceLine } = require("../trace-schema");

describe("trace-writer — characterization", () => {
  it("transitionReason + composeIterationDonePayload produce schema-valid iteration_done", () => {
    const tr = transitionReason("DONE");
    const payload = composeIterationDonePayload(1, "done", tr);
    const row = {
      ts: "2026-04-28T12:00:00.000Z",
      ts_ms: 1714305600000,
      trace_schema_version: "2",
      task_id: "tw-char",
      ...payload,
    };
    const v = validateTraceLine(row);
    assert.equal(v.ok, true, (v.errors || []).join(" | "));
  });

  it("orchestrator re-exports trace writer surface", () => {
    const orch = require("../orchestrator");
    const tw = require("../trace-writer");
    assert.equal(orch._sanitize, tw._sanitize);
    assert.equal(orch._hashGoal, tw._hashGoal);
    assert.equal(orch.composeIterationDonePayload, tw.composeIterationDonePayload);
    assert.equal(orch.transitionReason, tw.transitionReason);
  });
});
