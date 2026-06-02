"use strict";

/**
 * CLASSIFIED-SPAWN-COVERAGE-1 — worktree git path uses classified shell; deny-before-spawn.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resetToolActionManifestCache,
  loadToolActionManifest,
} = require("../security/action-classifiers/load-tool-action-manifest");

function initMiniGitRepo(dir) {
  delete require.cache[require.resolve("../worktree-isolation")];
  const { runGit } = require("../worktree-isolation");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  runGit(["init"], { cwd: dir, permissionProfileName: "dev-local", traceRole: "ORCHESTRATOR" });
  runGit(["config", "user.email", "t@example.com"], { cwd: dir, permissionProfileName: "dev-local", traceRole: "ORCHESTRATOR" });
  runGit(["config", "user.name", "t"], { cwd: dir, permissionProfileName: "dev-local", traceRole: "ORCHESTRATOR" });
  runGit(["add", "README.md"], { cwd: dir, permissionProfileName: "dev-local", traceRole: "ORCHESTRATOR" });
  runGit(["commit", "-m", "init"], { cwd: dir, permissionProfileName: "dev-local", traceRole: "ORCHESTRATOR" });
  return { runGit };
}

describe("classified spawn coverage — worktree runGit", () => {
  let origSpawn;
  let spawnCalls;

  beforeEach(() => {
    resetToolActionManifestCache();
    loadToolActionManifest();
    spawnCalls = 0;
    origSpawn = cp.spawnSync;
    cp.spawnSync = () => {
      spawnCalls += 1;
      return { error: null, status: 0, stdout: "", stderr: "" };
    };
  });

  afterEach(() => {
    cp.spawnSync = origSpawn;
  });

  it("spawnClassifiedSync git push does not spawn under dev-local", () => {
    const { spawnClassifiedSync } = require("../agents/runtime/run-classified-shell.js");
    assert.throws(
      () =>
        spawnClassifiedSync("git", ["push"], {
          cwd: process.cwd(),
          permissionProfileName: "dev-local",
          traceRole: "ORCHESTRATOR",
        }),
      (err) => err.code === "CLASSIFIED_SHELL_DENIED",
    );
    assert.equal(spawnCalls, 0);
  });

  it("runGit show-ref allowed via read classification (not unknown bypass)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-wt-show-ref-"));
    try {
      const { runGit } = initMiniGitRepo(tmp);
      spawnCalls = 0;
      const r = runGit(["show-ref", "--verify", "--quiet", "refs/heads/main"], {
        cwd: tmp,
        permissionProfileName: "dev-local",
        traceRole: "ORCHESTRATOR",
      });
      assert.equal(spawnCalls, 1, "allowed read must spawn once");
      assert.equal(r.ok, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runGit denies CERBERUS git domain before spawn", () => {
    delete require.cache[require.resolve("../worktree-isolation")];
    const { runGit } = require("../worktree-isolation");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-wt-git-deny-"));
    try {
      assert.throws(
        () =>
          runGit(["status"], {
            cwd: tmp,
            permissionProfileName: "dev-local",
            traceRole: "CERBERUS",
          }),
        (err) =>
          err.code === "CLASSIFIED_SHELL_DENIED"
          && err.permission_decision
          && err.permission_decision.reason_code === "role_capability_domain_denied",
      );
      assert.equal(spawnCalls, 0, "git spawn must not run on deny");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("classified spawn coverage — inventory doc", () => {
  it("subprocess-classification.md exists at docs/orchestrator", () => {
    const doc = path.join(__dirname, "../../docs/orchestrator/subprocess-classification.md");
    assert.ok(fs.existsSync(doc), "inventory doc required for audit");
    const text = fs.readFileSync(doc, "utf8");
    assert.match(text, /worktree-isolation/);
    assert.match(text, /run-claude/);
    assert.match(text, /invokeMcpDirect/);
  });
});
