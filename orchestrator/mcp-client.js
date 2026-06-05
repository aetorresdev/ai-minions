"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { traceEvent, setPermissionCheckAuditHook } = require("./trace-writer");
const { runMcpPermissionGate } = require("./security/mcp-permission-gate");
const { buildApprovalRequiredFromPermissionTrace } = require("./governance-gate");

let _mcpAuditTaskId = null;
/** @type {{ server: string, tool: string, transport: string, duration_ms: number, ok: boolean }[]} */
let _mcpAuditCalls = [];
/** @type {{ decision?: string, reason_code?: string, domain?: string, tool?: string }[]} */
let _permissionCheckAuditBuffer = [];

setPermissionCheckAuditHook((taskId, sanitized) => {
  if (taskId !== _mcpAuditTaskId) return;
  _permissionCheckAuditBuffer.push({
    decision: sanitized.decision,
    reason_code: sanitized.reason_code,
    domain: sanitized.domain,
    tool: sanitized.tool,
  });
});

function beginMcpAudit(taskId) {
  _mcpAuditTaskId = taskId;
  _mcpAuditCalls = [];
  _permissionCheckAuditBuffer = [];
}

function clearMcpAudit() {
  _mcpAuditTaskId = null;
  _mcpAuditCalls = [];
  _permissionCheckAuditBuffer = [];
}

function getMcpAuditCalls() {
  return _mcpAuditCalls;
}

function getPermissionCheckAuditBuffer() {
  return _permissionCheckAuditBuffer;
}

/**
 * Roll up MCP invocation rows for session_end / tests.
 * @param {{ server: string, tool: string, transport: string, duration_ms: number, ok: boolean }[]} calls
 */
function aggregateMcpUsage(calls) {
  if (!calls.length) {
    return { mcp_total_calls: 0, mcp_by_tool: {}, mcp_by_transport: {}, mcp_failed_calls: 0 };
  }
  const mcp_by_tool = {};
  const mcp_by_transport = {};
  let mcp_failed_calls = 0;
  for (const c of calls) {
    const key = `${c.server}.${c.tool}`;
    mcp_by_tool[key] = (mcp_by_tool[key] || 0) + 1;
    mcp_by_transport[c.transport] = (mcp_by_transport[c.transport] || 0) + 1;
    if (!c.ok) mcp_failed_calls += 1;
  }
  return {
    mcp_total_calls: calls.length,
    mcp_by_tool,
    mcp_by_transport,
    mcp_failed_calls,
  };
}

function recordMcpInvocation(entry) {
  if (!_mcpAuditTaskId) return;
  _mcpAuditCalls.push(entry);
  traceEvent(_mcpAuditTaskId, { event: "mcp_call", ...entry });
}

/**
 * Permission evaluator before MCP execution (fail closed).
 * Set `ORCH_SKIP_MCP_PERMISSION_GATE=1` to bypass (tests / emergency only).
 */
function gateMcpInvocation(server, toolName, cwd, gateOpts = {}) {
  if (process.env.ORCH_SKIP_MCP_PERMISSION_GATE === "1") return;
  const repoRoot = cwd || process.cwd();
  let result;
  try {
    result = runMcpPermissionGate({
      server,
      tool: toolName,
      repoRoot,
      agentId: gateOpts.agentId,
      role: gateOpts.role,
    });
  } catch (err) {
    const e = new Error(`MCP permission gate failed: ${err.message}`);
    e.cause = err;
    e.code = "MCP_PERMISSION_GATE_ERROR";
    throw e;
  }
  if (_mcpAuditTaskId) {
    traceEvent(_mcpAuditTaskId, result.tracePayload);
  }
  const out = result.output;
  if (out.decision === "requires_approval" && _mcpAuditTaskId) {
    traceEvent(
      _mcpAuditTaskId,
      buildApprovalRequiredFromPermissionTrace(result.tracePayload, {
        mcpServer: server,
        mcpTool: toolName,
        agent: gateOpts.agentId,
        iteration: gateOpts.iteration,
        step_id: gateOpts.step_id,
        role: gateOpts.role,
        ownership_change: gateOpts.ownership_change,
        handoff_contract_ref: gateOpts.handoff_contract_ref,
        source_role: gateOpts.source_role,
        target_role: gateOpts.target_role,
      }),
    );
  }
  if (out.decision === "deny" || out.decision === "requires_approval" || !out.safe_to_continue) {
    const msg = `MCP invocation denied (${out.reason_code}): ${server}.${toolName}`;
    const err = new Error(msg);
    err.code = "MCP_PERMISSION_DENIED";
    err.permission_decision = out;
    throw err;
  }
}

function emitPermissionCheckTrace(payload) {
  if (!_mcpAuditTaskId) return;
  traceEvent(_mcpAuditTaskId, payload);
}

function useMcpDirectTransport() {
  return process.env.ORCH_MCP_TRANSPORT === "direct";
}

/** Parse stdout from mcp-direct.py — JSON object, or last JSON line, or raw string (YAML). */
function parseMcpDirectStdout(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch { /* fallthrough */ }
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line);
    } catch { /* continue */ }
  }
  return t;
}

/** Drop / rename fields so Python tool signatures match (claude CLI tolerated extras). */
function sanitizeOrchestratorStateArgs(toolName, args) {
  if (toolName === "register_task") {
    const { contract_version, ...rest } = args;
    void contract_version;
    return rest;
  }
  if (toolName === "record_artifact") {
    return {
      task_id: args.task_id,
      path: args.path ?? args.artifact_id ?? "session-summary",
      note: String(args.note ?? args.content ?? "").slice(0, 12000),
    };
  }
  return { ...args };
}

function extractJson(text) {
  const trimmed = text.trim();
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = block ? block[1].trim() : trimmed;
  try { return JSON.parse(raw); } catch { return null; }
}

function invokeMcpDirect(server, toolName, args, { cwd } = {}) {
  gateMcpInvocation(server, toolName, cwd);
  const script = path.join(__dirname, "mcp-direct.py");
  if (!fs.existsSync(script)) {
    throw new Error(`mcp-direct.py not found at ${script}`);
  }
  const py = process.env.ORCH_PYTHON || "python3";
  const payload = JSON.stringify({ server, tool: toolName, args });
  const timeoutMs = parseInt(process.env.ORCH_MCP_DIRECT_TIMEOUT_MS, 10) || 180000;
  const t0 = Date.now();
  try {
    const result = spawnSync(py, [script], {
      input: payload,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const msg = (result.stderr || result.stdout || "").trim() || `mcp-direct exited ${result.status}`;
      throw new Error(msg);
    }
    recordMcpInvocation({
      server,
      tool: toolName,
      transport: "direct",
      duration_ms: Date.now() - t0,
      ok: true,
    });
    return parseMcpDirectStdout(result.stdout);
  } catch (err) {
    recordMcpInvocation({
      server,
      tool: toolName,
      transport: "direct",
      duration_ms: Date.now() - t0,
      ok: false,
    });
    throw err;
  }
}

function callStateMcp(toolName, args, { cwd } = {}) {
  if (useMcpDirectTransport()) {
    const parsed = invokeMcpDirect("orchestrator-state", toolName, sanitizeOrchestratorStateArgs(toolName, args), {
      cwd,
    });
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`orchestrator-state.${toolName} returned non-JSON`);
    }
    return parsed;
  }
  gateMcpInvocation("orchestrator-state", toolName, cwd);
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  const prompt = `Call the MCP tool orchestrator-state.${toolName} with these arguments and return only the raw JSON response, no other text:\n${toolName}(${argsStr})`;
  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 60000;
  const t0 = Date.now();
  try {
    const result = spawnSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: timeoutMs,
      cwd: cwd || process.cwd(),
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || "claude CLI error calling MCP");
    const parsed = extractJson(result.stdout.trim());
    if (!parsed) throw new Error(`orchestrator-state.${toolName} returned non-JSON: ${result.stdout.slice(0, 300)}`);
    recordMcpInvocation({
      server: "orchestrator-state",
      tool: toolName,
      transport: "claude_cli",
      duration_ms: Date.now() - t0,
      ok: true,
    });
    return parsed;
  } catch (err) {
    recordMcpInvocation({
      server: "orchestrator-state",
      tool: toolName,
      transport: "claude_cli",
      duration_ms: Date.now() - t0,
      ok: false,
    });
    throw err;
  }
}

/**
 * Normalize compact_handoff tool result (YAML string legacy, or structured JSON from mcp-direct).
 * @param {unknown} out
 * @returns {{ yaml: string, ollama_prompt_tokens: number, ollama_completion_tokens: number }}
 */
function normalizeCompactHandoffResult(out) {
  if (typeof out === "string") {
    const yaml = out.trim();
    if (!yaml) throw new Error("compact_handoff returned empty output");
    if (yaml.startsWith("error:")) throw new Error(yaml.slice(0, 400));
    return { yaml, ollama_prompt_tokens: 0, ollama_completion_tokens: 0 };
  }
  if (out && typeof out === "object") {
    const o = /** @type {Record<string, unknown>} */ (out);
    if (typeof o.handoff_yaml === "string") {
      const yaml = o.handoff_yaml.trim();
      if (!yaml) throw new Error("compact_handoff returned empty output");
      if (yaml.startsWith("error:")) throw new Error(yaml.slice(0, 400));
      const p = typeof o.ollama_prompt_tokens === "number" && !Number.isNaN(o.ollama_prompt_tokens)
        ? o.ollama_prompt_tokens : 0;
      const c = typeof o.ollama_completion_tokens === "number" && !Number.isNaN(o.ollama_completion_tokens)
        ? o.ollama_completion_tokens : 0;
      return { yaml, ollama_prompt_tokens: p, ollama_completion_tokens: c };
    }
  }
  throw new Error(`compact_handoff unexpected return shape: ${String(JSON.stringify(out)).slice(0, 200)}`);
}

function callCompactHandoff({ text, modeCompleted, nextMode, iteration, maxIterations, flowMode }, { cwd } = {}) {
  if (useMcpDirectTransport()) {
    const out = invokeMcpDirect(
      "compact-handoff",
      "compact_handoff",
      {
        text,
        mode_completed: modeCompleted,
        next_mode: nextMode,
        iteration,
        max_iterations: maxIterations,
        flow_mode: flowMode,
      },
      { cwd },
    );
    return normalizeCompactHandoffResult(out);
  }
  gateMcpInvocation("compact-handoff", "compact_handoff", cwd);
  const prompt = `Call the MCP tool compact-handoff.compact_handoff with these arguments and return only the raw YAML string, no other text:
compact_handoff(
  text=${JSON.stringify(text)},
  mode_completed=${JSON.stringify(modeCompleted)},
  next_mode=${JSON.stringify(nextMode)},
  iteration=${iteration},
  max_iterations=${maxIterations},
  flow_mode=${JSON.stringify(flowMode)}
)`;
  const timeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 120000;
  const t0 = Date.now();
  try {
    const result = spawnSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: timeoutMs,
      cwd: cwd || process.cwd(),
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || "claude CLI error calling compact-handoff");
    recordMcpInvocation({
      server: "compact-handoff",
      tool: "compact_handoff",
      transport: "claude_cli",
      duration_ms: Date.now() - t0,
      ok: true,
    });
    return normalizeCompactHandoffResult(result.stdout);
  } catch (err) {
    recordMcpInvocation({
      server: "compact-handoff",
      tool: "compact_handoff",
      transport: "claude_cli",
      duration_ms: Date.now() - t0,
      ok: false,
    });
    throw err;
  }
}

module.exports = {
  beginMcpAudit,
  clearMcpAudit,
  getMcpAuditCalls,
  getPermissionCheckAuditBuffer,
  aggregateMcpUsage,
  emitPermissionCheckTrace,
  useMcpDirectTransport,
  parseMcpDirectStdout,
  sanitizeOrchestratorStateArgs,
  invokeMcpDirect,
  callStateMcp,
  normalizeCompactHandoffResult,
  callCompactHandoff,
};
