"use strict";

/**
 * Pure permission evaluator: structured input → decision envelope.
 * No I/O, no side effects. Caller supplies the resolved profile object.
 *
 * Optional input.precheck:
 * - declared_local_capability: true → short-circuit allow (caller validated against catalog)
 * - declared_docs_category: true → short-circuit allow (caller validated docs category)
 * - network_hostname + optional network_port → host allow-list match (`domains.network`)
 */

const READ_SIMULATE_LIKE = new Set(["read", "validate", "simulate", "generate"]);

/**
 * HTTP client "host" values sometimes use `0.0.0.0` (e.g. OLLAMA_HOST in CI/Docker) to mean the local
 * Ollama listener. For allow-list matching against loopback entries, treat as 127.0.0.1 — not a wider egress allow.
 * @param {string} hostname — trim + lower
 * @returns {string}
 */
function normalizeClientHostnameForNetworkPolicy(hostname) {
  const h = String(hostname).trim().toLowerCase();
  if (h === "0.0.0.0") return "127.0.0.1";
  return h;
}

/**
 * Parse `host` or `host:port` allow-list entry (IPv4 / hostname only; IPv6 not supported).
 * @param {unknown} entry
 * @returns {{ host: string, port: number | null }}
 */
function parseAllowHostEntry(entry) {
  const s = String(entry).trim().toLowerCase();
  const m = s.match(/^(.+):(\d+)$/);
  if (m) {
    const p = parseInt(m[2], 10);
    if (Number.isFinite(p)) return { host: m[1], port: p };
  }
  return { host: s, port: null };
}

/**
 * @param {string} hostname — normalized (trim + lower)
 * @param {number | null} port — null = unknown port (fail closed for allow-list-only profiles)
 * @param {unknown[]} allowHosts
 */
function networkHostMatchesAllowlist(hostname, port, allowHosts) {
  if (!Array.isArray(allowHosts)) return false;
  const hn = String(hostname).trim().toLowerCase();
  for (const raw of allowHosts) {
    const { host, port: entryPort } = parseAllowHostEntry(raw);
    if (host !== hn) continue;
    if (entryPort === null) return true;
    if (port != null && Number.isFinite(port) && entryPort === port) return true;
  }
  return false;
}

function evaluateNetwork(profile, input) {
  const net = profile.domains.network;
  if (typeof net !== "object" || net == null) {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "malformed_policy_fail_safe",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  const pc = input.precheck || {};
  const hostRaw = pc.network_hostname;
  if (hostRaw == null || String(hostRaw).trim() === "") {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "network_precheck_missing_host",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  const hostname = normalizeClientHostnameForNetworkPolicy(String(hostRaw).trim().toLowerCase());
  let port = null;
  if (pc.network_port !== undefined && pc.network_port !== null && pc.network_port !== "") {
    const n = Number(pc.network_port);
    if (!Number.isFinite(n) || n < 0 || n > 65535) {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "network_precheck_invalid_port",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
    port = n;
  }

  const allowHosts = Array.isArray(net.allow_hosts) ? net.allow_hosts : [];
  if (networkHostMatchesAllowlist(hostname, port, allowHosts)) {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "network_allowlist_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }

  const def = net.default;
  if (def === "allow") {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "network_default_allow",
      requires_approval: false,
      safe_to_continue: true,
    });
  }
  if (def === "approval_required") {
    return baseEnvelope(input, {
      decision: "requires_approval",
      reason_code: "network_egress_requires_allow",
      requires_approval: true,
      safe_to_continue: false,
    });
  }

  return baseEnvelope(input, {
    decision: "deny",
    reason_code: "network_host_denied",
    requires_approval: false,
    safe_to_continue: false,
  });
}

function evaluateContextRetrieval(profile, input) {
  const cr = profile.domains.context_retrieval;
  if (typeof cr !== "object" || cr == null) {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "malformed_policy_fail_safe",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  const d = cr.default;
  if (d === "allow") {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "context_retrieval_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }
  if (d === "warn_only") {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "context_retrieval_warn_only_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }
  if (d === "deny") {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "context_retrieval_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  if (d === "approval_required") {
    return baseEnvelope(input, {
      decision: "requires_approval",
      reason_code: "context_retrieval_requires_allow",
      requires_approval: true,
      safe_to_continue: false,
    });
  }
  return baseEnvelope(input, {
    decision: "deny",
    reason_code: "malformed_policy_fail_safe",
    requires_approval: false,
    safe_to_continue: false,
  });
}

function baseEnvelope(input, partial) {
  return {
    decision: partial.decision,
    reason_code: partial.reason_code,
    action_class: input.action_class,
    target_class: input.target_class != null ? input.target_class : null,
    policy_source: input.policy_source,
    permission_profile: input.permission_profile,
    requires_approval: partial.requires_approval,
    safe_to_continue: partial.safe_to_continue,
  };
}

function evaluateFilesystem(profile, input) {
  const fs = profile.domains.filesystem;
  const action_class = input.action_class;

  if (typeof fs !== "object" || fs == null) {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "malformed_policy_fail_safe",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  if (action_class === "unknown") {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "unknown_action_class_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  if (action_class === "destructive") {
    if (fs.destructive === "deny") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "destructive_action_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
  }

  if (READ_SIMULATE_LIKE.has(action_class)) {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "read_or_simulate_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }

  const wc = fs.write_classes || {};
  const wcKeys = [
    "write_local_repo",
    "write_draft",
    "write_external_state",
    "external_side_effect",
    "ambiguous_write",
  ];

  if (action_class === "ambiguous_write" || action_class === "write") {
    const rule = wc.ambiguous_write;
    if (rule === "requires_classification" || rule === "requires_approval") {
      return baseEnvelope(input, {
        decision: "requires_approval",
        reason_code: "ambiguous_write_requires_target_classification",
        requires_approval: true,
        safe_to_continue: false,
      });
    }
    if (rule === "deny") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
  }

  if (wcKeys.includes(action_class) || action_class === "execute") {
    const key = action_class === "execute" ? "external_side_effect" : action_class;
    const rule = wc[key];
    if (rule === "allow") {
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "read_or_simulate_allowed",
        requires_approval: false,
        safe_to_continue: true,
      });
    }
    if (rule === "approval_required") {
      const rc =
        key === "write_external_state"
          ? "write_external_state_requires_allow"
          : "external_side_effect_requires_allow";
      return baseEnvelope(input, {
        decision: "requires_approval",
        reason_code: rc,
        requires_approval: true,
        safe_to_continue: false,
      });
    }
    if (rule === "deny") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
    if (rule === "requires_classification") {
      return baseEnvelope(input, {
        decision: "requires_approval",
        reason_code: "ambiguous_write_requires_target_classification",
        requires_approval: true,
        safe_to_continue: false,
      });
    }
  }

  return baseEnvelope(input, {
    decision: "deny",
    reason_code: "unknown_action_class_denied",
    requires_approval: false,
    safe_to_continue: false,
  });
}

function evaluateShell(profile, input) {
  const pc = input.precheck || {};
  /**
   * Orchestrator spawn of `claude` CLI as LLM transport (agents.js runClaude).
   * Governed by **remote_model** (Anthropic API via CLI), not raw `shell` approval_required,
   * so normal dev-local runs are not blocked while profiles still express shell restrictions
   * for future arbitrary shell execution.
   */
  if (pc.orchestrator_shell_spawn === "claude_cli") {
    const rm = profile.domains && profile.domains.remote_model;
    if (rm === "allow") {
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "shell_claude_cli_remote_model_allow",
        requires_approval: false,
        safe_to_continue: true,
      });
    }
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "shell_claude_cli_remote_model_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  const dom = profile.domains.shell;
  if (dom === "approval_required") {
    return baseEnvelope(input, {
      decision: "requires_approval",
      reason_code: "external_side_effect_requires_allow",
      requires_approval: true,
      safe_to_continue: false,
    });
  }
  if (dom === "deny") {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "unknown_external_target_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  return baseEnvelope(input, {
    decision: "allow",
    reason_code: "read_or_simulate_allowed",
    requires_approval: false,
    safe_to_continue: true,
  });
}

function evaluateGit(profile, input) {
  const dom = profile.domains.git;
  const ac = input.action_class;
  if (dom === "read_only") {
    if (ac === "write_local_repo" || ac === "destructive" || ac === "external_side_effect") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
    if (READ_SIMULATE_LIKE.has(ac) || ac === "read") {
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "read_or_simulate_allowed",
        requires_approval: false,
        safe_to_continue: true,
      });
    }
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "unknown_external_target_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  if (dom === "read_write") {
    if (READ_SIMULATE_LIKE.has(ac) || ac === "read") {
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "read_or_simulate_allowed",
        requires_approval: false,
        safe_to_continue: true,
      });
    }
    if (ac === "write_local_repo") {
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "read_or_simulate_allowed",
        requires_approval: false,
        safe_to_continue: true,
      });
    }
    if (ac === "external_side_effect") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
    if (ac === "destructive") {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "destructive_action_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "unknown_action_class_denied",
      requires_approval: false,
      safe_to_continue: false,
    });
  }
  return baseEnvelope(input, {
    decision: "deny",
    reason_code: "malformed_policy_fail_safe",
    requires_approval: false,
    safe_to_continue: false,
  });
}

const MCP_TRUST_LEVELS = new Set(["local_declared", "remote_declared", "runtime_discovered", "unknown"]);

/**
 * MCP domain: trust_policy maps trust levels to rule keywords from permission profiles.
 * Caller supplies `precheck.mcp_trust_level` and optional `precheck.ci_mcp_configured`.
 */
function evaluateMcp(profile, input) {
  const mcp = profile.domains && profile.domains.mcp;
  if (typeof mcp !== "object" || mcp == null || typeof mcp.trust_policy !== "object" || mcp.trust_policy == null) {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "malformed_policy_fail_safe",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  const pc = input.precheck || {};
  const level =
    typeof pc.mcp_trust_level === "string" && MCP_TRUST_LEVELS.has(pc.mcp_trust_level)
      ? pc.mcp_trust_level
      : "unknown";

  const tp = mcp.trust_policy;
  const ruleRaw =
    typeof tp[level] === "string" ? tp[level] : typeof tp.unknown === "string" ? tp.unknown : "deny";

  return mapMcpTrustRule(ruleRaw, input, pc);
}

function mapMcpTrustRule(rule, input, pc) {
  switch (rule) {
    case "allow":
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "mcp_trust_allow",
        requires_approval: false,
        safe_to_continue: true,
      });
    case "deny":
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "mcp_trust_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    case "warn_allow":
      return baseEnvelope(input, {
        decision: "allow",
        reason_code: "mcp_trust_warn_allow",
        requires_approval: false,
        safe_to_continue: true,
      });
    case "warn_deny":
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "mcp_trust_warn_deny",
        requires_approval: false,
        safe_to_continue: false,
      });
    case "approval_required":
      return baseEnvelope(input, {
        decision: "requires_approval",
        reason_code: "external_side_effect_requires_allow",
        requires_approval: true,
        safe_to_continue: false,
      });
    case "allow_if_ci_configured":
      if (pc && pc.ci_mcp_configured === true) {
        return baseEnvelope(input, {
          decision: "allow",
          reason_code: "mcp_ci_configured_allow",
          requires_approval: false,
          safe_to_continue: true,
        });
      }
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "mcp_ci_not_configured_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    default:
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
  }
}

function evaluateCredential(profile, input) {
  const ac = input.action_class;
  if (ac === "credential_export" || ac === "credential_reveal") {
    const denyExport = profile.credential_export === "deny";
    const denyReveal = profile.credential_reveal === "deny";
    if ((ac === "credential_export" && denyExport) || (ac === "credential_reveal" && denyReveal)) {
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "credential_export_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
    }
  }
  return baseEnvelope(input, {
    decision: "requires_approval",
    reason_code: "external_side_effect_requires_allow",
    requires_approval: true,
    safe_to_continue: false,
  });
}

/**
 * @param {object} input
 * @param {string} input.actor
 * @param {string} input.role
 * @param {string} input.tool
 * @param {string} [input.action]
 * @param {unknown} [input.target]
 * @param {string | null} [input.capability]
 * @param {string} input.action_class
 * @param {string | null} [input.target_class]
 * @param {string} input.domain — capability-matrix domain key
 * @param {string} input.permission_profile
 * @param {string} input.policy_source
 * @param {object} input.profile — resolved profile object (domains, credential_* )
 * @param {object} [input.precheck]
 */
function evaluatePermission(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("evaluatePermission: input required");
  }
  const required = [
    "actor",
    "role",
    "tool",
    "action_class",
    "domain",
    "permission_profile",
    "policy_source",
    "profile",
  ];
  for (const k of required) {
    if (k === "tool") continue;
    if (input[k] === undefined || input[k] === null) {
      throw new TypeError(`evaluatePermission: missing ${k}`);
    }
  }
  if (input.tool === undefined || input.tool === null) {
    input.tool = "";
  }

  if (!input.profile.domains) {
    return baseEnvelope(input, {
      decision: "deny",
      reason_code: "malformed_policy_fail_safe",
      requires_approval: false,
      safe_to_continue: false,
    });
  }

  const pc = input.precheck || {};
  if (pc.declared_local_capability === true) {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "declared_local_capability_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }
  if (pc.declared_docs_category === true) {
    return baseEnvelope(input, {
      decision: "allow",
      reason_code: "declared_docs_category_allowed",
      requires_approval: false,
      safe_to_continue: true,
    });
  }

  const ac = input.action_class;

  if (ac === "credential_export" || ac === "credential_reveal" || ac === "credential_use") {
    return evaluateCredential(input.profile, input);
  }

  switch (input.domain) {
    case "filesystem":
      return evaluateFilesystem(input.profile, input);
    case "shell":
      return evaluateShell(input.profile, input);
    case "git":
      return evaluateGit(input.profile, input);
    case "mcp":
      return evaluateMcp(input.profile, input);
    case "network":
      return evaluateNetwork(input.profile, input);
    case "context_retrieval":
      return evaluateContextRetrieval(input.profile, input);
    default:
      return baseEnvelope(input, {
        decision: "deny",
        reason_code: "unknown_external_target_denied",
        requires_approval: false,
        safe_to_continue: false,
      });
  }
}

module.exports = {
  evaluatePermission,
  parseAllowHostEntry,
  networkHostMatchesAllowlist,
  normalizeClientHostnameForNetworkPolicy,
};
