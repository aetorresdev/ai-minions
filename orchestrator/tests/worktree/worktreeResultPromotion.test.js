"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");

const { validateTraceLine } = require("../../trace-schema");
const { traceFilePath } = require("../../trace-append");
const { createIsolatedWorktree } = require("../../worktree-isolation");
const { CONTRACT_REL_PATH } = require("../../run-workdir-contract");
const {
  validatePromotionEligibility,
  promoteWorktreeResults,
  denyWorktreePromotion,
  readPromotionRecord,
  isPathUnderRoot,
} = require("../../worktree-result-promotion");

/**
 * @returns {string}
 */
function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf8");
  const { runGit } = require("../../worktree-isolation");
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

  it("promote-deny fails when workspace_artifacts_ready trace ref is missing", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const prevDisable = process.env.ORCH_DISABLE_WORKSPACE_TRACE;
    process.env.ORCH_DISABLE_WORKSPACE_TRACE = "1";

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-deny-no-ready", primaryCwd: repo });
    if (prevDisable === undefined) delete process.env.ORCH_DISABLE_WORKSPACE_TRACE;
    else process.env.ORCH_DISABLE_WORKSPACE_TRACE = prevDisable;

    assert.equal(created.ok, true);

    const denied = denyWorktreePromotion({ repoRoot: repo, taskId: "promo-deny-no-ready" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "artifacts_not_ready");
    assert.equal(denied.reason_code, "missing_artifacts_ready_trace");
    assert.equal(readPromotionRecord(created.worktree_path), null);
  });

  it("promote-deny fails when run workdir contract is invalid", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-deny-bad-contract", primaryCwd: repo });
    assert.equal(created.ok, true);

    const contractPath = path.join(created.worktree_path, CONTRACT_REL_PATH);
    fs.writeFileSync(contractPath, '{"schema_version":"1"}\n', "utf8");

    const denied = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-deny-bad-contract",
      tracesDir,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "run_workdir_contract_invalid");
    assert.equal(denied.reason_code, "invalid_contract");
    assert.equal(readPromotionRecord(created.worktree_path), null);
  });

  it("promote-deny fails after prior deny and preserves record", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-deny-twice", primaryCwd: repo });
    assert.equal(created.ok, true);

    const first = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-deny-twice",
      reasonCode: "operator_denied",
      tracesDir,
    });
    assert.equal(first.ok, true);

    const before = readPromotionRecord(created.worktree_path);
    assert.equal(before.status, "denied");
    assert.equal(before.deny_reason_code, "operator_denied");
    const deniedEventsBefore = loadTraceRows(tracesDir, "promo-deny-twice")
      .filter((r) => r.event === "workspace_promotion_denied");
    assert.equal(deniedEventsBefore.length, 1);

    const second = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-deny-twice",
      reasonCode: "retry_denied",
      tracesDir,
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "promotion_already_denied");
    assert.equal(second.reason_code, "already_denied");

    const after = readPromotionRecord(created.worktree_path);
    assert.deepEqual(after, before);

    const deniedEventsAfter = loadTraceRows(tracesDir, "promo-deny-twice")
      .filter((r) => r.event === "workspace_promotion_denied");
    assert.equal(deniedEventsAfter.length, 1);
  });

  it("promote fails after prior deny and preserves record", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-after-deny", primaryCwd: repo });
    assert.equal(created.ok, true);
    const artifactRel = "after-deny.txt";
    fs.writeFileSync(path.join(created.worktree_path, artifactRel), "nope\n", "utf8");

    const denied = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-after-deny",
      reasonCode: "operator_denied",
      tracesDir,
    });
    assert.equal(denied.ok, true);

    const before = readPromotionRecord(created.worktree_path);
    const dest = path.join(repo, artifactRel);
    assert.equal(fs.existsSync(dest), false);

    const promoted = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-after-deny",
      artifacts: [artifactRel],
      operatorApproved: true,
      tracesDir,
    });
    assert.equal(promoted.ok, false);
    assert.equal(promoted.error, "promotion_already_denied");
    assert.equal(promoted.reason_code, "already_denied");
    assert.equal(fs.existsSync(dest), false);

    const after = readPromotionRecord(created.worktree_path);
    assert.deepEqual(after, before);
  });

  it("promote-deny fails after promotion completed and preserves record", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-deny-after-done", primaryCwd: repo });
    assert.equal(created.ok, true);
    const artifactRel = "done.txt";
    fs.writeFileSync(path.join(created.worktree_path, artifactRel), "done\n", "utf8");

    const promoted = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-deny-after-done",
      artifacts: [artifactRel],
      operatorApproved: true,
      tracesDir,
    });
    assert.equal(promoted.ok, true);

    const before = readPromotionRecord(created.worktree_path);
    assert.equal(before.status, "completed");

    const denied = denyWorktreePromotion({
      repoRoot: repo,
      taskId: "promo-deny-after-done",
      tracesDir,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "promotion_already_completed");
    assert.equal(denied.reason_code, "already_promoted");

    const after = readPromotionRecord(created.worktree_path);
    assert.equal(after.status, "completed");
    assert.deepEqual(after, before);
  });

  it("promote fails when destination exists without overwrite", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-promo-trace-"));
    prevTracesDir = process.env.ORCH_TRACES_DIR || "";
    process.env.ORCH_TRACES_DIR = tracesDir;

    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "promo-overwrite", primaryCwd: repo });
    assert.equal(created.ok, true);
    const artifactRel = "collision.txt";
    fs.writeFileSync(path.join(created.worktree_path, artifactRel), "worktree\n", "utf8");
    fs.writeFileSync(path.join(repo, artifactRel), "existing\n", "utf8");

    const blocked = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-overwrite",
      artifacts: [artifactRel],
      operatorApproved: true,
      tracesDir,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "dest_exists");
    assert.equal(blocked.reason_code, "dest_already_exists");
    assert.equal(fs.readFileSync(path.join(repo, artifactRel), "utf8"), "existing\n");

    const allowed = promoteWorktreeResults({
      repoRoot: repo,
      taskId: "promo-overwrite",
      artifacts: [artifactRel],
      operatorApproved: true,
      allowOverwrite: true,
      tracesDir,
    });
    assert.equal(allowed.ok, true);
    assert.equal(fs.readFileSync(path.join(repo, artifactRel), "utf8"), "worktree\n");
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
