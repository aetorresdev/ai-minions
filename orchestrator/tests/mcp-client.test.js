"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateMcpUsage,
  parseMcpDirectStdout,
  sanitizeOrchestratorStateArgs,
  normalizeCompactHandoffResult,
  beginMcpAudit,
  clearMcpAudit,
  getMcpAuditCalls,
} = require("../mcp-client");

describe("mcp-client — characterization", () => {
  it("aggregateMcpUsage rolls up calls", () => {
    const calls = [
      { server: "orchestrator-state", tool: "open_envelope", transport: "direct", duration_ms: 10, ok: true },
      { server: "orchestrator-state", tool: "open_envelope", transport: "direct", duration_ms: 12, ok: false },
    ];
    const s = aggregateMcpUsage(calls);
    assert.equal(s.mcp_total_calls, 2);
    assert.equal(s.mcp_failed_calls, 1);
    assert.equal(s.mcp_by_tool["orchestrator-state.open_envelope"], 2);
    assert.equal(s.mcp_by_transport.direct, 2);
  });

  it("parseMcpDirectStdout parses JSON object or last JSON line", () => {
    assert.deepEqual(parseMcpDirectStdout('{"ok":true}'), { ok: true });
    assert.deepEqual(
      parseMcpDirectStdout("log line\n{\"task_id\":\"t1\"}\n"),
      { task_id: "t1" },
    );
    assert.equal(parseMcpDirectStdout("handoff_yaml: |\n  x"), "handoff_yaml: |\n  x");
  });

  it("sanitizeOrchestratorStateArgs strips register_task contract_version", () => {
    const out = sanitizeOrchestratorStateArgs("register_task", {
      task_id: "t1",
      contract_version: "v9",
      goal: "g",
    });
    assert.equal(out.task_id, "t1");
    assert.equal(out.goal, "g");
    assert.equal(out.contract_version, undefined);
  });

  it("sanitizeOrchestratorStateArgs maps record_artifact fields", () => {
    const out = sanitizeOrchestratorStateArgs("record_artifact", {
      task_id: "t1",
      artifact_id: "summary.md",
      content: "note body",
    });
    assert.deepEqual(out, { task_id: "t1", path: "summary.md", note: "note body" });
  });

  it("normalizeCompactHandoffResult accepts YAML string and structured JSON", () => {
    const fromStr = normalizeCompactHandoffResult("files_modified:\n  - a.js\n");
    assert.match(fromStr.yaml, /files_modified/);
    const fromObj = normalizeCompactHandoffResult({
      handoff_yaml: "verdict: pass\n",
      ollama_prompt_tokens: 3,
      ollama_completion_tokens: 7,
    });
    assert.equal(fromObj.yaml, "verdict: pass");
    assert.equal(fromObj.ollama_prompt_tokens, 3);
    assert.equal(fromObj.ollama_completion_tokens, 7);
  });

  it("beginMcpAudit resets audit call buffer", () => {
    beginMcpAudit("audit-task-1");
    assert.deepEqual(getMcpAuditCalls(), []);
    clearMcpAudit();
  });

  it("orchestrator re-exports MCP client surface", () => {
    const orch = require("../orchestrator");
    const mcp = require("../mcp-client");
    assert.equal(orch.aggregateMcpUsage, mcp.aggregateMcpUsage);
    assert.equal(orch.emitPermissionCheckTrace, mcp.emitPermissionCheckTrace);
    assert.equal(orch._test_invokeMcpDirect, mcp.invokeMcpDirect);
    assert.equal(orch._test_callStateMcp, mcp.callStateMcp);
    assert.equal(orch._test_callCompactHandoff, mcp.callCompactHandoff);
    assert.equal(orch._test_beginMcpAudit, mcp.beginMcpAudit);
    assert.equal(orch._test_clearMcpAudit, mcp.clearMcpAudit);
  });
});
