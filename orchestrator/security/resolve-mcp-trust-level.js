"use strict";

/**
 * Resolve MCP trust level for policy evaluation (declaration vs runtime).
 * Does not read env directly — caller passes options derived from env / project policy.
 */

/** Orchestrator core MCP servers — always treated as locally declared for trust_policy.local_declared. */
const BUILTIN_DECLARED_SERVERS = new Set(["orchestrator-state", "compact-handoff"]);

/**
 * @param {string} server — MCP server id (e.g. from trace / manifest)
 * @param {{ declared_servers?: Set<string> | string[], remote_declared_servers?: Set<string> | string[] }} [opts]
 * @returns {"local_declared" | "remote_declared" | "runtime_discovered" | "unknown"}
 */
function resolveMcpTrustLevel(server, opts = {}) {
  const id = typeof server === "string" ? server.trim() : "";
  if (!id) return "unknown";

  if (BUILTIN_DECLARED_SERVERS.has(id)) return "local_declared";

  const declared = _toSet(opts.declared_servers);
  if (declared.has(id)) return "local_declared";

  const remoteDeclared = _toSet(opts.remote_declared_servers);
  if (remoteDeclared.has(id)) return "remote_declared";

  return "runtime_discovered";
}

function _toSet(v) {
  if (!v) return new Set();
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v.filter((x) => typeof x === "string" && x.trim()));
  return new Set();
}

module.exports = {
  resolveMcpTrustLevel,
  BUILTIN_DECLARED_SERVERS,
};
