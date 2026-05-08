"use strict";

/**
 * Claude CLI shell gate: permission_check emitted when MCP audit task id is active.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

describe("Claude CLI shell gate — trace", () => {
  let tmpDir;
  let savedEnv;
  let origSpawn;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cli-shell-"));
    savedEnv = {
      ORCH_TRACES_DIR: process.env.ORCH_TRACES_DIR,
      ORCH_SKIP_SHELL_PERMISSION_GATE: process.env.ORCH_SKIP_SHELL_PERMISSION_GATE,
      ORCH_PERMISSION_PROFILE: process.env.ORCH_PERMISSION_PROFILE,
    };
    process.env.ORCH_TRACES_DIR = tmpDir;
    process.env.ORCH_PERMISSION_PROFILE = "dev-local";
    delete process.env.ORCH_SKIP_SHELL_PERMISSION_GATE;

    origSpawn = cp.spawnSync;
    cp.spawnSync = () => ({
      error: null,
      status: 0,
      stdout: "stub-claude-output",
      stderr: "",
    });
  });

  afterEach(() => {
    cp.spawnSync = origSpawn;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runClaude emits permission_check when audit task id active", () => {
    const { _test_beginMcpAudit, _test_clearMcpAudit } = require("../orchestrator.js");
    const { runClaude } = require("../agents/runtime/run-claude.js");

    const taskId = "task-cli-shell-1";
    _test_beginMcpAudit(taskId);

    runClaude("hello", { cwd: tmpDir, traceRole: "DEV" });

    _test_clearMcpAudit();

    const jsonlPath = path.join(tmpDir, `${taskId}.jsonl`);
    assert.ok(fs.existsSync(jsonlPath));
    const lines = fs
      .readFileSync(jsonlPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const gateLine = lines.find((r) => r.event === "permission_check" && r.tool === "claude_cli");
    assert.ok(gateLine, "expected claude_cli permission_check line");
    assert.equal(gateLine.permission_profile, "dev-local");
    assert.equal(gateLine.domain, "shell");
    assert.equal(gateLine.reason_code, "shell_claude_cli_remote_model_allow");
    assert.equal(gateLine.role, "DEV");
  });
});
