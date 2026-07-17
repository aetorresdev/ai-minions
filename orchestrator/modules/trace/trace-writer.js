"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { redactSensitivePlaintext } = require("./trace-redact");
const {
  TRACE_LINE_WRITER_VERSION,
  validateTraceLine: validateTraceLineForWrite,
} = require("./trace-schema");

/**
 * Resolve trace output directory on each read/write (not at module load).
 * Intentional: tests reload `orchestrator.js` while changing `ORCH_TRACES_DIR`
 * per case (`mcpGateTrace`, permission gate tests). Module-load caching caused stale paths.
 */
function resolveTracesDir() {
  return process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim()
    ? path.resolve(String(process.env.ORCH_TRACES_DIR).trim())
    : path.join(os.homedir(), ".claude", "metrics", "traces");
}

const TRACE_REDACT_GOAL = process.env.TRACE_REDACT_GOAL === "1";

/** Same as `TRACE_LINE_WRITER_VERSION` in trace-schema.js — single source for writer + schema. */
const TRACE_SCHEMA_VERSION = TRACE_LINE_WRITER_VERSION;

let _traceWarnEmitted = false;

/** @type {((taskId: string, sanitized: object) => void) | null} */
let permissionCheckAuditHook = null;

/**
 * Optional hook for MCP audit buffer (wired from orchestrator until mcp-client slice).
 * @param {(taskId: string, sanitized: object) => void | null} fn
 */
function setPermissionCheckAuditHook(fn) {
  permissionCheckAuditHook = fn;
}

function _hashGoal(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
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
  if ("sanitized_preview" in out && out.sanitized_preview != null) {
    out.sanitized_preview = redactSensitivePlaintext(String(out.sanitized_preview)).slice(0, 500);
  }
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

function traceIterationDone(taskId, iteration, outcome, trSpread, extra = {}, ctx = {}) {
  traceEvent(taskId, composeIterationDonePayload(iteration, outcome, trSpread, extra, ctx));
}

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
  const filePath = path.join(resolveTracesDir(), `${taskId}.jsonl`);
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
  if (sanitized.event === "permission_check" && permissionCheckAuditHook) {
    permissionCheckAuditHook(taskId, sanitized);
  }
  try {
    const tracesDir = resolveTracesDir();
    fs.mkdirSync(tracesDir, { recursive: true });
    const line = JSON.stringify(record);
    fs.appendFileSync(path.join(tracesDir, `${taskId}.jsonl`), line + "\n");
  } catch (err) {
    if (!_traceWarnEmitted) {
      process.stderr.write(`[trace] WARNING: could not write trace (${err.message}) — tracing disabled for this session\n`);
      _traceWarnEmitted = true;
    }
  }
}

module.exports = {
  resolveTracesDir,
  TRACE_REDACT_GOAL,
  TRACE_SCHEMA_VERSION,
  FAILURE_TYPES,
  FAILURE_AXES,
  TRANSITION_REASON_TYPES,
  TRANSITION_REASON_CODES,
  setPermissionCheckAuditHook,
  _hashGoal,
  _sanitize,
  failureTypeForIterationDone,
  failureAxisForIterationDone,
  composeIterationDonePayload,
  traceIterationDone,
  inferReasonCode,
  transitionReason,
  loadTraceRowsForTask,
  traceEvent,
};
