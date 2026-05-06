"use strict";

/**
 * MCP permission gate: single evaluation per direct MCP call (no double permission_check),
 * and deny path records permission_check without mcp_call or python bridge.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ORCH_PATH = require.resolve("../orchestrator");

describe("MCP gate — trace parity (direct transport)", () => {
  let tmpDir;
  let savedEnv;
  let origSpawn;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-mcp-trace-"));
    savedEnv = {
      ORCH_TRACES_DIR: process.env.ORCH_TRACES_DIR,
      ORCH_MCP_TRANSPORT: process.env.ORCH_MCP_TRANSPORT,
      ORCH_PERMISSION_PROFILE: process.env.ORCH_PERMISSION_PROFILE,
      ORCH_SKIP_MCP_PERMISSION_GATE: process.env.ORCH_SKIP_MCP_PERMISSION_GATE,
    };
    process.env.ORCH_TRACES_DIR = tmpDir;
    process.env.ORCH_MCP_TRANSPORT = "direct";
    process.env.ORCH_PERMISSION_PROFILE = "dev-local";
    delete process.env.ORCH_SKIP_MCP_PERMISSION_GATE;

    origSpawn = cp.spawnSync;
    cp.spawnSync = (cmd, args, opts) => {
      const argv = [cmd, ...(Array.isArray(args) ? args : [])].map((x) => String(x));
      if (argv.some((a) => a.includes("mcp-direct.py"))) {
        return { error: null, status: 0, stdout: '{"ok":true,"task_id":"stub"}\n', stderr: "" };
      }
      return { error: null, status: 0, stdout: "\n", stderr: "" };
    };

    delete require.cache[ORCH_PATH];
  });

  afterEach(() => {
    cp.spawnSync = origSpawn;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[ORCH_PATH];
  });

  it("callStateMcp (direct): exactly one permission_check and one mcp_call", () => {
    const {
      _test_callStateMcp,
      _test_beginMcpAudit,
      _test_clearMcpAudit,
    } = require("../orchestrator");
    const taskId = "task-mcp-parity-1";
    _test_beginMcpAudit(taskId);
    const parsed = _test_callStateMcp("open_envelope", { task_id: taskId }, { cwd: tmpDir });
    assert.ok(parsed && typeof parsed === "object");
    _test_clearMcpAudit();

    const jsonlPath = path.join(tmpDir, `${taskId}.jsonl`);
    assert.ok(fs.existsSync(jsonlPath), "trace file should exist");
    const lines = fs
      .readFileSync(jsonlPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const perm = lines.filter((r) => r.event === "permission_check");
    const mcp = lines.filter((r) => r.event === "mcp_call");
    assert.equal(perm.length, 1, `permission_check count ${perm.length}`);
    assert.equal(mcp.length, 1, `mcp_call count ${mcp.length}`);
  });

  it("denied MCP: one permission_check, zero mcp_call, mcp-direct.py not spawned", () => {
    let pythonLaunches = 0;
    cp.spawnSync = (cmd, args, opts) => {
      const argv = [cmd, ...(Array.isArray(args) ? args : [])].map((x) => String(x));
      if (argv.some((a) => a.includes("mcp-direct.py"))) {
        pythonLaunches += 1;
        return { error: null, status: 0, stdout: "{}\n", stderr: "" };
      }
      return { error: null, status: 0, stdout: "\n", stderr: "" };
    };

    const { _test_invokeMcpDirect, _test_beginMcpAudit, _test_clearMcpAudit } = require("../orchestrator");
    const taskId = "task-mcp-deny-1";
    _test_beginMcpAudit(taskId);
    assert.throws(
      () => _test_invokeMcpDirect("untrusted-mcp-server-xyz", "some_tool", {}, { cwd: tmpDir }),
      (err) => err.code === "MCP_PERMISSION_DENIED"
    );
    _test_clearMcpAudit();

    assert.equal(pythonLaunches, 0);
    const jsonlPath = path.join(tmpDir, `${taskId}.jsonl`);
    assert.ok(fs.existsSync(jsonlPath));
    const lines = fs
      .readFileSync(jsonlPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.equal(lines.filter((r) => r.event === "permission_check").length, 1);
    assert.equal(lines.filter((r) => r.event === "mcp_call").length, 0);
  });
});
