"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "ollama-tags-sample.json"), "utf8"),
);

const {
  discoverLocalModels,
  normalizeOllamaTag,
  inferFamilyFromName,
  httpGetTags,
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

  it("returns stable shape when fetchTags throws", async () => {
    const result = await discoverLocalModels({
      fetchTags: async () => {
        throw new Error("fetchTags boom");
      },
    });

    assert.match(result.missing_local_backend, /missing local backend/);
    assert.equal(result.backends.length, 1);
    assert.equal(result.backends[0].available, false);
    assert.equal(result.backends[0].reason, "fetchTags boom");
    assert.deepEqual(result.models, []);
  });

  it("passes Olla base_path prefix to fetchTags", async () => {
    /** @type {Record<string, unknown> | null} */
    let captured = null;
    await discoverLocalModels({
      endpoint: {
        host: "127.0.0.1",
        port: 40114,
        base_path: "/olla/ollama",
        base_url: "http://127.0.0.1:40114/olla/ollama",
        source: "cli_base_url",
      },
      fetchTags: async (opts) => {
        captured = opts;
        return { ok: true, statusCode: 200, body: JSON.stringify({ models: [] }) };
      },
    });
    assert.equal(captured.base_path, "/olla/ollama");
    assert.equal(captured.host, "127.0.0.1");
    assert.equal(captured.port, 40114);
    assert.equal(captured.protocol, "http");
  });

  it("passes https protocol to fetchTags", async () => {
    /** @type {Record<string, unknown> | null} */
    let captured = null;
    await discoverLocalModels({
      endpoint: {
        host: "127.0.0.1",
        port: 8443,
        base_path: "/olla/ollama",
        protocol: "https",
        source: "cli_base_url",
      },
      fetchTags: async (opts) => {
        captured = opts;
        return { ok: true, statusCode: 200, body: JSON.stringify({ models: [] }) };
      },
    });
    assert.equal(captured.protocol, "https");
  });
});

describe("local-model-discovery — httpGetTags path prefix", () => {
  it("requests /olla/ollama/api/tags when base_path is configured", async () => {
    const fixtureBody = JSON.stringify({ models: [] });
    const server = http.createServer((req, res) => {
      if (req.url === "/olla/ollama/api/tags" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fixtureBody);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    try {
      const response = await httpGetTags({
        host: "127.0.0.1",
        port,
        base_path: "/olla/ollama",
      });
      assert.equal(response.ok, true);
      assert.equal(response.body, fixtureBody);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    }
  });

  it("requests https /olla/ollama/api/tags when protocol is https", async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "https-tags-"));
    const keyPath = path.join(tmp, "key.pem");
    const certPath = path.join(tmp, "cert.pem");
    try {
      require("child_process").execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`,
        { stdio: "ignore" },
      );
    } catch {
      t.skip("openssl unavailable for https transport test");
      return;
    }
    const fixtureBody = JSON.stringify({ models: [] });
    const server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      (req, res) => {
        if (req.url === "/olla/ollama/api/tags" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(fixtureBody);
          return;
        }
        res.writeHead(404);
        res.end();
      },
    );
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = "1";
    try {
      const response = await httpGetTags({
        host: "127.0.0.1",
        port,
        base_path: "/olla/ollama",
        protocol: "https",
        tls_insecure: true,
      });
      assert.equal(response.ok, true);
      assert.equal(response.body, fixtureBody);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects self-signed https unless tls_insecure is opted in", async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "https-tags-strict-"));
    const keyPath = path.join(tmp, "key.pem");
    const certPath = path.join(tmp, "cert.pem");
    try {
      require("child_process").execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`,
        { stdio: "ignore" },
      );
    } catch {
      t.skip("openssl unavailable for https transport test");
      return;
    }
    const server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [] }));
      },
    );
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    try {
      const response = await httpGetTags({
        host: "127.0.0.1",
        port,
        protocol: "https",
      });
      assert.equal(response.ok, false);
      assert.match(String(response.error ?? ""), /certificate|self signed|unable to verify/i);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
