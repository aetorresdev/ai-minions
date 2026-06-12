"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const CONTRACT_PATH = path.join(__dirname, "..", "..", "docs", "orchestrator", "module-boundaries.md");

const CANONICAL_MODULES = [
  "run-control",
  "contracts",
  "gates",
  "permissions",
  "tools",
  "model-runtime",
  "trace",
  "recovery",
  "budget",
  "worktree",
  "operator",
  "disclosure",
];

describe("module-boundaries-contract", () => {
  it("documents partial migration status and canonical modules", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /partial physical migration|CI import guard/i);
    assert.match(doc, /modules\/gates/i);
    assert.match(doc, /modules\/contracts/i);
    assert.match(doc, /modules\/recovery/i);
    assert.match(doc, /Not claimed/i);
    assert.match(doc, /modular monolith refactor complete/i);
    for (const mod of CANONICAL_MODULES) {
      assert.match(doc, new RegExp(`\\*\\*${mod}\\*\\*`));
    }
  });

  it("defines dependency matrix and known violations", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Allowed \/ forbidden dependencies/i);
    assert.match(doc, /\| \*\*recovery\*\* \|/);
    assert.match(doc, /\| recovery \|/);
    assert.match(doc, /Known import/i);
    assert.match(doc, /check-module-boundaries|lint:module-boundaries/i);
    assert.match(doc, /module-boundary-allowlist/i);
    assert.match(doc, /module-boundary-allowlist-shrink/i);
  });

  it("maps principal orchestrator files to modules", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /orchestrator\.js/);
    assert.match(doc, /approval-policy-gate\.js/);
    assert.match(doc, /modules\/gates/);
    assert.match(doc, /otel-genai-trace-map\.js/);
    assert.match(doc, /modules\/worktree/);
    assert.match(doc, /worktree-isolation\.js/);
  });

  it("documents functional core vs imperative shell", () => {
    const doc = fs.readFileSync(CONTRACT_PATH, "utf8");
    assert.match(doc, /Functional core/i);
    assert.match(doc, /evaluatePermission/i);
    assert.match(doc, /evaluateApprovalPolicy/i);
  });
});
