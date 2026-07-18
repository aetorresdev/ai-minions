/**
 * Claude Code runtime-host adapter — MCP register + hook settings merge.
 * Spawns host commands with argv arrays only (no shell interpolation).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  RUNTIME_HOST_IDS,
  RUNTIME_REASON_CODES,
  REQUIRED_HOOKS,
  REQUIRED_MCP_SERVERS,
} from "./runtime-host-contract.mjs";

/**
 * POSIX-safe single-quote for embedding a path in a shell command string.
 * @param {string} value
 * @returns {string}
 */
export function posixShellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseClaudeMcpList(stdout) {
  /** @type {Set<string>} */
  const servers = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
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
 *   homeDir?: string,
 *   spawnSyncFn?: typeof spawnSync,
 *   fsModule?: typeof fs,
 *   env?: NodeJS.ProcessEnv,
 *   claudeBin?: string,
 * }} [options]
 */
export function createClaudeCodeAdapter(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const fsMod = options.fsModule ?? fs;
  const env = { ...process.env, ...(options.env ?? {}), HOME: homeDir };
  const claudeBin = options.claudeBin ?? "claude";
  const settingsPath = path.join(homeDir, ".claude", "settings.json");

  return {
    id: RUNTIME_HOST_IDS.CLAUDE_CODE,
    settingsPath,
    homeDir,

    /**
     * @returns {{ available: boolean, reason_code: string | null, message: string }}
     */
    detectAvailable() {
      const result = spawnSyncFn(claudeBin, ["--version"], {
        encoding: "utf8",
        stdio: "pipe",
        env,
      });
      if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
        return {
          available: false,
          reason_code: RUNTIME_REASON_CODES.UNAVAILABLE,
          message: "claude CLI not found in PATH (runtime host unavailable)",
        };
      }
      if (result.status !== 0) {
        return {
          available: false,
          reason_code: RUNTIME_REASON_CODES.UNAVAILABLE,
          message: `claude CLI not usable (exit ${result.status ?? "error"})`,
        };
      }
      return {
        available: true,
        reason_code: null,
        message: "claude_code runtime host available",
      };
    },

    /**
     * @returns {{ available: boolean, servers: Set<string> }}
     */
    listMcpServers() {
      const result = spawnSyncFn(claudeBin, ["mcp", "list"], {
        encoding: "utf8",
        stdio: "pipe",
        env,
      });
      if (result.status !== 0) {
        return { available: false, servers: new Set() };
      }
      return {
        available: true,
        servers: parseClaudeMcpList(String(result.stdout ?? "")),
      };
    },

    /**
     * @param {{ serverId: string, command: string, args: string[] }} spec
     * @returns {{ ok: boolean, reason_code: string, message: string }}
     */
    registerMcpServer(spec) {
      const listed = this.listMcpServers();
      if (listed.available && listed.servers.has(spec.serverId)) {
        return {
          ok: true,
          reason_code: RUNTIME_REASON_CODES.MCP_ALREADY_REGISTERED,
          message: `${spec.serverId} already registered`,
        };
      }
      const result = spawnSyncFn(
        claudeBin,
        ["mcp", "add", spec.serverId, spec.command, ...spec.args, "--scope", "user"],
        { encoding: "utf8", stdio: "pipe", env },
      );
      if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || "claude mcp add failed").slice(0, 240);
        return {
          ok: false,
          reason_code: RUNTIME_REASON_CODES.MCP_REGISTER_FAILED,
          message: `failed to register ${spec.serverId}: ${detail}`,
        };
      }
      const after = this.listMcpServers();
      if (!after.available || !after.servers.has(spec.serverId)) {
        return {
          ok: false,
          reason_code: RUNTIME_REASON_CODES.VERIFY_FAILED,
          message: `${spec.serverId} register reported ok but not visible in mcp list`,
        };
      }
      return {
        ok: true,
        reason_code: RUNTIME_REASON_CODES.MCP_REGISTERED,
        message: `${spec.serverId} registered`,
      };
    },

    /**
     * @returns {{ ok: boolean, settings: object | null, reason_code: string | null, message: string, raw?: string }}
     */
    readSettings() {
      try {
        if (!fsMod.existsSync(settingsPath)) {
          return {
            ok: true,
            settings: {},
            reason_code: null,
            message: "settings.json absent — will create",
          };
        }
        const raw = fsMod.readFileSync(settingsPath, "utf8");
        try {
          const settings = JSON.parse(raw);
          if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
            return {
              ok: false,
              settings: null,
              reason_code: RUNTIME_REASON_CODES.SETTINGS_UNREADABLE,
              message: "settings.json is not a JSON object",
              raw,
            };
          }
          return { ok: true, settings, reason_code: null, message: "settings loaded", raw };
        } catch {
          return {
            ok: false,
            settings: null,
            reason_code: RUNTIME_REASON_CODES.SETTINGS_UNREADABLE,
            message: "settings.json is malformed JSON",
            raw,
          };
        }
      } catch (err) {
        return {
          ok: false,
          settings: null,
          reason_code: RUNTIME_REASON_CODES.SETTINGS_UNREADABLE,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },

    /**
     * Atomic write: temp file in same dir + rename.
     * @param {object} settings
     * @returns {{ ok: boolean, reason_code: string | null, message: string }}
     */
    writeSettingsAtomic(settings) {
      try {
        const dir = path.dirname(settingsPath);
        fsMod.mkdirSync(dir, { recursive: true });
        const tmpPath = path.join(
          dir,
          `.settings.json.${process.pid}.${Date.now()}.tmp`,
        );
        const body = `${JSON.stringify(settings, null, 2)}\n`;
        fsMod.writeFileSync(tmpPath, body, "utf8");
        fsMod.renameSync(tmpPath, settingsPath);
        return {
          ok: true,
          reason_code: null,
          message: `wrote ${settingsPath}`,
        };
      } catch (err) {
        return {
          ok: false,
          reason_code: RUNTIME_REASON_CODES.SETTINGS_WRITE_FAILED,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },

    /**
     * Merge required MODE/handoff hooks without duplicating or removing unrelated entries.
     * @param {object} settings
     * @param {string} repoRoot
     * @returns {{ settings: object, changes: Array<{ hook_id: string, action: string, reason_code: string }> }}
     */
    mergeRequiredHooks(settings, repoRoot) {
      const next = { ...settings };
      const hooksRoot = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)
        ? { ...next.hooks }
        : {};
      /** @type {Array<{ hook_id: string, action: string, reason_code: string }>} */
      const changes = [];

      for (const hook of REQUIRED_HOOKS) {
        const scriptPath = path.join(repoRoot, "scripts", "hooks", hook.script);
        if (!fsMod.existsSync(scriptPath)) {
          changes.push({
            hook_id: hook.hook_id,
            action: "missing_script",
            reason_code: RUNTIME_REASON_CODES.HOOK_WIRE_FAILED,
          });
          continue;
        }
        const command = `python3 ${posixShellSingleQuote(scriptPath)}`;
        /** @type {unknown[]} */
        const eventHooks = Array.isArray(hooksRoot[hook.event])
          ? [...hooksRoot[hook.event]]
          : [];

        const already = eventHooks.some((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const e = /** @type {Record<string, unknown>} */ (entry);
          if (hook.matcher !== "*" && e.matcher !== hook.matcher) return false;
          if (hook.matcher === "*" && e.matcher != null && e.matcher !== "*") return false;
          const inner = Array.isArray(e.hooks) ? e.hooks : [];
          return inner.some(
            (h) => h && typeof h === "object"
              && typeof /** @type {Record<string, unknown>} */ (h).command === "string"
              && String(/** @type {Record<string, unknown>} */ (h).command).includes(hook.script),
          );
        });

        if (already) {
          changes.push({
            hook_id: hook.hook_id,
            action: "unchanged",
            reason_code: RUNTIME_REASON_CODES.HOOK_ALREADY_CONFIGURED,
          });
          continue;
        }

        eventHooks.push({
          matcher: hook.matcher,
          hooks: [
            {
              type: "command",
              command,
              statusMessage: `ai-minions ${hook.hook_id}`,
            },
          ],
        });
        hooksRoot[hook.event] = eventHooks;
        changes.push({
          hook_id: hook.hook_id,
          action: "added",
          reason_code: RUNTIME_REASON_CODES.HOOK_CONFIGURED,
        });
      }

      next.hooks = hooksRoot;
      return { settings: next, changes };
    },

    /**
     * @param {string} hookScript
     * @returns {boolean}
     */
    isHookWired(hookScript) {
      const read = this.readSettings();
      if (!read.ok || !read.settings) return false;
      return JSON.stringify(read.settings).includes(hookScript);
    },
  };
}

/**
 * Resolve MCP server python + server.py paths; validate they exist.
 * @param {string} repoRoot
 * @param {typeof REQUIRED_MCP_SERVERS[number]} spec
 * @param {typeof fs} [fsMod]
 */
export function resolveMcpLaunchPaths(repoRoot, spec, fsMod = fs) {
  const root = path.join(path.resolve(repoRoot), spec.rel_dir);
  const serverPy = path.join(root, "server.py");
  const python = path.join(root, ".venv", "bin", "python");
  if (!fsMod.existsSync(serverPy)) {
    return {
      ok: false,
      reason_code: RUNTIME_REASON_CODES.MCP_ARTIFACT_MISSING,
      message: `missing ${spec.rel_dir}/server.py`,
      command: null,
      args: null,
    };
  }
  if (!fsMod.existsSync(python)) {
    return {
      ok: false,
      reason_code: RUNTIME_REASON_CODES.MCP_VENV_SYNC_FAILED,
      message: `missing ${spec.rel_dir}/.venv/bin/python — run uv sync`,
      command: null,
      args: null,
    };
  }
  return {
    ok: true,
    reason_code: null,
    message: "launch paths ok",
    command: python,
    args: [serverPy],
  };
}

export { REQUIRED_MCP_SERVERS, REQUIRED_HOOKS };
