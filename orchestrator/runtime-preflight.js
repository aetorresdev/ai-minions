'use strict';

/**
 * Provider runtime preflight — closed MCP/hook/config inventory for operator validation.
 * Read-only checks; does not mutate user MCP/hook settings.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REASON_CODES = Object.freeze({
  OK: 'RUNTIME_PREFLIGHT_OK',
  MCP_MISSING: 'RUNTIME_PREFLIGHT_MCP_MISSING',
  HOOK_MISSING: 'RUNTIME_PREFLIGHT_HOOK_MISSING',
  DEGRADED: 'RUNTIME_PREFLIGHT_DEGRADED',
  BLOCKED: 'RUNTIME_PREFLIGHT_BLOCKED',
});

/** @typedef {'ok' | 'warn' | 'degraded' | 'blocked'} RuntimeComponentStatus */

/** @type {Readonly<Record<RuntimeComponentStatus, number>>} */
const STATUS_RANK = Object.freeze({
  ok: 0,
  warn: 1,
  degraded: 2,
  blocked: 3,
});

/**
 * v0.14 closed component list — amend only via contract doc + spec update.
 * @type {ReadonlyArray<{
 *   component_id: string,
 *   component_type: 'mcp' | 'hook' | 'config',
 *   server_id?: string,
 *   rel_dir?: string,
 *   hook_script?: string,
 *   config_rel?: string,
 *   strict_local_only?: boolean,
 * }>}
 */
const CURRENT_RUNTIME_COMPONENTS = Object.freeze([
  {
    component_id: 'mcp:orchestrator-state',
    component_type: 'mcp',
    server_id: 'orchestrator-state',
    rel_dir: 'mcp-servers/orchestrator-state',
  },
  {
    component_id: 'mcp:compact-handoff',
    component_type: 'mcp',
    server_id: 'compact-handoff',
    rel_dir: 'mcp-servers/compact-handoff',
  },
  {
    component_id: 'hook:mode-enforcer',
    component_type: 'hook',
    hook_script: 'mode-enforcer.py',
  },
  {
    component_id: 'hook:handoff-enforcer',
    component_type: 'hook',
    hook_script: 'handoff-enforcer.py',
  },
  {
    component_id: 'config:model-policy-yaml',
    component_type: 'config',
    config_rel: '.ai-minions/model-policy.yaml',
    strict_local_only: true,
  },
  {
    component_id: 'config:model-policy-json',
    component_type: 'config',
    config_rel: '.ai-minions/model_policy.json',
    strict_local_only: true,
  },
]);

/**
 * @param {RuntimeComponentStatus[]} statuses
 * @returns {RuntimeComponentStatus}
 */
function deriveOverallStatus(statuses) {
  /** @type {RuntimeComponentStatus} */
  let worst = 'ok';
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

/**
 * @param {string} repoRoot
 * @param {string} relDir
 */
function checkMcpArtifacts(repoRoot, relDir) {
  const root = path.join(path.resolve(repoRoot), relDir);
  const serverPy = path.join(root, 'server.py');
  if (!fs.existsSync(serverPy)) {
    return {
      status: /** @type {RuntimeComponentStatus} */ ('blocked'),
      reason_code: REASON_CODES.MCP_MISSING,
      message: `missing MCP server artifact at ${relDir}/server.py`,
    };
  }
  const venvPython = path.join(root, '.venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    return {
      status: 'degraded',
      reason_code: REASON_CODES.DEGRADED,
      message: `MCP venv not synced for ${relDir} (run uv sync in that directory)`,
    };
  }
  return {
    status: 'ok',
    reason_code: REASON_CODES.OK,
    message: 'MCP server artifacts present',
  };
}

/**
 * @param {string} serverId
 * @param {'local_only' | 'remote_ok'} modelPolicy
 * @param {{ registered?: Set<string>, list_available?: boolean, ci_configured?: boolean }} mcpState
 */
function checkMcpRegistration(serverId, modelPolicy, mcpState) {
  if (mcpState.ci_configured) {
    return {
      status: 'ok',
      reason_code: REASON_CODES.OK,
      message: 'MCP registration assumed via CI configured flag',
    };
  }
  if (mcpState.registered?.has(serverId)) {
    return {
      status: 'ok',
      reason_code: REASON_CODES.OK,
      message: 'MCP server registered in Claude host',
    };
  }
  if (mcpState.list_available === false) {
    return {
      status: modelPolicy === 'local_only' ? 'degraded' : 'warn',
      reason_code: REASON_CODES.DEGRADED,
      message: `cannot verify MCP registration for ${serverId} (claude mcp list unavailable)`,
    };
  }
  return {
    status: modelPolicy === 'local_only' ? 'degraded' : 'warn',
    reason_code: REASON_CODES.MCP_MISSING,
    message: `MCP server ${serverId} not registered (claude mcp add)`,
  };
}

/**
 * @param {string} repoRoot
 * @param {string[]} [extraPaths]
 */
function readSettingsContents(repoRoot, extraPaths = []) {
  const candidates = [
    path.join(path.resolve(repoRoot), 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
    ...extraPaths,
  ];
  /** @type {string[]} */
  const contents = [];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        contents.push(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {
      // skip unreadable settings
    }
  }
  return contents;
}

/**
 * @param {string} hookScript
 * @param {string[]} settingsContents
 */
function checkHookWiring(hookScript, settingsContents) {
  const wired = settingsContents.some((content) => content.includes(hookScript));
  if (wired) {
    return {
      status: /** @type {RuntimeComponentStatus} */ ('ok'),
      reason_code: REASON_CODES.OK,
      message: `${hookScript} referenced in Claude settings hooks`,
    };
  }
  return {
    status: 'warn',
    reason_code: REASON_CODES.HOOK_MISSING,
    message: `${hookScript} not found in Claude settings hooks (MODE/handoff gates optional)`,
  };
}

/**
 * @param {string} repoRoot
 * @param {string} configRel
 * @param {'local_only' | 'remote_ok'} modelPolicy
 * @param {boolean} strictLocalOnly
 */
function checkInstallConfig(repoRoot, configRel, modelPolicy, strictLocalOnly) {
  const configPath = path.join(path.resolve(repoRoot), configRel);
  if (fs.existsSync(configPath)) {
    return {
      status: 'ok',
      reason_code: REASON_CODES.OK,
      message: `${configRel} present`,
    };
  }
  if (strictLocalOnly && modelPolicy === 'local_only') {
    return {
      status: 'blocked',
      reason_code: REASON_CODES.BLOCKED,
      message: `missing ${configRel} — run install-ai-minions config-write phase first`,
    };
  }
  return {
    status: 'warn',
    reason_code: REASON_CODES.DEGRADED,
    message: `missing ${configRel} (install config not written)`,
  };
}

/**
 * @param {string} stdout
 * @returns {Set<string>}
 */
function parseClaudeMcpList(stdout) {
  /** @type {Set<string>} */
  const servers = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const bullet = trimmed.match(/^[-*]\s+([a-z0-9][\w-]*)/i);
    if (bullet) {
      servers.add(bullet[1]);
      continue;
    }
    const plain = trimmed.match(/^([a-z0-9][\w-]*)\s*:/i);
    if (plain) {
      servers.add(plain[1]);
    }
  }
  return servers;
}

/**
 * @param {{
 *   repoRoot: string,
 *   modelPolicy?: 'local_only' | 'remote_ok' | null,
 *   listMcpServers?: () => { available: boolean, servers: Set<string> },
 *   readSettings?: (repoRoot: string) => string[],
 *   components?: typeof CURRENT_RUNTIME_COMPONENTS,
 * }} options
 */
function runRuntimePreflight(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const modelPolicy = options.modelPolicy === 'remote_ok' ? 'remote_ok' : 'local_only';
  const listMcpServers =
    options.listMcpServers ??
    (() => {
      const { spawnSync } = require('node:child_process');
      const result = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', stdio: 'pipe' });
      if (result.status !== 0) {
        return { available: false, servers: new Set() };
      }
      return { available: true, servers: parseClaudeMcpList(String(result.stdout ?? '')) };
    });
  const readSettings = options.readSettings ?? readSettingsContents;
  const inventory = options.components ?? CURRENT_RUNTIME_COMPONENTS;

  const mcpListed = listMcpServers();
  const mcpState = {
    registered: mcpListed.servers,
    list_available: mcpListed.available,
    ci_configured:
      process.env.ORCH_CI_MCP_CONFIGURED === '1' ||
      process.env.CI === 'true' ||
      process.env.CI === '1',
  };
  const settingsContents = readSettings(repoRoot);

  /** @type {Array<{
   *   component_id: string,
   *   component_type: string,
   *   status: RuntimeComponentStatus,
   *   reason_code: string,
   *   message: string,
   * }>} */
  const components = [];

  for (const spec of inventory) {
    if (spec.component_type === 'mcp') {
      const artifact = checkMcpArtifacts(repoRoot, spec.rel_dir);
      const registration = checkMcpRegistration(spec.server_id, modelPolicy, mcpState);
      const worst =
        STATUS_RANK[artifact.status] >= STATUS_RANK[registration.status]
          ? artifact
          : registration;
      components.push({
        component_id: spec.component_id,
        component_type: spec.component_type,
        status: worst.status,
        reason_code: worst.reason_code,
        message: worst.message,
      });
      continue;
    }

    if (spec.component_type === 'hook') {
      const hook = checkHookWiring(spec.hook_script, settingsContents);
      components.push({
        component_id: spec.component_id,
        component_type: spec.component_type,
        status: hook.status,
        reason_code: hook.reason_code,
        message: hook.message,
      });
      continue;
    }

    if (spec.component_type === 'config') {
      const config = checkInstallConfig(
        repoRoot,
        spec.config_rel,
        modelPolicy,
        spec.strict_local_only === true,
      );
      components.push({
        component_id: spec.component_id,
        component_type: spec.component_type,
        status: config.status,
        reason_code: config.reason_code,
        message: config.message,
      });
    }
  }

  const overall_status = deriveOverallStatus(components.map((c) => c.status));

  return {
    runtime_preflight: {
      components,
      overall_status,
      model_policy: modelPolicy,
    },
  };
}

module.exports = {
  REASON_CODES,
  STATUS_RANK,
  CURRENT_RUNTIME_COMPONENTS,
  deriveOverallStatus,
  parseClaudeMcpList,
  readSettingsContents,
  runRuntimePreflight,
};
