"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 6 (budget)", () => {
  it("physical modules/budget tree exists", () => {
    for (const rel of [
      "modules/budget/index.js",
      "modules/budget/token-usage-summary.js",
      "modules/budget/token-trace-report.js",
      "modules/budget/cost-accounting-dimensions.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same budget APIs", () => {
    const shimSummary = require("../token-usage-summary");
    const canonSummary = require("../modules/budget/token-usage-summary");
    assert.equal(typeof shimSummary.buildTokenUsageSummary, "function");
    assert.equal(shimSummary.buildTokenUsageSummary, canonSummary.buildTokenUsageSummary);

    const shimCost = require("../cost-accounting-dimensions");
    const canonCost = require("../modules/budget/cost-accounting-dimensions");
    assert.equal(typeof shimCost.buildRunCostAccountingFromReport, "function");
    assert.equal(shimCost.buildRunCostAccountingFromReport, canonCost.buildRunCostAccountingFromReport);

    const shimReport = require("../token-trace-report");
    const canonReport = require("../modules/budget/token-trace-report");
    assert.equal(typeof shimReport.buildReport, "function");
    assert.equal(typeof shimReport.parseJsonl, "function");
    assert.equal(shimReport.buildReport, canonReport.buildReport);
  });

  it("modules/budget index aggregates core exports", () => {
    const budget = require("../modules/budget");
    assert.equal(typeof budget.buildTokenUsageSummary, "function");
    assert.equal(typeof budget.buildRunCostAccountingFromReport, "function");
    assert.equal(typeof budget.buildReport, "function");
    assert.equal(typeof budget.parseJsonl, "function");
  });

  it("runner-budget-view remains at root until operator slice", () => {
    assert.ok(fs.existsSync(path.join(ORCH, "runner-budget-view.js")));
    assert.equal(fs.existsSync(path.join(ORCH, "modules/budget/runner-budget-view.js")), false);
  });
});
