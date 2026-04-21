"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { decideFromOrchestratorDecide } = require("../decision-engine");

test("decideFromOrchestratorDecide — finish when done true", () => {
  const d = decideFromOrchestratorDecide({ done: true, summary: "Shipped." });
  assert.equal(d.action, "finish");
  assert.equal(d.params.summary, "Shipped.");
});

test("decideFromOrchestratorDecide — iterate when corrections non-empty", () => {
  const corrections = [{ agentId: "dev-backend", task: "fix lint" }];
  const d = decideFromOrchestratorDecide({ done: false, corrections });
  assert.equal(d.action, "iterate");
  assert.deepEqual(d.params.corrections, corrections);
});

test("decideFromOrchestratorDecide — stop on empty / invalid", () => {
  assert.equal(decideFromOrchestratorDecide(null).action, "stop");
  assert.equal(decideFromOrchestratorDecide({}).action, "stop");
  assert.equal(decideFromOrchestratorDecide({ done: false }).action, "stop");
  assert.equal(decideFromOrchestratorDecide({ corrections: [] }).action, "stop");
});
