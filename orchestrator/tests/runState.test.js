"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRunState,
  syncRunIteration,
  setStepRunning,
  setStepCompleted,
  setStepFailedAndClear,
  markStepRetryingAfterGate,
  getRunStatePublicView,
} = require("../run-state");

test("syncRunIteration sets current_iteration and clears step", () => {
  const rs = createRunState({ taskId: "t1", flowMode: "single_agent", goal: "g", maxIterations: 3 });
  setStepRunning(rs, "s1", "dev-backend");
  assert.ok(rs.step);
  syncRunIteration(rs, 2);
  assert.equal(rs.run.current_iteration, 2);
  assert.equal(rs.step, null);
});

test("markStepRetryingAfterGate after agent_done path marks retrying", () => {
  const rs = createRunState({ taskId: "t1", flowMode: "single_agent", goal: "g", maxIterations: 3 });
  syncRunIteration(rs, 1);
  setStepRunning(rs, "t1-i1-dev-backend", "dev-backend");
  setStepCompleted(rs);
  assert.equal(rs.step.status, "done");
  markStepRetryingAfterGate(rs);
  assert.equal(rs.step.status, "retrying");
  assert.equal(rs.step.intent.status, "active");
  const pub = getRunStatePublicView(rs);
  assert.equal(pub.step && pub.step.status, "retrying");
});

test("setStepFailedAndClear leaves no step (contract_fail before agent_done)", () => {
  const rs = createRunState({ taskId: "t1", flowMode: "single_agent", goal: "g", maxIterations: 1 });
  setStepRunning(rs, "s1", "dev-backend");
  setStepFailedAndClear(rs);
  assert.equal(rs.step, null);
  markStepRetryingAfterGate(rs);
  assert.equal(rs.step, null);
});
