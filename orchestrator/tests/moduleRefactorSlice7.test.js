"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const ORCH = path.join(__dirname, "..");

describe("module refactor slice 7 (worktree)", () => {
  it("physical modules/worktree tree exists", () => {
    for (const rel of [
      "modules/worktree/index.js",
      "modules/worktree/worktree-isolation.js",
      "modules/worktree/worktree-result-promotion.js",
      "modules/worktree/worktree-cleanup-safety.js",
      "modules/worktree/run-workdir-contract.js",
      "modules/worktree/trace-workspace-lifecycle.js",
    ]) {
      assert.ok(fs.existsSync(path.join(ORCH, rel)), `missing ${rel}`);
    }
  });

  it("root shims re-export the same worktree APIs", () => {
    const shimIso = require("../worktree-isolation");
    const canonIso = require("../modules/worktree/worktree-isolation");
    assert.equal(shimIso.BINDING_SCHEMA_VERSION, canonIso.BINDING_SCHEMA_VERSION);
    assert.equal(typeof shimIso.createIsolatedWorktree, "function");
    assert.equal(shimIso.planWorktree, canonIso.planWorktree);

    const shimContract = require("../run-workdir-contract");
    const canonContract = require("../modules/worktree/run-workdir-contract");
    assert.equal(shimContract.CONTRACT_SCHEMA_VERSION, canonContract.CONTRACT_SCHEMA_VERSION);
    assert.equal(typeof shimContract.readRunWorkdirContract, "function");

    const shimLifecycle = require("../trace-workspace-lifecycle");
    const canonLifecycle = require("../modules/worktree/trace-workspace-lifecycle");
    assert.equal(typeof shimLifecycle.summarizeWorkspaceLifecycleFromRows, "function");
    assert.deepEqual(shimLifecycle.WORKSPACE_EVENTS, canonLifecycle.WORKSPACE_EVENTS);
    assert.equal(shimLifecycle.summarizeWorkspaceLifecycleFromRows, canonLifecycle.summarizeWorkspaceLifecycleFromRows);

    const shimPromotion = require("../worktree-result-promotion");
    const canonPromotion = require("../modules/worktree/worktree-result-promotion");
    assert.equal(shimPromotion.PROMOTION_SCHEMA_VERSION, canonPromotion.PROMOTION_SCHEMA_VERSION);
    assert.equal(typeof shimPromotion.promoteWorktreeResults, "function");
    assert.equal(shimPromotion.promoteWorktreeResults, canonPromotion.promoteWorktreeResults);
    assert.equal(shimPromotion.validatePromotionEligibility, canonPromotion.validatePromotionEligibility);

    const shimCleanup = require("../worktree-cleanup-safety");
    const canonCleanup = require("../modules/worktree/worktree-cleanup-safety");
    assert.equal(typeof shimCleanup.validateCleanupTarget, "function");
    assert.equal(shimCleanup.validateCleanupTarget, canonCleanup.validateCleanupTarget);
    assert.equal(shimCleanup.isUnderAllowedRoot, canonCleanup.isUnderAllowedRoot);
  });

  it("modules/worktree index aggregates core exports", () => {
    const worktree = require("../modules/worktree");
    assert.equal(typeof worktree.createIsolatedWorktree, "function");
    assert.equal(typeof worktree.readRunWorkdirContract, "function");
    assert.equal(typeof worktree.promoteWorktreeResults, "function");
    assert.equal(typeof worktree.validateCleanupTarget, "function");
    assert.equal(typeof worktree.summarizeWorkspaceLifecycleFromRows, "function");
  });
});
