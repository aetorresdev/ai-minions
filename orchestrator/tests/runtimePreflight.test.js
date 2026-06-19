'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  REASON_CODES,
  V0_14_RUNTIME_COMPONENTS,
  deriveOverallStatus,
  parseClaudeMcpList,
  runRuntimePreflight,
} = require('../runtime-preflight');

function makeRepoLayout(tmp, { withVenv = true, withConfig = true, withSettings = true } = {}) {
  for (const spec of V0_14_RUNTIME_COMPONENTS) {
    if (spec.rel_dir) {
      const dir = path.join(tmp, spec.rel_dir);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'server.py'), '# stub\n');
      if (withVenv) {
        const venvBin = path.join(dir, '.venv', 'bin');
        fs.mkdirSync(venvBin, { recursive: true });
        fs.writeFileSync(path.join(venvBin, 'python'), '');
      }
    }
  }
  if (withConfig) {
    const ai = path.join(tmp, '.ai-minions');
    fs.mkdirSync(ai, { recursive: true });
    fs.writeFileSync(path.join(ai, 'model-policy.yaml'), 'model_policy_version: 1\n');
    fs.writeFileSync(path.join(ai, 'model_policy.json'), '{"model_policy_version":1}\n');
  }
  if (withSettings) {
    fs.writeFileSync(
      path.join(tmp, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ command: 'python3 scripts/hooks/mode-enforcer.py' }],
            },
            {
              matcher: 'mcp__orchestrator-state__advance_mode',
              hooks: [{ command: 'python3 scripts/hooks/handoff-enforcer.py' }],
            },
          ],
        },
      }),
    );
  }
}

describe('runtime-preflight — helpers', () => {
  it('deriveOverallStatus picks worst status', () => {
    assert.equal(deriveOverallStatus(['ok', 'warn']), 'warn');
    assert.equal(deriveOverallStatus(['ok', 'degraded', 'warn']), 'degraded');
    assert.equal(deriveOverallStatus(['ok', 'blocked', 'warn']), 'blocked');
  });

  it('parseClaudeMcpList reads bullet and colon lines', () => {
    const servers = parseClaudeMcpList(`MCP servers:\n- orchestrator-state\n- compact-handoff\n`);
    assert.ok(servers.has('orchestrator-state'));
    assert.ok(servers.has('compact-handoff'));
  });
});

describe('runtime-preflight — statuses', () => {
  it('ok when artifacts, registration, hooks, and config present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-preflight-'));
    makeRepoLayout(tmp);
    const result = runRuntimePreflight({
      repoRoot: tmp,
      modelPolicy: 'local_only',
      listMcpServers: () => ({
        available: true,
        servers: new Set(['orchestrator-state', 'compact-handoff']),
      }),
      readSettings: (root) => [fs.readFileSync(path.join(root, 'settings.json'), 'utf8')],
    });
    assert.equal(result.runtime_preflight.overall_status, 'ok');
    assert.ok(result.runtime_preflight.components.every((c) => c.status === 'ok'));
  });

  it('warn when hooks missing under remote_ok', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-preflight-'));
    makeRepoLayout(tmp, { withSettings: false });
    const result = runRuntimePreflight({
      repoRoot: tmp,
      modelPolicy: 'remote_ok',
      listMcpServers: () => ({
        available: true,
        servers: new Set(['orchestrator-state', 'compact-handoff']),
      }),
      readSettings: () => [],
    });
    assert.equal(result.runtime_preflight.overall_status, 'warn');
    const hooks = result.runtime_preflight.components.filter((c) => c.component_type === 'hook');
    assert.ok(hooks.every((c) => c.status === 'warn'));
  });

  it('degraded when MCP venv missing under local_only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-preflight-'));
    makeRepoLayout(tmp, { withVenv: false });
    const result = runRuntimePreflight({
      repoRoot: tmp,
      modelPolicy: 'local_only',
      listMcpServers: () => ({ available: false, servers: new Set() }),
      readSettings: (root) => [fs.readFileSync(path.join(root, 'settings.json'), 'utf8')],
    });
    assert.equal(result.runtime_preflight.overall_status, 'degraded');
    const mcps = result.runtime_preflight.components.filter((c) => c.component_type === 'mcp');
    assert.ok(mcps.some((c) => c.status === 'degraded'));
  });

  it('blocked when install config missing under local_only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-preflight-'));
    makeRepoLayout(tmp, { withConfig: false });
    const result = runRuntimePreflight({
      repoRoot: tmp,
      modelPolicy: 'local_only',
      listMcpServers: () => ({
        available: true,
        servers: new Set(['orchestrator-state', 'compact-handoff']),
      }),
      readSettings: (root) => [fs.readFileSync(path.join(root, 'settings.json'), 'utf8')],
    });
    assert.equal(result.runtime_preflight.overall_status, 'blocked');
    const configs = result.runtime_preflight.components.filter((c) => c.component_type === 'config');
    assert.ok(configs.every((c) => c.status === 'blocked'));
    assert.ok(configs.every((c) => c.reason_code === REASON_CODES.BLOCKED));
  });
});
