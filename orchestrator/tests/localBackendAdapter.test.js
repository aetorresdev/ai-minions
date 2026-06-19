"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKEND_REGISTRY,
  enrichBackendStatus,
  normalizeInstallDiscovery,
  normalizeModelDescriptor,
  getExtensionPointBackends,
  getBackendRegistryEntry,
} = require("../local-backend-adapter");

describe("local-backend-adapter — registry", () => {
  it("lists ollama as only supported backend", () => {
    const supported = BACKEND_REGISTRY.filter((e) => e.support_status === "supported");
    assert.equal(supported.length, 1);
    assert.equal(supported[0].backend_id, "ollama");
  });

  it("includes experimental and unsupported extension points", () => {
    const extensions = getExtensionPointBackends();
    assert.ok(extensions.some((e) => e.backend_id === "openai_compatible_local"));
    assert.ok(extensions.some((e) => e.backend_id === "llama_cpp_server"));
    assert.ok(extensions.some((e) => e.backend_id === "vllm"));
  });

  it("getBackendRegistryEntry returns null for unknown backend", () => {
    assert.equal(getBackendRegistryEntry("unknown"), null);
  });
});

describe("local-backend-adapter — normalization", () => {
  it("enrichBackendStatus adds support_status and discovery_method", () => {
    const enriched = enrichBackendStatus({
      backend_id: "ollama",
      available: true,
      host: "localhost",
      port: 11434,
      reason: null,
    });
    assert.equal(enriched.support_status, "supported");
    assert.equal(enriched.discovery_method, "http_tags");
  });

  it("normalizeModelDescriptor maps backend to backend_id", () => {
    const model = normalizeModelDescriptor({
      name: "qwen2.5-coder:7b",
      backend: "ollama",
      family: "qwen2",
      size_bytes: 100,
      context_length: null,
    });
    assert.equal(model.backend_id, "ollama");
    assert.equal(model.name, "qwen2.5-coder:7b");
  });

  it("normalizeInstallDiscovery produces contract-shaped discovery block", () => {
    const normalized = normalizeInstallDiscovery({
      backends: [
        {
          backend_id: "ollama",
          available: true,
          host: "localhost",
          port: 11434,
          reason: null,
        },
      ],
      models: [
        {
          name: "llama3.1:8b",
          backend: "ollama",
          family: "llama",
          size_bytes: 1,
          context_length: null,
        },
      ],
      missing_local_backend: null,
    });
    assert.equal(normalized.backends[0].support_status, "supported");
    assert.equal(normalized.models[0].backend_id, "ollama");
    assert.equal(normalized.missing_local_backend, null);
  });
});
