"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const OPERATOR_GATE_SOURCES = new Set(["cli_host_port", "cli_base_url", "model_policy_yaml"]);
const OPERATOR_GATE_SCOPES_PRIVATE = new Set(["localhost", "private_lan"]);
const OLLAMA_TOOLS = new Set(["ollama_health_check", "ollama_chat"]);

/**
 * @param {string} host
 * @returns {"localhost" | "private_lan" | "public_endpoint"}
 */
function classifyEndpointScope(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return "public_endpoint";
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return "localhost";
  if (h.endsWith(".local") || h === "host.docker.internal") return "private_lan";
  const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return "private_lan";
    if (a === 172 && b >= 16 && b <= 31) return "private_lan";
    if (a === 192 && b === 168) return "private_lan";
    if (a === 127) return "localhost";
    return "public_endpoint";
  }
  if (h.includes(".")) return "public_endpoint";
  return "private_lan";
}

/**
 * @param {Record<string, unknown> | null | undefined} endpoint
 * @param {{ allowPublicLocalRuntime?: boolean }} [options]
 */
function toOperatorConfiguredGateEndpoint(endpoint, options = {}) {
  if (!endpoint || typeof endpoint !== "object") return null;
  const source = String(endpoint.source || "");
  if (!OPERATOR_GATE_SOURCES.has(source)) return null;
  const scope = String(endpoint.endpoint_scope || "");
  const allowPublic = options.allowPublicLocalRuntime === true
    || endpoint.allow_public_local_runtime === true;
  const scopes = allowPublic
    ? new Set([...OPERATOR_GATE_SCOPES_PRIVATE, "public_endpoint"])
    : OPERATOR_GATE_SCOPES_PRIVATE;
  if (!scopes.has(scope)) return null;
  const host = String(endpoint.host || "").trim();
  const port = Number(endpoint.port);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return {
    provider: String(endpoint.provider || "ollama"),
    host,
    port,
    endpoint_scope: scope,
    source,
    ...(allowPublic && scope === "public_endpoint" ? { allow_public_local_runtime: true } : {}),
  };
}

/**
 * @param {string} repoRoot
 * @returns {Record<string, unknown> | null}
 */
function loadModelPolicyYaml(repoRoot) {
  const policyPath = path.join(path.resolve(repoRoot || "."), ".ai-minions", "model-policy.yaml");
  if (!fs.existsSync(policyPath)) return null;
  const parsed = yaml.load(fs.readFileSync(policyPath, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? /** @type {Record<string, unknown>} */ (parsed)
    : null;
}

/**
 * @param {Record<string, unknown> | null} policy
 * @returns {{ host: string, port: number, endpoint_scope: string, source: string } | null}
 */
function endpointFromYamlPolicy(policy) {
  if (!policy) return null;
  const lb = policy.local_backend;
  if (!lb || typeof lb !== "object" || Array.isArray(lb)) return null;
  const rec = /** @type {Record<string, unknown>} */ (lb);
  let host = null;
  let port = 11434;
  if (typeof rec.base_url === "string" && rec.base_url.trim()) {
    try {
      const url = new URL(rec.base_url.includes("://") ? rec.base_url : `http://${rec.base_url}`);
      host = url.hostname;
      port = url.port ? Number(url.port) : 80;
    } catch {
      return null;
    }
  } else if (typeof rec.host === "string" && rec.host.trim()) {
    host = rec.host.trim();
    port = rec.port != null ? Number(rec.port) : 11434;
  }
  if (!host || !Number.isFinite(port)) return null;
  return {
    host,
    port,
    endpoint_scope: classifyEndpointScope(host),
    source: "model_policy_yaml",
  };
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.hostname
 * @param {number} opts.port
 * @param {Record<string, unknown>} [opts.operatorConfiguredEndpoint]
 * @param {boolean} [opts.allowPublicLocalRuntime]
 */
function deriveOperatorConfiguredEndpoint(opts) {
  const allowPublic = opts.allowPublicLocalRuntime === true;
  if (opts.operatorConfiguredEndpoint) {
    const gateEp = toOperatorConfiguredGateEndpoint(opts.operatorConfiguredEndpoint, {
      allowPublicLocalRuntime: allowPublic,
    });
    if (!gateEp) return null;
    if (gateEp.host.toLowerCase() !== String(opts.hostname).trim().toLowerCase()) return null;
    if (Number(opts.port) !== gateEp.port) return null;
    return gateEp;
  }
  const fromYaml = endpointFromYamlPolicy(loadModelPolicyYaml(opts.repoRoot));
  if (!fromYaml) return null;
  if (fromYaml.endpoint_scope === "public_endpoint" && !allowPublic) return null;
  const gateEp = toOperatorConfiguredGateEndpoint(
    { provider: "ollama", ...fromYaml },
    { allowPublicLocalRuntime: allowPublic },
  );
  if (!gateEp) return null;
  if (gateEp.host.toLowerCase() !== String(opts.hostname).trim().toLowerCase()) return null;
  if (Number(opts.port) !== gateEp.port) return null;
  return gateEp;
}

module.exports = {
  OPERATOR_GATE_SOURCES,
  OLLAMA_TOOLS,
  classifyEndpointScope,
  toOperatorConfiguredGateEndpoint,
  deriveOperatorConfiguredEndpoint,
  endpointFromYamlPolicy,
  loadModelPolicyYaml,
};
