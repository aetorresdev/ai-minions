"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { validateTraceLine } = require("../trace-schema");
const { traceFilePath } = require("../trace-append");
const {
  emitWorkspaceCreated,
  emitWorkspaceReused,
  emitWorkspaceRejected,
  emitWorkspaceCleanupStarted,
  emitWorkspaceCleanupCompleted,
  emitWorkspaceCleanupSkipped,
  emitWorkspaceCleanupFailed,
  emitWorkspaceRunCwdBound,
  emitWorkspaceArtifactsReady,
  emitWorkspacePromotionStarted,
  emitWorkspacePromotionCompleted,
  emitWorkspacePromotionDenied,
  emitWorkspacePromotionFailed,
  summarizeWorkspaceLifecycleFromRows,
} = require("../trace-workspace-lifecycle");
const {
  createIsolatedWorktree,
  removeIsolatedWorktree,
} = require("../worktree-isolation");
const { readRunWorkdirContract } = require("../run-workdir-contract");

/**
 * @returns {string}
 */
function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ws-trace-"));
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

function baseCtx(repo, worktreePath, taskId) {
  return {
    task_id: taskId,
    repo_root: repo,
    worktree_path: worktreePath,
    branch: `orch/${taskId}`,
    base_ref: "HEAD",
    run_cwd: worktreePath,
    artifact_root: path.join(worktreePath, ".claude", "run-artifacts", taskId),
    cleanup_policy: "retain",
  };
}

test("workspace lifecycle emitters validate against trace v2 schema", () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-schema-"));
  const taskId = "t-schema";
  const repo = "/tmp/repo";
  const wt = "/tmp/repo/.claude/worktrees/t-schema";
  const ctx = baseCtx(repo, wt, taskId);
  const opts = { tracesDir };

  const emitters = [
    () => emitWorkspaceCreated(taskId, ctx, {}, opts),
    () => emitWorkspaceReused(taskId, ctx, {}, opts),
    () => emitWorkspaceRejected(taskId, ctx, "worktree_path_exists", {}, opts),
    () => emitWorkspaceRunCwdBound(taskId, ctx, opts),
    () => emitWorkspaceArtifactsReady(taskId, ctx, opts),
    () => emitWorkspaceCleanupStarted(taskId, ctx, opts),
    () => emitWorkspaceCleanupCompleted(taskId, ctx, opts),
    () => emitWorkspaceCleanupSkipped(taskId, ctx, "cleanup_policy_retain", opts),
    () => emitWorkspaceCleanupFailed(taskId, ctx, "git_worktree_remove_failed", {}, opts),
    () => emitWorkspacePromotionStarted(taskId, ctx, { operator_approved: true, artifact_count: 1 }, opts),
    () => emitWorkspacePromotionCompleted(taskId, ctx, {
      operator_approved: true,
      promoted_artifacts: [{ source_rel: "a.txt", dest_rel: "a.txt" }],
    }, opts),
    () => emitWorkspacePromotionDenied(taskId, ctx, "operator_denied", {}, opts),
    () => emitWorkspacePromotionFailed(taskId, ctx, "copy_failed", {}, opts),
  ];

  for (const run of emitters) {
    const r = run();
    assert.equal(r.ok, true);
    const v = validateTraceLine(r.record);
    assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
  }
});

test("integration: happy path lifecycle + trace_refs on contract", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-happy-"));
  const prev = process.env.ORCH_TRACES_DIR;
  process.env.ORCH_TRACES_DIR = tracesDir;

  try {
    const taskId = "task-happy";
    const created = createIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(created.ok, true);

    const rows = loadTraceRows(tracesDir, taskId);
    const events = rows.map((r) => r.event);
    assert.ok(events.includes("workspace_created"));
    assert.ok(events.includes("workspace_artifacts_ready"));

    const contractRead = readRunWorkdirContract(created.worktree_path);
    assert.equal(contractRead.ok, true);
    assert.ok(Array.isArray(contractRead.contract.trace_refs));
    assert.ok(contractRead.contract.trace_refs.length >= 2);
    assert.equal(created.contract.trace_refs.length, contractRead.contract.trace_refs.length);

    const removed = removeIsolatedWorktree({ repoRoot: repo, taskId, force: true });
    assert.equal(removed.ok, true);

    const rowsAfter = loadTraceRows(tracesDir, taskId);
    const afterEvents = rowsAfter.map((r) => r.event);
    assert.ok(afterEvents.includes("workspace_cleanup_started"));
    assert.ok(afterEvents.includes("workspace_cleanup_completed"));

    const summary = summarizeWorkspaceLifecycleFromRows(rowsAfter);
    assert.equal(summary.flags.workspace_created, true);
    assert.equal(summary.flags.cleanup_completed, true);
    assert.equal(summary.event_count, afterEvents.filter((e) => e.startsWith("workspace_")).length);
  } finally {
    if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test("integration: cleanup failure retains workspace + trace", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-fail-"));
  const prev = process.env.ORCH_TRACES_DIR;
  process.env.ORCH_TRACES_DIR = tracesDir;

  try {
    const taskId = "task-dirty-retain";
    const created = createIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(created.ok, true);

    const removed = removeIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(removed.ok, false);

    const rows = loadTraceRows(tracesDir, taskId);
    assert.ok(rows.some((r) => r.event === "workspace_cleanup_failed"));
    const failed = rows.find((r) => r.event === "workspace_cleanup_failed");
    assert.equal(failed.retained, true);

    const summary = summarizeWorkspaceLifecycleFromRows(rows);
    assert.equal(summary.flags.workspace_retained, true);
    assert.equal(summary.flags.cleanup_completed, false);
  } finally {
    if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test("integration: retain policy skip emitter (fixture)", () => {
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-skip-"));
  const taskId = "task-retain-skip";
  const repo = "/repo";
  const wt = "/repo/.claude/worktrees/task-retain-skip";
  const ctx = baseCtx(repo, wt, taskId);

  emitWorkspaceCleanupSkipped(taskId, ctx, "cleanup_policy_retain", { tracesDir });
  const rows = loadTraceRows(tracesDir, taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, "workspace_cleanup_skipped");
  assert.equal(rows[0].reason_code, "cleanup_policy_retain");

  const summary = summarizeWorkspaceLifecycleFromRows(rows);
  assert.equal(summary.flags.cleanup_attempted, true);
  assert.equal(summary.flags.workspace_retained, true);

  fs.rmSync(tracesDir, { recursive: true, force: true });
});

test("ORCH_DISABLE_WORKSPACE_TRACE=1 skips JSONL append and trace_refs mutation", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-off-"));
  const prevTraces = process.env.ORCH_TRACES_DIR;
  const prevDisable = process.env.ORCH_DISABLE_WORKSPACE_TRACE;
  process.env.ORCH_TRACES_DIR = tracesDir;
  process.env.ORCH_DISABLE_WORKSPACE_TRACE = "1";

  try {
    const taskId = "task-trace-off";
    const created = createIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(traceFilePath(taskId, tracesDir)), false);
    assert.deepEqual(created.contract.trace_refs, []);
    const onDisk = readRunWorkdirContract(created.worktree_path);
    assert.equal(onDisk.ok, true);
    assert.deepEqual(onDisk.contract.trace_refs, []);
  } finally {
    if (prevTraces === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prevTraces;
    if (prevDisable === undefined) delete process.env.ORCH_DISABLE_WORKSPACE_TRACE;
    else process.env.ORCH_DISABLE_WORKSPACE_TRACE = prevDisable;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test("integration: reuse emits workspace_reused", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-reuse-"));
  const prev = process.env.ORCH_TRACES_DIR;
  process.env.ORCH_TRACES_DIR = tracesDir;

  try {
    const taskId = "task-reuse-trace";
    assert.equal(createIsolatedWorktree({ repoRoot: repo, taskId }).ok, true);
    assert.equal(createIsolatedWorktree({ repoRoot: repo, taskId }).ok, true);

    const rows = loadTraceRows(tracesDir, taskId);
    assert.equal(rows.filter((r) => r.event === "workspace_created").length, 1);
    assert.equal(rows.filter((r) => r.event === "workspace_reused").length, 1);
  } finally {
    if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});
