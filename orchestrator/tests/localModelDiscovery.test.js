"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "ollama-tags-sample.json"), "utf8"),
);

const {
  discoverLocalModels,
  normalizeOllamaTag,
  inferFamilyFromName,
} = require("../local-model-discovery");

describe("local-model-discovery — normalizeOllamaTag", () => {
  it("maps Ollama tag fields to descriptor shape", () => {
    const model = normalizeOllamaTag(fixture.models[0]);
    assert.equal(model.name, "qwen2.5-coder:7b");
    assert.equal(model.backend, "ollama");
    assert.equal(model.family, "qwen2");
    assert.equal(model.size_bytes, 4683087332);
    assert.equal(model.context_length, null);
  });

  it("infers family from model name when details omit family", () => {
    const model = normalizeOllamaTag(fixture.models[1]);
    assert.equal(model.family, "llama");
  });

  it("inferFamilyFromName handles common prefixes", () => {
    assert.equal(inferFamilyFromName("mistral:7b"), "mistral");
    assert.equal(inferFamilyFromName("deepseek-coder:6.7b"), "deepseek");
  });
});

describe("local-model-discovery — discoverLocalModels", () => {
  it("returns normalized models from fixture fetchTags mock", async () => {
    const result = await discoverLocalModels({
      fetchTags: async () => ({
        ok: true,
        statusCode: 200,
        body: JSON.stringify(fixture),
      }),
    });

    assert.equal(result.missing_local_backend, null);
    assert.equal(result.backends.length, 1);
    assert.equal(result.backends[0].backend_id, "ollama");
    assert.equal(result.backends[0].available, true);
    assert.equal(result.models.length, 2);
    assert.equal(result.models[0].name, "qwen2.5-coder:7b");
    assert.equal(result.models[1].name, "llama3.1:8b");
  });

  it("reports missing local backend when unreachable", async () => {
    const result = await discoverLocalModels({
      fetchTags: async () => ({ ok: false, error: "connect ECONNREFUSED" }),
    });

    assert.match(result.missing_local_backend, /missing local backend/);
    assert.equal(result.backends[0].available, false);
    assert.equal(result.backends[0].reason, "connect ECONNREFUSED");
    assert.deepEqual(result.models, []);
  });

  it("reports network denial without inference", async () => {
    const result = await discoverLocalModels({
      fetchTags: async () => ({ ok: false, denied: true, error: "network_denied" }),
    });

    assert.match(result.missing_local_backend, /network egress denied/);
    assert.equal(result.backends[0].reason, "network_denied");
    assert.deepEqual(result.models, []);
  });

  it("handles invalid JSON payload", async () => {
    const result = await discoverLocalModels({
      fetchTags: async () => ({ ok: true, statusCode: 200, body: "not-json" }),
    });

    assert.match(result.missing_local_backend, /invalid tags payload/);
    assert.equal(result.backends[0].reason, "invalid_json");
  });
});

describe("local-model-discovery — optional live integration", () => {
  it("probes real Ollama when ORCH_INTEGRATION_OLLAMA=1", async (t) => {
    if (process.env.ORCH_INTEGRATION_OLLAMA !== "1") {
      t.skip("set ORCH_INTEGRATION_OLLAMA=1 on self-hosted runner to enable");
      return;
    }
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    const result = await discoverLocalModels();
    assert.ok(Array.isArray(result.backends));
    assert.ok(Array.isArray(result.models));
  });
});
