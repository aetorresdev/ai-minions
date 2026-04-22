"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  decideFromOrchestratorDecide,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
  decideCorrectionsPlan,
  loopExhaustedDefaultSummary,
  decideCostGuard,
  decideStepRetryGuard,
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

test("decideCorrectionsPlan — use_json vs fallback_dev", () => {
  const corrections = [{ agentId: "dev", task: "fix" }];
  assert.deepEqual(decideCorrectionsPlan({ corrections }), { action: "use_json", corrections });
  assert.deepEqual(decideCorrectionsPlan({ corrections: [] }), { action: "fallback_dev" });
  assert.deepEqual(decideCorrectionsPlan(null), { action: "fallback_dev" });
});

test("loopExhaustedDefaultSummary", () => {
  assert.equal(loopExhaustedDefaultSummary(3), "Stopped after 3 iteration(s).");
});

test("decideCostGuard — no abort when under limit", () => {
  assert.deepEqual(decideCostGuard({ estimate: 0.5, maxCostUsd: 1.0, phase: "worker" }), { abort: false });
});

test("decideCostGuard — no abort when maxCostUsd null", () => {
  assert.deepEqual(decideCostGuard({ estimate: 99, maxCostUsd: null, phase: "worker" }), { abort: false });
});

test("decideCostGuard — no abort when estimate null", () => {
  assert.deepEqual(decideCostGuard({ estimate: null, maxCostUsd: 1.0, phase: "worker" }), { abort: false });
});

test("decideCostGuard — abort when over limit", () => {
  const d = decideCostGuard({ estimate: 1.5, maxCostUsd: 1.0, phase: "cerberus" });
  assert.equal(d.abort, true);
  assert.equal(d.limitUsd, 1.0);
  assert.equal(d.guardPhase, "cerberus");
  assert.ok(typeof d.summary === "string" && d.summary.includes("ORCH_MAX_COST_USD=1"));
  assert.ok(typeof d.estimateUsd === "number" && d.estimateUsd > 1.0);
});

test("decideCostGuard — no abort when estimate equals limit exactly", () => {
  assert.deepEqual(decideCostGuard({ estimate: 1.0, maxCostUsd: 1.0, phase: "plan" }), { abort: false });
});

test("decideStepRetryGuard — no abort when under limit", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: 1, maxStepRetries: 2, agentId: "dev-backend" }), { abort: false });
});

test("decideStepRetryGuard — no abort when maxStepRetries null", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: 99, maxStepRetries: null, agentId: "dev-backend" }), { abort: false });
});

test("decideStepRetryGuard — abort when exceeds limit", () => {
  const d = decideStepRetryGuard({ prevRetries: 3, maxStepRetries: 2, agentId: "dev-backend" });
  assert.equal(d.abort, true);
  assert.equal(d.agentId, "dev-backend");
  assert.equal(d.retryNumber, 3);
  assert.ok(typeof d.summary === "string" && d.summary.includes("ORCH_MAX_RETRIES=2"));
});

test("decideStepRetryGuard — no abort when prevRetries equals limit exactly", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: 2, maxStepRetries: 2, agentId: "dev-backend" }), { abort: false });
});
