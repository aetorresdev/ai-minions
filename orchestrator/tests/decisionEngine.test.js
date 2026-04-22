"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  decideFromOrchestratorDecide,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
} = require("../decision-engine");

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

test("decideCerberusBlockersBranch — iterate, cap, skip", () => {
  assert.equal(decideCerberusBlockersBranch({ blockerCount: 0, iterations: 1, maxIterations: 3 }), "skip");
  assert.equal(decideCerberusBlockersBranch({ blockerCount: 2, iterations: 1, maxIterations: 3 }), "iterate");
  assert.equal(decideCerberusBlockersBranch({ blockerCount: 1, iterations: 3, maxIterations: 3 }), "manual_cap");
});

test("decideGateBlockedArtifactsBranch — iterate, cap, skip", () => {
  assert.equal(decideGateBlockedArtifactsBranch({ artifactCount: 0, iterations: 1, maxIterations: 3 }), "skip");
  assert.equal(decideGateBlockedArtifactsBranch({ artifactCount: 1, iterations: 1, maxIterations: 3 }), "iterate");
  assert.equal(decideGateBlockedArtifactsBranch({ artifactCount: 2, iterations: 5, maxIterations: 5 }), "manual_cap");
});
