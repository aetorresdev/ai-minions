'use strict';

/**
 * Local backend adapter registry and install-report normalization.
 * Ollama is the only supported backend in v0.14; other entries are schema extension points.
 */

const OLLAMA_BACKEND_ID = 'ollama';

/** @typedef {'supported' | 'experimental' | 'unsupported'} SupportStatus */

/** @type {ReadonlyArray<{ backend_id: string, support_status: SupportStatus, discovery_method: string | null }>} */
const BACKEND_REGISTRY = Object.freeze([
  { backend_id: OLLAMA_BACKEND_ID, support_status: 'supported', discovery_method: 'http_tags' },
  {
    backend_id: 'openai_compatible_local',
    support_status: 'experimental',
    discovery_method: null,
  },
  { backend_id: 'llama_cpp_server', support_status: 'unsupported', discovery_method: null },
  { backend_id: 'vllm', support_status: 'unsupported', discovery_method: null },
]);

/**
 * @param {string} backendId
 * @returns {{ backend_id: string, support_status: SupportStatus, discovery_method: string | null } | null}
 */
function getBackendRegistryEntry(backendId) {
  return BACKEND_REGISTRY.find((entry) => entry.backend_id === backendId) ?? null;
}

/**
 * @param {import('./local-model-discovery').LocalBackendStatus} backend
 * @returns {{
 *   backend_id: string,
 *   support_status: SupportStatus,
 *   available: boolean,
 *   host: string,
 *   port: number,
 *   reason: string | null,
 *   discovery_method: string | null,
 * }}
 */
function enrichBackendStatus(backend) {
  const entry = getBackendRegistryEntry(backend.backend_id);
  return {
    backend_id: backend.backend_id,
    support_status: entry?.support_status ?? 'unsupported',
    available: backend.available,
    host: backend.host,
    port: backend.port,
    reason: backend.reason,
    discovery_method: entry?.discovery_method ?? null,
  };
}

/**
 * @param {import('./local-model-discovery').LocalModelDescriptor} model
 * @returns {{
 *   name: string,
 *   backend_id: string,
 *   family: string | null,
 *   size_bytes: number | null,
 *   context_length: number | null,
 * }}
 */
function normalizeModelDescriptor(model) {
  const backendId = /** @type {{ backend_id?: string, backend?: string }} */ (model).backend_id
    ?? model.backend
    ?? 'unknown';
  return {
    name: model.name,
    backend_id: backendId,
    family: model.family ?? null,
    size_bytes: model.size_bytes ?? null,
    context_length: model.context_length ?? null,
  };
}

/**
 * @param {import('./local-model-discovery').LocalModelDiscoveryResult} discoveryResult
 * @returns {{
 *   backends: ReturnType<typeof enrichBackendStatus>[],
 *   models: ReturnType<typeof normalizeModelDescriptor>[],
 *   missing_local_backend: string | null,
 * }}
 */
function normalizeInstallDiscovery(discoveryResult) {
  return {
    backends: (discoveryResult.backends ?? []).map(enrichBackendStatus),
    models: (discoveryResult.models ?? []).map(normalizeModelDescriptor),
    missing_local_backend: discoveryResult.missing_local_backend ?? null,
  };
}

/**
 * Extension-point backends (experimental / unsupported) — not discovered in v0.14.
 * @returns {typeof BACKEND_REGISTRY}
 */
function getExtensionPointBackends() {
  return BACKEND_REGISTRY.filter((entry) => entry.support_status !== 'supported');
}

module.exports = {
  BACKEND_REGISTRY,
  OLLAMA_BACKEND_ID,
  enrichBackendStatus,
  normalizeModelDescriptor,
  normalizeInstallDiscovery,
  getExtensionPointBackends,
  getBackendRegistryEntry,
};
