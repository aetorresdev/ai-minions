/**
 * Autonomous orchestrator loop following the MODE protocol.
 *
 * Flow per iteration:
 *   1. ORCHESTRATOR plans (Ollama → JSON steps)
 *   2. Each step runs the assigned agent (claude CLI)
 *   3. compact-handoff MCP compacts each agent output → YAML
 *   4. orchestrator-state MCP validates alignment + gates the transition
 *   5. CERBERUS reviews the full iteration output
 *   6. ORCHESTRATOR decides: done or corrections (blockers only)
 *
 * Hard gates (orchestrator-state MCP):
 *   - register_task at session start
 *   - validate_goal_alignment before every DEV→QA and QA→CERBERUS advance
 *   - validate_transition dry-run before advance_mode
 *   - advance_mode records every MODE transition on disk
 *   - close_task at session end
 *
 * Requires:
 *   - Default: claude CLI in PATH — MCP tools invoked via `claude -p` (MCPs registered in Claude)
 *   - Ollama at localhost:11434 with qwen2.5-coder:7b (agents + compact-handoff server)
 *   - Optional **system-path E2E / CI without Claude MCP:** set `ORCH_MCP_TRANSPORT=direct` to call
 *     `mcp-direct.py` (Python + `mcp-servers` venvs) instead of the claude CLI for state store + compact_handoff.
 */

const { askAgent, summarizeHandoff, CONTRACT_VERSION, getDegradedAgents, clearDegradedAgents } = require("./agents");
const { formatArtifactLine, envInt, truncateForContext } = require("./context-utils");
const { spawnSync } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  createRunState,
  syncRunIteration,
  setStepRunning,
  setStepCompleted,
  setStepFailedAndClear,
  markStepRetryingAfterGate,
  finalizeRunState,
  getRunStatePublicView,
} = require("./run-state");
const {
  decideFromOrchestratorDecide,
  mapDecideLoopToPlanOutcome,
  planStepsAfterCorrectionsResponse,
  decideCerberusBlockersBranch,
  decideGateBlockedArtifactsBranch,
  decideCorrectionsPlan,
  loopExhaustedDefaultSummary,
  decideCostGuard,
  decideStepRetryGuard,
  formatGateBlockedReasonLines,
  planStepsReplayFromGateBlockedArtifacts,
  summaryMaxIterationsGateBlocked,
} = require("./decision-engine");
const { qaAgentDoneTraceExtras } = require("./agents/validate-output");

// ── Execution trace ───────────────────────────────────────────────────────────
// Writes one JSONL event per step to ~/.claude/metrics/traces/<task_id>.jsonl
// Every line: ts (ISO), ts_ms (epoch ms), trace_schema_version, task_id, …payload.
// trace_schema_version = TRACE_LINE_WRITER_VERSION from trace-schema.js (today "2").
// Event types: session_start, agent_start, agent_done, gate_result,
//              contract_fail, iteration_done, session_end, mcp_call,
//              context_stats may include ollama_prompt_tokens / ollama_completion_tokens (Ollama routes)
//              agent_done (qa): optional qa_triple_template + qa_blocker_non_vacuous for rollups
// iteration_done: transition_reason { type, reason_code, ... }; failure_type when outcome !== "done".
//
// Sensitive field handling:
//   goal  → truncated to 80 chars + SHA-256 hash (TRACE_REDACT_GOAL=1 omits text entirely)
//   task  → truncated to 120 chars
//   reason/summary → truncated to 300 chars
//   transition_reason.details → truncated to 300 chars
// Trace write failures emit a one-time stderr warning (not silenced).

const TRACES_DIR = process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim()
  ? path.resolve(String(process.env.ORCH_TRACES_DIR).trim())
  : path.join(require("os").homedir(), ".claude", "metrics", "traces");
const TRACE_REDACT_GOAL = process.env.TRACE_REDACT_GOAL === "1";

const {
  TRACE_LINE_WRITER_VERSION,
  validateTraceLine: validateTraceLineForWrite,
} = require("./trace-schema");

/** Same as `TRACE_LINE_WRITER_VERSION` in trace-schema.js — single source for writer + schema. */
const TRACE_SCHEMA_VERSION = TRACE_LINE_WRITER_VERSION;

// ── MCP usage audit (per run) ───────────────────────────────────────────────
let _mcpAuditTaskId = null;
/** @type {{ server: string, tool: string, transport: string, duration_ms: number, ok: boolean }[]} */
let _mcpAuditCalls = [];

function beginMcpAudit(taskId) {
  _mcpAuditTaskId = taskId;
  _mcpAuditCalls = [];
}

function clearMcpAudit() {
  _mcpAuditTaskId = null;
  _mcpAuditCalls = [];
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

/**
 * In degraded multi_agent (`skipStateMcp`), planners often prepend owner/architect before DEV;
 * those roles often fail output contracts on local Ollama before any dev-* step runs.
 * Remove only leading owner/architect steps when a dev-* step still exists later.
 * @param {{ agentId?: string, task?: string }[]} steps
 */
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

// ── edge_type taxonomy ────────────────────────────────────────────────────────
// Categorises each edge_type value into a semantic layer so consumers can
// filter by category without parsing individual type strings.
//   control_flow — normal execution progression (success, retry)
//   failure      — hard stops (fail, timeout)
//   policy       — gate decisions (gate_block)
const EDGE_TYPE_CATEGORY = Object.freeze({
  success:    "control_flow",
  retry:      "control_flow",
  fail:       "failure",
  timeout:    "failure",
  gate_block: "policy",
});

/**
 * Returns { edge_type, edge_category } for a given edge type string.
 * edge_category defaults to "unknown" for forward-compat with future types.
 * @param {string} edgeType
 * @returns {{ edge_type: string, edge_category: string }}
 */
function edgeMeta(edgeType) {
  return { edge_type: edgeType, edge_category: EDGE_TYPE_CATEGORY[edgeType] ?? "unknown" };
}

// ── graph validation ──────────────────────────────────────────────────────────
/**
 * Validates the step graph before execution begins.
 * Checks structural issues detectable before run:
 *   - steps must be an array
 *   - each step must have agentId or agent field
 *
 * parent_step_id references are validated at emit time via assertParentStepExists
 * since stepIds are computed dynamically during the loop.
 *
 * @param {{ agentId?: string, agent?: string, task?: string }[]} steps
 * @param {Set<string>} validAgents
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStepGraph(steps, validAgents) {
  const errors = [];
  if (!Array.isArray(steps)) {
    return { valid: false, errors: ["steps must be an array"] };
  }
  const seen = new Map(); // agentId → count (for stepId collision detection)
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = step.agentId || step.agent;
    if (!agentId) {
      errors.push(`step[${i}] missing agentId/agent field`);
      continue;
    }
    if (!validAgents.has(agentId)) continue; // skipped by loop — not an error
    seen.set(agentId, (seen.get(agentId) || 0) + 1);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a parent_step_id reference at emit time.
 * Called before emitting any trace event that carries parent_step_id.
 * Logs a one-time warning per invalid reference — does NOT throw.
 * @param {string|null} parentStepId
 * @param {Set<string>} emittedStepIds
 */
function assertParentStepExists(parentStepId, emittedStepIds) {
  if (parentStepId !== null && !emittedStepIds.has(parentStepId)) {
    process.stderr.write(
      `[orchestrator] warning: parent_step_id "${parentStepId}" not found in emitted steps\n`
    );
  }
}

function recordMcpInvocation(entry) {
  if (!_mcpAuditTaskId) return;
  _mcpAuditCalls.push(entry);
  traceEvent(_mcpAuditTaskId, { event: "mcp_call", ...entry });
}

/**
 * Test-only harness: exercise real MCP + disk transitions without trusting the alignment LLM
 * (stubs + `enforce_goal_alignment: false` + Node bypass when `aligned === false`).
 * **Not** production-safe; **not** "strict E2E" in the product sense. Set only from `tests/e2e.strict.test.js`.
 */
function orchTestSystemPathHarnessOn() {
  return process.env.ORCH_TEST_SYSTEM_PATH_HARNESS === "1";
}
let _traceWarnEmitted = false;

function _hashGoal(text) {
  return require("crypto").createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function _sanitize(event) {
  const out = { ...event };
  if ("goal" in out) {
    const h = _hashGoal(out.goal);
    out.goal = TRACE_REDACT_GOAL ? `[redacted:${h}]` : `${String(out.goal).slice(0, 80)}… [sha256:${h}]`;
  }
  if ("task" in out) out.task = String(out.task).slice(0, 120);
  if ("reason" in out) out.reason = String(out.reason).slice(0, 300);
  if ("summary" in out) out.summary = String(out.summary).slice(0, 300);
  if (out.transition_reason && typeof out.transition_reason === "object" && out.transition_reason !== null) {
    const tr = { ...out.transition_reason };
    if ("details" in tr && tr.details != null) tr.details = String(tr.details).slice(0, 300);
    if ("gate_id" in tr && tr.gate_id != null) tr.gate_id = String(tr.gate_id).slice(0, 120);
    if ("step_id" in tr && tr.step_id != null) tr.step_id = String(tr.step_id).slice(0, 240);
    if (out.event === "iteration_done" && tr.type && !tr.reason_code) {
      tr.reason_code = inferReasonCode(String(tr.type), tr.details);
    }
    out.transition_reason = tr;
  }
  if ("failure_type" in out && out.failure_type != null) {
    out.failure_type = String(out.failure_type).slice(0, 64);
  }
  if ("failure_axis" in out && out.failure_axis != null) {
    out.failure_axis = String(out.failure_axis).slice(0, 32);
  }
  if (typeof out.intent_id === "string") {
    out.intent_id = out.intent_id.slice(0, 64);
  }
  if (Array.isArray(out.intent_ids)) {
    out.intent_ids = out.intent_ids
      .filter((x) => typeof x === "string")
      .map((x) => x.slice(0, 64))
      .slice(0, 48);
  }
  return out;
}

/** Closed catalog for `iteration_done.failure_type` (JSON Schema + trace taxonomy). */
const FAILURE_TYPES = /** @type {const} */ ([
  "spec_missing",
  "contract_mismatch",
  "hallucination",
  "tool_error",
  "timeout",
  "cost_abort",
  "retry_exceeded",
]);
const FAILURE_TYPE_SET = new Set(FAILURE_TYPES);

/** Middle-layer axis for dashboards — pairs with coarse `failure_type`. */
const FAILURE_AXES = /** @type {const} */ ([
  "guard",
  "cerberus",
  "gate_artifact",
  "gate_tool",
  "orchestrate",
  "loop_cap",
  "contract",
  "unknown",
]);
const FAILURE_AXIS_SET = new Set(FAILURE_AXES);

/** Allowed values for iteration_done.transition_reason.type. */
const TRANSITION_REASON_TYPES = new Set([
  "DONE",
  "VALIDATION_FAIL",
  "GATE_BLOCK",
  "MAX_ITERATIONS",
  "CONTRACT_FAIL",
  "ITERATE_FALLBACK",
  "ITERATE",
  "GUARD",
]);

/** Closed catalog for analytics / aggregation (JSON Schema enum in schemas/trace-v2-line.schema.json). */
const TRANSITION_REASON_CODES = new Set([
  "RUN_COMPLETED",
  "CERBERUS_BLOCKERS_ITERATE",
  "ORCHESTRATOR_NO_CORRECTIONS_JSON",
  "MAX_ITERATIONS_CERBERUS_BLOCKERS",
  "GATE_ARTIFACT_OR_HANDOFF",
  "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS",
  "ORCHESTRATOR_DECIDE_CORRECTIONS",
  "CONTRACT_OR_DECIDE_FAILURE",
  "VALIDATION_FAILURE_GENERIC",
  "GUARD_COST_LIMIT",
  "GUARD_STEP_RETRY_LIMIT",
  "MAX_ITERATIONS_LOOP_EXHAUSTED",
]);

/**
 * Map orchestrator semantics → coarse `failure_type` on iteration_done.
 *
 * **Design:** `failure_type` is intentionally a small rollup (env guardrails, high-level SLOs).
 * For dashboards and drill-down, pair with **`transition_reason.reason_code`** (stable enum:
 * CERBERUS_BLOCKERS_ITERATE, ORCHESTRATOR_DECIDE_CORRECTIONS, GATE_ARTIFACT_OR_HANDOFF, …) —
 * that is the dimension that distinguishes “cerberus vs decide vs gate” today; do not infer
 * sub-categories from free text alone.
 *
 * **`tool_error` (v1):** emitted when gate-blocked iteration is driven by **`compact_handoff`**
 * MCP failure (`gate_kind`). Other MCP/tool surfaces should get explicit branches here (or
 * new `reason_code` values) before reusing `tool_error`, to avoid silent semantic drift.
 *
 * @param {string} outcome
 * @param {string} reasonCode — transition_reason.reason_code
 * @param {{ gateKinds?: string[] }} [ctx]
 * @returns {string | null} null when outcome is terminal success (`done`)
 */
function failureTypeForIterationDone(outcome, reasonCode, ctx = {}) {
  if (outcome === "done") return null;
  const kinds = ctx.gateKinds || [];
  if (outcome === "gate_blocked_iterate" && kinds.some((k) => k === "compact_handoff")) {
    return "tool_error";
  }
  if (
    reasonCode === "MAX_ITERATIONS_CERBERUS_BLOCKERS" ||
    reasonCode === "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS" ||
    reasonCode === "MAX_ITERATIONS_LOOP_EXHAUSTED" ||
    reasonCode === "GUARD_STEP_RETRY_LIMIT"
  ) {
    return "retry_exceeded";
  }
  if (reasonCode === "GUARD_COST_LIMIT") return "cost_abort";
  return "contract_mismatch";
}

/**
 * Analytics axis: use with `failure_type` and `transition_reason.reason_code` in dashboards.
 * @param {string} outcome
 * @param {string} reasonCode
 * @param {{ gateKinds?: string[] }} [ctx]
 * @returns {string}
 */
function failureAxisForIterationDone(outcome, reasonCode, ctx = {}) {
  if (outcome === "done") return "unknown";
  const rc = String(reasonCode || "");
  const kinds = ctx.gateKinds || [];
  if (rc === "GUARD_COST_LIMIT" || rc === "GUARD_STEP_RETRY_LIMIT") return "guard";
  if (outcome === "gate_blocked_iterate" && kinds.some((k) => k === "compact_handoff")) return "gate_tool";
  if (
    rc === "CERBERUS_BLOCKERS_ITERATE" ||
    rc === "MAX_ITERATIONS_CERBERUS_BLOCKERS" ||
    outcome === "max_iterations_with_blockers"
  ) {
    return "cerberus";
  }
  if (
    rc === "GATE_ARTIFACT_OR_HANDOFF" ||
    rc === "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS" ||
    outcome === "max_iterations_with_gate_blocks"
  ) {
    return "gate_artifact";
  }
  if (rc === "ORCHESTRATOR_DECIDE_CORRECTIONS" || rc === "ORCHESTRATOR_NO_CORRECTIONS_JSON") return "orchestrate";
  if (rc === "MAX_ITERATIONS_LOOP_EXHAUSTED" || outcome === "loop_limit_stopped") return "loop_cap";
  if (rc === "CONTRACT_OR_DECIDE_FAILURE" || outcome === "stopped") return "contract";
  return "unknown";
}

/**
 * Assemble the `iteration_done` trace row (writer contract). Used by `traceIterationDone` and emitter contract tests.
 * @param {number} iteration
 * @param {string} outcome
 * @param {ReturnType<typeof transitionReason>} trSpread
 * @param {Record<string, unknown>} [extra]
 * @param {{ gateKinds?: string[], intent_ids?: string[] }} [ctx]
 * @returns {Record<string, unknown>}
 */
function composeIterationDonePayload(iteration, outcome, trSpread, extra = {}, ctx = {}) {
  const reasonCode = trSpread.transition_reason && trSpread.transition_reason.reason_code;
  const rcs = reasonCode != null ? String(reasonCode) : "";
  if (!TRANSITION_REASON_CODES.has(rcs)) {
    throw new Error(`iteration_done: transition_reason.reason_code missing or not in catalog (${JSON.stringify(reasonCode)})`);
  }
  const payload = {
    event: "iteration_done",
    iteration,
    outcome,
    ...trSpread,
    ...extra,
  };
  const ft = failureTypeForIterationDone(outcome, rcs, ctx);
  if (ft != null) {
    if (!FAILURE_TYPE_SET.has(ft)) {
      throw new Error(`internal: invalid failure_type ${ft}`);
    }
    payload.failure_type = ft;
  }
  if (outcome !== "done") {
    const axis = failureAxisForIterationDone(outcome, rcs, ctx);
    if (!FAILURE_AXIS_SET.has(axis)) throw new Error(`internal: invalid failure_axis ${axis}`);
    payload.failure_axis = axis;
  }
  if (ctx.intent_ids && ctx.intent_ids.length) {
    payload.intent_ids = ctx.intent_ids.slice(0, 48);
  }
  return payload;
}

/**
 * @param {string} taskId
 * @param {number} iteration
 * @param {string} outcome
 * @param {ReturnType<typeof transitionReason>} trSpread
 * @param {Record<string, unknown>} [extra]
 * @param {{ gateKinds?: string[], intent_ids?: string[] }} [ctx]
 */
function traceIterationDone(taskId, iteration, outcome, trSpread, extra = {}, ctx = {}) {
  traceEvent(taskId, composeIterationDonePayload(iteration, outcome, trSpread, extra, ctx));
}

/**
 * Map (type, details) → stable reason_code. Extend when adding new iteration_done paths.
 * @param {string} type
 * @param {string|undefined} details
 */
function inferReasonCode(type, details) {
  const d = details == null ? "" : String(details);
  if (type === "DONE") return "RUN_COMPLETED";
  if (type === "VALIDATION_FAIL") return "VALIDATION_FAILURE_GENERIC";
  if (type === "GATE_BLOCK" && d === "cerberus_blockers") return "CERBERUS_BLOCKERS_ITERATE";
  if (type === "ITERATE_FALLBACK" && d === "orchestrator_no_corrections_json") return "ORCHESTRATOR_NO_CORRECTIONS_JSON";
  if (type === "MAX_ITERATIONS" && d === "cerberus_blockers_cap") return "MAX_ITERATIONS_CERBERUS_BLOCKERS";
  if (type === "GATE_BLOCK" && d === "artifact_contract_or_handoff") return "GATE_ARTIFACT_OR_HANDOFF";
  if (type === "MAX_ITERATIONS" && d === "gate_blocked_artifacts_cap") return "MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS";
  if (type === "ITERATE" && d === "orchestrator_decide_corrections") return "ORCHESTRATOR_DECIDE_CORRECTIONS";
  if (type === "CONTRACT_FAIL") return "CONTRACT_OR_DECIDE_FAILURE";
  if (type === "MAX_ITERATIONS" && d === "loop_exhausted_without_done") return "MAX_ITERATIONS_LOOP_EXHAUSTED";
  throw new Error(`cannot infer reason_code for transition_reason type=${type} details=${d.slice(0, 80)}`);
}

/**
 * Structured transition reason for iteration_done.
 * @param {string} type — must be in TRANSITION_REASON_TYPES
 * @param {string} [details]
 * @param {{ reason_code?: string, gate_id?: string, step_id?: string }} [meta] — optional overrides / correlation fields
 * @returns {{ transition_reason: { type: string, reason_code: string, details?: string, gate_id?: string, step_id?: string } }}
 */
function transitionReason(type, details, meta = {}) {
  if (!TRANSITION_REASON_TYPES.has(type)) {
    throw new Error(`invalid transition_reason.type: ${type}`);
  }
  const reason_code = meta.reason_code != null && String(meta.reason_code).length
    ? String(meta.reason_code)
    : inferReasonCode(type, details);
  if (!TRANSITION_REASON_CODES.has(reason_code)) {
    throw new Error(`invalid transition_reason.reason_code: ${reason_code}`);
  }
  const transition_reason = { type, reason_code };
  if (details != null && String(details).length > 0) {
    transition_reason.details = String(details).slice(0, 300);
  }
  if (meta.gate_id != null && String(meta.gate_id).length > 0) {
    transition_reason.gate_id = String(meta.gate_id).slice(0, 120);
  }
  if (meta.step_id != null && String(meta.step_id).length > 0) {
    transition_reason.step_id = String(meta.step_id).slice(0, 240);
  }
  return { transition_reason };
}

function traceEvent(taskId, event) {
  const tsMs = Date.now();
  const sanitized = _sanitize(event);
  const record = {
    ...sanitized,
    task_id: taskId,
    trace_schema_version: TRACE_SCHEMA_VERSION,
    ts: new Date(tsMs).toISOString(),
    ts_ms: tsMs,
  };
  const v = validateTraceLineForWrite(record);
  if (!v.ok) {
    throw new Error(`trace line failed JSON Schema: ${v.errors.join("; ")}`);
  }
  try {
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const line = JSON.stringify(record);
    fs.appendFileSync(path.join(TRACES_DIR, `${taskId}.jsonl`), line + "\n");
  } catch (err) {
    if (!_traceWarnEmitted) {
      process.stderr.write(`[trace] WARNING: could not write trace (${err.message}) — tracing disabled for this session\n`);
      _traceWarnEmitted = true;
    }
  }
}

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const DEFAULT_MAX_REVIEW_CHARS = 0;

/** @param {string} name @param {number} maxVal */
function parseOptionalNonNegativeInt(name, maxVal) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return null;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0 || n > maxVal) return null;
  return n;
}

/** @param {string} name */
function parseOptionalPositiveFloat(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** @param {string} name */
function parseEnvPositiveFloatOrNull(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** USD per 1e6 tokens — same basis as `token-trace-report.js`. */
function loadOllamaUsdRatesMtok() {
  const p = parseEnvPositiveFloatOrNull("ORCH_USD_PER_MTOK_PROMPT");
  const c = parseEnvPositiveFloatOrNull("ORCH_USD_PER_MTOK_COMPLETION");
  if (p == null || c == null) return null;
  return { prompt: p, completion: c };
}

/**
 * @param {{ maxIterations?: number }} options
 * @returns {number}
 */
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
  orchestrator:  "\x1b[90m",  // gray
  owner:         "\x1b[35m",  // magenta
  architect:     "\x1b[36m",  // cyan
  "dev-backend": "\x1b[32m",  // green
  "dev-frontend":"\x1b[34m",  // blue
  "dev-devops":  "\x1b[33m",  // yellow
  qa:            "\x1b[33m",  // yellow
  cerberus:      "\x1b[31m",  // red
  summarizer:    "\x1b[96m",  // bright cyan
  gate:          "\x1b[95m",  // magenta bright
};
const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

const AGENT_ICONS = {
  orchestrator:  "◉",
  owner:         "◆",
  architect:     "⬢",
  "dev-backend": "●",
  "dev-frontend":"●",
  "dev-devops":  "●",
  qa:            "▲",
  cerberus:      "✕",
  summarizer:    "◈",
  gate:          "⊙",
};

function agentLabel(agentId) {
  const color = AGENT_COLORS[agentId] || "";
  const icon  = AGENT_ICONS[agentId] || "·";
  return `${color}${BOLD}${icon} [${agentId.toUpperCase()}]${RESET}`;
}

function log(agentId, message) {
  const ts = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${DIM}${ts}${RESET} ${agentLabel(agentId)} ${message}`);
}

function logRoleSwitch(fromId, toId) {
  const fromColor = AGENT_COLORS[fromId] || "";
  const toColor   = AGENT_COLORS[toId]   || "";
  const fromIcon  = AGENT_ICONS[fromId]  || "·";
  const toIcon    = AGENT_ICONS[toId]    || "·";
  const sep = "─".repeat(52);
  console.log(`\n${DIM}${sep}${RESET}`);
  console.log(`${fromColor}${BOLD}${fromIcon} ${fromId.toUpperCase()}${RESET} ${BOLD}→${RESET} ${toColor}${BOLD}${toIcon} ${toId.toUpperCase()}${RESET}`);
  console.log(`${DIM}${sep}${RESET}\n`);
}

const AGENT_STATE_FILE = require("os").homedir() + "/.claude/metrics/active-agent.json";

function writeAgentState(agentId, goal) {
  try {
    const goalHash = _hashGoal(goal);
    const goalField = TRACE_REDACT_GOAL
      ? `[redacted:${goalHash}]`
      : `${String(goal).slice(0, 80)}… [sha256:${goalHash}]`;
    require("fs").writeFileSync(AGENT_STATE_FILE, JSON.stringify({
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

// ── Handoff structural validation ────────────────────────────────────────────

/**
 * Shallow key-presence / line-shape check on a handoff YAML string per MODE.
 * No semantic parsing — does **not** prove YAML content is true (e.g. a invented
 * `validation_run` can still pass shape checks). Heuristic only; not a substitute
 * for artifact-grounded review.
 *
 * @param {string} mode - ORCHESTRATOR mode (DEV, QA, CERBERUS, ...)
 * @param {string} yaml - handoff YAML produced by compact-handoff MCP
 * @param {{ strict?: boolean }} options
 *   strict=false (default): empty YAML passes — compact-handoff may not be registered
 *   strict=true:            empty YAML fails — compact-handoff is required in strict mode
 *
 * Required keys:
 *   DEV      → files_modified OR validation_run
 *   QA       → verdict AND (findings OR issues)
 *   CERBERUS → verdict AND blockers must be empty/absent
 *
 * Returns { valid: boolean, reason: string }
 */
function validateHandoffStructure(mode, yaml, { strict = false } = {}) {
  if (!yaml || !yaml.trim()) {
    if (strict) return { valid: false, reason: `${mode} handoff is empty — compact_handoff must be called before advance_mode in strict mode` };
    return { valid: true, reason: "" };
  }

  // Extract top-level keys from YAML without a full parser
  // Matches "key:" at the start of a line (with optional leading spaces)
  const presentKeys = new Set();
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{0,2}(\w[\w_-]*):/);
    if (m) presentKeys.add(m[1]);
  }

  if (mode === "DEV") {
    const hasTop = presentKeys.has("files_modified") || presentKeys.has("validation_run");
    // compact-handoff often nests keys under `handoff:` (indented >2 spaces) — shallow top-level scan misses them
    const hasNested =
      /(^|\n)\s{1,12}files_modified\s*:/m.test(yaml) || /(^|\n)\s{1,12}validation_run\s*:/m.test(yaml);
    if (!hasTop && !hasNested) {
      return { valid: false, reason: "DEV handoff must include files_modified or validation_run" };
    }
  } else if (mode === "QA") {
    if (!presentKeys.has("verdict")) {
      return { valid: false, reason: "QA handoff must include verdict" };
    }
    if (!presentKeys.has("findings") && !presentKeys.has("issues")) {
      return { valid: false, reason: "QA handoff must include findings or issues" };
    }
  } else if (mode === "CERBERUS") {
    const hasVerdictTop = presentKeys.has("verdict");
    const hasVerdictNested = /(^|\n)\s{1,12}verdict\s*:/m.test(yaml);
    if (!hasVerdictTop && !hasVerdictNested) {
      return { valid: false, reason: "CERBERUS handoff must include verdict" };
    }
    // Block if blockers key is present with a non-empty list
    if (presentKeys.has("blockers")) {
      const blockersMatch = yaml.match(/^blockers\s*:\s*\n((?:\s+-[^\n]+\n?)+)/m);
      if (blockersMatch) {
        return { valid: false, reason: "CERBERUS handoff has open blockers — resolve before closing" };
      }
    }
  }

  return { valid: true, reason: "" };
}

// ── MCP gate helpers ──────────────────────────────────────────────────────────

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

/**
 * Call compact-handoff or orchestrator-state via mcp-direct.py (no claude CLI).
 */
function invokeMcpDirect(server, toolName, args) {
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

/**
 * Call an orchestrator-state MCP tool via the claude CLI or mcp-direct (ORCH_MCP_TRANSPORT=direct).
 * Returns parsed JSON response or throws on failure.
 */
function callStateMcp(toolName, args, { cwd } = {}) {
  void cwd;
  if (useMcpDirectTransport()) {
    const parsed = invokeMcpDirect("orchestrator-state", toolName, sanitizeOrchestratorStateArgs(toolName, args));
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`orchestrator-state.${toolName} returned non-JSON`);
    }
    return parsed;
  }
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
 * Call compact-handoff MCP to compact agent output into handoff YAML.
 */
/**
 * When true, compact_handoff failure is a hard gate (gateBlocked).
 * When false, failure uses explicit fallback metadata (run continues in degraded mode).
 * Default: same as strict mode — derived from !skipStateMcp unless overridden.
 */
function resolveRequireHandoff(options) {
  if (typeof options.requireHandoff === "boolean") return options.requireHandoff;
  return options.skipStateMcp !== true;
}

/** Structured metadata when compact_handoff fails in degraded mode (policy B). */
function compactHandoffDegradedMeta(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoff_compression: "unavailable",
    handoff_fallback_used: true,
    handoff_error: msg,
  };
}

/** Artifact fields when compact_handoff fails in strict mode (policy A). */
function compactHandoffStrictFailureFields(err) {
  const msg = err && err.message ? String(err.message) : "unknown error";
  return {
    handoffYaml: "",
    gateBlocked: true,
    gateReason: `compact_handoff failed: ${msg}`,
    handoff_compression: "failed",
    handoff_error: msg,
  };
}

function callCompactHandoff({ text, modeCompleted, nextMode, iteration, maxIterations, flowMode }, { cwd } = {}) {
  void cwd;
  if (useMcpDirectTransport()) {
    const out = invokeMcpDirect("compact-handoff", "compact_handoff", {
      text,
      mode_completed: modeCompleted,
      next_mode: nextMode,
      iteration,
      max_iterations: maxIterations,
      flow_mode: flowMode,
    });
    const yaml = typeof out === "string" ? out : "";
    if (!yaml.trim()) throw new Error("compact_handoff returned empty output");
    if (yaml.startsWith("error:")) throw new Error(yaml.slice(0, 400));
    return yaml.trim();
  }
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
    return result.stdout.trim();
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

// ── Blocker detection (deterministic) ────────────────────────────────────────
//
// Parses CERBERUS output for blocker findings without model interpretation.
// Returns { count, items } where items are the matched lines.
//
// Matches lines like:
//   - blocker: missing validation
//   **blocker** — no auth check
//   type: blocker
//   [blocker] broken flow
//
const BLOCKER_LINE_RE = /^.*\bblocker\b.*$/gim;

function detectBlockers(cerberusOutput) {
  const matches = cerberusOutput.match(BLOCKER_LINE_RE) || [];
  return { count: matches.length, items: matches.map(l => l.trim()) };
}

// ── MODE mapping ──────────────────────────────────────────────────────────────

const AGENT_TO_MODE = {
  owner:         "OWNER",
  architect:     "ARCHITECT",
  "dev-backend": "DEV",
  "dev-frontend":"DEV",
  "dev-devops":  "DEV",
  qa:            "QA",
  cerberus:      "CERBERUS",
};

const VALID_WORKER_AGENTS = new Set(Object.keys(AGENT_TO_MODE));

// Agents that require compact_handoff + validate_goal_alignment before advancing
const AGENTS_REQUIRING_GATE = new Set(["dev-backend", "dev-frontend", "dev-devops", "qa", "cerberus"]);

// ── Ollama connectivity check ─────────────────────────────────────────────────

/**
 * Ping Ollama API to verify it is reachable.
 * Returns true if Ollama responds, false otherwise.
 */
function checkOllama() {
  const host = process.env.OLLAMA_HOST || "localhost";
  const port = parseInt(process.env.OLLAMA_PORT || "11434", 10);
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.request({ hostname: host, port, path: "/api/tags", method: "GET" }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

// ── Environment access parsing ────────────────────────────────────────────────

/**
 * Parse the ENVIRONMENT block from a session prompt header.
 * Supports:
 *   ENVIRONMENT:
 *     mode: read | write
 *     credentials:
 *       - name: n8n
 *         type: api_key
 *         vars:
 *           url: N8N_URL
 *           key: N8N_API_KEY
 *
 * Returns null if no ENVIRONMENT block found.
 * Returns { mode: "read"|"write", credentials: [{ name, type, vars: {} }] }
 */
function parseEnvironment(prompt) {
  // Extract everything after ENVIRONMENT: until next top-level key or end
  const envMatch = prompt.match(/^ENVIRONMENT:\s*\n((?:[ \t]+[^\n]*\n?)*)/m);
  if (!envMatch) return null;

  const block = envMatch[1];

  // Parse mode
  const modeMatch = block.match(/^\s+mode:\s*(read|write)\s*$/m);
  const mode = modeMatch ? modeMatch[1] : "read";  // default: read (safe)

  // Parse credentials list — each starts with "- name:"
  const credentials = [];
  const credBlocks = block.split(/\n\s+-\s+name:/);
  for (let i = 1; i < credBlocks.length; i++) {
    const cb = credBlocks[i];
    const name = cb.match(/^([^\n]+)/)?.[1]?.trim();
    const type = cb.match(/\btype:\s*([^\n]+)/)?.[1]?.trim();
    if (!name || !type) continue;

    // Parse vars block (indented key: ENV_VAR pairs)
    const vars = {};
    const varsMatch = cb.match(/\bvars:\s*\n((?:\s{8,}[^\n]+\n?)*)/);
    if (varsMatch) {
      for (const line of varsMatch[1].split("\n")) {
        const kv = line.match(/^\s+(\w+):\s*([^\s#][^\n]*)/);
        if (kv) vars[kv[1].trim()] = kv[2].trim();
      }
    }
    credentials.push({ name, type, vars });
  }

  return { mode, credentials };
}

// ── Main run function ─────────────────────────────────────────────────────────

/**
 * Runs the orchestrator loop.
 * @param {string} goal - Goal / epic / task description
 * @param {{
 *   maxIterations?: number — outer loop cap; explicit option beats **ORCH_MAX_ITERATIONS** (1–500), then default 3,
 *   cwd?: string,
 *   flowMode?: string,
 *   taskId?: string,
 *   approvedArtifacts?: string[],
 *   maxContextCharsPerArtifact?: number,
 *   maxReviewCharsPerArtifact?: number,
 *   stepSummary?: boolean,
 *   skipStateMcp?: boolean
 *   requireHandoff?: boolean — if set, overrides default: strict (!skipStateMcp) requires compact_handoff; degraded skips hard fail
 *   traceScenarioId?: string — optional label written to trace `session_start` / `session_end` as `scenario_id` (batch metrics export). Env: ORCH_TRACE_SCENARIO_ID.
 * }} options
 */
async function run(goal, options = {}) {
  const maxIterations = resolveMaxIterations(options);
  const maxCostUsd = parseOptionalPositiveFloat("ORCH_MAX_COST_USD");
  const usdRatesMtok = loadOllamaUsdRatesMtok();
  if (maxCostUsd != null && !usdRatesMtok) {
    throw new Error(
      "ORCH_MAX_COST_USD requires both ORCH_USD_PER_MTOK_PROMPT and ORCH_USD_PER_MTOK_COMPLETION (non-negative floats, USD per 1e6 tokens; same basis as token-trace-report).",
    );
  }
  const maxStepRetries = parseOptionalNonNegativeInt("ORCH_MAX_RETRIES", 500);

  const cwd           = options.cwd || process.cwd();
  const flowMode      = options.flowMode || "single_agent";
  const taskId        = options.taskId || `task-${randomUUID().slice(0, 8)}`;
  const rawScenario = options.traceScenarioId ?? process.env.ORCH_TRACE_SCENARIO_ID ?? "";
  const scenarioId = String(rawScenario).trim() ? String(rawScenario).trim().slice(0, 240) : null;
  beginMcpAudit(taskId);
  const approvedArtifacts = options.approvedArtifacts || [];
  const skipStateMcp  = options.skipStateMcp === true;
  const requireHandoff = resolveRequireHandoff(options);

  const maxContextChars = options.maxContextCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS);
  const maxReviewChars  = options.maxReviewCharsPerArtifact
    ?? envInt("AI_TEAM_MAX_REVIEW_CHARS_PER_ARTIFACT", DEFAULT_MAX_REVIEW_CHARS);
  const stepSummary = options.stepSummary !== undefined
    ? Boolean(options.stepSummary)
    : process.env.AI_TEAM_STEP_SUMMARY !== "0";

  const sessionEnv = options.sessionEnv || parseEnvironment(goal) || null;

  const artifacts = [];
  let plan        = { steps: [] };
  let iterations  = 0;
  let done          = false;
  let summary       = "";
  let manualReview  = false;  // set true in gate-blocked or CERBERUS-unresolved paths
  /** When true, skip advance_mode + main iteration loop (e.g. plan-phase cost guard). */
  let skipMainOrchestrationLoop = false;
  const runState = createRunState({
    taskId,
    flowMode,
    goal,
    maxIterations,
  });
  const ollamaTokenTotals = { prompt: 0, completion: 0 };
  function bumpOllamaFromStats(stats) {
    if (!stats || typeof stats !== "object") return;
    if (typeof stats.ollama_prompt_tokens === "number" && !Number.isNaN(stats.ollama_prompt_tokens)) {
      ollamaTokenTotals.prompt += stats.ollama_prompt_tokens;
    }
    if (typeof stats.ollama_completion_tokens === "number" && !Number.isNaN(stats.ollama_completion_tokens)) {
      ollamaTokenTotals.completion += stats.ollama_completion_tokens;
    }
  }
  function estimateRunUsd() {
    if (!usdRatesMtok) return null;
    return (ollamaTokenTotals.prompt / 1e6) * usdRatesMtok.prompt
      + (ollamaTokenTotals.completion / 1e6) * usdRatesMtok.completion;
  }
  /** @returns {{ ok: true } | { ok: false, estimate: number }} */
  function checkCostGuard() {
    if (maxCostUsd == null || !usdRatesMtok) return { ok: true };
    const estimate = estimateRunUsd();
    if (estimate == null || !Number.isFinite(estimate)) return { ok: true };
    if (estimate > maxCostUsd) return { ok: false, estimate };
    return { ok: true };
  }
  let currentMode = "ORCHESTRATOR";
  const degradedInRun = new Set(); // agents that ran in fallback at least once this run
  clearDegradedAgents();

  log("orchestrator", `Working directory: ${cwd}`);
  log("orchestrator", `task_id: ${taskId} | flow: ${flowMode} | max_iterations: ${maxIterations}`);
  if (sessionEnv) {
    const credNames = sessionEnv.credentials.map(c => c.name).join(", ");
    log("orchestrator", `Environment: mode=${sessionEnv.mode} | credentials: ${credNames || "none"}`);
  }

  // ── Ollama connectivity check ────────────────────────────────────────────────
  const ollamaModel = process.env.OLLAMA_MODEL || null;
  if (ollamaModel) {
    const ollamaOk = await checkOllama();
    if (!ollamaOk) {
      log("orchestrator", `WARNING: OLLAMA_MODEL=${ollamaModel} set but Ollama unreachable at ${process.env.OLLAMA_HOST || "localhost"}:${process.env.OLLAMA_PORT || "11434"}. orchestrator/summarizer will use claude-haiku fallback.`);
    } else {
      log("orchestrator", `Ollama ready — model: ${ollamaModel}`);
    }
  } else {
    log("orchestrator", "Ollama not configured (OLLAMA_MODEL unset) — orchestrator/summarizer using claude-haiku.");
  }
  log("orchestrator", `Context: ${stepSummary ? "Ollama handoff between steps" : "no Ollama summary"}; truncation: ${maxContextChars > 0 ? `${maxContextChars} chars/step` : "off"}`);
  if (maxCostUsd != null) {
    log("orchestrator", `Guardrail: ORCH_MAX_COST_USD=${maxCostUsd} (Ollama USD estimate from ORCH_USD_PER_MTOK_*)`);
  }
  if (maxStepRetries != null) {
    log("orchestrator", `Guardrail: ORCH_MAX_RETRIES=${maxStepRetries} (per agentId retry_number cap within one iteration)`);
  }
  traceEvent(taskId, {
    event: "session_start",
    flow_mode: flowMode,
    max_iterations: maxIterations,
    cwd,
    goal: goal.slice(0, 200),
    require_handoff: requireHandoff,
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
  });

  // ── Degraded mode banner ──────────────────────────────────────────────────────
  if (skipStateMcp) {
    const YELLOW = "\x1b[33m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
    console.log(`\n${YELLOW}${BOLD}⚠  DEGRADED MODE — hard gates DISABLED${RESET}`);
    console.log(`${YELLOW}   orchestrator-state and compact-handoff MCPs are not active.`);
    console.log(`   No transitions are recorded. No goal alignment is checked.`);
    console.log(`   No approved-artifact enforcement. Output contracts still apply.`);
    console.log(`   Run without --skip-gates to enable strict mode.\n${RESET}`);
    traceEvent(taskId, { event: "degraded_mode", reason: "skipStateMcp=true" });
  }

  // ── Register task (state store) ──────────────────────────────────────────────
  if (!skipStateMcp) {
    log("gate", `Registering task "${taskId}" in state store...`);
    try {
      /** @type {Record<string, unknown>} */
      const registerPayload = {
        goal,
        task_id: taskId,
        flow_mode: flowMode,
        max_iterations: maxIterations,
        approved_artifacts: JSON.stringify(approvedArtifacts),
        contract_version: CONTRACT_VERSION,
      };
      // Test harness only — never enable in real runs (see README § system-path harness)
      if (orchTestSystemPathHarnessOn()) {
        registerPayload.enforce_goal_alignment = false;
      }
      const reg = callStateMcp("register_task", registerPayload, { cwd });
      if (!reg.ok) throw new Error(reg.error || "register_task failed");
      log("gate", `Task registered — envelope: ${reg.envelope_path}`);
    } catch (err) {
      log("gate", `\x1b[33m\x1b[1m⚠  DEGRADED MODE — state store unavailable\x1b[0m (${err.message}). Continuing without hard gates.`);
      traceEvent(taskId, { event: "degraded_mode", reason: err.message });
    }
  }

  // ── Phase 1: plan ─────────────────────────────────────────────────────────────
  log("orchestrator", "Planning...");
  const multiAgentPlanConstraint =
    flowMode === "multi_agent"
      ? `

Hard requirement for FLOW multi_agent: "steps" MUST include at least one implementation agent (agentId dev-backend, dev-frontend, or dev-devops) with a concrete code-edit task, and a later step with agentId qa that reviews that implementation. For goals that change source files, do NOT emit a plan with only owner or architect — those roles scope or design; implementation and QA review are mandatory in this flow.

When the goal is a localized change to existing application code (bugfix, validation, small feature) in the working directory, prefer the MINIMAL pipeline only: dev-backend → qa → cerberus (in that order). The dev-backend task must name the file(s) to edit and require files_read[], files_modified:, and validation_run in the output. Omit owner and architect unless the goal explicitly asks for product scope, a written spec, architecture trade-offs, or diagrams before coding.`
      : "";
  const planPrompt = `MODE: ORCHESTRATOR
FLOW: ${flowMode}
GOAL: ${goal}
MAX_ITERATIONS: ${maxIterations}
Working directory: ${cwd}

Decompose this goal into ordered execution steps following the MODE protocol.
Assign one agent per step. Reply with JSON only.${multiAgentPlanConstraint}`;

  const { output: planResponse, context_stats: planCtxStats } = await askAgent("orchestrator", planPrompt, { cwd, sessionEnv, phase: "plan" });
  bumpOllamaFromStats(planCtxStats);
  if (planCtxStats) traceEvent(taskId, { event: "context_stats", agent: "orchestrator", iteration: 0, phase: "plan", ...planCtxStats });
  const planCost = checkCostGuard();
  if (!planCost.ok) {
    summary = `Guardrail ORCH_MAX_COST_USD=${maxCostUsd}: estimated spend ${roundUsd6(planCost.estimate)} USD exceeds limit after plan phase.`;
    manualReview = true;
    traceIterationDone(taskId, 0, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
      estimate_usd: roundUsd6(planCost.estimate),
      limit_usd: maxCostUsd,
      guard_phase: "plan",
    });
    skipMainOrchestrationLoop = true;
  }
  const parsed = extractJson(planResponse);
  if (parsed && Array.isArray(parsed.steps)) {
    plan = parsed;
    if (flowMode === "multi_agent" && skipStateMcp) {
      const before = plan.steps.length;
      plan.steps = stripLeadingOwnerArchitectForDegradedMultiAgent(plan.steps);
      if (plan.steps.length !== before) {
        traceEvent(taskId, {
          event: "plan_normalized",
          removed_leading_steps: before - plan.steps.length,
        });
      }
    }
    log("orchestrator", `Plan ready — ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => log(s.agentId || "?", `Step ${i + 1}: ${s.task}`));
  }

  // ── Advance ORCHESTRATOR → first MODE ────────────────────────────────────────
  if (!skipMainOrchestrationLoop) {
    const firstAgent = plan.steps[0]?.agentId;
    if (!skipStateMcp && firstAgent && AGENT_TO_MODE[firstAgent]) {
      try {
        callStateMcp("advance_mode", {
          task_id: taskId,
          to_mode: AGENT_TO_MODE[firstAgent],
          from_mode: "ORCHESTRATOR",
          handoff_yaml: "",
          iteration: -1,
        }, { cwd });
        currentMode = AGENT_TO_MODE[firstAgent];
      } catch (err) {
        log("gate", `WARNING: advance_mode failed (${err.message})`);
      }
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  const RED = "\x1b[31m", BOLD_C = "\x1b[1m", RESET_C = "\x1b[0m";

  orchestration: while (!skipMainOrchestrationLoop && !done && iterations < maxIterations) {
    if (skipStateMcp) {
      console.log(`${RED}${BOLD_C}  ⚠ NO HARD GATES ACTIVE — iteration unprotected${RESET_C}`);
    }
    iterations += 1;
    syncRunIteration(runState, iterations);
    log("orchestrator", `── Iteration ${iterations}/${maxIterations} ──`);

    const intentByStepSlot = new Map();
    const intentIdsThisIteration = new Set();
    /** @param {Record<string, unknown>} [extra] */
    function iterationDoneCtx(extra = {}) {
      const ids = [...intentIdsThisIteration];
      return { ...extra, ...(ids.length ? { intent_ids: ids.slice(0, 48) } : {}) };
    }
    /**
     * @param {string} phase
     * @returns {boolean} true if run must stop (caller should `break orchestration`)
     */
    function costGuardAbort(phase) {
      const raw = checkCostGuard();
      const d = decideCostGuard({ estimate: raw.ok ? null : (raw.estimate ?? null), maxCostUsd, phase });
      if (!d.abort) return false;
      summary = d.summary;
      manualReview = true;
      traceIterationDone(taskId, iterations, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
        estimate_usd: d.estimateUsd,
        limit_usd: maxCostUsd,
        guard_phase: phase,
      }, iterationDoneCtx());
      return true;
    }

    const steps = plan.steps && plan.steps.length ? plan.steps : [];
    const contextHeader = stepSummary
      ? "Prior steps = Ollama handoff summaries. Full detail is in the repo/cwd — open cited files as needed.\n\n"
      : maxContextChars > 0
        ? "Prior steps may be truncated; use cwd, git diff, and mentioned paths.\n\n"
        : "";

    function contextChunk(a) {
      return stepSummary && a.handoffSummary
        ? `## Handoff (${a.agentId})\n${a.handoffSummary}`
        : formatArtifactLine(a, maxContextChars);
    }

    // ── Execute each step ───────────────────────────────────────────────────────
    // retry_number tracks how many times each agentId has run in this iteration
    const retryCountThisIteration = {};
    let previousAgentId = null;
    let previousStepId = null;  // for parent_step_id graph edges
    const emittedStepIds = new Set(); 


    const graphCheck = validateStepGraph(steps, VALID_WORKER_AGENTS);
    if (!graphCheck.valid) {
      const msg = `Step graph validation failed: ${graphCheck.errors.join("; ")}`;
      traceEvent(taskId, { event: "graph_validation_fail", iteration: iterations, errors: graphCheck.errors });
      throw new Error(msg);
    }

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const agentId = step.agentId || step.agent;
      if (!agentId || !VALID_WORKER_AGENTS.has(agentId)) continue;

      if (previousAgentId && previousAgentId !== agentId) logRoleSwitch(previousAgentId, agentId);
      previousAgentId = agentId;

      const prevRetries = retryCountThisIteration[agentId] ?? 0;
      const retryGuard = decideStepRetryGuard({ prevRetries, maxStepRetries, agentId });
      if (retryGuard.abort) {
        summary = retryGuard.summary;
        manualReview = true;
        traceIterationDone(
          taskId,
          iterations,
          "guard_abort",
          transitionReason("GUARD", "step_retry_limit", {
            reason_code: "GUARD_STEP_RETRY_LIMIT",
            gate_id: agentId,
          }),
          { max_step_retries: maxStepRetries, agent_id: agentId, retry_number: retryGuard.retryNumber },
          iterationDoneCtx(),
        );
        break orchestration;
      }
      const retryNumber = prevRetries;
      retryCountThisIteration[agentId] = prevRetries + 1;
      const stepSlotKey = `${stepIndex}:${agentId}`;
      let intentId = intentByStepSlot.get(stepSlotKey);
      if (!intentId) {
        intentId = require("crypto").randomUUID();
        intentByStepSlot.set(stepSlotKey, intentId);
      }
      intentIdsThisIteration.add(intentId);
      const intentStep = { intent_id: intentId };
      const stepId = `${taskId}-i${iterations}-${agentId}${retryNumber > 0 ? `-r${retryNumber}` : ""}`;
      const graphMeta = { parent_step_id: previousStepId };
      assertParentStepExists(previousStepId, emittedStepIds);

      const contextBlock = contextHeader + [goal, ...artifacts.map(contextChunk)].join("\n\n---\n\n");
      writeAgentState(agentId, goal);
      log(agentId, `Executing: ${step.task.slice(0, 80)}${step.task.length > 80 ? "..." : ""}`);
      const stepStart = Date.now();
      traceEvent(taskId, { event: "agent_start", agent: agentId, iteration: iterations, step_id: stepId, step_index: stepIndex, retry_number: retryNumber, ...graphMeta, ...intentStep, task: step.task.slice(0, 200) });
      setStepRunning(runState, stepId, agentId);

      let result, contextStats;
      try {
        const agentResult = await askAgent(
          agentId,
          `Working directory: ${cwd}\n\nContext:\n${contextBlock}\n\nYour task:\n${step.task}`,
          { cwd, sessionEnv }
        );
        result = agentResult.output;
        contextStats = agentResult.context_stats || null;
      } catch (err) {
        const duration_ms = Date.now() - stepStart;
        const isCritical = ["architect", "qa", "cerberus"].includes(agentId);
        const gateId = err.gate_id || null;
        traceEvent(taskId, { event: "contract_fail", agent: agentId, iteration: iterations, step_id: stepId, step_index: stepIndex, retry_number: retryNumber, ...graphMeta, ...intentStep, ...edgeMeta("fail"), duration_ms, reason: err.message.slice(0, 300), critical: isCritical, ...(gateId ? { gate_id: gateId } : {}) });
        setStepFailedAndClear(runState);
        log(agentId, `🟥 Output contract failed: ${err.message}`);
        artifacts.push({
          agentId,
          task: step.task,
          result: typeof err.rawModelOutput === "string" ? err.rawModelOutput : "",
          gateBlocked: true,
          gateReason: err.message,
          step_id: stepId,
          intent_id: intentId,
          gate_kind: gateId || "output_contract",
        });
        emittedStepIds.add(stepId);
        previousStepId = stepId;
        if (isCritical) {
          log(agentId, `🟥 Critical role contract fail — stopping iteration (no QA/CERBERUS/ARCHITECT degradation allowed)`);
          break;
        }
        continue;
      }
      // Collect any agents that fell back to a secondary model during this call
      for (const id of getDegradedAgents()) degradedInRun.add(id);
      clearDegradedAgents();
      const stepDegraded = degradedInRun.has(agentId);
      const edgeType = retryNumber > 0 ? "retry" : "success";
      /** @type {Record<string, unknown>} */
      const donePayload = {
        event: "agent_done",
        agent: agentId,
        iteration: iterations,
        step_id: stepId,
        step_index: stepIndex,
        retry_number: retryNumber,
        ...graphMeta,
        ...intentStep,
        ...edgeMeta(edgeType),
        duration_ms: Date.now() - stepStart,
        output_chars: result.length,
        ...(stepDegraded ? { degraded: true } : {}),
      };
      if (agentId === "qa") Object.assign(donePayload, qaAgentDoneTraceExtras(result));
      traceEvent(taskId, donePayload);
      setStepCompleted(runState);
      if (contextStats) {
        bumpOllamaFromStats(contextStats);
        traceEvent(taskId, { event: "context_stats", agent: agentId, iteration: iterations, step_id: stepId, step_index: stepIndex, ...graphMeta, ...intentStep, ...contextStats });
      }
      if (costGuardAbort("worker")) break orchestration;
      emittedStepIds.add(stepId);
      previousStepId = stepId;

      // ── Compact handoff (compact-handoff MCP) ──────────────────────────────
      let handoffYaml = "";
      /** @type {Record<string, unknown>} */
      let handoffCompressionMeta = {};
      const toMode = AGENT_TO_MODE[agentId];
      const nextStepIdx = steps.indexOf(step) + 1;
      const nextAgent   = steps[nextStepIdx]?.agentId;
      const nextMode    = nextAgent ? (AGENT_TO_MODE[nextAgent] || "ORCHESTRATOR") : "ORCHESTRATOR";

      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        log("gate", `Compacting handoff for ${agentId} → ${nextMode}...`);
        try {
          handoffYaml = callCompactHandoff({
            text: result,
            modeCompleted: toMode,
            nextMode,
            iteration: iterations,
            maxIterations,
            flowMode,
          }, { cwd });
          log("gate", `Handoff YAML ready (${handoffYaml.length} chars)`);
        } catch (err) {
          const msg = err.message || String(err);
          if (requireHandoff) {
            traceEvent(taskId, {
              event: "compact_handoff_failed",
              agent: agentId,
              iteration: iterations,
              step_id: stepId,
              ...intentStep,
              message: msg.slice(0, 400),
              phase: "worker_step",
            });
            log("gate", `🟥 compact_handoff failed (strict — hard fail): ${msg}`);
            artifacts.push({
              agentId,
              task: step.task,
              result,
              step_id: stepId,
              intent_id: intentId,
              gate_kind: "compact_handoff",
              ...compactHandoffStrictFailureFields(err),
            });
            markStepRetryingAfterGate(runState);
            continue;
          }
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            ...intentStep,
            message: msg.slice(0, 400),
            phase: "worker_step",
          });
          handoffCompressionMeta = compactHandoffDegradedMeta(err);
          log("gate", `⚠ compact_handoff unavailable (degraded — continuing without YAML compression): ${msg}`);
        }
      }

      // ── Structural handoff validation (per-MODE key check) ────────────────
      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        const sv = validateHandoffStructure(toMode, handoffYaml, { strict: requireHandoff });
        if (!sv.valid) {
          log("gate", `🟥 Handoff structure invalid (${toMode}): ${sv.reason}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "handoff_structure", passed: false, reason: sv.reason });
          artifacts.push({
            agentId,
            task: step.task,
            result,
            handoffYaml,
            gateBlocked: true,
            gateReason: `handoff_structure: ${sv.reason}`,
            step_id: stepId,
            intent_id: intentId,
            gate_kind: "handoff_structure",
          });
          markStepRetryingAfterGate(runState);
          continue;
        }
        traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "handoff_structure", passed: true });
      }

      // ── validate_goal_alignment + advance_mode ─────────────────────────────
      if (!skipStateMcp && AGENTS_REQUIRING_GATE.has(agentId) && handoffYaml) {
        try {
          log("gate", `Validating goal alignment for ${agentId}...`);
          const alignment = callStateMcp("validate_goal_alignment", {
            task_id: taskId,
            handoff_yaml: handoffYaml,
          }, { cwd });

          if (!alignment.ok) {
            log("gate", `WARNING: validate_goal_alignment failed: ${alignment.error}`);
          } else if (alignment.aligned === false) {
            // ORCH_TEST_SYSTEM_PATH_HARNESS: envelope has enforce_goal_alignment=false;
            // validate_transition still runs; LLM may return aligned=false — Node must not treat that as prod truth.
            if (orchTestSystemPathHarnessOn()) {
              log("gate", `⚠ ORCH_TEST_SYSTEM_PATH_HARNESS: goal alignment returned false — continuing (test harness only; not prod semantics)`);
              traceEvent(taskId, {
                event: "gate_result",
                agent: agentId,
                iteration: iterations,
                step_id: stepId,
                ...intentStep,
                gate: "goal_alignment",
                passed: true,
                confidence: alignment.confidence,
                test_system_path_harness: true,
                notes: alignment.notes,
              });
            } else {
              log("gate", `🟥 Goal not aligned: ${alignment.notes}. Skipping advance_mode for this step.`);
              traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "goal_alignment", passed: false, confidence: alignment.confidence, reason: alignment.notes });
              artifacts.push({
                agentId,
                task: step.task,
                result,
                handoffYaml,
                gateBlocked: true,
                gateReason: `goal_alignment: ${alignment.notes}`,
                step_id: stepId,
                intent_id: intentId,
                gate_kind: "goal_alignment",
              });
              markStepRetryingAfterGate(runState);
              continue;
            }
          } else {
            log("gate", `🟩 Goal aligned (confidence: ${alignment.confidence ?? "n/a"})`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "goal_alignment", passed: true, confidence: alignment.confidence });
          }

          log("gate", `validate_transition: ${currentMode} → ${nextMode} (iteration ${iterations})`);
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: currentMode,
            to_mode: nextMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (!vt.allowed) {
            log("gate", `🟥 Transition blocked: ${(vt.errors || []).join("; ")}`);
            traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("gate_block"), gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: false, reason: (vt.errors || []).join("; ") });
            artifacts.push({
              agentId,
              task: step.task,
              result,
              handoffYaml,
              gateBlocked: true,
              gateReason: (vt.errors || []).join("; "),
              step_id: stepId,
              intent_id: intentId,
              gate_kind: "transition",
            });
            markStepRetryingAfterGate(runState);
            continue;
          }

          log("gate", `🟩 Transition allowed — advancing to ${nextMode}`);
          traceEvent(taskId, { event: "gate_result", agent: agentId, iteration: iterations, step_id: stepId, ...graphMeta, ...intentStep, ...edgeMeta("success"), gate: "transition", from_mode: currentMode, to_mode: nextMode, passed: true });
          const adv = callStateMcp("advance_mode", {
            task_id: taskId,
            to_mode: nextMode,
            from_mode: currentMode,
            handoff_yaml: handoffYaml,
            iteration: iterations,
          }, { cwd });

          if (adv.ok) {
            currentMode = nextMode;
            log("gate", `Mode advanced → ${currentMode}`);
          } else {
            log("gate", `WARNING: advance_mode returned ok=false: ${adv.error || JSON.stringify(adv.errors)}`);
          }
        } catch (err) {
          log("gate", `WARNING: State MCP gate error (${err.message}). Continuing without gate.`);
        }
      }

      // ── Ollama step summary ────────────────────────────────────────────────
      let handoffSummary = "";
      if (stepSummary) {
        log("summarizer", `Summarizing ${agentId} output (Ollama)...`);
        try {
          const summaryResult = await summarizeHandoff({ agentId, task: step.task, result, cwd, priorArtifacts: artifacts });
          handoffSummary = summaryResult.summary;
          bumpOllamaFromStats(summaryResult);
          if (summaryResult.ollama_prompt_tokens != null || summaryResult.ollama_completion_tokens != null) {
            traceEvent(taskId, {
              event: "context_stats",
              agent: "summarizer",
              target_agent: agentId,
              iteration: iterations,
              ...(typeof summaryResult.ollama_prompt_tokens === "number" ? { ollama_prompt_tokens: summaryResult.ollama_prompt_tokens } : {}),
              ...(typeof summaryResult.ollama_completion_tokens === "number" ? { ollama_completion_tokens: summaryResult.ollama_completion_tokens } : {}),
            });
          }
          if (costGuardAbort("summarizer")) break orchestration;
          log("summarizer", `Summary ready (${handoffSummary.length} chars)`);
        } catch (err) {
          log("summarizer", `Ollama failed (${err.message}); next step uses truncation.`);
        }
      }

      artifacts.push({
        agentId,
        task: step.task,
        result,
        handoffYaml,
        gateBlocked: false,
        step_id: stepId,
        intent_id: intentId,
        ...(handoffSummary ? { handoffSummary } : {}),
        ...(Object.keys(handoffCompressionMeta).length ? handoffCompressionMeta : {}),
      });
      log(agentId, `Done (${result.length} chars)`);
    }

    // ── Cerberus review ───────────────────────────────────────────────────────
    logRoleSwitch(previousAgentId || "orchestrator", "cerberus");
    log("cerberus", "Reviewing deliverables...");
    const reviewChunks = artifacts.map((a) => {
      const { text } = truncateForContext(a.result, maxReviewChars);
      return `## ${a.agentId} — ${a.task}\n\n${text}`;
    });
    const cerberusPrompt = `Working directory: ${cwd}

Original goal: ${goal}

Deliverables from iteration ${iterations}:

${reviewChunks.join("\n\n---\n\n")}

Review the above. Classify each finding as blocker | improvement | nice-to-have.
Only blockers require another DEV iteration.

Your reply must begin with these three lines in this exact order (use (none) when a category has nothing to report; no preamble before blocker:):
blocker: ...
improvement: ...
nice-to-have: ...`;

    let cerberusResult = "";
    try {
      const { output, context_stats: cerbCtx } = await askAgent("cerberus", cerberusPrompt, { cwd, sessionEnv });
      cerberusResult = output;
      bumpOllamaFromStats(cerbCtx);
      if (cerbCtx) traceEvent(taskId, { event: "context_stats", agent: "cerberus", iteration: iterations, phase: "review", ...cerbCtx });
      if (costGuardAbort("cerberus")) break orchestration;
      log("cerberus", `Review ready (${cerberusResult.length} chars)`);
    } catch (err) {
      const gateId = err.gate_id || null;
      const reason = (err.message || String(err)).slice(0, 300);
      traceEvent(taskId, {
        event: "contract_fail",
        agent: "cerberus",
        iteration: iterations,
        duration_ms: 0,
        reason,
        critical: true,
        ...(gateId ? { gate_id: gateId } : {}),
      });
      log("cerberus", `🟥 Output contract failed: ${err.message}`);
      artifacts.push({
        agentId: "cerberus",
        task: "(session review) Deliverable review before decide",
        result: "",
        gateBlocked: true,
        gateReason: err.message,
        gate_kind: gateId || "cerberus_output_contract",
      });
    }

    // ── Compact cerberus handoff + advance to ORCHESTRATOR ────────────────────
    if (!skipStateMcp) {
      let cerberusHandoff = "";
      try {
        cerberusHandoff = callCompactHandoff({
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        }, { cwd });
      } catch (err) {
        const msg = err.message || String(err);
        if (requireHandoff) {
          traceEvent(taskId, {
            event: "compact_handoff_failed",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
          });
          log("gate", `🟥 compact_handoff failed (strict — CERBERUS → ORCHESTRATOR): ${msg}`);
          artifacts.push({
            agentId: "cerberus",
            task: "(session review) Deliverable review before decide",
            result: cerberusResult,
            gate_kind: "compact_handoff",
            ...compactHandoffStrictFailureFields(err),
          });
        } else {
          traceEvent(taskId, {
            event: "compact_handoff_fallback",
            agent: "cerberus",
            iteration: iterations,
            message: msg.slice(0, 400),
            phase: "cerberus_advance",
          });
          log("gate", `⚠ compact_handoff unavailable (degraded — CERBERUS advance): ${msg}`);
        }
      }
      if (cerberusHandoff) {
        try {
          const vt = callStateMcp("validate_transition", {
            task_id: taskId,
            from_mode: "CERBERUS",
            to_mode: "ORCHESTRATOR",
            handoff_yaml: cerberusHandoff,
            iteration: iterations,
          }, { cwd });

          if (vt.allowed) {
            callStateMcp("advance_mode", {
              task_id: taskId,
              to_mode: "ORCHESTRATOR",
              from_mode: "CERBERUS",
              handoff_yaml: cerberusHandoff,
              iteration: iterations,
            }, { cwd });
            currentMode = "ORCHESTRATOR";
          }
        } catch (err) {
          log("gate", `WARNING: Cerberus transition gate error (${err.message})`);
        }
      }
    }

    // ── Hard blocker enforcement (deterministic) ──────────────────────────────
    // Detect blockers from CERBERUS output directly — does not rely on the
    // orchestrator model to interpret whether iteration is required.
    // If blockers exist and iterations remain → force iterate.
    // If no blockers → allow orchestrator to declare done.
    const cerberusBlockers = detectBlockers(cerberusResult);
    traceEvent(taskId, { event: "cerberus_check", iteration: iterations, blockers: cerberusBlockers.count, items: cerberusBlockers.items.slice(0, 5) });

    const cerbDecision = decideCerberusBlockersBranch({
      blockerCount: cerberusBlockers.count,
      iterations,
      maxIterations,
    });
    if (cerbDecision === "iterate") {
      log("cerberus", `🟥 ${cerberusBlockers.count} blocker(s) detected — forcing iteration (deterministic)`);
      cerberusBlockers.items.forEach(b => log("cerberus", `  ↳ ${b.slice(0, 120)}`));

      // Ask orchestrator only for corrections — done=true is not an option when blockers exist
      const artifactsBlob = artifacts
        .map((a) => {
          const { text } = truncateForContext(a.result, maxReviewChars);
          return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
        })
        .join("\n\n---\n\n");

      const correctPrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus blockers (must be fixed):
${cerberusBlockers.items.join("\n")}

List the correction steps required. Reply with JSON: { "done": false, "corrections": [{ "agentId": "...", "task": "..." }] }`;

      logRoleSwitch("cerberus", "orchestrator");
      const { output: correctResponse, context_stats: correctCtx } = await askAgent("orchestrator", correctPrompt, { cwd, sessionEnv, phase: "decide" });
      bumpOllamaFromStats(correctCtx);
      if (correctCtx) traceEvent(taskId, { event: "context_stats", agent: "orchestrator", iteration: iterations, phase: "correct", ...correctCtx });
      if (costGuardAbort("correct")) break orchestration;
      const corrections = extractJson(correctResponse);
      const corrPlan = decideCorrectionsPlan(corrections);
      const planOut = planStepsAfterCorrectionsResponse({
        corrPlan,
        artifacts,
        blockerItems: cerberusBlockers.items,
        maxBlockersInTask: 2,
      });
      const steps = /** @type {Array<{ agentId?: string, task: string }>} */ (planOut.steps);
      if (planOut.traceBranch === "iterate_corrections_json") {
        log("orchestrator", `↻ Correcting — ${steps.length} step(s):`);
        steps.forEach((c) =>
          log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
        );
        traceIterationDone(taskId, iterations, "iterate", transitionReason("GATE_BLOCK", "cerberus_blockers"), { blockers: cerberusBlockers.count, corrections: steps.length }, iterationDoneCtx());
        plan = { steps };
      } else {
        log("orchestrator", "WARNING: orchestrator returned no corrections — retrying last DEV steps");
        traceIterationDone(taskId, iterations, "iterate_fallback", transitionReason("ITERATE_FALLBACK", "orchestrator_no_corrections_json"), { blockers: cerberusBlockers.count }, iterationDoneCtx());
        plan = { steps };
      }
      continue;
    }

    if (cerbDecision === "manual_cap") {
      done = false;
      manualReview = true;
      summary = `Max iterations reached with ${cerberusBlockers.count} gate-blocked CERBERUS finding(s). Manual review required.`;
      log("orchestrator", `⚠ ${summary}`);
      traceIterationDone(taskId, iterations, "max_iterations_with_blockers", transitionReason("MAX_ITERATIONS", "cerberus_blockers_cap"), { blockers: cerberusBlockers.count }, iterationDoneCtx());
      continue;
    }

    // ── Gate-blocked artifact enforcement ────────────────────────────────────
    // Any artifact with gateBlocked:true in this iteration is an implicit blocker.
    // gateBlocked means a hard contract or gate failed — CERBERUS silence does not clear it.
    // This covers: output contract failures (missing files_read, files_modified,
    // validation_run), handoff structure failures, and goal alignment failures.
    const gateBlockedArtifacts = artifacts.filter(a => a.gateBlocked);
    const gateBlockedDecision = decideGateBlockedArtifactsBranch({
      artifactCount: gateBlockedArtifacts.length,
      iterations,
      maxIterations,
    });
    if (gateBlockedDecision === "iterate") {
      const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
      traceEvent(taskId, { event: "gate_blocked_completion", iteration: iterations, count: gateBlockedArtifacts.length, reasons: gateBlockReasons });
      log("orchestrator", `🟥 ${gateBlockedArtifacts.length} gate-blocked artifact(s) — cannot mark done (forcing iteration):`);
      gateBlockReasons.forEach(r => log("orchestrator", `  ↳ ${r}`));
      const _gb0 = gateBlockedArtifacts[0];
      traceIterationDone(
        taskId,
        iterations,
        "gate_blocked_iterate",
        transitionReason("GATE_BLOCK", "artifact_contract_or_handoff", {
          ...( _gb0 && _gb0.step_id ? { step_id: _gb0.step_id } : {}),
          ...( _gb0 && _gb0.gate_kind ? { gate_id: _gb0.gate_kind } : {}),
        }),
        { gate_blocks: gateBlockedArtifacts.length },
        iterationDoneCtx({ gateKinds: gateBlockedArtifacts.map((a) => a.gate_kind).filter(Boolean) }),
      );
      plan = { steps: planStepsReplayFromGateBlockedArtifacts(gateBlockedArtifacts) };
      continue;
    }
    if (gateBlockedDecision === "manual_cap") {
      const gateBlockReasons = formatGateBlockedReasonLines(gateBlockedArtifacts);
      done = false;
      manualReview = true;
      summary = summaryMaxIterationsGateBlocked({
        count: gateBlockedArtifacts.length,
        reasonLines: gateBlockReasons,
      });
      log("orchestrator", `⚠ ${summary}`);
      traceIterationDone(taskId, iterations, "max_iterations_with_gate_blocks", transitionReason("MAX_ITERATIONS", "gate_blocked_artifacts_cap"), { gate_blocks: gateBlockedArtifacts.length }, iterationDoneCtx());
      continue;
    }

    // ── ORCHESTRATOR decides (no blockers path) ───────────────────────────────
    logRoleSwitch("cerberus", "orchestrator");
    log("orchestrator", "No blockers — evaluating completion...");
    const artifactsBlob = artifacts
      .map((a) => {
        const { text } = truncateForContext(a.result, maxReviewChars);
        return `## ${a.agentId}\nTask: ${a.task}\n\n${text}`;
      })
      .join("\n\n---\n\n");

    const decidePrompt = `Original goal:
${goal}

Iteration: ${iterations}/${maxIterations}

Deliverables:
${artifactsBlob}

Cerberus review (no blockers):
${cerberusResult}

No blockers were found. Confirm completion or list any remaining corrections.
Reply with JSON only.`;

    let decideResponse = "";
    try {
      const { output, context_stats: decideCtx } = await askAgent("orchestrator", decidePrompt, { cwd, sessionEnv, phase: "decide" });
      decideResponse = output;
      bumpOllamaFromStats(decideCtx);
      if (decideCtx) traceEvent(taskId, { event: "context_stats", agent: "orchestrator", iteration: iterations, phase: "decide", ...decideCtx });
      if (costGuardAbort("decide")) break orchestration;
    } catch (decideErr) {
      log("orchestrator", `⚠ Decide contract failed (${decideErr.message}) — treating as stopped`);
      traceEvent(taskId, { event: "decide_contract_fail", reason: decideErr.message });
    }
    const decide = extractJson(decideResponse);
    const loopDecision = decideFromOrchestratorDecide(decide);
    const mapped = mapDecideLoopToPlanOutcome(loopDecision);

    if (mapped.variant === "finish") {
      done = true;
      summary = /** @type {string} */ (mapped.summary);
      log("orchestrator", `✓ Done: ${summary}`);
      traceIterationDone(taskId, iterations, "done", transitionReason("DONE"), { summary: summary.slice(0, 200) }, iterationDoneCtx());
    } else if (mapped.variant === "iterate") {
      const corrections = /** @type {Array<{ agentId?: string, task: string }>} */ (mapped.planSteps);
      log("orchestrator", `↻ Iterating — ${corrections.length} correction(s):`);
      corrections.forEach((c) =>
        log(c.agentId || "?", `Correction: ${c.task.slice(0, 80)}${c.task.length > 80 ? "..." : ""}`)
      );
      traceIterationDone(taskId, iterations, "iterate", transitionReason("ITERATE", "orchestrator_decide_corrections"), { corrections: corrections.length }, iterationDoneCtx());
      plan = { steps: corrections };
    } else {
      done = true;
      summary = /** @type {string} */ (mapped.summary);
      log("orchestrator", summary);
      traceIterationDone(taskId, iterations, "stopped", transitionReason("CONTRACT_FAIL", summary), { summary }, iterationDoneCtx());
    }
  }

  if (!done && !summary) {
    summary = loopExhaustedDefaultSummary(maxIterations);
    log("orchestrator", summary);
    traceIterationDone(
      taskId,
      iterations,
      "loop_limit_stopped",
      transitionReason("MAX_ITERATIONS", "loop_exhausted_without_done"),
      { iterations, max_iterations: maxIterations },
    );
  }

  finalizeRunState(runState, { done, manualReview });

  // ── Surface degraded compact_handoff fallback in summary (structured data is on artifacts) ──
  const handoffFallbackArtifacts = artifacts.filter((a) => a.handoff_fallback_used === true);
  if (handoffFallbackArtifacts.length > 0) {
    const agents = [...new Set(handoffFallbackArtifacts.map((a) => a.agentId))].join(", ");
    const err0 = handoffFallbackArtifacts[0].handoff_error || "unknown";
    const note = `[handoff compression unavailable for ${agents} — continued without compact_handoff; error: ${String(err0).slice(0, 120)}]`;
    summary = summary ? `${summary}\n${note}` : note;
  }

  // ── Record session summary artifact before closing ───────────────────────
  if (!skipStateMcp) {
    try {
      const sessionSummary = [
        `goal: ${goal}`,
        `iterations: ${iterations}/${maxIterations}`,
        `agents_run: ${[...new Set(artifacts.map(a => a.agentId))].join(", ")}`,
        `outcome: ${summary}`,
        artifacts.length > 0
          ? `last_artifacts:\n${artifacts.slice(-3).map(a => `  - ${a.agentId}: ${a.task.slice(0, 80)}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

      callStateMcp("record_artifact", {
        task_id: taskId,
        artifact_id: "session-summary",
        content: sessionSummary,
        agent_id: "orchestrator",
      }, { cwd });
      log("gate", "Session summary recorded in envelope.");
    } catch (err) {
      log("gate", `WARNING: record_artifact failed (${err.message})`);
    }
  }

  // ── Close task (state store) ──────────────────────────────────────────────
  if (!skipStateMcp) {
    try {
      callStateMcp("close_task", { task_id: taskId, reason: summary }, { cwd });
      log("gate", `Task "${taskId}" closed in state store.`);
    } catch (err) {
      log("gate", `WARNING: close_task failed (${err.message})`);
    }
  }

  // Clear active agent state
  try { require("fs").unlinkSync(AGENT_STATE_FILE); } catch { /* already gone */ }

  const qaDegraded = degradedInRun.has("qa");
  if (qaDegraded) {
    log("qa", "⚠ QA ran in degraded mode (fallback model) — coverage may be reduced. Manual review recommended.");
  }
  const manualReviewRecommended = qaDegraded || manualReview;
  const handoffFallbackAny = artifacts.some((a) => a.handoff_fallback_used === true);
  const mcpSummary = aggregateMcpUsage(_mcpAuditCalls);
  traceEvent(taskId, {
    event: "session_end",
    iterations,
    done,
    summary: summary.slice(0, 200),
    agents_run: [...new Set(artifacts.map((a) => a.agentId))],
    gate_blocks: artifacts.filter((a) => a.gateBlocked).length,
    run_state_snapshot: getRunStatePublicView(runState),
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    ...mcpSummary,
    ...(ollamaTokenTotals.prompt > 0 || ollamaTokenTotals.completion > 0
      ? {
        ollama_prompt_tokens_total: ollamaTokenTotals.prompt,
        ollama_completion_tokens_total: ollamaTokenTotals.completion,
      }
      : {}),
    ...(qaDegraded ? { qa_degraded: true } : {}),
    ...(manualReviewRecommended ? { manual_review_recommended: true } : {}),
    ...(handoffFallbackAny ? { handoff_fallback_used: true } : {}),
  });

  clearMcpAudit();
  return { done, summary, artifacts, iterations, taskId, runState: getRunStatePublicView(runState) };
}

module.exports = {
  run,
  resolveMaxIterations,
  detectBlockers,
  validateHandoffStructure,
  _sanitize,
  _hashGoal,
  resolveRequireHandoff,
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,
  aggregateMcpUsage,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  edgeMeta,
  EDGE_TYPE_CATEGORY,
  validateStepGraph,
  assertParentStepExists,
  transitionReason,
  TRANSITION_REASON_TYPES,
  TRANSITION_REASON_CODES,
  inferReasonCode,
  TRACE_SCHEMA_VERSION,
  FAILURE_TYPES,
  FAILURE_AXES,
  failureTypeForIterationDone,
  failureAxisForIterationDone,
  traceIterationDone,
  composeIterationDonePayload,
};
