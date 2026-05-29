"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDomainAllowedForCapabilityContext,
  normalizeModeKey,
  isClaudeCliTransportAllowedForRole,
} = require("../security/trace-role-capability");
const { runClaudeCliPermissionGate } = require("../security/claude-cli-shell-gate");
const { runNetworkPermissionGate } = require("../security/network-permission-gate");
const { runMcpPermissionGate } = require("../security/mcp-permission-gate");

describe("trace-role-capability (SEC-NET-R3)", () => {
  it("normalizeModeKey defaults empty to ORCHESTRATOR", () => {
    assert.equal(normalizeModeKey(""), "ORCHESTRATOR");
    assert.equal(normalizeModeKey("dev"), "DEV");
  });

  it("agentId cerberus allows network for local Ollama (local-only alignment)", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "CERBERUS",
      agentId: "cerberus",
      domain: "network",
    });
    assert.equal(r.ok, true);
  });

  it("agentId qa allows local_model for Ollama routing", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "QA",
      agentId: "qa",
      domain: "local_model",
    });
    assert.equal(r.ok, true);
  });

  it("agentId cerberus denies mcp domain", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "QA",
      agentId: "cerberus",
      domain: "mcp",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason_code, "role_capability_domain_denied");
  });

  it("agentId dev-backend allows filesystem", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "DEV",
      agentId: "dev-backend",
      domain: "filesystem",
    });
    assert.equal(r.ok, true);
  });

  it("MODE DEV union allows git if any dev role has git", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "DEV",
      agentId: null,
      domain: "git",
    });
    assert.equal(r.ok, true);
  });

  it("MODE CERBERUS denies git (cerberus matrix has no git)", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "CERBERUS",
      agentId: null,
      domain: "git",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason_code, "role_capability_domain_denied");
  });

  it("isClaudeCliTransportAllowedForRole uses remote_model OR shell", () => {
    assert.equal(isClaudeCliTransportAllowedForRole({ traceRole: "QA", agentId: "qa" }).ok, true);
    assert.equal(
      isClaudeCliTransportAllowedForRole({ traceRole: "ORCHESTRATOR", agentId: "summarizer" }).ok,
      false,
    );
  });

  it("unknown agent id fails closed", () => {
    const r = isDomainAllowedForCapabilityContext({
      traceRole: "DEV",
      agentId: "ghost-agent",
      domain: "filesystem",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason_code, "role_capability_unknown_agent_id");
  });
});

describe("gates — role capability precheck", () => {
  it("runClaudeCliPermissionGate denies Claude transport for summarizer (no remote_model/shell)", () => {
    const gate = runClaudeCliPermissionGate({
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
      role: "ORCHESTRATOR",
      agentId: "summarizer",
      actor: "orchestrator",
    });
    assert.equal(gate.output.decision, "deny");
    assert.equal(gate.output.reason_code, "role_capability_domain_denied");
  });

  it("runNetworkPermissionGate allows Ollama for cerberus agentId under dev-local", () => {
    const gate = runNetworkPermissionGate({
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
      role: "CERBERUS",
      agentId: "cerberus",
      actor: "orchestrator",
      hostname: "127.0.0.1",
      port: 11434,
      tool: "ollama_chat",
      pathLabel: "/api/chat",
    });
    assert.equal(gate.output.decision, "allow");
    assert.equal(gate.output.reason_code, "network_allowlist_allowed");
  });

  it("runNetworkPermissionGate allows Ollama for qa agentId under dev-local", () => {
    const gate = runNetworkPermissionGate({
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
      role: "QA",
      agentId: "qa",
      actor: "orchestrator",
      hostname: "localhost",
      port: 11434,
      tool: "ollama_chat",
      pathLabel: "/api/chat",
    });
    assert.equal(gate.output.decision, "allow");
  });

  it("runMcpPermissionGate denies mcp when agentId cerberus", () => {
    const gate = runMcpPermissionGate({
      server: "compact-handoff",
      tool: "compact_handoff",
      repoRoot: "/tmp",
      permissionProfileName: "dev-local",
      agentId: "cerberus",
      role: "CERBERUS",
    });
    assert.equal(gate.output.decision, "deny");
    assert.equal(gate.output.reason_code, "role_capability_domain_denied");
  });

  it("ORCH_SKIP_ROLE_CAPABILITY_GATE=1 skips matrix deny for cerberus+mcp", () => {
    const prev = process.env.ORCH_SKIP_ROLE_CAPABILITY_GATE;
    process.env.ORCH_SKIP_ROLE_CAPABILITY_GATE = "1";
    try {
      const gate = runMcpPermissionGate({
        server: "compact-handoff",
        tool: "compact_handoff",
        repoRoot: "/tmp",
        permissionProfileName: "dev-local",
        agentId: "cerberus",
        role: "CERBERUS",
      });
      assert.equal(gate.output.decision, "allow");
    } finally {
      if (prev === undefined) delete process.env.ORCH_SKIP_ROLE_CAPABILITY_GATE;
      else process.env.ORCH_SKIP_ROLE_CAPABILITY_GATE = prev;
    }
  });
});
