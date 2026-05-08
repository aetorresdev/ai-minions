"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePermission } = require("../security/evaluate-permission");
const { classifyTarget } = require("../security/classify-target");
const { traceSecurityDecision } = require("../security/trace-security-decision");
const { loadPermissionConfig, resolveProfile } = require("../security/load-permission-config");

function baseInput(profileName, overrides = {}) {
  const cfg = loadPermissionConfig();
  const profile = resolveProfile(profileName, cfg.profiles);
  return {
    actor: "local",
    role: "DEV",
    tool: "tool",
    action: "",
    capability: null,
    action_class: "read",
    target_class: null,
    domain: "filesystem",
    permission_profile: profileName,
    policy_source: "built_in_profile",
    profile,
    ...overrides,
  };
}

describe("evaluate-permission — filesystem / dev-local", () => {
  it("allows read / simulate / validate → read_or_simulate_allowed", () => {
    for (const ac of ["read", "simulate", "validate"]) {
      const r = evaluatePermission(baseInput("dev-local", { action_class: ac }));
      assert.equal(r.decision, "allow");
      assert.equal(r.reason_code, "read_or_simulate_allowed");
      assert.equal(r.safe_to_continue, true);
      assert.equal(r.permission_profile, "dev-local");
      assert.equal(r.policy_source, "built_in_profile");
    }
  });

  it("allows write_local_repo when profile allows", () => {
    const r = evaluatePermission(baseInput("dev-local", { action_class: "write_local_repo" }));
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "read_or_simulate_allowed");
  });

  it("requires approval for write_external_state", () => {
    const r = evaluatePermission(baseInput("dev-local", { action_class: "write_external_state" }));
    assert.equal(r.decision, "requires_approval");
    assert.equal(r.reason_code, "write_external_state_requires_allow");
    assert.equal(r.requires_approval, true);
    assert.equal(r.safe_to_continue, false);
  });

  it("requires approval for ambiguous_write when profile requires_classification", () => {
    const r = evaluatePermission(baseInput("dev-local", { action_class: "ambiguous_write" }));
    assert.equal(r.decision, "requires_approval");
    assert.equal(r.reason_code, "ambiguous_write_requires_target_classification");
  });

  it("denies destructive when profile denies", () => {
    const r = evaluatePermission(baseInput("dev-local", { action_class: "destructive" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "destructive_action_denied");
  });

  it("denies unknown action_class", () => {
    const r = evaluatePermission(baseInput("dev-local", { action_class: "unknown" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "unknown_action_class_denied");
  });
});

describe("evaluate-permission — credentials", () => {
  it("denies credential_export and credential_reveal when profile denies", () => {
    for (const ac of ["credential_export", "credential_reveal"]) {
      const r = evaluatePermission(
        baseInput("dev-local", { domain: "filesystem", action_class: ac })
      );
      assert.equal(r.decision, "deny");
      assert.equal(r.reason_code, "credential_export_denied");
    }
  });
});

describe("evaluate-permission — shell", () => {
  it("claude CLI orchestrator spawn allows when remote_model is allow (SEC-NET-R1-B2)", () => {
    const r = evaluatePermission(
      baseInput("dev-local", {
        domain: "shell",
        action_class: "external_side_effect",
        tool: "claude_cli",
        precheck: { orchestrator_shell_spawn: "claude_cli" },
      }),
    );
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "shell_claude_cli_remote_model_allow");
  });

  it("claude CLI spawn denies when remote_model is deny", () => {
    const cfg = loadPermissionConfig();
    const p = resolveProfile("dev-local", cfg.profiles);
    const r = evaluatePermission(
      baseInput("dev-local", {
        domain: "shell",
        action_class: "external_side_effect",
        tool: "claude_cli",
        precheck: { orchestrator_shell_spawn: "claude_cli" },
        profile: {
          ...p,
          domains: {
            ...p.domains,
            remote_model: "deny",
          },
        },
      }),
    );
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "shell_claude_cli_remote_model_denied");
  });

  it("dev-local shell requires approval", () => {
    const r = evaluatePermission(baseInput("dev-local", { domain: "shell", action_class: "external_side_effect" }));
    assert.equal(r.decision, "requires_approval");
    assert.equal(r.reason_code, "external_side_effect_requires_allow");
  });

  it("ci-safe shell denies", () => {
    const r = evaluatePermission(baseInput("ci-safe", { domain: "shell", action_class: "read" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "unknown_external_target_denied");
  });
});

describe("evaluate-permission — git read_only", () => {
  it("denies mutating git actions on read_only profile", () => {
    const r = evaluatePermission(baseInput("prod-guarded", { domain: "git", action_class: "write_local_repo" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "unknown_external_target_denied");
  });
});

describe("evaluate-permission — ci-safe filesystem external_side_effect", () => {
  it("denies external_side_effect", () => {
    const r = evaluatePermission(baseInput("ci-safe", { action_class: "external_side_effect" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "unknown_external_target_denied");
  });
});

describe("evaluate-permission — mcp domain", () => {
  function mcpInput(profileName, precheck, overrides = {}) {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile(profileName, cfg.profiles);
    return {
      actor: "local",
      role: "DEV",
      tool: "server.tool",
      action_class: "external_side_effect",
      domain: "mcp",
      permission_profile: profileName,
      policy_source: "built_in_profile",
      profile,
      precheck,
      ...overrides,
    };
  }

  it("dev-local allows local_declared", () => {
    const r = evaluatePermission(mcpInput("dev-local", { mcp_trust_level: "local_declared" }));
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "mcp_trust_allow");
    assert.equal(r.safe_to_continue, true);
  });

  it("dev-local deny runtime_discovered maps warn_deny", () => {
    const r = evaluatePermission(mcpInput("dev-local", { mcp_trust_level: "runtime_discovered" }));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "mcp_trust_warn_deny");
  });

  it("ci-safe local_declared requires CI configuration", () => {
    const ok = evaluatePermission(
      mcpInput("ci-safe", { mcp_trust_level: "local_declared", ci_mcp_configured: true })
    );
    assert.equal(ok.decision, "allow");
    assert.equal(ok.reason_code, "mcp_ci_configured_allow");

    const bad = evaluatePermission(
      mcpInput("ci-safe", { mcp_trust_level: "local_declared", ci_mcp_configured: false })
    );
    assert.equal(bad.decision, "deny");
    assert.equal(bad.reason_code, "mcp_ci_not_configured_denied");
  });
});

describe("evaluate-permission — network domain (SEC-NET-R1-B3)", () => {
  function netInput(profileName, hostname, port, overrides = {}) {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile(profileName, cfg.profiles);
    return {
      actor: "local",
      role: "DEV",
      tool: "http_egress",
      action_class: "read",
      domain: "network",
      permission_profile: profileName,
      policy_source: "built_in_profile",
      profile,
      precheck: { network_hostname: hostname, network_port: port },
      ...overrides,
    };
  }

  it("dev-local allows localhost:11434 via allow_hosts", () => {
    const r = evaluatePermission(netInput("dev-local", "localhost", 11434));
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "network_allowlist_allowed");
  });

  it("dev-local allows localhost with port via host-only allow entry", () => {
    const r = evaluatePermission(netInput("dev-local", "127.0.0.1", 11434));
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "network_allowlist_allowed");
  });

  it("dev-local denies non-allowlisted host", () => {
    const r = evaluatePermission(netInput("dev-local", "evil.example", 443));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "network_host_denied");
  });

  it("ci-safe denies localhost (empty allow_hosts)", () => {
    const r = evaluatePermission(netInput("ci-safe", "localhost", 11434));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "network_host_denied");
  });

  it("denies when network_hostname missing", () => {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile("dev-local", cfg.profiles);
    const r = evaluatePermission({
      actor: "x",
      role: "DEV",
      tool: "http_egress",
      action_class: "read",
      domain: "network",
      permission_profile: "dev-local",
      policy_source: "built_in_profile",
      profile,
      precheck: {},
    });
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "network_precheck_missing_host");
  });

  it("denies invalid port in precheck", () => {
    const r = evaluatePermission(netInput("dev-local", "localhost", 999999));
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "network_precheck_invalid_port");
  });
});

describe("evaluate-permission — context_retrieval domain", () => {
  it("dev-local allows context_retrieval", () => {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile("dev-local", cfg.profiles);
    const r = evaluatePermission({
      actor: "x",
      role: "DEV",
      tool: "retrieval",
      action_class: "read",
      domain: "context_retrieval",
      permission_profile: "dev-local",
      policy_source: "built_in_profile",
      profile,
    });
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "context_retrieval_allowed");
  });

  it("ci-safe warn_only maps to allow with warn reason", () => {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile("ci-safe", cfg.profiles);
    const r = evaluatePermission({
      actor: "x",
      role: "DEV",
      tool: "retrieval",
      action_class: "read",
      domain: "context_retrieval",
      permission_profile: "ci-safe",
      policy_source: "built_in_profile",
      profile,
    });
    assert.equal(r.decision, "allow");
    assert.equal(r.reason_code, "context_retrieval_warn_only_allowed");
  });
});

describe("evaluate-permission — precheck reason codes", () => {
  it("declared_local_capability_allowed", () => {
    const r = evaluatePermission(
      baseInput("dev-local", {
        precheck: { declared_local_capability: true },
        action_class: "read",
      })
    );
    assert.equal(r.reason_code, "declared_local_capability_allowed");
    assert.equal(r.decision, "allow");
  });

  it("declared_docs_category_allowed", () => {
    const r = evaluatePermission(
      baseInput("dev-local", {
        precheck: { declared_docs_category: true },
        action_class: "read",
      })
    );
    assert.equal(r.reason_code, "declared_docs_category_allowed");
  });
});

describe("evaluate-permission — malformed policy", () => {
  it("fails safe when profile missing domains", () => {
    const r = evaluatePermission({
      actor: "x",
      role: "DEV",
      tool: "t",
      action_class: "read",
      domain: "filesystem",
      permission_profile: "dev-local",
      policy_source: "built_in_profile",
      profile: {},
    });
    assert.equal(r.decision, "deny");
    assert.equal(r.reason_code, "malformed_policy_fail_safe");
  });
});

describe("classify-target + trace-security-decision", () => {
  it("classifyTarget normalizes objects with target_class", () => {
    const r = classifyTarget({ target_class: "cloud_infra", path: "/x" });
    assert.equal(r.target_class, "cloud_infra");
  });

  it("traceSecurityDecision carries audit fields", () => {
    const input = baseInput("dev-local", { action_class: "read" });
    const out = evaluatePermission(input);
    const tr = traceSecurityDecision(input, out);
    assert.equal(tr.event, "permission_check");
    assert.equal(tr.permission_profile, "dev-local");
    assert.equal(tr.reason_code, out.reason_code);
    assert.equal(tr.requires_approval, out.requires_approval);
  });

  it("traceSecurityDecision omits raw action/target payloads (no credential leakage)", () => {
    const input = baseInput("dev-local", {
      action_class: "read",
      action: "SECRET_TOKEN=abc terraform apply",
      target: { url: "https://evil.example/?token=supersecret" },
    });
    const out = evaluatePermission(input);
    const tr = traceSecurityDecision(input, out);
    assert.equal("action" in tr, false);
    assert.equal("target" in tr, false);
    assert.equal("precheck" in tr, false);
    assert.equal(tr.tool, "tool");
  });
});
