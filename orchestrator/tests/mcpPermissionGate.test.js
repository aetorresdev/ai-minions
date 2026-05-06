"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { runMcpPermissionGate } = require("../security/mcp-permission-gate");

describe("mcp-permission-gate", () => {
  let saved;

  beforeEach(() => {
    saved = {
      ORCH_PERMISSION_PROFILE: process.env.ORCH_PERMISSION_PROFILE,
      ORCH_MCP_DECLARED_SERVERS: process.env.ORCH_MCP_DECLARED_SERVERS,
      ORCH_CI_MCP_CONFIGURED: process.env.ORCH_CI_MCP_CONFIGURED,
      CI: process.env.CI,
    };
    delete process.env.ORCH_PERMISSION_PROFILE;
    delete process.env.ORCH_MCP_DECLARED_SERVERS;
    delete process.env.ORCH_CI_MCP_CONFIGURED;
    delete process.env.CI;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("allows built-in orchestrator MCP under dev-local", () => {
    const r = runMcpPermissionGate({
      server: "compact-handoff",
      tool: "compact_handoff",
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
    });
    assert.equal(r.output.decision, "allow");
    assert.equal(r.trust_level, "local_declared");
    assert.equal(r.tracePayload.event, "permission_check");
  });

  it("denies undeclared MCP server under dev-local (runtime_discovered)", () => {
    const r = runMcpPermissionGate({
      server: "unknown-custom-mcp",
      tool: "some_tool",
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
    });
    assert.equal(r.output.decision, "deny");
    assert.equal(r.output.reason_code, "mcp_trust_warn_deny");
  });

  it("allows extra server id when listed in ORCH_MCP_DECLARED_SERVERS", () => {
    process.env.ORCH_MCP_DECLARED_SERVERS = "my-mcp,other";
    const r = runMcpPermissionGate({
      server: "my-mcp",
      tool: "t",
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
    });
    assert.equal(r.output.decision, "allow");
    assert.equal(r.trust_level, "local_declared");
  });
});
