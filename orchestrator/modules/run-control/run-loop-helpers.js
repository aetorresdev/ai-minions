"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { validateHandoffForMode } = require("./qa-spec-flow");
const { _hashGoal, TRACE_REDACT_GOAL } = require("../trace/trace-writer");
const { runNetworkPermissionGate } = require("../../security/network-permission-gate");
const { emitPermissionCheckTrace } = require("../tools");
const {
  buildOllamaHttpPath,
  ollamaHttpTransport,
  resolveLocalRuntimeEndpoint,
  hasYamlLocalBackendEndpoint,
  resolveEnvOllamaHttpTarget,
} = require("../model-runtime/local-runtime-endpoint");

function stripLeadingOwnerArchitectForDegradedMultiAgent(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return steps;
  const scope = new Set(["owner", "architect"]);
  let i = 0;
  while (i < steps.length) {
    const id = String(steps[i].agentId || "").toLowerCase();
    if (!scope.has(id)) break;
    i += 1;
  }
  if (i === 0) return steps;
  const rest = steps.slice(i);
  const hasDev = rest.some((s) => String(s.agentId || "").toLowerCase().startsWith("dev"));
  return hasDev ? rest : steps;
}

const EDGE_TYPE_CATEGORY = Object.freeze({
  success: "control_flow",
  retry: "control_flow",
  fail: "failure",
  timeout: "failure",
  gate_block: "policy",
});

function edgeMeta(edgeType) {
  return { edge_type: edgeType, edge_category: EDGE_TYPE_CATEGORY[edgeType] ?? "unknown" };
}

function validateStepGraph(steps, validAgents) {
  const errors = [];
  if (!Array.isArray(steps)) {
    return { valid: false, errors: ["steps must be an array"] };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = step.agentId != null ? String(step.agentId).trim() : "";
    if (!agentId) {
      errors.push(`step[${i}] missing agentId`);
      continue;
    }
    if (!validAgents.has(agentId)) continue;
  }
  return { valid: errors.length === 0, errors };
}

function assertParentStepExists(parentStepId, emittedStepIds) {
  if (parentStepId !== null && !emittedStepIds.has(parentStepId)) {
    process.stderr.write(
      `[orchestrator] warning: parent_step_id "${parentStepId}" not found in emitted steps\n`,
    );
  }
}

function orchTestSystemPathHarnessOn() {
  return process.env.ORCH_TEST_SYSTEM_PATH_HARNESS === "1";
}

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const DEFAULT_MAX_REVIEW_CHARS = 0;

function parseOptionalNonNegativeInt(name, maxVal) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return null;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0 || n > maxVal) return null;
  return n;
}

function parseOptionalPositiveFloat(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseOptionalRatioWithInvalid(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return { value: null, invalid: null };
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return { value: null, invalid: { var_name: name, reason: "not_number" } };
  if (n <= 0 || n > 1) {
    return { value: null, invalid: { var_name: name, reason: "out_of_range", min_exclusive: 0, max_inclusive: 1 } };
  }
  return { value: n, invalid: null };
}

function parseBudgetLimitsJson() {
  const raw = process.env.ORCH_BUDGET_LIMITS_JSON;
  if (raw == null || String(raw).trim() === "") return { limits: {}, invalid: null };
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    return { limits: {}, invalid: { var_name: "ORCH_BUDGET_LIMITS_JSON", reason: "invalid_json", message: err.message } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { limits: {}, invalid: { var_name: "ORCH_BUDGET_LIMITS_JSON", reason: "not_object" } };
  }
  const limits = { roles: {}, steps: {}, models: {} };
  if (Object.prototype.hasOwnProperty.call(parsed, "run")) {
    const n = Number(parsed.run);
    if (Number.isFinite(n) && n > 0) limits.run = n;
  }
  for (const [src, dst] of [["roles", limits.roles], ["steps", limits.steps], ["models", limits.models]]) {
    const o = parsed[src];
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v);
      if (String(k).trim() && Number.isFinite(n) && n > 0) dst[String(k).trim()] = n;
    }
  }
  return { limits, invalid: null };
}

function parseEnvPositiveFloatOrNull(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function loadOllamaUsdRatesMtok() {
  const p = parseEnvPositiveFloatOrNull("ORCH_USD_PER_MTOK_PROMPT");
  const c = parseEnvPositiveFloatOrNull("ORCH_USD_PER_MTOK_COMPLETION");
  if (p == null || c == null) return null;
  return { prompt: p, completion: c };
}

function resolveMaxIterations(options) {
  if (options.maxIterations != null) {
    const n = Math.floor(Number(options.maxIterations));
    if (Number.isFinite(n) && n >= 1) return Math.min(500, n);
  }
  const raw = process.env.ORCH_MAX_ITERATIONS;
  if (raw !== undefined && String(raw).trim() !== "") {
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(500, n);
  }
  return DEFAULT_MAX_ITERATIONS;
}

function roundUsd6(x) {
  return Math.round(x * 1e6) / 1e6;
}

const AGENT_COLORS = {
  orchestrator: "\x1b[90m",
  owner: "\x1b[35m",
  architect: "\x1b[36m",
  "dev-backend": "\x1b[32m",
  "dev-frontend": "\x1b[34m",
  "dev-devops": "\x1b[33m",
  qa: "\x1b[33m",
  cerberus: "\x1b[31m",
  summarizer: "\x1b[96m",
  gate: "\x1b[95m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const AGENT_ICONS = {
  orchestrator: "◉",
  owner: "◆",
  architect: "⬢",
  "dev-backend": "●",
  "dev-frontend": "●",
  "dev-devops": "●",
  qa: "▲",
  cerberus: "✕",
  summarizer: "◈",
  gate: "⊙",
};

function agentLabel(agentId) {
  const color = AGENT_COLORS[agentId] || "";
  const icon = AGENT_ICONS[agentId] || "·";
  return `${color}${BOLD}${icon} [${agentId.toUpperCase()}]${RESET}`;
}

function log(agentId, message) {
  const ts = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${DIM}${ts}${RESET} ${agentLabel(agentId)} ${message}`);
}

function logRoleSwitch(fromId, toId) {
  const fromColor = AGENT_COLORS[fromId] || "";
  const toColor = AGENT_COLORS[toId] || "";
  const fromIcon = AGENT_ICONS[fromId] || "·";
  const toIcon = AGENT_ICONS[toId] || "·";
  const sep = "─".repeat(52);
  console.log(`\n${DIM}${sep}${RESET}`);
  console.log(`${fromColor}${BOLD}${fromIcon} ${fromId.toUpperCase()}${RESET} ${BOLD}→${RESET} ${toColor}${BOLD}${toIcon} ${toId.toUpperCase()}${RESET}`);
  console.log(`${DIM}${sep}${RESET}\n`);
}

const AGENT_STATE_FILE = path.join(os.homedir(), ".claude", "metrics", "active-agent.json");

function writeAgentState(agentId, goal) {
  try {
    const goalHash = _hashGoal(goal);
    const goalField = TRACE_REDACT_GOAL
      ? `[redacted:${goalHash}]`
      : `${String(goal).slice(0, 80)}… [sha256:${goalHash}]`;
    fs.writeFileSync(AGENT_STATE_FILE, JSON.stringify({
      flow: "multi_agent",
      goal: goalField,
      active_agent: agentId.toUpperCase(),
      updated_at: new Date().toISOString(),
    }));
  } catch { /* non-fatal */ }
}

function extractJson(text) {
  const trimmed = text.trim();
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = block ? block[1].trim() : trimmed;
  try { return JSON.parse(raw); } catch { return null; }
}

function validateHandoffStructure(mode, yaml, { strict = false, requireQaSpecRef = false } = {}) {
  if (mode === "DEV" || mode === "QA_SPEC" || mode === "QA_EXEC" || mode === "QA") {
    return validateHandoffForMode(mode, yaml, { strict, requireQaSpecRef });
  }

  if (!yaml || !yaml.trim()) {
    if (strict) {
      return { valid: false, reason: `${mode} handoff is empty — compact_handoff must be called before advance_mode in strict mode` };
    }
    return { valid: true, reason: "" };
  }

  const presentKeys = new Set();
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{0,2}(\w[\w_-]*):/);
    if (m) presentKeys.add(m[1]);
  }

  if (mode === "ARCHITECT") {
    const archKeys = ["decisions", "pending_for_next_mode", "design_summary", "risks"];
    const hasTop = archKeys.some((k) => presentKeys.has(k));
    const hasNested = /(^|\n)\s{1,12}(decisions|pending_for_next_mode|design_summary|risks)\s*:/m.test(yaml);
    if (!hasTop && !hasNested) {
      return {
        valid: false,
        reason: "ARCHITECT handoff must include decisions, pending_for_next_mode, design_summary, or risks",
      };
    }
  } else if (mode === "CERBERUS") {
    const hasVerdictTop = presentKeys.has("verdict");
    const hasVerdictNested = /(^|\n)\s{1,12}verdict\s*:/m.test(yaml);
    if (!hasVerdictTop && !hasVerdictNested) {
      return { valid: false, reason: "CERBERUS handoff must include verdict" };
    }
    if (presentKeys.has("blockers")) {
      const blockersMatch = yaml.match(/^blockers\s*:\s*\n((?:\s+-[^\n]+\n?)+)/m);
      if (blockersMatch) {
        return { valid: false, reason: "CERBERUS handoff has open blockers — resolve before closing" };
      }
    }
  }

  return { valid: true, reason: "" };
}

const BLOCKER_LINE_RE = /^.*\bblocker\b.*$/gim;

function detectBlockers(cerberusOutput) {
  const matches = cerberusOutput.match(BLOCKER_LINE_RE) || [];
  return { count: matches.length, items: matches.map((l) => l.trim()) };
}

const AGENT_TO_MODE = {
  owner: "OWNER",
  architect: "ARCHITECT",
  "dev-backend": "DEV",
  "dev-frontend": "DEV",
  "dev-devops": "DEV",
  qa: "QA",
  cerberus: "CERBERUS",
};

const VALID_WORKER_AGENTS = new Set(Object.keys(AGENT_TO_MODE));

const AGENTS_REQUIRING_GATE = new Set(["architect", "dev-backend", "dev-frontend", "dev-devops", "qa", "cerberus"]);

function checkOllama(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  /** @type {Record<string, unknown> | null} */
  let endpoint = null;
  let host;
  let port;
  let base_path;
  let protocol;

  if (hasYamlLocalBackendEndpoint(cwd)) {
    try {
      endpoint = resolveLocalRuntimeEndpoint({ cwd });
    } catch {
      return Promise.resolve(false);
    }
    host = endpoint.host;
    port = endpoint.port;
    base_path = endpoint.base_path ?? '';
    protocol = endpoint.protocol ?? 'http';
  } else {
    const envTarget = resolveEnvOllamaHttpTarget();
    host = envTarget.host;
    port = envTarget.port;
    base_path = envTarget.base_path;
    protocol = envTarget.protocol;
  }
  const tagsPath = buildOllamaHttpPath(base_path, '/api/tags');

  return new Promise((resolve) => {
    if (process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE !== "1") {
      try {
        /** @type {Record<string, unknown>} */
        const gateOpts = {
          repoRoot: cwd,
          role: "ORCHESTRATOR",
          actor: "orchestrator",
          hostname: host,
          port,
          tool: "ollama_health_check",
          pathLabel: tagsPath,
        };
        if (["cli_host_port", "cli_base_url", "model_policy_yaml"].includes(endpoint.source)) {
          gateOpts.operatorConfiguredEndpoint = endpoint;
        }
        const gate = runNetworkPermissionGate(gateOpts);
        emitPermissionCheckTrace(gate.tracePayload);
        const out = gate.output;
        if (out.decision === "deny" || out.decision === "requires_approval" || !out.safe_to_continue) {
          resolve(false);
          return;
        }
      } catch {
        resolve(false);
        return;
      }
    }
    const transport = ollamaHttpTransport(protocol);
    /** @type {import('http').RequestOptions} */
    const requestOpts = {
      hostname: host,
      port,
      path: tagsPath,
      method: "GET",
    };
    if (transport === https) {
      requestOpts.rejectUnauthorized = false;
    }
    const req = transport.request(requestOpts, (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

module.exports = {
  AGENT_STATE_FILE,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  EDGE_TYPE_CATEGORY,
  edgeMeta,
  validateStepGraph,
  assertParentStepExists,
  orchTestSystemPathHarnessOn,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_CONTEXT_CHARS,
  DEFAULT_MAX_REVIEW_CHARS,
  parseOptionalNonNegativeInt,
  parseOptionalPositiveFloat,
  parseOptionalRatioWithInvalid,
  parseBudgetLimitsJson,
  loadOllamaUsdRatesMtok,
  resolveMaxIterations,
  roundUsd6,
  log,
  logRoleSwitch,
  writeAgentState,
  extractJson,
  validateHandoffStructure,
  detectBlockers,
  AGENT_TO_MODE,
  VALID_WORKER_AGENTS,
  AGENTS_REQUIRING_GATE,
  checkOllama,
};
