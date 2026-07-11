'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const {
  MODEL_RUNTIME_REASON,
  classifyEndpointScope,
  normalizeOllamaBasePath,
  buildOllamaHttpPath,
  parseOllamaBaseUrl,
  resolveLocalRuntimeEndpoint,
  resolvePolicyCwd,
  buildDiscoverOptions,
  endpointFromYamlPolicy,
} = require('../local-runtime-endpoint');
const {
  buildRunPreflight,
  formatPreflightText,
} = require('../modules/operator/runner-preflight');

describe('local-runtime-endpoint', () => {
  it('classifyEndpointScope maps localhost and private LAN', () => {
    assert.equal(classifyEndpointScope('localhost'), 'localhost');
    assert.equal(classifyEndpointScope('127.0.0.1'), 'localhost');
    assert.equal(classifyEndpointScope('macstudio.local'), 'private_lan');
    assert.equal(classifyEndpointScope('192.168.1.50'), 'private_lan');
    assert.equal(classifyEndpointScope('10.0.0.5'), 'private_lan');
    assert.equal(classifyEndpointScope('ollama.example.com'), 'public_endpoint');
  });

  it('parseOllamaBaseUrl normalizes http URL', () => {
    const parsed = parseOllamaBaseUrl('http://macstudio.local:11434');
    assert.equal(parsed.host, 'macstudio.local');
    assert.equal(parsed.port, 11434);
    assert.equal(parsed.base_url, 'http://macstudio.local:11434');
    assert.equal(parsed.base_path, '');
  });

  it('parseOllamaBaseUrl preserves Olla path prefix without trailing slash', () => {
    const parsed = parseOllamaBaseUrl('http://127.0.0.1:40114/olla/ollama');
    assert.equal(parsed.host, '127.0.0.1');
    assert.equal(parsed.port, 40114);
    assert.equal(parsed.base_path, '/olla/ollama');
    assert.equal(parsed.base_url, 'http://127.0.0.1:40114/olla/ollama');
  });

  it('parseOllamaBaseUrl strips trailing slash from path prefix', () => {
    const parsed = parseOllamaBaseUrl('http://127.0.0.1:40114/olla/ollama/');
    assert.equal(parsed.base_path, '/olla/ollama');
    assert.equal(parsed.base_url, 'http://127.0.0.1:40114/olla/ollama');
  });

  it('buildOllamaHttpPath joins base path with Ollama API routes', () => {
    assert.equal(buildOllamaHttpPath('', '/api/tags'), '/api/tags');
    assert.equal(buildOllamaHttpPath('/olla/ollama', '/api/tags'), '/olla/ollama/api/tags');
    assert.equal(buildOllamaHttpPath('/olla/ollama', 'api/chat'), '/olla/ollama/api/chat');
  });

  it('normalizeOllamaBasePath treats root path as empty prefix', () => {
    assert.equal(normalizeOllamaBasePath('/'), '');
    assert.equal(normalizeOllamaBasePath(''), '');
    assert.equal(normalizeOllamaBasePath('/olla/ollama/'), '/olla/ollama');
  });

  it('resolveLocalRuntimeEndpoint preserves CLI ollamaBaseUrl path prefix', () => {
    const ep = resolveLocalRuntimeEndpoint({
      cwd: os.tmpdir(),
      ollamaBaseUrl: 'http://127.0.0.1:40114/olla/ollama',
    });
    assert.equal(ep.host, '127.0.0.1');
    assert.equal(ep.port, 40114);
    assert.equal(ep.base_path, '/olla/ollama');
    assert.equal(ep.base_url, 'http://127.0.0.1:40114/olla/ollama');
    assert.equal(ep.source, 'cli_base_url');
  });

  it('resolveLocalRuntimeEndpoint reads model-policy.yaml base_url with path prefix', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-endpoint-olla-'));
    const policyDir = path.join(tmp, '.ai-minions');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(
      path.join(policyDir, 'model-policy.yaml'),
      yaml.dump({
        model_policy_version: 1,
        local_backend: {
          backend_id: 'ollama',
          support_status: 'supported',
          base_url: 'http://127.0.0.1:40114/olla/ollama',
          endpoint_scope: 'localhost',
        },
      }),
      'utf8',
    );
    const ep = resolveLocalRuntimeEndpoint({ cwd: tmp });
    assert.equal(ep.base_path, '/olla/ollama');
    assert.equal(ep.base_url, 'http://127.0.0.1:40114/olla/ollama');
    assert.equal(ep.source, 'model_policy_yaml');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('parseOllamaBaseUrl rejects malformed URLs', () => {
    assert.throws(() => parseOllamaBaseUrl('ftp://bad'), /http or https/);
    assert.throws(() => parseOllamaBaseUrl(''), /required/);
  });

  it('resolveLocalRuntimeEndpoint prefers CLI host/port over env', () => {
    const prevHost = process.env.OLLAMA_HOST;
    const prevPort = process.env.OLLAMA_PORT;
    process.env.OLLAMA_HOST = 'ignored.example.com';
    process.env.OLLAMA_PORT = '9999';
    try {
      const ep = resolveLocalRuntimeEndpoint({
        cwd: os.tmpdir(),
        ollamaHost: 'macstudio.local',
        ollamaPort: 11434,
      });
      assert.equal(ep.host, 'macstudio.local');
      assert.equal(ep.port, 11434);
      assert.equal(ep.endpoint_scope, 'private_lan');
      assert.equal(ep.source, 'cli_host_port');
    } finally {
      if (prevHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prevHost;
      if (prevPort === undefined) delete process.env.OLLAMA_PORT;
      else process.env.OLLAMA_PORT = prevPort;
    }
  });

  it('resolveLocalRuntimeEndpoint reads model-policy.yaml local_backend', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-endpoint-'));
    const policyDir = path.join(tmp, '.ai-minions');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(
      path.join(policyDir, 'model-policy.yaml'),
      yaml.dump({
        model_policy_version: 1,
        local_backend: {
          backend_id: 'ollama',
          support_status: 'supported',
          host: 'macstudio.local',
          port: 11434,
          base_url: 'http://macstudio.local:11434',
          endpoint_scope: 'private_lan',
        },
      }),
      'utf8',
    );
    const ep = resolveLocalRuntimeEndpoint({ cwd: tmp });
    assert.equal(ep.host, 'macstudio.local');
    assert.equal(ep.endpoint_scope, 'private_lan');
    assert.equal(ep.source, 'model_policy_yaml');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeYamlPolicy(tmp, localBackend) {
    const policyDir = path.join(tmp, '.ai-minions');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(
      path.join(policyDir, 'model-policy.yaml'),
      yaml.dump({
        model_policy_version: 1,
        local_backend: localBackend,
      }),
      'utf8',
    );
  }

  it('blocks YAML public base_url even when endpoint_scope claims private_lan', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-endpoint-public-'));
    writeYamlPolicy(tmp, {
      backend_id: 'ollama',
      support_status: 'supported',
      host: 'ollama.example.com',
      port: 11434,
      base_url: 'http://ollama.example.com:11434',
      endpoint_scope: 'private_lan',
    });
    assert.throws(
      () => resolveLocalRuntimeEndpoint({ cwd: tmp }),
      /public_endpoint blocked in model-policy.yaml/,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('allows YAML public base_url only with allowPublicLocalRuntime', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-endpoint-public-allow-'));
    writeYamlPolicy(tmp, {
      backend_id: 'ollama',
      support_status: 'supported',
      host: 'ollama.example.com',
      port: 11434,
      base_url: 'http://ollama.example.com:11434',
      endpoint_scope: 'private_lan',
    });
    const ep = resolveLocalRuntimeEndpoint({
      cwd: tmp,
      allowPublicLocalRuntime: true,
    });
    assert.equal(ep.endpoint_scope, 'public_endpoint');
    assert.equal(ep.host, 'ollama.example.com');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('blocks YAML public host/port when endpoint_scope claims private_lan', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-endpoint-public-host-'));
    writeYamlPolicy(tmp, {
      backend_id: 'ollama',
      support_status: 'supported',
      host: 'ollama.example.com',
      port: 11434,
      endpoint_scope: 'private_lan',
    });
    assert.throws(
      () => resolveLocalRuntimeEndpoint({ cwd: tmp }),
      /public_endpoint blocked in model-policy.yaml/,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('endpointFromYamlPolicy recomputes scope and preserves declared mismatch', () => {
    const fromYaml = endpointFromYamlPolicy({
      local_backend: {
        host: 'ollama.example.com',
        port: 11434,
        base_url: 'http://ollama.example.com:11434',
        endpoint_scope: 'private_lan',
      },
    });
    assert.equal(fromYaml.endpoint_scope, 'public_endpoint');
    assert.equal(fromYaml.declared_endpoint_scope, 'private_lan');
  });

  it('resolvePolicyCwd lifts orchestrator/ cwd to repo root policy', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-cwd-'));
    const orch = path.join(tmp, 'orchestrator');
    fs.mkdirSync(path.join(tmp, '.ai-minions'), { recursive: true });
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.ai-minions', 'model-policy.yaml'),
      'model_policy_version: 1\n',
      'utf8',
    );
    assert.equal(resolvePolicyCwd(orch), tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildDiscoverOptions returns host/port for discovery', () => {
    const built = buildDiscoverOptions(os.tmpdir(), { ollamaHost: 'macstudio.local', ollamaPort: 11434 });
    assert.equal(built.host, 'macstudio.local');
    assert.equal(built.port, 11434);
    assert.equal(built.endpoint.endpoint_scope, 'private_lan');
  });
});

describe('runner-preflight — LAN endpoint', () => {
  const mockDiscoverOk = async () => ({
    backends: [{ backend_id: 'ollama', available: true, host: 'macstudio.local', port: 11434 }],
    models: [{ name: 'qwen2.5-coder:7b', backend: 'ollama' }],
    missing_local_backend: null,
  });

  const mockSelect = async () => ({
    selected_model: 'qwen2.5-coder:7b',
    override_source: 'cli',
    selection_reason: 'explicit CLI --model override',
    discovered_models: ['qwen2.5-coder:7b'],
    endpoint_scope: 'private_lan',
    base_url: 'http://macstudio.local:11434',
    model_backend: 'ollama',
  });

  it('buildRunPreflight uses explicit ollama host and reports MODEL_RUNTIME_OK', async () => {
    const pf = await buildRunPreflight({
      modelPolicy: 'local_only',
      ollamaHost: 'macstudio.local',
      ollamaPort: 11434,
      model: 'qwen2.5-coder:7b',
      discover: mockDiscoverOk,
      selectLocalModel: mockSelect,
    });
    assert.equal(pf.ok, true);
    assert.equal(pf.model_runtime_reason_code, MODEL_RUNTIME_REASON.OK);
    assert.equal(pf.endpoint_scope, 'private_lan');
    assert.equal(pf.base_url, 'http://macstudio.local:11434');
    assert.match(formatPreflightText(pf), /model_runtime:\s+MODEL_RUNTIME_OK/);
  });

  it('buildRunPreflight reports MODEL_NOT_FOUND for missing model in non-TTY', async () => {
    const pf = await buildRunPreflight({
      modelPolicy: 'local_only',
      ollamaHost: 'macstudio.local',
      model: 'missing-model:99b',
      discover: mockDiscoverOk,
    });
    assert.equal(pf.ok, false);
    assert.equal(pf.model_runtime_reason_code, MODEL_RUNTIME_REASON.NOT_FOUND);
    assert.ok(pf.blockers.some((b) => /MODEL_NOT_FOUND/.test(b)));
    assert.ok(pf.next_safe_action);
  });

  it('buildRunPreflight reports MODEL_RUNTIME_UNREACHABLE when discovery fails', async () => {
    const pf = await buildRunPreflight({
      modelPolicy: 'local_only',
      ollamaHost: 'macstudio.local',
      discover: async () => ({
        backends: [{ backend_id: 'ollama', available: false, host: 'macstudio.local', port: 11434, reason: 'timeout' }],
        models: [],
        missing_local_backend: 'missing local backend: ollama unreachable',
      }),
      selectLocalModel: mockSelect,
    });
    assert.equal(pf.ok, false);
    assert.equal(pf.model_runtime_reason_code, MODEL_RUNTIME_REASON.UNREACHABLE);
  });
});
