"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { validateCleanupTarget } = require("../worktree-cleanup-safety");
const {
  createIsolatedWorktree,
  removeIsolatedWorktree,
  readWorktreeBinding,
  writeWorktreeBinding,
} = require("../worktree-isolation");
const { traceFilePath } = require("../trace-append");

/**
 * @returns {string}
 */
function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cleanup-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf8");
  const { runGit } = require("../worktree-isolation");
  runGit(["init"], { cwd: dir });
  runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  runGit(["config", "user.name", "test"], { cwd: dir });
  runGit(["add", "README.md"], { cwd: dir });
  runGit(["commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("validateCleanupTarget rejects unsafe paths (table)", () => {
  const repo = path.join(os.tmpdir(), "orch-safe-repo");
  const allowed = path.join(repo, ".claude", "worktrees");
  const safe = path.join(allowed, "task-ok");
  fs.mkdirSync(safe, { recursive: true });

  const cases = [
    { name: "empty", path: "", expect: "empty_path" },
    { name: "whitespace", path: "   ", expect: "empty_path" },
    { name: "filesystem root", path: path.parse("/").root, expect: "filesystem_root" },
    { name: "home", path: os.homedir(), expect: "home_directory" },
    { name: "repo root", path: repo, expect: "repo_root" },
    { name: "worktrees root", path: allowed, expect: "worktrees_root" },
    { name: "outside allowed", path: path.join(repo, "elsewhere"), expect: "outside_allowed_root" },
    { name: "parent escape", path: path.join(allowed, "..", "README.md"), expect: "outside_allowed_root" },
    {
      name: "primary cwd",
      path: safe,
      expect: "primary_cwd",
      extra: { primaryCwd: safe },
    },
  ];

  for (const c of cases) {
    const r = validateCleanupTarget(c.path, {
      allowedRoot: allowed,
      repoRoot: repo,
      ...(c.extra || {}),
    });
    assert.equal(r.ok, false, c.name);
    assert.equal(r.reason_code, c.expect, c.name);
  }

  const ok = validateCleanupTarget(safe, { allowedRoot: allowed, repoRoot: repo });
  assert.equal(ok.ok, true);
  assert.equal(ok.resolved_path, path.resolve(safe));
});

test("removeIsolatedWorktree rejects unsafe cleanup target before git remove", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cleanup-unsafe-int-"));
  const prev = process.env.ORCH_TRACES_DIR;
  process.env.ORCH_TRACES_DIR = tracesDir;

  try {
    const taskId = "task-unsafe-int";
    const created = createIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(created.ok, true);

    const binding = readWorktreeBinding(created.worktree_path);
    assert.ok(binding);
    writeWorktreeBinding(created.worktree_path, {
      ...binding,
      primary_cwd: created.worktree_path,
    });

    const removed = removeIsolatedWorktree({ repoRoot: repo, taskId, force: true });
    assert.equal(removed.ok, false);
    assert.equal(removed.error, "unsafe_cleanup_target");
    assert.equal(removed.reason_code, "primary_cwd");
    assert.equal(fs.existsSync(created.worktree_path), true);

    const rows = fs.readFileSync(traceFilePath(taskId, tracesDir), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const failed = rows.filter((r) => r.event === "workspace_cleanup_failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].reason_code, "primary_cwd");
    assert.equal(rows.some((r) => r.event === "workspace_cleanup_started"), false);
    assert.equal(rows.some((r) => r.event === "workspace_cleanup_completed"), false);
  } finally {
    if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});

test("removeIsolatedWorktree is idempotent when worktree already gone", () => {
  const repo = initTempGitRepo();
  const tracesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cleanup-idem-"));
  const prev = process.env.ORCH_TRACES_DIR;
  process.env.ORCH_TRACES_DIR = tracesDir;

  try {
    const taskId = "task-idem";
    const created = createIsolatedWorktree({ repoRoot: repo, taskId });
    assert.equal(created.ok, true);

    const first = removeIsolatedWorktree({ repoRoot: repo, taskId, force: true });
    assert.equal(first.ok, true);
    assert.equal(first.removed, true);

    const second = removeIsolatedWorktree({ repoRoot: repo, taskId, force: true });
    assert.equal(second.ok, true);
    assert.equal(second.already_removed, true);

    const rows = fs.readFileSync(traceFilePath(taskId, tracesDir), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    assert.ok(rows.some((r) => r.event === "workspace_cleanup_skipped" && r.reason_code === "already_removed"));
  } finally {
    if (prev === undefined) delete process.env.ORCH_TRACES_DIR;
    else process.env.ORCH_TRACES_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tracesDir, { recursive: true, force: true });
  }
});
