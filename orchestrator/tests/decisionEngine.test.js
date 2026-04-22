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
  formatGateBlockedReasonLines,
  planStepsReplayFromGateBlockedArtifacts,
  planStepsDevFallbackFromBlockers,
  summaryMaxIterationsGateBlocked,
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

// decideCostGuard — edge cases
test("decideCostGuard — no abort when estimate undefined", () => {
  assert.deepEqual(decideCostGuard({ estimate: undefined, maxCostUsd: 1.0, phase: "worker" }), { abort: false });
});

test("decideCostGuard — no abort when maxCostUsd negative", () => {
  assert.deepEqual(decideCostGuard({ estimate: 5, maxCostUsd: -1, phase: "worker" }), { abort: false });
});

test("decideCostGuard — no abort when estimate NaN", () => {
  assert.deepEqual(decideCostGuard({ estimate: NaN, maxCostUsd: 1.0, phase: "worker" }), { abort: false });
});

test("decideCostGuard — no abort when estimate Infinity", () => {
  // Infinity is not finite — treated as unresolvable, no abort
  assert.deepEqual(decideCostGuard({ estimate: Infinity, maxCostUsd: 1.0, phase: "worker" }), { abort: false });
});

test("decideCostGuard — abort includes reason_code", () => {
  const d = decideCostGuard({ estimate: 2.0, maxCostUsd: 1.0, phase: "plan" });
  assert.equal(d.abort, true);
  assert.equal(d.reason_code, "cost_guard");
});

// decideStepRetryGuard — edge cases
test("decideStepRetryGuard — no abort when prevRetries undefined", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: undefined, maxStepRetries: 2, agentId: "dev-backend" }), { abort: false });
});

test("decideStepRetryGuard — no abort when maxStepRetries negative", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: 5, maxStepRetries: -1, agentId: "dev-backend" }), { abort: false });
});

test("decideStepRetryGuard — no abort when prevRetries NaN", () => {
  assert.deepEqual(decideStepRetryGuard({ prevRetries: NaN, maxStepRetries: 2, agentId: "dev-backend" }), { abort: false });
});

test("decideStepRetryGuard — abort with empty agentId uses empty string", () => {
  const d = decideStepRetryGuard({ prevRetries: 3, maxStepRetries: 2, agentId: "" });
  assert.equal(d.abort, true);
  assert.equal(d.agentId, "");
});

test("decideStepRetryGuard — abort with null agentId coerces to empty string", () => {
  const d = decideStepRetryGuard({ prevRetries: 3, maxStepRetries: 2, agentId: null });
  assert.equal(d.abort, true);
  assert.equal(d.agentId, "");
});

test("decideStepRetryGuard — abort includes reason_code", () => {
  const d = decideStepRetryGuard({ prevRetries: 3, maxStepRetries: 2, agentId: "dev-backend" });
  assert.equal(d.abort, true);
  assert.equal(d.reason_code, "step_retry_guard");
});

test("formatGateBlockedReasonLines — empty and shaped rows", () => {
  assert.deepEqual(formatGateBlockedReasonLines([]), []);
  assert.deepEqual(formatGateBlockedReasonLines(null), []);
  assert.deepEqual(formatGateBlockedReasonLines([{ agentId: "dev-backend", gateReason: "missing yaml" }]), [
    "dev-backend: missing yaml",
  ]);
  assert.deepEqual(formatGateBlockedReasonLines([{ agentId: "", gateReason: "" }]), [": gate blocked"]);
});

test("planStepsReplayFromGateBlockedArtifacts — maps agentId and task", () => {
  const steps = planStepsReplayFromGateBlockedArtifacts([
    { agentId: "dev-backend", task: "do X" },
    { agentId: "qa", task: "check" },
  ]);
  assert.deepEqual(steps, [
    { agentId: "dev-backend", task: "do X" },
    { agentId: "qa", task: "check" },
  ]);
});

test("planStepsDevFallbackFromBlockers — only dev-* and joins blockers", () => {
  const steps = planStepsDevFallbackFromBlockers({
    artifacts: [
      { agentId: "dev-backend", task: "old" },
      { agentId: "qa", task: "ignore" },
      { agentId: "dev-frontend", task: "old2" },
    ],
    blockerItems: ["a", "b", "c"],
    maxBlockersInTask: 2,
  });
  assert.deepEqual(steps, [
    { agentId: "dev-backend", task: "Fix blockers: a; b" },
    { agentId: "dev-frontend", task: "Fix blockers: a; b" },
  ]);
});

test("planStepsDevFallbackFromBlockers — empty blockers matches prior inline suffix", () => {
  const steps = planStepsDevFallbackFromBlockers({
    artifacts: [{ agentId: "dev-backend", task: "x" }],
    blockerItems: [],
  });
  assert.deepEqual(steps, [{ agentId: "dev-backend", task: "Fix blockers: " }]);
});

test("summaryMaxIterationsGateBlocked — joins reason lines", () => {
  const s = summaryMaxIterationsGateBlocked({
    count: 2,
    reasonLines: ["dev-backend: bad", "qa: also bad"],
  });
  assert.ok(s.includes("2 gate-blocked"));
  assert.ok(s.endsWith("Blocked: dev-backend: bad; qa: also bad"));
});
