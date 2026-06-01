"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");

const {
  planWorktree,
  createIsolatedWorktree,
  removeIsolatedWorktree,
  listManagedWorktrees,
  statusWorktree,
  buildWorktreeTraceFields,
  readWorktreeBinding,
} = require("../worktree-isolation");

/**
 * @returns {string}
 */
function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-worktree-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf8");
  const { runGit } = require("../worktree-isolation");
  runGit(["init"], { cwd: dir });
  runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  runGit(["config", "user.name", "test"], { cwd: dir });
  runGit(["add", "README.md"], { cwd: dir });
  runGit(["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("worktree-isolation", () => {
  /** @type {string[]} */
  let repos = [];

  afterEach(() => {
    for (const repo of repos) {
      try {
        fs.rmSync(repo, { recursive: true, force: true });
      } catch {
        /* ok */
      }
    }
    repos = [];
  });

  it("planWorktree derives stable paths and branch names", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const plan = planWorktree({ repoRoot: repo, taskId: "task-abc123" });
    assert.equal(plan.ok, true);
    assert.match(plan.worktree_path, /task-abc123$/);
    assert.equal(plan.branch, "orch/task-abc123");
  });

  it("createIsolatedWorktree adds binding and lists managed worktree", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({
      repoRoot: repo,
      taskId: "task-wt-1",
      primaryCwd: repo,
    });
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.ok(fs.existsSync(created.worktree_path));
    const binding = readWorktreeBinding(created.worktree_path);
    assert.equal(binding.task_id, "task-wt-1");
    assert.equal(binding.repo_root, repo);

    const listed = listManagedWorktrees({ repoRoot: repo });
    assert.equal(listed.ok, true);
    assert.equal(listed.worktrees.length, 1);
    assert.equal(listed.worktrees[0].task_id, "task-wt-1");
  });

  it("createIsolatedWorktree is idempotent for same task_id", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const first = createIsolatedWorktree({ repoRoot: repo, taskId: "task-dup" });
    const second = createIsolatedWorktree({ repoRoot: repo, taskId: "task-dup" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.already_exists, true);
    assert.equal(second.created, false);
  });

  it("buildWorktreeTraceFields returns isolation metadata inside worktree", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-trace" });
    assert.equal(created.ok, true);
    const fields = buildWorktreeTraceFields(created.worktree_path);
    assert.equal(fields.isolation_mode, "git_worktree");
    assert.equal(fields.worktree_task_id, "task-trace");
    assert.equal(fields.worktree_path, created.worktree_path);
  });

  it("removeIsolatedWorktree fails on dirty managed worktree without --force", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-dirty-no-force" });
    assert.equal(created.ok, true);
    assert.ok(readWorktreeBinding(created.worktree_path));

    const removed = removeIsolatedWorktree({ repoRoot: repo, taskId: "task-dirty-no-force" });
    assert.equal(removed.ok, false);
    assert.equal(removed.error, "git_worktree_remove_failed");
    assert.match(removed.detail || "", /modified or untracked/i);
    assert.equal(fs.existsSync(created.worktree_path), true);
  });

  it("removeIsolatedWorktree succeeds on dirty managed worktree with --force", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-dirty-force" });
    assert.equal(created.ok, true);

    const removed = removeIsolatedWorktree({
      repoRoot: repo,
      taskId: "task-dirty-force",
      force: true,
    });
    assert.equal(removed.ok, true);
    assert.equal(fs.existsSync(created.worktree_path), false);
  });

  it("statusWorktree reports managed cwd", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-st" });
    const st = statusWorktree({ cwd: created.worktree_path });
    assert.equal(st.ok, true);
    assert.equal(st.managed, true);
    assert.equal(st.binding.task_id, "task-st");
  });
});
