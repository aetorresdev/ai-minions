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
