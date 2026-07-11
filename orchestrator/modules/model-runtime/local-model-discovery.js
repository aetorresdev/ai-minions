'use strict';

/**
 * Discover local model backends and installed models (no inference).
 * Initial backend: Ollama GET /api/tags.
 */

const http = require('http');
const https = require('https');

const { buildOllamaHttpPath, ollamaHttpTransport, applyOllamaHttpsTlsOptions } = require('./local-runtime-endpoint');

const OLLAMA_BACKEND_ID = 'ollama';
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * @typedef {Object} LocalModelDescriptor
 * @property {string} name
 * @property {string} backend
 * @property {string|null} family
 * @property {number|null} size_bytes
 * @property {number|null} context_length
 */

/**
 * @typedef {Object} LocalBackendStatus
 * @property {string} backend_id
 * @property {boolean} available
 * @property {string} host
 * @property {number} port
 * @property {string|null} reason
 */

/**
 * @typedef {Object} LocalModelDiscoveryResult
 * @property {LocalBackendStatus[]} backends
 * @property {LocalModelDescriptor[]} models
 * @property {string|null} missing_local_backend
 */

function resolveOllamaEndpoint(options = {}) {
  if (options.endpoint && typeof options.endpoint === 'object') {
    return {
      host: String(options.endpoint.host ?? process.env.OLLAMA_HOST ?? 'localhost'),
      port: Number(options.endpoint.port ?? parseInt(process.env.OLLAMA_PORT || '11434', 10)),
      base_path: String(options.endpoint.base_path ?? ''),
      protocol: String(options.endpoint.protocol ?? 'http'),
      tls_insecure: options.endpoint.tls_insecure === true || options.tlsInsecure === true,
    };
  }
  const host = options.host ?? process.env.OLLAMA_HOST ?? 'localhost';
  const port = options.port ?? parseInt(process.env.OLLAMA_PORT || '11434', 10);
  const base_path = options.base_path != null ? String(options.base_path) : '';
  const protocol = options.protocol != null ? String(options.protocol) : 'http';
  return {
    host,
    port,
    base_path,
    protocol,
    tls_insecure: options.tlsInsecure === true,
  };
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function inferFamilyFromName(name) {
  const base = String(name ?? '').split(':')[0].toLowerCase();
  if (!base) return null;
  if (base.includes('qwen')) return 'qwen2';
  if (base.startsWith('llama')) return 'llama';
  if (base.startsWith('mistral')) return 'mistral';
  if (base.includes('codellama')) return 'llama';
  if (base.includes('deepseek')) return 'deepseek';
  return null;
}

/**
 * @param {Record<string, unknown>} tag
 * @returns {LocalModelDescriptor}
 */
function normalizeOllamaTag(tag) {
  const name = String(tag.name || tag.model || '').trim();
  /** @type {{ family?: string, families?: string[], context_length?: number }} */
  const details = tag.details && typeof tag.details === 'object' ? tag.details : {};
  const family =
    (typeof details.family === 'string' && details.family) ||
    (Array.isArray(details.families) && details.families[0]) ||
    inferFamilyFromName(name);
  return {
    name,
    backend: OLLAMA_BACKEND_ID,
    family: family || null,
    size_bytes: typeof tag.size === 'number' && !Number.isNaN(tag.size) ? tag.size : null,
    context_length:
      typeof details.context_length === 'number' && !Number.isNaN(details.context_length)
        ? details.context_length
        : null,
  };
}

/**
 * @param {{ host: string, port: number, base_path?: string, protocol?: string, tls_insecure?: boolean, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, statusCode?: number, body?: string, error?: string, denied?: boolean }>}
 */
function httpGetTags(opts) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const path = buildOllamaHttpPath(opts.base_path ?? '', '/api/tags');
  const transport = ollamaHttpTransport(opts.protocol ?? 'http');
  /** @type {import('http').RequestOptions} */
  const requestOpts = {
    hostname: opts.host,
    port: opts.port,
    path,
    method: 'GET',
  };
  applyOllamaHttpsTlsOptions(requestOpts, {
    protocol: opts.protocol,
    tls_insecure: opts.tls_insecure,
  });
  return new Promise((resolve) => {
    const req = transport.request(
      requestOpts,
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode,
            body: data,
          });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message || 'unreachable' });
    });
    req.end();
  });
}

/**
 * @param {{ host: string, port: number, cwd?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, statusCode?: number, body?: string, error?: string, denied?: boolean }>}
 */
async function defaultFetchOllamaTags(opts) {
  const tagsPath = buildOllamaHttpPath(opts.base_path ?? '', '/api/tags');
  if (process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE !== '1') {
    try {
      const { runNetworkPermissionGate } = require('../../security/network-permission-gate');
      const repoRoot = opts.cwd != null ? String(opts.cwd) : process.cwd();
      /** @type {Record<string, unknown>} */
      const gateOpts = {
        repoRoot,
        role: 'ORCHESTRATOR',
        actor: 'orchestrator',
        hostname: opts.host,
        port: opts.port,
        tool: 'ollama_health_check',
        pathLabel: tagsPath,
      };
      if (opts.endpoint) {
        gateOpts.operatorConfiguredEndpoint = opts.endpoint;
        gateOpts.allowPublicLocalRuntime = opts.allowPublicLocalRuntime === true;
      }
      const gate = runNetworkPermissionGate(gateOpts);
      const out = gate.output;
      if (out.decision === 'deny' || out.decision === 'requires_approval' || !out.safe_to_continue) {
        return { ok: false, denied: true, error: out.reason_code || 'network_denied' };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return httpGetTags(opts);
}

/**
 * @param {LocalBackendStatus} backend
 * @param {string} reason
 * @param {string} missingMessage
 * @returns {LocalModelDiscoveryResult}
 */
function discoveryFailure(backend, reason, missingMessage) {
  backend.reason = reason;
  return {
    backends: [backend],
    models: [],
    missing_local_backend: missingMessage,
  };
}

/**
 * Discover local backends and models without running inference.
 * @param {{
 *   host?: string,
 *   port?: number,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   fetchTags?: (opts: { host: string, port: number, cwd?: string, timeoutMs?: number }) => Promise<{ ok: boolean, statusCode?: number, body?: string, error?: string, denied?: boolean }>,
 * }} [options]
 * @returns {Promise<LocalModelDiscoveryResult>}
 */
async function discoverLocalModels(options = {}) {
  const { host, port, base_path, protocol, tls_insecure } = resolveOllamaEndpoint(options);
  const fetchTags = options.fetchTags ?? defaultFetchOllamaTags;
  /** @type {LocalBackendStatus} */
  const backend = {
    backend_id: OLLAMA_BACKEND_ID,
    available: false,
    host,
    port,
    reason: null,
  };

  let response;
  try {
    response = await fetchTags({
      host,
      port,
      base_path,
      protocol,
      tls_insecure,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      endpoint: options.endpoint,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return discoveryFailure(
      backend,
      reason,
      'missing local backend: ollama unreachable',
    );
  }

  if (response.denied) {
    return discoveryFailure(
      backend,
      'network_denied',
      'missing local backend: ollama network egress denied',
    );
  }

  if (!response.ok) {
    return discoveryFailure(
      backend,
      response.error || `http_${response.statusCode ?? 'error'}`,
      'missing local backend: ollama unreachable',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(String(response.body ?? '{}'));
  } catch {
    return discoveryFailure(
      backend,
      'invalid_json',
      'missing local backend: ollama returned invalid tags payload',
    );
  }

  const rawModels = Array.isArray(parsed.models) ? parsed.models : [];
  const models = rawModels
    .filter((tag) => tag && (tag.name || tag.model))
    .map((tag) => normalizeOllamaTag(tag))
    .filter((m) => m.name);

  backend.available = true;
  backend.reason = null;
  return {
    backends: [backend],
    models,
    missing_local_backend: null,
  };
}

module.exports = {
  OLLAMA_BACKEND_ID,
  discoverLocalModels,
  normalizeOllamaTag,
  inferFamilyFromName,
  resolveOllamaEndpoint,
  defaultFetchOllamaTags,
  httpGetTags,
};
