#!/usr/bin/env node
/**
 * Explicit Ollama local runtime endpoint resolution — operator-configured LAN only.
 * No subnet scanning. Distinguishes localhost / private_lan / public_endpoint.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { OLLAMA_BACKEND_ID } = require('./local-model-discovery');

const MODEL_RUNTIME_REASON = {
  OK: 'MODEL_RUNTIME_OK',
  UNREACHABLE: 'MODEL_RUNTIME_UNREACHABLE',
  NOT_FOUND: 'MODEL_NOT_FOUND',
};

/** @typedef {'localhost' | 'private_lan' | 'public_endpoint'} EndpointScope */

/**
 * @param {string} host
 * @returns {EndpointScope}
 */
function classifyEndpointScope(host) {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h) return 'public_endpoint';
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'localhost';
  if (h.endsWith('.local') || h === 'host.docker.internal') return 'private_lan';

  const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return 'private_lan';
    if (a === 172 && b >= 16 && b <= 31) return 'private_lan';
    if (a === 192 && b === 168) return 'private_lan';
    if (a === 127) return 'localhost';
    return 'public_endpoint';
  }

  if (h.includes('.')) {
    return 'public_endpoint';
  }
  return 'private_lan';
}

/**
 * Normalize URL pathname for Ollama base_url prefix.
 * Strips trailing slash (except bare "/"); empty string means API root.
 * @param {string} pathname
 * @returns {string}
 */
function normalizeOllamaBasePath(pathname) {
  const raw = String(pathname ?? '').trim();
  if (!raw || raw === '/') return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Join configured base path with an Ollama API path (e.g. `/api/tags`).
 * @param {string} basePath
 * @param {string} apiPath
 * @returns {string}
 */
function buildOllamaHttpPath(basePath, apiPath) {
  const api = String(apiPath ?? '').startsWith('/') ? String(apiPath) : `/${apiPath}`;
  const prefix = normalizeOllamaBasePath(basePath);
  return prefix ? `${prefix}${api}` : api;
}

/**
 * @param {string} baseUrl
 * @returns {{ host: string, port: number, base_url: string, base_path: string }}
 */
function parseOllamaBaseUrl(baseUrl) {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) {
    throw new Error('ollama base_url is required');
  }
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new Error(`malformed ollama base_url: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ollama base_url must use http or https: ${raw}`);
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port in ollama base_url: ${raw}`);
  }
  const base_path = normalizeOllamaBasePath(url.pathname);
  const origin = `${url.protocol}//${host}:${port}`;
  const base_url = base_path ? `${origin}${base_path}` : origin;
  return { host, port, base_url, base_path };
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {{ host: string, port: number, base_url: string, base_path: string }}
 */
function buildOllamaEndpoint(host, port) {
  const h = String(host ?? '').trim();
  const p = Number(port);
  if (!h) throw new Error('ollama host is required');
  if (!Number.isFinite(p) || p <= 0 || p > 65535) {
    throw new Error('ollama port must be a valid TCP port');
  }
  return { host: h, port: p, base_url: `http://${h}:${p}`, base_path: '' };
}

/**
 * @param {string} cwd
 * @returns {Record<string, unknown> | null}
 */
function loadRuntimeYamlPolicy(cwd) {
  const policyPath = path.join(path.resolve(cwd || '.'), '.ai-minions', 'model-policy.yaml');
  if (!fs.existsSync(policyPath)) return null;
  const parsed = yaml.load(fs.readFileSync(policyPath, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? /** @type {Record<string, unknown>} */ (parsed)
    : null;
}

/**
 * @param {Record<string, unknown> | null} policy
 * @returns {{
 *   host: string,
 *   port: number,
 *   base_url: string,
 *   endpoint_scope: EndpointScope,
 *   declared_endpoint_scope?: EndpointScope,
 * } | null}
 */
function endpointFromYamlPolicy(policy) {
  if (!policy) return null;
  const lb = policy.local_backend;
  if (!lb || typeof lb !== 'object' || Array.isArray(lb)) return null;
  const rec = /** @type {Record<string, unknown>} */ (lb);
  const declaredScope = typeof rec.endpoint_scope === 'string' && rec.endpoint_scope.trim()
    ? /** @type {EndpointScope} */ (String(rec.endpoint_scope).trim())
    : null;

  if (typeof rec.base_url === 'string' && rec.base_url.trim()) {
    const parsed = parseOllamaBaseUrl(rec.base_url);
    const computedScope = classifyEndpointScope(parsed.host);
    return {
      ...parsed,
      endpoint_scope: computedScope,
      ...(declaredScope ? { declared_endpoint_scope: declaredScope } : {}),
    };
  }
  if (typeof rec.host === 'string' && rec.host.trim()) {
    const port = rec.port != null ? Number(rec.port) : 11434;
    const built = buildOllamaEndpoint(rec.host, port);
    const computedScope = classifyEndpointScope(built.host);
    return {
      ...built,
      endpoint_scope: computedScope,
      ...(declaredScope ? { declared_endpoint_scope: declaredScope } : {}),
    };
  }
  return null;
}

/**
 * @param {{
 *   cwd?: string,
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   loadPolicy?: (cwd: string) => Record<string, unknown> | null,
 * }} [options]
 * @returns {{
 *   provider: string,
 *   host: string,
 *   port: number,
 *   base_url: string,
 *   endpoint_scope: EndpointScope,
 *   source: string,
 * }}
 */
function resolveLocalRuntimeEndpoint(options = {}) {
  const cwd = options.cwd || process.cwd();
  const loadPolicy = options.loadPolicy ?? loadRuntimeYamlPolicy;
  const allowPublic = options.allowPublicLocalRuntime === true;

  if (options.ollamaBaseUrl) {
    const parsed = parseOllamaBaseUrl(String(options.ollamaBaseUrl));
    const scope = classifyEndpointScope(parsed.host);
    if (scope === 'public_endpoint' && !allowPublic) {
      throw new Error(
        'public_endpoint blocked — set --allow-public-local-runtime to opt in explicitly',
      );
    }
    return {
      provider: OLLAMA_BACKEND_ID,
      ...parsed,
      endpoint_scope: scope,
      source: 'cli_base_url',
    };
  }

  if (options.ollamaHost) {
    const port = options.ollamaPort != null
      ? Number(options.ollamaPort)
      : parseInt(process.env.OLLAMA_PORT || '11434', 10);
    const built = buildOllamaEndpoint(String(options.ollamaHost), port);
    const scope = classifyEndpointScope(built.host);
    if (scope === 'public_endpoint' && !allowPublic) {
      throw new Error(
        'public_endpoint blocked — set --allow-public-local-runtime to opt in explicitly',
      );
    }
    return {
      provider: OLLAMA_BACKEND_ID,
      ...built,
      endpoint_scope: scope,
      source: 'cli_host_port',
    };
  }

  const fromYaml = endpointFromYamlPolicy(loadPolicy(cwd));
  if (fromYaml) {
    if (fromYaml.endpoint_scope === 'public_endpoint' && !allowPublic) {
      throw new Error(
        'public_endpoint blocked in model-policy.yaml — set --allow-public-local-runtime to opt in',
      );
    }
    return {
      provider: OLLAMA_BACKEND_ID,
      host: fromYaml.host,
      port: fromYaml.port,
      base_url: fromYaml.base_url,
      base_path: fromYaml.base_path ?? '',
      endpoint_scope: fromYaml.endpoint_scope,
      source: 'model_policy_yaml',
    };
  }

  const envHost = process.env.OLLAMA_HOST;
  const envPort = parseInt(process.env.OLLAMA_PORT || '11434', 10);
  const host = envHost && String(envHost).trim() ? String(envHost).trim() : 'localhost';
  const built = buildOllamaEndpoint(host, envPort);
  const scope = classifyEndpointScope(built.host);
  if (scope === 'public_endpoint' && !allowPublic) {
    throw new Error(
      'public_endpoint blocked from OLLAMA_HOST — set --allow-public-local-runtime to opt in',
    );
  }
  return {
    provider: OLLAMA_BACKEND_ID,
    ...built,
    endpoint_scope: scope,
    source: envHost ? 'env_ollama_host' : 'default_localhost',
  };
}

/**
 * @param {{
 *   host: string,
 *   port: number,
 *   base_url: string,
 *   endpoint_scope: EndpointScope,
 *   default_model?: string | null,
 * }} endpoint
 * @returns {Record<string, unknown>}
 */
function buildLocalBackendYamlBlock(endpoint, defaultModel = null) {
  /** @type {Record<string, unknown>} */
  const block = {
    backend_id: OLLAMA_BACKEND_ID,
    support_status: 'supported',
    host: endpoint.host,
    port: endpoint.port,
    base_url: endpoint.base_url,
    endpoint_scope: endpoint.endpoint_scope,
  };
  /** @type {Record<string, unknown>} */
  const policy = {
    model_policy_version: 1,
    local_backend: block,
  };
  if (defaultModel) {
    policy.default_model = defaultModel;
  }
  return policy;
}

/**
 * @param {string} cwd
 * @param {{
 *   ollamaHost?: string | null,
 *   ollamaPort?: number | string | null,
 *   ollamaBaseUrl?: string | null,
 *   allowPublicLocalRuntime?: boolean,
 *   loadPolicy?: (cwd: string) => Record<string, unknown> | null,
 * }} [options]
 */
function buildDiscoverOptions(cwd, options = {}) {
  const endpoint = resolveLocalRuntimeEndpoint({ cwd, ...options });
  return {
    host: endpoint.host,
    port: endpoint.port,
    cwd,
    endpoint,
  };
}

/**
 * @param {string} repoCwd
 * @returns {string}
 */
function resolvePolicyCwd(repoCwd) {
  const resolved = path.resolve(repoCwd || '.');
  const policyHere = path.join(resolved, '.ai-minions', 'model-policy.yaml');
  if (fs.existsSync(policyHere)) return resolved;
  const parent = path.dirname(resolved);
  if (
    path.basename(resolved) === 'orchestrator'
    && fs.existsSync(path.join(parent, '.ai-minions', 'model-policy.yaml'))
  ) {
    return parent;
  }
  return resolved;
}

module.exports = {
  MODEL_RUNTIME_REASON,
  classifyEndpointScope,
  normalizeOllamaBasePath,
  buildOllamaHttpPath,
  parseOllamaBaseUrl,
  buildOllamaEndpoint,
  resolveLocalRuntimeEndpoint,
  buildDiscoverOptions,
  resolvePolicyCwd,
  endpointFromYamlPolicy,
  buildLocalBackendYamlBlock,
  loadRuntimeYamlPolicy,
};
