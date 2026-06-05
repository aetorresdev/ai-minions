"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");

const { validateTraceLine } = require("../trace-schema");
const { traceFilePath } = require("../trace-append");
const { createIsolatedWorktree } = require("../worktree-isolation");
const {
  validatePromotionEligibility,
  promoteWorktreeResults,
  denyWorktreePromotion,
  readPromotionRecord,
  isPathUnderRoot,
} = require("../worktree-result-promotion");

/**
 * @returns {string}
 */
function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf8");
  const { runGit } = require("../worktree-isolation");
  runGit(["init"], { cwd: dir });
  runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  runGit(["config", "user.name", "test"], { cwd: dir });
  runGit(["add", "README.md"], { cwd: dir });
  runGit(["commit", "-m", "init"], { cwd: dir });
  return dir;
}

/**
 * @param {string} tracesDir
 * @param {string} taskId
 * @returns {object[]}
 */
function loadTraceRows(tracesDir, taskId) {
  const fp = traceFilePath(taskId, tracesDir);
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("worktree-result-promotion", () => {
  /** @type {string[]} */
  let repos = [];
  /** @type {string | undefined} */
  let prevTracesDir;

  afterEach(() => {
    if (prevTracesDir !== undefined) {
      if (prevTracesDir) process.env.ORCH_TRACES_DIR = prevTracesDir;
      else delete process.env.ORCH_TRACES_DIR;
      prevTracesDir = undefined;
    }
    for (const repo of repos) {
      try {
        fs.rmSync(repo, { recursive: true, force: true });
      } catch {
        /* ok */
      }
    }
    repos = [];
  });

  it("isPathUnderRoot detects containment", () => {
    assert.equal(isPathUnderRoot("/a/b/c", "/a/b"), true);
    assert.equal(isPathUnderRoot("/a/b", "/a/b/c"), false);
  });

  it("validatePromotionEligibility requires artifacts_ready trace ref", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-elig", primaryCwd: repo });
    assert.equal(created.ok, true);

    const elig = validatePromotionEligibility({ repoRoot: repo, taskId: "promo-elig" });
    assert.equal(elig.ok, true);
    assert.ok(elig.trace_refs.some((r) => r.event === "workspace_artifacts_ready"));
  });

  it("promoteWorktreeResults requires operator approval", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-approve", primaryCwd: repo });
    assert.equal(created.ok, true);
    const artifactRel = "output.txt";
    fs.writeFileSync(path.join(created.worktree_path, artifactRel), "hello\n", "utf8");

    const denied = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-approve",
      artifacts: [artifactRel],
      tracesDir,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "operator_approval_required");

    const promoted = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-approve",
      artifacts: [artifactRel],
      operatorApproved: true,
      tracesDir,
    });
    assert.equal(promoted.ok, true);
    assert.equal(promoted.artifacts.length, 1);
    const dest = path.join(repo, artifactRel);
    assert.ok(fs.existsSync(dest));
    assert.equal(fs.readFileSync(dest, "utf8"), "hello\n");

    const record = readPromotionRecord(created.worktree_path);
    assert.equal(record.status, "completed");
    assert.equal(record.operator_approved, true);

    const rows = loadTraceRows(tracesDir, "promo-approve");
    const promoEvents = rows.filter((r) => String(r.event).startsWith("workspace_promotion_"));
    assert.ok(promoEvents.some((r) => r.event === "workspace_promotion_started"));
    assert.ok(promoEvents.some((r) => r.event === "workspace_promotion_completed"));
    for (const row of promoEvents) {
      const v = validateTraceLine(row);
      assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
    }
  });

  it("denyWorktreePromotion has no cleanup side effects", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-deny", primaryCwd: repo });
    assert.equal(created.ok, true);
    assert.ok(fs.existsSync(created.worktree_path));

    const denied = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-deny",
      reasonCode: "operator_denied",
      tracesDir,
    });
    assert.equal(denied.ok, true);
    assert.equal(denied.cleanup_side_effects, false);
    assert.ok(fs.existsSync(created.worktree_path));

    const record = readPromotionRecord(created.worktree_path);
    assert.equal(record.status, "denied");
    assert.equal(record.deny_reason_code, "operator_denied");

    const rows = loadTraceRows(tracesDir, "promo-deny");
    const deniedEvent = rows.find((r) => r.event === "workspace_promotion_denied");
    assert.ok(deniedEvent);
    assert.equal(deniedEvent.cleanup_side_effects, false);
    const v = validateTraceLine(deniedEvent);
    assert.equal(v.ok, true);
  });

  it("rejects promotion when artifact is outside mutable zone", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-bad", primaryCwd: repo });
    assert.equal(created.ok, true);

    const outside = path.join(repo, "outside.txt");
    fs.writeFileSync(outside, "nope\n", "utf8");

    const result = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-bad",
      artifacts: [path.relative(created.worktree_path, outside)],
      operatorApproved: true,
      tracesDir,
    });
    assert.equal(result.ok, false);
  });
});
