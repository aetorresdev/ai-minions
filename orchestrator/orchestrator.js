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

const { deriveRunScope, writeOrchRunContext } = require("./flow-hook-bridge");
const {
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,
  validateHandoffForMode,
  qaSpecFlowTraceExtras,
  shouldEmitQaReviewRecord,
} = require("./qa-spec-flow");
const { askAgent, summarizeHandoff, CONTRACT_VERSION, getDegradedAgents, clearDegradedAgents } = require("./agents");
const {
  configureLocalModelPolicy,
  validateLocalOnlyRunPrerequisites,
  setLocalModelTraceReporter,
} = require("./local-model-policy");
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
const {
  validatePlanStepsCapability,
  CAPABILITY_MATRIX_VERSION,
} = require("./agents/capability-matrix");

// ── Execution trace ───────────────────────────────────────────────────────────
// Writes one JSONL event per step to ~/.claude/metrics/traces/<task_id>.jsonl
// Every line: ts (ISO), ts_ms (epoch ms), trace_schema_version, task_id, …payload.
// trace_schema_version = TRACE_LINE_WRITER_VERSION from trace-schema.js (today "2").
// Event types: session_start, agent_start, agent_done, gate_result,
//              contract_fail, iteration_done, session_end (optional permission_summary rollup), mcp_call, permission_check,
//              context_stats (ollama_* tokens, compaction attribution, model_fallback_segments),
//              context_compaction_started / context_compaction_completed (compaction lifecycle observability — not a substitute for context_stats),
//              model_fallback_required / model_fallback_started / model_fallback_completed (model fallback lifecycle observability),
//              agent_done (qa): optional qa_triple_template + qa_blocker_non_vacuous for rollups
//              approval_required / approval_granted / approval_denied (human governance — see governance-gate.js + trace schema)
// iteration_done: transition_reason { type, reason_code, ... }; failure_type when outcome !== "done".
//
// Sensitive field handling:
//   goal  → secret-shaped substrings redacted, then truncated to 80 chars + SHA-256 hash (TRACE_REDACT_GOAL=1 omits text entirely)
//   task / reason / summary / message / string[] items,reasons,errors → redact then truncate (ORCH_TRACE_SKIP_SECRET_REDACT=1 disables redact)
//   transition_reason.details → redacted then truncated to 300 chars
// Trace write failures emit a one-time stderr warning (not silenced).

const TRACES_DIR = process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim()
  ? path.resolve(String(process.env.ORCH_TRACES_DIR).trim())
  : path.join(require("os").homedir(), ".claude", "metrics", "traces");
const TRACE_REDACT_GOAL = process.env.TRACE_REDACT_GOAL === "1";

const {
  TRACE_LINE_WRITER_VERSION,
  validateTraceLine: validateTraceLineForWrite,
} = require("./trace-schema");
const {
  emitModelFallbackLifecycleIfNeeded,
  emitContextCompactionStarted,
  emitContextCompactionCompleted,
} = require("./trace-lifecycle-events");
const {
  createContextHygieneTracker,
  emitContextHygieneSignalsFromStats,
} = require("./context-hygiene-signals");
const { buildReviewRecord, traceReviewRecord } = require("./review-record");
const { runRecoverySweepAndTrace } = require("./recovery-sweep");
const { redactSensitivePlaintext } = require("./trace-redact");
const { runMcpPermissionGate } = require("./security/mcp-permission-gate");
const { runNetworkPermissionGate } = require("./security/network-permission-gate");
const { aggregatePermissionCheckRows } = require("./security/permission-check-summary");
const { buildApprovalRequiredFromPermissionTrace } = require("./governance-gate");

/** Same as `TRACE_LINE_WRITER_VERSION` in trace-schema.js — single source for writer + schema. */
const TRACE_SCHEMA_VERSION = TRACE_LINE_WRITER_VERSION;

// ── MCP usage audit (per run) ───────────────────────────────────────────────
let _mcpAuditTaskId = null;
/** @type {{ server: string, tool: string, transport: string, duration_ms: number, ok: boolean }[]} */
let _mcpAuditCalls = [];
/** @type {{ decision?: string, reason_code?: string, domain?: string, tool?: string }[]} */
let _permissionCheckAuditBuffer = [];

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
 *   - each step must have agentId (legacy "agent" on plan rows is not accepted; matches plan capability validation)
 *
 * parent_step_id references are validated at emit time via assertParentStepExists
 * since stepIds are computed dynamically during the loop.
 *
 * @param {{ agentId?: string, task?: string }[]} steps
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
    const agentId = step.agentId != null ? String(step.agentId).trim() : "";
    if (!agentId) {
      errors.push(`step[${i}] missing agentId`);
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
 * Permission evaluator before MCP execution (fail closed).
 * Set `ORCH_SKIP_MCP_PERMISSION_GATE=1` to bypass (tests / emergency only).
 * @param {string} server
 * @param {string} toolName
 * @param {string} [cwd]
 * @param {{ agentId?: string, role?: string, iteration?: number, step_id?: string, ownership_change?: boolean, handoff_contract_ref?: string, source_role?: string, target_role?: string }} [gateOpts] — capability matrix context for MCP (defaults: orchestrator / ORCHESTRATOR); optional fields feed governance trace when policy returns requires_approval
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

/**
 * Emit `permission_check` for Claude CLI shell gate when MCP audit task id is active (same window as MCP traces).
 * Used by `agents/runtime/run-claude.js`; optional when orchestrator not loaded.
 */
function emitPermissionCheckTrace(payload) {
  if (!_mcpAuditTaskId) return;
  traceEvent(_mcpAuditTaskId, payload);
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

/**
 * @param {unknown} v
 * @returns {unknown}
 */
function _redactStringArray(v) {
  if (!Array.isArray(v)) return v;
  return v.map((x) => (typeof x === "string" ? redactSensitivePlaintext(x) : x));
}

function _sanitize(event) {
  const out = { ...event };
  if ("goal" in out) {
    const cleaned = redactSensitivePlaintext(String(out.goal));
    const h = _hashGoal(cleaned);
    out.goal = TRACE_REDACT_GOAL ? `[redacted:${h}]` : `${cleaned.slice(0, 80)}… [sha256:${h}]`;
  }
  if ("task" in out) out.task = redactSensitivePlaintext(String(out.task)).slice(0, 120);
  if ("reason" in out) out.reason = redactSensitivePlaintext(String(out.reason)).slice(0, 300);
  if ("summary" in out) out.summary = redactSensitivePlaintext(String(out.summary)).slice(0, 300);
  if (typeof out.message === "string") out.message = redactSensitivePlaintext(out.message).slice(0, 400);
  if (Array.isArray(out.items)) out.items = _redactStringArray(out.items);
  if (Array.isArray(out.reasons)) out.reasons = _redactStringArray(out.reasons);
  if (Array.isArray(out.errors)) out.errors = _redactStringArray(out.errors);
  if (out.transition_reason && typeof out.transition_reason === "object" && out.transition_reason !== null) {
    const tr = { ...out.transition_reason };
    if ("details" in tr && tr.details != null) tr.details = redactSensitivePlaintext(String(tr.details)).slice(0, 300);
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

function loadTraceRowsForTask(taskId) {
  const filePath = path.join(TRACES_DIR, `${taskId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  /** @type {object[]} */
  const rows = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return rows;
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
  if (sanitized.event === "permission_check" && taskId === _mcpAuditTaskId) {
    _permissionCheckAuditBuffer.push({
      decision: sanitized.decision,
      reason_code: sanitized.reason_code,
      domain: sanitized.domain,
      tool: sanitized.tool,
    });
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
function parseOptionalRatioWithInvalid(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return { value: null, invalid: null };
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return { value: null, invalid: { var_name: name, reason: "not_number" } };
  if (n <= 0 || n > 1) return { value: null, invalid: { var_name: name, reason: "out_of_range", min_exclusive: 0, max_inclusive: 1 } };
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
  /** @type {{ run?: number, roles: Record<string, number>, steps: Record<string, number>, models: Record<string, number> }} */
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
 *   DEV      → files_modified OR validation_run (+ acceptance_criteria|qa_spec_ref after QA_SPEC)
 *   QA_SPEC  → acceptance_criteria, test_strategy|required_tests, validation_commands
 *   QA_EXEC  → verdict AND (findings OR issues)  (legacy mode QA: same as QA_EXEC)
 *   CERBERUS → verdict AND blockers must be empty/absent
 *
 * Returns { valid: boolean, reason: string }
 */
function validateHandoffStructure(mode, yaml, { strict = false, requireQaSpecRef = false } = {}) {
  if (mode === "DEV" || mode === "QA_SPEC" || mode === "QA_EXEC" || mode === "QA") {
    return validateHandoffForMode(mode, yaml, { strict, requireQaSpecRef });
  }

  if (!yaml || !yaml.trim()) {
    if (strict) return { valid: false, reason: `${mode} handoff is empty — compact_handoff must be called before advance_mode in strict mode` };
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

/**
 * Call an orchestrator-state MCP tool via the claude CLI or mcp-direct (ORCH_MCP_TRANSPORT=direct).
 * Returns parsed JSON response or throws on failure.
 */
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
    handoff_degraded: true,
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
      { cwd }
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
const AGENTS_REQUIRING_GATE = new Set(["architect", "dev-backend", "dev-frontend", "dev-devops", "qa", "cerberus"]);

// ── Ollama connectivity check ─────────────────────────────────────────────────

/**
 * Ping Ollama API to verify it is reachable.
 * Returns true if Ollama responds, false otherwise.
 */
function checkOllama() {
  const host = process.env.OLLAMA_HOST || "localhost";
  const port = parseInt(process.env.OLLAMA_PORT || "11434", 10);
  return new Promise((resolve) => {
    if (process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE !== "1") {
      try {
        const gate = runNetworkPermissionGate({
          repoRoot: process.cwd(),
          role: "ORCHESTRATOR",
          actor: "orchestrator",
          hostname: host,
          port,
          tool: "ollama_health_check",
          pathLabel: "/api/tags",
        });
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
 *   localModel?: string — CLI `--model` override for local-only / Ollama execution.
 *   credentialSessionMode?: 'read'|'write' — session credential ceiling for plan validation with `requiredDomains` (default write). Env: ORCH_SESSION_CREDENTIAL_MODE=read.
 * }} options
 */
async function run(goal, options = {}) {
  const maxIterations = resolveMaxIterations(options);
  const maxCostUsd = parseOptionalPositiveFloat("ORCH_MAX_COST_USD");
  const parsedBudgetWarningRatio = parseOptionalRatioWithInvalid("ORCH_BUDGET_WARNING_RATIO");
  const budgetWarningRatio = parsedBudgetWarningRatio.value;
  const parsedBudgetLimits = parseBudgetLimitsJson();
  const budgetLimits = parsedBudgetLimits.limits;
  if (!budgetLimits.roles) budgetLimits.roles = {};
  if (!budgetLimits.steps) budgetLimits.steps = {};
  if (!budgetLimits.models) budgetLimits.models = {};
  if (maxCostUsd != null && budgetLimits.run == null) budgetLimits.run = maxCostUsd;
  const usdRatesMtok = loadOllamaUsdRatesMtok();
  const hasBudgetLimits =
    budgetLimits.run != null ||
    Object.keys(budgetLimits.roles || {}).length > 0 ||
    Object.keys(budgetLimits.steps || {}).length > 0 ||
    Object.keys(budgetLimits.models || {}).length > 0;
  if (hasBudgetLimits && !usdRatesMtok) {
    throw new Error(
      "Budget guards require both ORCH_USD_PER_MTOK_PROMPT and ORCH_USD_PER_MTOK_COMPLETION (non-negative floats, USD per 1e6 tokens; same basis as token-trace-report).",
    );
  }
  const maxStepRetries = parseOptionalNonNegativeInt("ORCH_MAX_RETRIES", 500);

  const cwd           = options.cwd || process.cwd();
  const flowMode      = options.flowMode || "single_agent";
  const taskId        = options.taskId || `task-${randomUUID().slice(0, 8)}`;
  writeOrchRunContext(cwd, { taskId, flowMode, goal });
  const runScope = deriveRunScope(goal);
  const rawScenario = options.traceScenarioId ?? process.env.ORCH_TRACE_SCENARIO_ID ?? "";
  const scenarioId = String(rawScenario).trim() ? String(rawScenario).trim().slice(0, 240) : null;
  beginMcpAudit(taskId);
  const approvedArtifacts = options.approvedArtifacts || [];
  const skipStateMcp  = options.skipStateMcp === true;
  const requireHandoff = resolveRequireHandoff(options);
  const credentialSessionMode =
    options.credentialSessionMode === "read" || options.credentialSessionMode === "write"
      ? options.credentialSessionMode
      : String(process.env.ORCH_SESSION_CREDENTIAL_MODE || "").toLowerCase() === "read"
        ? "read"
        : "write";

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
  const budgetUsage = {
    run: 0,
    roles: {},
    steps: {},
    models: {},
  };
  const budgetWarningsEmitted = new Set();
  let lastBudgetMeta = {};
  const contextHygieneTracker = createContextHygieneTracker();
  function bumpOllamaFromStats(stats) {
    if (!stats || typeof stats !== "object") return;
    if (typeof stats.ollama_prompt_tokens === "number" && !Number.isNaN(stats.ollama_prompt_tokens)) {
      ollamaTokenTotals.prompt += stats.ollama_prompt_tokens;
    }
    if (typeof stats.ollama_completion_tokens === "number" && !Number.isNaN(stats.ollama_completion_tokens)) {
      ollamaTokenTotals.completion += stats.ollama_completion_tokens;
    }
  }

  function usdForTokens(promptTokens, completionTokens) {
    if (!usdRatesMtok) return null;
    return (promptTokens / 1e6) * usdRatesMtok.prompt
      + (completionTokens / 1e6) * usdRatesMtok.completion;
  }

  function budgetModelKey(row) {
    const backend = typeof row.model_backend === "string" && row.model_backend ? row.model_backend : "unknown";
    const name =
      typeof row.model_name === "string" && row.model_name
        ? row.model_name
        : typeof row.model === "string" && row.model
          ? row.model
          : "unknown";
    return `${backend}/${name}`;
  }

  function addBudgetUsageFromRow(row) {
    const p = typeof row.ollama_prompt_tokens === "number" && !Number.isNaN(row.ollama_prompt_tokens)
      ? row.ollama_prompt_tokens
      : 0;
    const c = typeof row.ollama_completion_tokens === "number" && !Number.isNaN(row.ollama_completion_tokens)
      ? row.ollama_completion_tokens
      : 0;
    const usd = usdForTokens(p, c);
    if (usd == null || usd === 0) return;
    budgetUsage.run += usd;
    const role =
      typeof row.attributed_to_role === "string" && row.attributed_to_role
        ? row.attributed_to_role
        : typeof row.agent === "string" && row.agent
          ? row.agent
          : "unknown";
    budgetUsage.roles[role] = (budgetUsage.roles[role] || 0) + usd;
    if (typeof row.step_id === "string" && row.step_id) {
      budgetUsage.steps[row.step_id] = (budgetUsage.steps[row.step_id] || 0) + usd;
    }
    const m = budgetModelKey(row);
    budgetUsage.models[m] = (budgetUsage.models[m] || 0) + usd;
    lastBudgetMeta = {
      role,
      ...(typeof row.step_id === "string" && row.step_id ? { step_id: row.step_id } : {}),
      model_key: m,
    };
  }

  /**
   * Expand `context_stats` into one trace row per model segment (fallback chain) or a single row.
   * @param {string} agent
   * @param {number} iteration
   * @param {Record<string, unknown>} graphMeta
   * @param {Record<string, unknown>} intentStep
   * @param {Record<string, unknown>} stats
   * @param {Record<string, unknown>} loc
   */
  function expandContextStatsTraceRows(agent, iteration, graphMeta, intentStep, stats, loc = {}) {
    if (!stats || typeof stats !== "object") return [];
    const rawSegs = stats.model_fallback_segments;
    const rest = { ...stats };
    delete rest.model_fallback_segments;
    const base = { agent, iteration, ...graphMeta, ...intentStep, ...loc, invocation_type: "agent_call" };
    if (!Array.isArray(rawSegs) || rawSegs.length === 0) {
      return [{ ...base, ...rest }];
    }
    return rawSegs.map((seg, i) => ({
      ...base,
      ...rest,
      ...seg,
      model_fallback_segment_index: i,
      model_fallback_chain_length: rawSegs.length,
    }));
  }

  function emitContextStatsRows(stats, agent, iteration, graphMeta, intentStep, loc = {}) {
    if (!stats || typeof stats !== "object") return;
    const meta = { ...graphMeta, ...intentStep, ...loc };
    emitContextHygieneSignalsFromStats(
      traceEvent,
      taskId,
      agent,
      iteration,
      stats,
      meta,
      contextHygieneTracker,
    );
    for (const row of expandContextStatsTraceRows(agent, iteration, graphMeta, intentStep, stats, loc)) {
      bumpOllamaFromStats(row);
      addBudgetUsageFromRow(row);
      traceEvent(taskId, { event: "context_stats", ...row });
    }
  }
  function estimateRunUsd() {
    if (!usdRatesMtok) return null;
    return budgetUsage.run;
  }

  function budgetCheckDetails(phase, meta = {}) {
    if (!usdRatesMtok || !hasBudgetLimits) return { ok: true };
    /** @type {Array<Record<string, unknown>>} */
    const triggered = [];
    function add(scope, key, estimate, limit) {
      if (limit == null || estimate == null || !Number.isFinite(estimate) || estimate <= limit) return;
      triggered.push({
        scope,
        key,
        estimate_usd: roundUsd6(estimate),
        limit_usd: limit,
      });
    }
    add("run", "run", budgetUsage.run, budgetLimits.run);
    if (typeof meta.role === "string" && meta.role) add("role", meta.role, budgetUsage.roles[meta.role] || 0, budgetLimits.roles[meta.role]);
    if (typeof meta.step_id === "string" && meta.step_id) add("step", meta.step_id, budgetUsage.steps[meta.step_id] || 0, budgetLimits.steps[meta.step_id]);
    if (typeof meta.model_key === "string" && meta.model_key) add("model", meta.model_key, budgetUsage.models[meta.model_key] || 0, budgetLimits.models[meta.model_key]);
    if (!triggered.length) return { ok: true };
    const precedence = ["step", "role", "model", "run"];
    const primary = [...triggered].sort((a, b) => precedence.indexOf(String(a.scope)) - precedence.indexOf(String(b.scope)))[0];
    return {
      ok: false,
      estimate: Number(primary.estimate_usd),
      limit: Number(primary.limit_usd),
      phase,
      budget_scope: primary.scope,
      budget_key: primary.key,
      triggered_budgets: triggered.map((x) => x.scope),
      triggered_budget_details: triggered,
      attributed_to_role: meta.role,
      step_id: meta.step_id,
      model: meta.model_key,
      model_backend: typeof meta.model_key === "string" ? String(meta.model_key).split("/")[0] : undefined,
    };
  }

  /** @returns {{ ok: true } | ReturnType<typeof budgetCheckDetails>} */
  function checkCostGuard(phase, meta = {}) {
    return budgetCheckDetails(phase, meta);
  }

  function maybeEmitBudgetWarning(phase, meta = {}) {
    if (!usdRatesMtok || budgetWarningRatio == null || budgetWarningRatio <= 0) return;
    const runLimit = budgetLimits.run;
    if (runLimit == null) return;
    const estimate = estimateRunUsd();
    if (estimate == null || !Number.isFinite(estimate)) return;
    const thresholdUsd = runLimit * budgetWarningRatio;
    if (estimate < thresholdUsd) return;
    const key = String(phase || "unknown");
    if (budgetWarningsEmitted.has(key)) return;
    budgetWarningsEmitted.add(key);
    traceEvent(taskId, {
      event: "budget_warning",
      phase: key,
      estimate_usd: roundUsd6(estimate),
      threshold_usd: roundUsd6(thresholdUsd),
      limit_usd: runLimit,
      warning_ratio: budgetWarningRatio,
      cost_basis: "actual_env_pricing_ollama_tokens",
      budget_scope: "run",
      ...(typeof meta.role === "string" ? { attributed_to_role: meta.role } : {}),
      ...(typeof meta.step_id === "string" ? { step_id: meta.step_id } : {}),
      ...(typeof meta.model_key === "string" ? { model: meta.model_key } : {}),
      ...(typeof meta.model_key === "string" ? { model_backend: String(meta.model_key).split("/")[0] } : {}),
    });
  }

  function budgetEventFields(d) {
    return {
      phase: d.phase,
      estimate_usd: d.estimate,
      limit_usd: d.limit,
      cost_basis: "actual_env_pricing_ollama_tokens",
      reason_code: "GUARD_COST_LIMIT",
      budget_scope: d.budget_scope,
      budget_key: d.budget_key,
      triggered_budgets: d.triggered_budgets,
      triggered_budget_details: d.triggered_budget_details,
      ...(typeof d.attributed_to_role === "string" ? { attributed_to_role: d.attributed_to_role } : {}),
      ...(typeof d.step_id === "string" ? { step_id: d.step_id } : {}),
      ...(typeof d.model === "string" ? { model: d.model } : {}),
      ...(typeof d.model_backend === "string" ? { model_backend: d.model_backend } : {}),
    };
  }
  let currentMode = "ORCHESTRATOR";
  const degradedInRun = new Set(); // agents that ran in fallback at least once this run
  clearDegradedAgents();
  configureLocalModelPolicy({ cliModel: options.localModel ?? null });
  setLocalModelTraceReporter((payload) => traceEvent(taskId, payload));
  const localOnlyCtx = await validateLocalOnlyRunPrerequisites({ checkOllama });

  log("orchestrator", `Working directory: ${cwd}`);
  log("orchestrator", `task_id: ${taskId} | flow: ${flowMode} | max_iterations: ${maxIterations}`);
  if (parsedBudgetWarningRatio.invalid) {
    traceEvent(taskId, {
      event: "budget_config_invalid",
      ...parsedBudgetWarningRatio.invalid,
    });
  }
  if (parsedBudgetLimits.invalid) {
    traceEvent(taskId, {
      event: "budget_config_invalid",
      ...parsedBudgetLimits.invalid,
    });
  }
  if (sessionEnv) {
    const credNames = sessionEnv.credentials.map(c => c.name).join(", ");
    log("orchestrator", `Environment: mode=${sessionEnv.mode} | credentials: ${credNames || "none"}`);
  }

  // ── Ollama connectivity check ────────────────────────────────────────────────
  const ollamaModel = process.env.OLLAMA_MODEL || null;
  if (localOnlyCtx.local_only_mode) {
    log(
      "orchestrator",
      `Local-only mode — model: ${localOnlyCtx.selected_model} (source: ${localOnlyCtx.override_source})`,
    );
  } else if (ollamaModel) {
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
    if (budgetWarningRatio != null) {
      log("orchestrator", `Guardrail: ORCH_BUDGET_WARNING_RATIO=${budgetWarningRatio} (trace-only warning threshold)`);
    }
  }
  if (Object.keys(budgetLimits.roles || {}).length || Object.keys(budgetLimits.steps || {}).length || Object.keys(budgetLimits.models || {}).length) {
    log("orchestrator", "Guardrail: ORCH_BUDGET_LIMITS_JSON active (run/role/step/model actual-token budget limits)");
  }
  if (maxStepRetries != null) {
    log("orchestrator", `Guardrail: ORCH_MAX_RETRIES=${maxStepRetries} (per agentId retry_number cap within one iteration)`);
  }
  traceEvent(taskId, {
    event: "session_start",
    session_id: taskId,
    flow_mode: flowMode,
    flow_src: "orchestrator_cli",
    scope: runScope.scope,
    ...(runScope.scope_unknown_reason ? { scope_unknown_reason: runScope.scope_unknown_reason } : {}),
    max_iterations: maxIterations,
    cwd,
    goal: goal.slice(0, 200),
    require_handoff: requireHandoff,
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    ...localOnlyCtx,
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
${isQaSpecBeforeDevEnabled(flowMode) ? `
Acceptance-first (QA_SPEC before DEV): place a qa step BEFORE the first dev-* step to define acceptance_criteria, test_strategy (or required_tests), edge_cases, non_goals, and validation_commands. Tag that step with "qaPhase": "spec". The post-implementation qa review step must use "qaPhase": "exec" and run after dev-* completes.` : ""}

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
  if (planCtxStats) {
    emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", planCtxStats, { iteration: 0, phase: "plan" });
    emitContextStatsRows(planCtxStats, "orchestrator", 0, {}, {}, { phase: "plan" });
  }
  maybeEmitBudgetWarning("plan");
  const planCost = checkCostGuard("plan", lastBudgetMeta);
  if (!planCost.ok) {
    summary = `Guardrail budget limit (${planCost.budget_scope}) exceeded: estimated spend ${roundUsd6(planCost.estimate)} USD exceeds limit ${planCost.limit} after plan phase.`;
    manualReview = true;
    traceEvent(taskId, {
      event: "budget_block",
      ...budgetEventFields(planCost),
    });
    traceEvent(taskId, {
      event: "budget_exhausted",
      ...budgetEventFields(planCost),
    });
    traceIterationDone(taskId, 0, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
      estimate_usd: roundUsd6(planCost.estimate),
      limit_usd: planCost.limit,
      guard_phase: "plan",
      budget_scope: planCost.budget_scope,
      triggered_budgets: planCost.triggered_budgets,
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
    if (isQaSpecBeforeDevEnabled(flowMode) && plan.steps.length) {
      const beforeQa = plan.steps.length;
      plan.steps = applyQaSpecBeforeDevPlan(plan.steps, { enabled: true });
      if (plan.steps.length !== beforeQa) {
        traceEvent(taskId, {
          event: "plan_normalized",
          reason: "qa_spec_before_dev",
          steps_added: plan.steps.length - beforeQa,
        });
      }
    }
    log("orchestrator", `Plan ready — ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => log(s.agentId || "?", `Step ${i + 1}: ${s.task}`));
    const capPlan = validatePlanStepsCapability(plan.steps, { sessionCredentialMode: credentialSessionMode });
    if (!capPlan.ok) {
      summary = `Plan rejected — ${capPlan.errors.join("; ")}`;
      manualReview = true;
      traceEvent(taskId, {
        event: "plan_capability_reject",
        capability_matrix_version: CAPABILITY_MATRIX_VERSION,
        errors: capPlan.errors,
      });
      skipMainOrchestrationLoop = true;
    }
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

    // Corrections from decide replace plan.steps — validate again from iteration 2 onward (iteration 1 covered after plan parse).
    if (iterations > 1) {
      const stepsEarly = plan.steps && plan.steps.length ? plan.steps : [];
      const capIter = validatePlanStepsCapability(stepsEarly, { sessionCredentialMode: credentialSessionMode });
      if (!capIter.ok) {
        summary = `Plan rejected — ${capIter.errors.join("; ")}`;
        manualReview = true;
        traceEvent(taskId, {
          event: "plan_capability_reject",
          capability_matrix_version: CAPABILITY_MATRIX_VERSION,
          errors: capIter.errors,
          iteration: iterations,
        });
        break orchestration;
      }
    }

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
      maybeEmitBudgetWarning(phase, lastBudgetMeta);
      const raw = checkCostGuard(phase, lastBudgetMeta);
      const d = decideCostGuard({ estimate: raw.ok ? null : (raw.estimate ?? null), maxCostUsd: raw.ok ? maxCostUsd : raw.limit, phase });
      if (!d.abort) return false;
      summary = d.summary;
      manualReview = true;
      traceEvent(taskId, {
        event: "budget_block",
        ...budgetEventFields(raw),
      });
      traceEvent(taskId, {
        event: "budget_exhausted",
        ...budgetEventFields(raw),
      });
      traceIterationDone(taskId, iterations, "guard_abort", transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), {
        estimate_usd: d.estimateUsd,
        limit_usd: raw.limit,
        guard_phase: phase,
        budget_scope: raw.budget_scope,
        triggered_budgets: raw.triggered_budgets,
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

    let qaSpecSatisfiedThisIteration = false;
    const qaSpecFlowEnabledRun = isQaSpecBeforeDevEnabled(flowMode);

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const agentId = step.agentId != null ? String(step.agentId).trim() : "";
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
          { cwd, sessionEnv, qaPhase: step.qaPhase }
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
      if (agentId === "qa") {
        Object.assign(donePayload, qaAgentDoneTraceExtras(result));
      }
      traceEvent(taskId, donePayload);
      if (shouldEmitQaReviewRecord(agentId, step)) {
        traceReviewRecord(
          traceEvent,
          taskId,
          buildReviewRecord({
            reviewerRole: "qa",
            output: result,
            iteration: iterations,
            stepId,
            reviewedArtifactIds: [stepId],
          }),
        );
      }
      setStepCompleted(runState);
      if (contextStats) {
        emitModelFallbackLifecycleIfNeeded(
          traceEvent,
          taskId,
          agentId,
          contextStats,
          { iteration: iterations, step_id: stepId, step_index: stepIndex, ...graphMeta, ...intentStep },
        );
        emitContextStatsRows(contextStats, agentId, iterations, graphMeta, intentStep, { step_id: stepId, step_index: stepIndex });
      }
      if (costGuardAbort("worker")) break orchestration;
      emittedStepIds.add(stepId);
      previousStepId = stepId;

      // ── Compact handoff (compact-handoff MCP) ──────────────────────────────
      let handoffYaml = "";
      /** @type {Record<string, unknown>} */
      let handoffCompressionMeta = {};
      const toMode = resolveHandoffMode(agentId, step, AGENT_TO_MODE[agentId]);
      const nextStepIdx = steps.indexOf(step) + 1;
      const nextAgent   = steps[nextStepIdx]?.agentId;
      const nextMode    = nextAgent ? (AGENT_TO_MODE[nextAgent] || "ORCHESTRATOR") : "ORCHESTRATOR";

      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        log("gate", `Compacting handoff for ${agentId} → ${nextMode}...`);
        const compactionMeta = { iteration: iterations, step_id: stepId, step_index: stepIndex, ...graphMeta, ...intentStep };
        emitContextCompactionStarted(traceEvent, taskId, agentId, compactionMeta);
        try {
          const compactRes = callCompactHandoff({
            text: result,
            modeCompleted: toMode,
            nextMode,
            iteration: iterations,
            maxIterations,
            flowMode,
          }, { cwd });
          handoffYaml = compactRes.yaml;
          bumpOllamaFromStats({
            ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
            ollama_completion_tokens: compactRes.ollama_completion_tokens,
          });
          emitContextCompactionCompleted(traceEvent, taskId, agentId, compactionMeta, compactRes);
          traceEvent(taskId, {
            event: "context_stats",
            agent: "context_compactor",
            attributed_to_role: agentId,
            invocation_type: "context_compaction",
            execution_actor: "context_compactor",
            trigger_reason: "handoff_policy",
            iteration: iterations,
            step_id: stepId,
            step_index: stepIndex,
            ...graphMeta,
            ...intentStep,
            ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
            ollama_completion_tokens: compactRes.ollama_completion_tokens,
          });
          log("gate", `Handoff YAML ready (${handoffYaml.length} chars)`);
          traceEvent(taskId, {
            event: "gate_result",
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            ...graphMeta,
            ...intentStep,
            ...edgeMeta("success"),
            gate: "compact_handoff",
            passed: true,
            formal_handoff_completed: true,
          });
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
            handoff_degraded: true,
          });
          handoffCompressionMeta = compactHandoffDegradedMeta(err);
          log("gate", `⚠ compact_handoff unavailable (degraded — continuing without YAML compression): ${msg}`);
        }
      }

      // ── Structural handoff validation (per-MODE key check) ────────────────
      if (AGENTS_REQUIRING_GATE.has(agentId)) {
        const requireQaSpecRef = qaSpecFlowEnabledRun && qaSpecSatisfiedThisIteration && toMode === "DEV";
        const sv = validateHandoffStructure(toMode, handoffYaml, { strict: requireHandoff, requireQaSpecRef });
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
        if (toMode === "QA_SPEC") qaSpecSatisfiedThisIteration = true;
        const qaFlowTrace = qaSpecFlowTraceExtras(toMode, true, handoffYaml);
        if (qaFlowTrace.event) {
          traceEvent(taskId, {
            ...qaFlowTrace,
            agent: agentId,
            iteration: iterations,
            step_id: stepId,
            step_index: stepIndex,
            ...graphMeta,
            ...intentStep,
          });
        }
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
    let cerberusReviewRecordEmitted = false;
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
      if (cerbCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "cerberus", cerbCtx, { iteration: iterations, phase: "review" });
        emitContextStatsRows(cerbCtx, "cerberus", iterations, {}, {}, { phase: "review" });
      }
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
      traceReviewRecord(
        traceEvent,
        taskId,
        buildReviewRecord({
          reviewerRole: "cerberus",
          output: "",
          iteration: iterations,
          gateBlocked: true,
          gateReason: err.message,
          reviewedArtifactIds: artifacts
            .filter((a) => a.step_id && !a.gateBlocked)
            .map((a) => a.step_id),
        }),
      );
      cerberusReviewRecordEmitted = true;
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
      const cerbCompactionMeta = { iteration: iterations, phase: "cerberus_advance" };
      emitContextCompactionStarted(traceEvent, taskId, "cerberus", cerbCompactionMeta);
      try {
        const compactRes = callCompactHandoff({
          text: cerberusResult,
          modeCompleted: "CERBERUS",
          nextMode: "ORCHESTRATOR",
          iteration: iterations,
          maxIterations,
          flowMode,
        }, { cwd });
        cerberusHandoff = compactRes.yaml;
        bumpOllamaFromStats({
          ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
          ollama_completion_tokens: compactRes.ollama_completion_tokens,
        });
        emitContextCompactionCompleted(traceEvent, taskId, "cerberus", cerbCompactionMeta, compactRes);
        traceEvent(taskId, {
          event: "context_stats",
          agent: "context_compactor",
          attributed_to_role: "cerberus",
          invocation_type: "context_compaction",
          execution_actor: "context_compactor",
          trigger_reason: "handoff_policy",
          iteration: iterations,
          phase: "cerberus_advance",
          ollama_prompt_tokens: compactRes.ollama_prompt_tokens,
          ollama_completion_tokens: compactRes.ollama_completion_tokens,
        });
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
            handoff_degraded: true,
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
    const reviewedIds = artifacts
      .filter((a) => a.step_id && !a.gateBlocked && a.agentId !== "cerberus")
      .map((a) => a.step_id);
    if (!cerberusReviewRecordEmitted) {
      traceReviewRecord(
        traceEvent,
        taskId,
        buildReviewRecord({
          reviewerRole: "cerberus",
          output: cerberusResult,
          iteration: iterations,
          reviewedArtifactIds: reviewedIds,
        }),
      );
    }
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
      if (correctCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", correctCtx, { iteration: iterations, phase: "correct" });
        emitContextStatsRows(correctCtx, "orchestrator", iterations, {}, {}, { phase: "correct" });
      }
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
      if (decideCtx) {
        emitModelFallbackLifecycleIfNeeded(traceEvent, taskId, "orchestrator", decideCtx, { iteration: iterations, phase: "decide" });
        emitContextStatsRows(decideCtx, "orchestrator", iterations, {}, {}, { phase: "decide" });
      }
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
  const permission_summary = aggregatePermissionCheckRows(_permissionCheckAuditBuffer);
  const traceRows = loadTraceRowsForTask(taskId);
  runRecoverySweepAndTrace(traceEvent, taskId, traceRows, {
    lifecycleMode: "live_before_session_end",
  });
  traceEvent(taskId, {
    event: "session_end",
    session_id: taskId,
    flow_src: "orchestrator_cli",
    scope: runScope.scope,
    ...(runScope.scope_unknown_reason ? { scope_unknown_reason: runScope.scope_unknown_reason } : {}),
    iterations,
    done,
    summary: summary.slice(0, 200),
    agents_run: [...new Set(artifacts.map((a) => a.agentId))],
    gate_blocks: artifacts.filter((a) => a.gateBlocked).length,
    run_state_snapshot: getRunStatePublicView(runState),
    ...(scenarioId ? { scenario_id: scenarioId } : {}),
    ...mcpSummary,
    permission_summary,
    ...(ollamaTokenTotals.prompt > 0 || ollamaTokenTotals.completion > 0
      ? {
        ollama_prompt_tokens_total: ollamaTokenTotals.prompt,
        ollama_completion_tokens_total: ollamaTokenTotals.completion,
      }
      : {}),
    ...(qaDegraded ? { qa_degraded: true } : {}),
    ...(manualReviewRecommended ? { manual_review_recommended: true } : {}),
    ...(handoffFallbackAny ? { handoff_fallback_used: true, handoff_degraded: true } : {}),
  });

  clearMcpAudit();
  return { done, summary, artifacts, iterations, taskId, runState: getRunStatePublicView(runState) };
}

module.exports = {
  run,
  emitPermissionCheckTrace,
  resolveMaxIterations,
  detectBlockers,
  validateHandoffStructure,
  _sanitize,
  redactSensitivePlaintext,
  _hashGoal,
  resolveRequireHandoff,
  compactHandoffDegradedMeta,
  compactHandoffStrictFailureFields,
  aggregateMcpUsage,
  aggregatePermissionCheckRows,
  stripLeadingOwnerArchitectForDegradedMultiAgent,
  isQaSpecBeforeDevEnabled,
  applyQaSpecBeforeDevPlan,
  resolveHandoffMode,
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

  /** Test-only: MCP path surface for trace parity assertions — not a supported public API. */
  _test_invokeMcpDirect: invokeMcpDirect,
  _test_callStateMcp: callStateMcp,
  _test_callCompactHandoff: callCompactHandoff,
  _test_beginMcpAudit: beginMcpAudit,
  _test_clearMcpAudit: clearMcpAudit,

  /** Test / doc: parse ENVIRONMENT block from MODE header goal text. */
  parseEnvironment,
};
