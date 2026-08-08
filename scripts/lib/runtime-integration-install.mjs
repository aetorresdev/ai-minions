/**
 * Runtime integration install phase — MCP venv sync, register, hook wire, verify.
 * Observable separately from model_policy / model_backend.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  RUNTIME_HOST_IDS,
  RUNTIME_INTEGRATION_STATUS,
  RUNTIME_REASON_CODES,
  REQUIRED_HOOKS,
  REQUIRED_MCP_SERVERS,
  deriveRuntimeIntegrationStatus,
} from "./runtime-host-contract.mjs";
import {
  createClaudeCodeAdapter,
  resolveMcpLaunchPaths,
} from "./runtime-host-claude-code.mjs";

/**
 * @param {string} mcpDir
 * @param {{ spawnSyncFn?: typeof spawnSync, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: boolean, reason_code: string | null, message: string }}
 */
export function syncMcpVenv(mcpDir, options = {}) {
  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const env = options.env ?? process.env;
  const result = spawnSyncFn("uv", ["sync", "--no-install-project"], {
    cwd: mcpDir,
    encoding: "utf8",
    stdio: "pipe",
    env,
  });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return {
      ok: false,
      reason_code: RUNTIME_REASON_CODES.MCP_VENV_SYNC_FAILED,
      message: "uv not found in PATH",
    };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "uv sync failed").slice(0, 240);
    return {
      ok: false,
      reason_code: RUNTIME_REASON_CODES.MCP_VENV_SYNC_FAILED,
      message: detail,
    };
  }
  return { ok: true, reason_code: null, message: `uv sync ok in ${mcpDir}` };
}

/**
 * @param {{
 *   repoRoot: string,
 *   skip?: boolean,
 *   require?: boolean,
 *   homeDir?: string,
 *   adapter?: ReturnType<typeof createClaudeCodeAdapter>,
 *   syncMcpVenvFn?: typeof syncMcpVenv,
 *   spawnSyncFn?: typeof spawnSync,
 *   fsModule?: typeof fs,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 */
export function runRuntimeIntegrationInstall(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const fsMod = options.fsModule ?? fs;
  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const syncFn = options.syncMcpVenvFn ?? syncMcpVenv;
  const adapter = options.adapter ?? createClaudeCodeAdapter({
    homeDir: options.homeDir,
    spawnSyncFn,
    fsModule: fsMod,
    env: options.env,
  });

  /** @type {Record<string, string>} */
  const mcp_registration = {};
  /** @type {Record<string, string>} */
  const hook_wiring = {};
  /** @type {Array<{ id: string, reason_code: string, status: string, message: string }>} */
  const checks = [];
  /** @type {import('./runtime-host-contract.mjs').RuntimeIntegrationStatus[]} */
  const componentStatuses = [];

  if (options.skip === true) {
    for (const spec of REQUIRED_MCP_SERVERS) {
      mcp_registration[spec.server_id] = "skipped";
    }
    for (const hook of REQUIRED_HOOKS) {
      hook_wiring[hook.hook_id] = "skipped";
    }
    checks.push({
      id: "runtime_integration",
      reason_code: RUNTIME_REASON_CODES.SKIPPED,
      status: "warn",
      message: "runtime integration skipped (--skip-runtime-integration)",
    });
    return {
      ok: true,
      runtime_host: adapter.id,
      runtime_integration_status: RUNTIME_INTEGRATION_STATUS.SKIPPED,
      reason_code: RUNTIME_REASON_CODES.SKIPPED,
      mcp_registration,
      hook_wiring,
      checks,
      next_safe_action:
        "Re-run install without --skip-runtime-integration to register MCP servers and wire hooks",
      settings_path: adapter.settingsPath,
    };
  }

  const host = adapter.detectAvailable();
  if (!host.available) {
    // Sync MCP venvs for the product anyway: the orchestrator can use
    // compact-handoff / orchestrator-state via the direct transport
    // (mcp-direct.py + per-server .venv) even when Claude Code is not installed.
    /** @type {string[]} */
    const venvSyncFailed = [];
    for (const spec of REQUIRED_MCP_SERVERS) {
      const sync = syncFn(path.join(repoRoot, spec.rel_dir), { spawnSyncFn, env: options.env });
      if (!sync.ok) venvSyncFailed.push(spec.server_id);
      checks.push({
        id: `mcp_venv:${spec.server_id}`,
        reason_code: sync.ok
          ? RUNTIME_REASON_CODES.CONFIGURED
          : (sync.reason_code ?? RUNTIME_REASON_CODES.MCP_VENV_SYNC_FAILED),
        status: sync.ok ? "pass" : "fail",
        message: sync.ok
          ? `MCP venv synced (${spec.server_id})`
          : sync.message,
      });
      mcp_registration[spec.server_id] = "unavailable";
    }
    for (const hook of REQUIRED_HOOKS) {
      hook_wiring[hook.hook_id] = "unavailable";
    }
    const required = options.require === true;
    const reason = host.reason_code ?? RUNTIME_REASON_CODES.UNAVAILABLE;
    checks.push({
      id: "runtime_host",
      reason_code: reason,
      // Optional Claude Code host: warn. Explicit --require-runtime-integration: fail.
      status: required ? "fail" : "warn",
      message: host.message,
    });
    const venvsOk = venvSyncFailed.length === 0;
    return {
      // Product local_only install must not look failed when only the optional host is missing.
      // Venv sync failures are real product failures even when host is absent.
      ok: venvsOk && !required,
      required,
      runtime_host: adapter.id,
      runtime_integration_status: RUNTIME_INTEGRATION_STATUS.UNAVAILABLE,
      reason_code: RUNTIME_REASON_CODES.UNAVAILABLE,
      mcp_registration,
      hook_wiring,
      checks,
      next_safe_action: !venvsOk
        ? `Fix MCP venv sync (install uv / repair ${venvSyncFailed.join(", ")} venvs), then re-run install`
        : required
          ? "Install Claude Code CLI (runtime host), ensure `claude` is on PATH, then re-run install — or omit --require-runtime-integration for local_only product use"
          : "Optional: install Claude Code CLI and re-run install to wire MCP/hooks — product CLI works without it for local_only",
      settings_path: adapter.settingsPath,
    };
  }

  for (const spec of REQUIRED_MCP_SERVERS) {
    const mcpDir = path.join(repoRoot, spec.rel_dir);
    const sync = syncFn(mcpDir, { spawnSyncFn, env: options.env });
    if (!sync.ok) {
      mcp_registration[spec.server_id] = "failed";
      componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
      checks.push({
        id: `mcp_venv:${spec.server_id}`,
        reason_code: sync.reason_code ?? RUNTIME_REASON_CODES.MCP_VENV_SYNC_FAILED,
        status: "fail",
        message: sync.message,
      });
      continue;
    }

    const launch = resolveMcpLaunchPaths(repoRoot, spec, fsMod);
    if (!launch.ok || !launch.command || !launch.args) {
      mcp_registration[spec.server_id] = "failed";
      componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
      checks.push({
        id: `mcp_artifact:${spec.server_id}`,
        reason_code: launch.reason_code ?? RUNTIME_REASON_CODES.MCP_ARTIFACT_MISSING,
        status: "fail",
        message: launch.message,
      });
      continue;
    }

    const reg = adapter.registerMcpServer({
      serverId: spec.server_id,
      command: launch.command,
      args: launch.args,
    });
    if (!reg.ok) {
      mcp_registration[spec.server_id] = "failed";
      componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
      checks.push({
        id: `mcp_register:${spec.server_id}`,
        reason_code: reg.reason_code,
        status: "fail",
        message: reg.message,
      });
      continue;
    }
    mcp_registration[spec.server_id] = "registered";
    componentStatuses.push(RUNTIME_INTEGRATION_STATUS.CONFIGURED);
    checks.push({
      id: `mcp_register:${spec.server_id}`,
      reason_code: reg.reason_code,
      status: "pass",
      message: reg.message,
    });
  }

  const read = adapter.readSettings();
  if (!read.ok || !read.settings) {
    for (const hook of REQUIRED_HOOKS) {
      hook_wiring[hook.hook_id] = "failed";
      componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
    }
    checks.push({
      id: "settings_read",
      reason_code: read.reason_code ?? RUNTIME_REASON_CODES.SETTINGS_UNREADABLE,
      status: "fail",
      message: read.message,
    });
  } else {
    const { settings: merged, changes } = adapter.mergeRequiredHooks(read.settings, repoRoot);
    const missingScript = changes.some((c) => c.action === "missing_script");
    if (missingScript) {
      for (const c of changes) {
        hook_wiring[c.hook_id] = c.action === "missing_script" ? "failed" : "unknown";
        if (c.action === "missing_script") {
          componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
          checks.push({
            id: `hook:${c.hook_id}`,
            reason_code: c.reason_code,
            status: "fail",
            message: `hook script missing for ${c.hook_id}`,
          });
        }
      }
    } else {
      const write = adapter.writeSettingsAtomic(merged);
      if (!write.ok) {
        for (const hook of REQUIRED_HOOKS) {
          hook_wiring[hook.hook_id] = "failed";
          componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
        }
        checks.push({
          id: "settings_write",
          reason_code: write.reason_code ?? RUNTIME_REASON_CODES.SETTINGS_WRITE_FAILED,
          status: "fail",
          message: write.message,
        });
      } else {
        for (const c of changes) {
          const scriptName = REQUIRED_HOOKS.find((h) => h.hook_id === c.hook_id)?.script;
          const verified = scriptName ? adapter.isHookWired(scriptName) : false;
          if (!verified) {
            hook_wiring[c.hook_id] = "failed";
            componentStatuses.push(RUNTIME_INTEGRATION_STATUS.FAILED);
            checks.push({
              id: `hook:${c.hook_id}`,
              reason_code: RUNTIME_REASON_CODES.VERIFY_FAILED,
              status: "fail",
              message: `${c.hook_id} not verified in settings after write`,
            });
            continue;
          }
          hook_wiring[c.hook_id] = "configured";
          componentStatuses.push(RUNTIME_INTEGRATION_STATUS.CONFIGURED);
          checks.push({
            id: `hook:${c.hook_id}`,
            reason_code: c.reason_code,
            status: "pass",
            message: `${c.hook_id} ${c.action}`,
          });
        }
      }
    }
  }

  const status = deriveRuntimeIntegrationStatus(componentStatuses);
  const ok = status === RUNTIME_INTEGRATION_STATUS.CONFIGURED;
  let reason_code = RUNTIME_REASON_CODES.CONFIGURED;
  if (status === RUNTIME_INTEGRATION_STATUS.FAILED) reason_code = RUNTIME_REASON_CODES.FAILED;
  else if (status === RUNTIME_INTEGRATION_STATUS.DEGRADED) reason_code = RUNTIME_REASON_CODES.DEGRADED;
  else if (status === RUNTIME_INTEGRATION_STATUS.UNAVAILABLE) {
    reason_code = RUNTIME_REASON_CODES.UNAVAILABLE;
  }

  /** @type {string | null} */
  let next_safe_action = null;
  if (!ok) {
    next_safe_action =
      "Inspect runtime_integration checks above; fix MCP/hook failures, then re-run install (idempotent)";
  }

  return {
    ok,
    runtime_host: adapter.id ?? RUNTIME_HOST_IDS.CLAUDE_CODE,
    runtime_integration_status: status,
    reason_code,
    mcp_registration,
    hook_wiring,
    checks,
    next_safe_action,
    settings_path: adapter.settingsPath,
  };
}
