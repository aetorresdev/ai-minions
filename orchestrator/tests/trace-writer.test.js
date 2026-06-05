"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const {
  resolveTracesDir,
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

  it("resolveTracesDir reads ORCH_TRACES_DIR at call time (intentional, not module-load drift)", () => {
    const prev = process.env.ORCH_TRACES_DIR;
    const dirA = path.join(os.tmpdir(), "orch-traces-lazy-a");
    const dirB = path.join(os.tmpdir(), "orch-traces-lazy-b");
    try {
      process.env.ORCH_TRACES_DIR = dirA;
      assert.equal(resolveTracesDir(), path.resolve(dirA));
      process.env.ORCH_TRACES_DIR = dirB;
      assert.equal(resolveTracesDir(), path.resolve(dirB));
    } finally {
      if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
      else process.env.ORCH_TRACES_DIR = prev;
    }
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
