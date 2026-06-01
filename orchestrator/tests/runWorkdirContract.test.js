"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");

const {
  validateRunWorkdirContract,
  buildRunWorkdirContract,
  contractFromBinding,
  readRunWorkdirContract,
  resolveRunCwdFromContract,
  formatRunWorkdirContractText,
  readRunWorkdirContractFile,
  CLEANUP_POLICIES,
} = require("../run-workdir-contract");
const {
  planWorktree,
  createIsolatedWorktree,
  readWorktreeBinding,
} = require("../worktree-isolation");

function initTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-rw-contract-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf8");
  const { runGit } = require("../worktree-isolation");
  runGit(["init"], { cwd: dir });
  runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  runGit(["config", "user.name", "test"], { cwd: dir });
  runGit(["add", "README.md"], { cwd: dir });
  runGit(["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("run-workdir-contract", () => {
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

  it("validateRunWorkdirContract rejects invalid cleanup_policy", () => {
    const built = buildRunWorkdirContract({
      run_id: "task-1",
      repo_root: "/repo",
      worktree_path: "/repo/.claude/worktrees/task-1",
    });
    assert.equal(built.ok, true);
    const bad = { ...built.contract, cleanup_policy: "delete_everything" };
    const v = validateRunWorkdirContract(bad);
    assert.equal(v.ok, false);
    assert.ok(v.errors.includes("invalid_cleanup_policy"));
  });

  it("buildRunWorkdirContract separates execution state and business artifacts", () => {
    const repo = "/home/op/project";
    const wt = "/home/op/project/.claude/worktrees/task-x";
    const built = buildRunWorkdirContract({
      run_id: "task-x",
      repo_root: repo,
      worktree_path: wt,
      worktree_isolated: true,
    });
    assert.equal(built.ok, true);
    const c = built.contract;
    assert.equal(c.worktree_isolated, true);
    assert.deepEqual(c.execution_state.mutable_paths, [wt, c.artifact_root]);
    assert.deepEqual(c.business_artifacts.read_only_paths, [repo]);
    assert.ok(CLEANUP_POLICIES.includes(c.cleanup_policy));
  });

  it("contractFromBinding maps W1 binding shape", () => {
    const binding = {
      task_id: "task-bind",
      repo_root: "/repo",
      worktree_path: "/repo/wt/task-bind",
      branch: "orch/task-bind",
      base_ref: "HEAD",
    };
    const built = contractFromBinding(binding);
    assert.equal(built.ok, true);
    assert.equal(built.contract.run_id, "task-bind");
    assert.equal(built.contract.worktree_isolated, true);
  });

  it("createIsolatedWorktree writes contract file and readRunWorkdirContract loads it", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({
      repoRoot: repo,
      taskId: "task-contract",
      primaryCwd: repo,
      cleanupPolicy: "cleanup_on_success",
    });
    assert.equal(created.ok, true);
    assert.ok(created.contract);
    assert.equal(created.contract.cleanup_policy, "cleanup_on_success");

    const read = readRunWorkdirContract(created.worktree_path);
    assert.equal(read.ok, true);
    assert.equal(read.source, "contract");
    assert.equal(read.contract.run_id, "task-contract");
    assert.ok(fs.existsSync(read.contract.artifact_root));
  });

  it("readRunWorkdirContract falls back to binding when contract file missing", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-legacy" });
    assert.equal(created.ok, true);
    const contractPath = path.join(created.worktree_path, ".claude", "run-workdir-contract.json");
    fs.unlinkSync(contractPath);

    const read = readRunWorkdirContract(created.worktree_path);
    assert.equal(read.ok, true);
    assert.equal(read.source, "binding");
    assert.equal(read.contract.run_id, "task-legacy");
    assert.ok(readWorktreeBinding(created.worktree_path));
  });

  it("resolveRunCwdFromContract uses worktree cwd when isolated", () => {
    const built = buildRunWorkdirContract({
      run_id: "t",
      repo_root: "/repo",
      worktree_path: "/repo/wt/t",
      worktree_isolated: true,
    });
    assert.equal(built.ok, true);
    assert.equal(resolveRunCwdFromContract(built.contract), "/repo/wt/t");
  });

  it("validateRunWorkdirContract rejects contract missing nested execution_state", () => {
    const built = buildRunWorkdirContract({
      run_id: "task-1",
      repo_root: "/repo",
      worktree_path: "/repo/wt/task-1",
    });
    assert.equal(built.ok, true);
    const malformed = { ...built.contract, execution_state: { run_cwd: "/repo/wt/task-1" } };
    const v = validateRunWorkdirContract(malformed);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("execution_state")));
  });

  it("readRunWorkdirContract rejects malformed on-disk contract file", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const created = createIsolatedWorktree({ repoRoot: repo, taskId: "task-bad-file" });
    assert.equal(created.ok, true);
    const contractPath = path.join(created.worktree_path, ".claude", "run-workdir-contract.json");
    fs.writeFileSync(
      contractPath,
      `${JSON.stringify({ schema_version: "1", run_id: "task-bad-file" })}\n`,
      "utf8",
    );
    const read = readRunWorkdirContract(created.worktree_path);
    assert.equal(read.ok, false);
    assert.ok(read.errors.length > 0);
    const text = formatRunWorkdirContractText(readRunWorkdirContractFile(created.worktree_path));
    assert.match(text, /invalid/);
  });

  it("createIsolatedWorktree rejects invalid cleanupPolicy before git worktree add", () => {
    const repo = initTempGitRepo();
    repos.push(repo);
    const plan = planWorktree({ repoRoot: repo, taskId: "task-bad-policy" });
    assert.equal(plan.ok, true);
    const created = createIsolatedWorktree({
      repoRoot: repo,
      taskId: "task-bad-policy",
      cleanupPolicy: "nuke_from_orbit",
    });
    assert.equal(created.ok, false);
    assert.equal(created.error, "invalid_cleanup_policy");
    assert.equal(fs.existsSync(plan.worktree_path), false);
  });

  it("formatRunWorkdirContractText includes execution vs artifact lines", () => {
    const built = buildRunWorkdirContract({
      run_id: "t",
      repo_root: "/repo",
      worktree_path: "/repo/wt/t",
    });
    const text = formatRunWorkdirContractText(built.contract);
    assert.match(text, /execution_state \(mutable\)/);
    assert.match(text, /business_artifacts \(read-only source\)/);
    assert.match(text, /repo_root \(read-only\)/);
  });
});
