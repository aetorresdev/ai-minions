"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { summarizeModelCostOutcomeFromRows } = require("../modules/trace/model-cost-outcome-summary");
const {
  buildRunOutcomeSummary,
  formatRunOutcomeSummaryLines,
} = require("../run-outcome-summary");

describe("model-cost-outcome-summary", () => {
  it("returns empty tiers when no model governance trace events", () => {
    const summary = summarizeModelCostOutcomeFromRows([
      { event: "session_start", task_id: "t1" },
      { event: "session_end", task_id: "t1", done: true },
    ]);
    assert.equal(summary.total_steps, 0);
    assert.deepEqual(summary.tiers, []);
    assert.equal(summary.missing_tier_metadata_count, 0);
  });

  it("aggregates mixed-tier selections, gate failures, and retries", () => {
    const rows = [
      {
        event: "model_selection",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s-cheap",
        model: "claude-haiku-4-5-20251001",
        model_tier: "cheap",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.001,
      },
      {
        event: "model_selection",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s-standard",
        model: "claude-sonnet-4-6",
        model_tier: "standard",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.05,
      },
      {
        event: "agent_done",
        step_id: "s-standard",
        agent: "dev-backend",
        edge_type: "retry",
      },
      {
        event: "model_tier_gate_denied",
        gate_id: "model_tier_gate",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s-frontier",
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
        denial_reason: "Frontier tier cannot use selection_source=default.",
      },
      {
        event: "model_selection",
        role: "QA",
        agent: "qa",
        step_id: "s-infer",
        model: "claude-sonnet-4-6",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.02,
      },
    ];

    const summary = summarizeModelCostOutcomeFromRows(rows);
    assert.equal(summary.total_steps, 3);
    assert.equal(summary.missing_tier_metadata_count, 1);

    const cheap = summary.tiers.find((t) => t.model_tier === "cheap");
    const standard = summary.tiers.find((t) => t.model_tier === "standard");
    const frontier = summary.tiers.find((t) => t.model_tier === "frontier");

    assert.ok(cheap);
    assert.equal(cheap.steps, 1);
    assert.equal(cheap.cost_usd, 0.001);
    assert.equal(cheap.gate_failures, 0);
    assert.equal(cheap.retries, 0);
    assert.deepEqual(cheap.roles, ["DEV"]);

    assert.ok(standard);
    assert.equal(standard.steps, 2);
    assert.equal(standard.cost_usd, 0.07);
    assert.equal(standard.retries, 1);
    assert.equal(standard.gate_failures, 0);

    assert.ok(frontier);
    assert.equal(frontier.steps, 0);
    assert.equal(frontier.gate_failures, 1);
    assert.equal(frontier.retries, 0);
  });

  it("attributes retries without model_selection to unknown tier", () => {
    const summary = summarizeModelCostOutcomeFromRows([
      {
        event: "agent_done",
        step_id: "orphan",
        agent: "dev-backend",
        edge_type: "retry",
      },
    ]);
    const unknown = summary.tiers.find((t) => t.model_tier === "unknown");
    assert.ok(unknown);
    assert.equal(unknown.retries, 1);
    assert.equal(unknown.steps, 0);
  });

  it("counts invalid explicit model_tier as missing metadata when inferred from model", () => {
    const summary = summarizeModelCostOutcomeFromRows([
      {
        event: "model_selection",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s-bad-tier",
        model: "claude-sonnet-4-6",
        model_tier: "not-a-tier",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.01,
      },
    ]);
    assert.equal(summary.missing_tier_metadata_count, 1);
    assert.equal(summary.tiers[0].model_tier, "standard");
  });
});

describe("run_outcome_summary integration", () => {
  it("includes model_cost_outcome_summary for mixed-tier fixture", () => {
    const rows = [
      {
        event: "session_start",
        task_id: "ts-mco",
        flow_mode: "single_agent",
        max_iterations: 2,
      },
      {
        event: "model_selection",
        task_id: "ts-mco",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s1",
        model: "claude-haiku-4-5-20251001",
        model_tier: "cheap",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.002,
      },
      {
        event: "model_selection",
        task_id: "ts-mco",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s2",
        model: "claude-sonnet-4-6",
        model_tier: "standard",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        estimated_cost_usd: 0.04,
      },
      {
        event: "model_tier_gate_denied",
        task_id: "ts-mco",
        gate_id: "model_tier_gate",
        role: "DEV",
        agent: "dev-backend",
        step_id: "s3",
        model: "claude-opus-4",
        model_tier: "frontier",
        selection_source: "default",
        selection_reason: "model_routing_primary",
        reason_code: "FRONTIER_UNAUTHORIZED_SOURCE",
        denial_reason: "Frontier tier cannot use selection_source=default.",
      },
      {
        event: "session_end",
        task_id: "ts-mco",
        done: false,
        iterations: 1,
        gate_blocks: 1,
      },
    ];

    const s = buildRunOutcomeSummary(rows, {});
    assert.ok(s.model_cost_outcome_summary);
    assert.equal(s.model_cost_outcome_summary.total_steps, 2);
    assert.equal(s.model_tier_gate.denied_count, 1);

    const text = formatRunOutcomeSummaryLines(s).join("\n");
    assert.match(text, /model_cost_outcome:/);
    assert.match(text, /cheap:1st/);
    assert.match(text, /standard:1st/);
    assert.match(text, /frontier:0st/);
    assert.match(text, /1gf/);
  });
});
