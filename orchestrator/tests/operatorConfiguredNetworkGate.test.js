'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { evaluatePermission } = require('../security/evaluate-permission');
const { loadPermissionConfig, resolveProfile } = require('../security/load-permission-config');
const {
  runNetworkPermissionGate,
  deriveOperatorConfiguredEndpoint,
} = require('../security/network-permission-gate');
const { discoverLocalModels } = require('../local-model-discovery');
const { buildRunPreflight } = require('../modules/operator/runner-preflight');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function netInput(profileName, hostname, port, overrides = {}) {
  const cfg = loadPermissionConfig();
  const profile = resolveProfile(profileName, cfg.profiles);
  return {
    actor: 'orchestrator',
    role: 'ORCHESTRATOR',
    tool: 'ollama_health_check',
    action_class: 'read',
    domain: 'network',
    permission_profile: profileName,
    policy_source: 'built_in_profile',
    profile,
    precheck: {
      network_hostname: hostname,
      network_port: port,
      ...overrides.precheck,
    },
    ...overrides,
  };
}

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

describe('operator-configured Ollama network gate — evaluate-permission', () => {
  it('allows private LAN host:port from cli_host_port source', () => {
    const r = evaluatePermission(netInput('dev-local', '192.168.50.198', 11434, {
      precheck: {
        network_hostname: '192.168.50.198',
        network_port: 11434,
        operator_configured_local_runtime: {
          provider: 'ollama',
          host: '192.168.50.198',
          port: 11434,
          endpoint_scope: 'private_lan',
          source: 'cli_host_port',
        },
      },
    }));
    assert.equal(r.decision, 'allow');
    assert.equal(r.reason_code, 'network_operator_configured_local_runtime_allowed');
  });

  it('allows YAML model_policy_yaml source for LAN endpoint', () => {
    const r = evaluatePermission(netInput('dev-local', '192.168.50.198', 11434, {
      precheck: {
        network_hostname: '192.168.50.198',
        network_port: 11434,
        operator_configured_local_runtime: {
          provider: 'ollama',
          host: '192.168.50.198',
          port: 11434,
          endpoint_scope: 'private_lan',
          source: 'model_policy_yaml',
        },
      },
    }));
    assert.equal(r.decision, 'allow');
    assert.equal(r.reason_code, 'network_operator_configured_local_runtime_allowed');
  });

  it('denies public host without allow_public_local_runtime flag', () => {
    const r = evaluatePermission(netInput('dev-local', 'ollama.example.com', 11434, {
      precheck: {
        network_hostname: 'ollama.example.com',
        network_port: 11434,
        operator_configured_local_runtime: {
          provider: 'ollama',
          host: 'ollama.example.com',
          port: 11434,
          endpoint_scope: 'public_endpoint',
          source: 'cli_host_port',
        },
      },
    }));
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason_code, 'network_host_denied');
  });

  it('allows public host only with explicit allow_public_local_runtime', () => {
    const r = evaluatePermission(netInput('dev-local', 'ollama.example.com', 11434, {
      precheck: {
        network_hostname: 'ollama.example.com',
        network_port: 11434,
        operator_configured_local_runtime: {
          provider: 'ollama',
          host: 'ollama.example.com',
          port: 11434,
          endpoint_scope: 'public_endpoint',
          source: 'cli_host_port',
          allow_public_local_runtime: true,
        },
      },
    }));
    assert.equal(r.decision, 'allow');
    assert.equal(r.reason_code, 'network_operator_configured_local_runtime_allowed');
  });

  it('localhost behavior unchanged via allow_hosts', () => {
    const r = evaluatePermission(netInput('dev-local', '127.0.0.1', 11434));
    assert.equal(r.decision, 'allow');
    assert.equal(r.reason_code, 'network_allowlist_allowed');
  });

  it('denies LAN host when tool is not ollama_health_check or ollama_chat', () => {
    const r = evaluatePermission({
      ...netInput('dev-local', '192.168.50.198', 11434, {
        precheck: {
          network_hostname: '192.168.50.198',
          network_port: 11434,
          operator_configured_local_runtime: {
            provider: 'ollama',
            host: '192.168.50.198',
            port: 11434,
            endpoint_scope: 'private_lan',
            source: 'cli_host_port',
          },
        },
      }),
      tool: 'http_egress',
    });
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason_code, 'network_host_denied');
  });
});

describe('operator-configured Ollama network gate — runNetworkPermissionGate', () => {
  it('runNetworkPermissionGate records operator-configured allow in trace', () => {
    const gate = runNetworkPermissionGate({
      repoRoot: REPO_ROOT,
      role: 'ORCHESTRATOR',
      actor: 'orchestrator',
      hostname: '192.168.50.198',
      port: 11434,
      tool: 'ollama_health_check',
      pathLabel: '/api/tags',
      operatorConfiguredEndpoint: {
        provider: 'ollama',
        host: '192.168.50.198',
        port: 11434,
        endpoint_scope: 'private_lan',
        source: 'cli_host_port',
      },
    });
    assert.equal(gate.output.decision, 'allow');
    assert.equal(gate.output.reason_code, 'network_operator_configured_local_runtime_allowed');
    assert.equal(gate.tracePayload.reason_code, 'network_operator_configured_local_runtime_allowed');
  });

  it('deriveOperatorConfiguredEndpoint resolves YAML LAN endpoint when host/port match', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-yaml-'));
    writeYamlPolicy(tmp, {
      backend_id: 'ollama',
      support_status: 'supported',
      host: '192.168.50.198',
      port: 11434,
      base_url: 'http://192.168.50.198:11434',
      endpoint_scope: 'private_lan',
    });
    const ep = deriveOperatorConfiguredEndpoint({
      repoRoot: tmp,
      hostname: '192.168.50.198',
      port: 11434,
    });
    assert.ok(ep);
    assert.equal(ep.source, 'model_policy_yaml');
    assert.equal(ep.endpoint_scope, 'private_lan');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('dev-local profile allow_hosts unchanged (no wildcard expansion)', () => {
    const cfg = loadPermissionConfig();
    const profile = resolveProfile('dev-local', cfg.profiles);
    assert.deepEqual(profile.domains.network.allow_hosts, [
      'localhost',
      '127.0.0.1',
      'localhost:11434',
    ]);
  });
});

describe('operator-configured Ollama network gate — discovery integration', () => {
  it('discoverLocalModels passes network gate for CLI LAN endpoint without skip', async () => {
    const prevSkip = process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    try {
      const result = await discoverLocalModels({
        host: '192.168.50.198',
        port: 11434,
        cwd: REPO_ROOT,
        endpoint: {
          provider: 'ollama',
          host: '192.168.50.198',
          port: 11434,
          endpoint_scope: 'private_lan',
          source: 'cli_host_port',
        },
        fetchTags: async () => ({
          ok: true,
          statusCode: 200,
          body: JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }),
        }),
      });
      assert.equal(result.missing_local_backend, null);
      assert.equal(result.backends[0].available, true);
    } finally {
      if (prevSkip === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prevSkip;
    }
  });

  it('discoverLocalModels still denied for unmatched LAN host without operator endpoint', async () => {
    const prevSkip = process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    try {
      const result = await discoverLocalModels({
        host: '192.168.50.199',
        port: 11434,
        cwd: REPO_ROOT,
      });
      assert.match(result.missing_local_backend, /network egress denied/);
    } finally {
      if (prevSkip === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
      else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prevSkip;
    }
  });
});

describe('operator-configured Ollama network gate — runner preflight', () => {
  it('buildRunPreflight exposes config_target and policy_source for CLI LAN', async () => {
    const pf = await buildRunPreflight({
      cwd: REPO_ROOT,
      modelPolicy: 'local_only',
      ollamaHost: '192.168.50.198',
      ollamaPort: 11434,
      discover: async () => ({
        backends: [{ backend_id: 'ollama', available: true, host: '192.168.50.198', port: 11434 }],
        models: [{ name: 'qwen2.5-coder:7b', backend: 'ollama' }],
        missing_local_backend: null,
      }),
      selectLocalModel: async () => ({
        selected_model: 'qwen2.5-coder:7b',
        override_source: 'default',
        selection_reason: 'default',
        discovered_models: ['qwen2.5-coder:7b'],
        endpoint_scope: 'private_lan',
        base_url: 'http://192.168.50.198:11434',
        model_backend: 'ollama',
      }),
    });
    assert.equal(pf.policy_source, 'cli_host_port');
    assert.equal(pf.config_target, REPO_ROOT);
    assert.match(pf.config_path, /model-policy\.yaml$/);
    assert.equal(pf.endpoint_scope, 'private_lan');
  });
});
