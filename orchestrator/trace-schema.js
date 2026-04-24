"use strict";

/**
 * JSON Schema validation for trace JSONL lines (trace_schema_version "2").
 * Used at write time (orchestrator traceEvent) and optionally at read time (parseJsonl, CLI).
 *
 * Runtime policy: only versions in SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ are accepted
 * by validateTraceLine / parseTraceLine strict (before Ajv), so mismatches fail with an
 * explicit policy message — see docs/orchestrator/schema-versioning.md.
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

/** Writer version this build emits; must match bundled `trace-v2-line.schema.json` enum. */
const TRACE_LINE_WRITER_VERSION = "2";

/** Versions this binary can validate with the bundled schema (multi-version readers: extend here + loaders). */
const SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ = new Set([TRACE_LINE_WRITER_VERSION]);

const SCHEMA_PATH = path.join(__dirname, "schemas", "trace-v2-line.schema.json");
let _validate = null;

const REJECTION_CAP = 50;

/**
 * Valid reasons for a rejection entry. Enum closed — no free-form strings.
 * @readonly
 */
const REJECTION_REASONS = /** @type {const} */ ([
  "policy_missing_version",
  "policy_unsupported_version",
  "ajv_schema_error",
]);

/**
 * rejection_entry schema:
 *   reason:      string (enum REJECTION_REASONS) — always present
 *   event:       string | undefined — from record.event when available
 *   step_id:     string | undefined — from record.step_id when available
 *   reason_code: string | undefined — from record.transition_reason.reason_code when available
 *
 * Invariants enforced at insert time:
 *   - reason must be in REJECTION_REASONS
 *   - at least one of event, step_id, reason_code must be present (or record is bare)
 *   - no null values — fields are omitted rather than nulled
 */
const _metrics = {
  policy_missing_version: 0,
  policy_unsupported_version: 0,
  ajv_schema_error: 0,
  rejections: [],
};

function _addRejection(reason, record) {
  if (!REJECTION_REASONS.includes(reason)) return; // unknown reason = silent discard

  const entry = { reason };
  if (record && typeof record === "object") {
    if (typeof record.event === "string") entry.event = record.event;
    if (typeof record.step_id === "string") entry.step_id = record.step_id;
    if (
      record.transition_reason &&
      typeof record.transition_reason.reason_code === "string"
    ) {
      entry.reason_code = record.transition_reason.reason_code;
    }
  }
  if (_metrics.rejections.length >= REJECTION_CAP) _metrics.rejections.shift();
  _metrics.rejections.push(entry);
}

function getValidationMetrics() {
  return {
    policy_missing_version: _metrics.policy_missing_version,
    policy_unsupported_version: _metrics.policy_unsupported_version,
    ajv_schema_error: _metrics.ajv_schema_error,
    rejections: [..._metrics.rejections],
  };
}

function resetValidationMetrics() {
  _metrics.policy_missing_version = 0;
  _metrics.policy_unsupported_version = 0;
  _metrics.ajv_schema_error = 0;
  _metrics.rejections = [];
}

function getValidator() {
  if (_validate) return _validate;
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validate = ajv.compile(schema);
  return _validate;
}

/**
 * @param {unknown} record
 * @returns {string[] | null} policy errors, or null if OK
 */
function traceSchemaVersionPolicyErrors(record) {
  const v = record && record.trace_schema_version;
  if (typeof v !== "string") {
    const allowed = [...SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ].join(", ");
    const got = v === undefined || v === null ? "missing" : `<${typeof v}>`;
    return { errors: [`trace_schema_version: this binary only accepts ${allowed}; got ${got}`], reason: "missing_version" };
  }
  if (!SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ.has(v)) {
    const allowed = [...SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ].join(", ");
    return { errors: [`trace_schema_version: this binary only accepts ${allowed}; got <string>`], reason: "unsupported_version" };
  }
  return null;
}

/**
 * @param {unknown} record - one parsed JSON object from a trace line
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateTraceLine(record) {
  const policy = traceSchemaVersionPolicyErrors(record);
  if (policy) {
    if (policy.reason === "missing_version") {
      _metrics.policy_missing_version++;
      _addRejection("policy_missing_version", record);
    } else {
      _metrics.policy_unsupported_version++;
      _addRejection("policy_unsupported_version", record);
    }
    return { ok: false, errors: policy.errors };
  }
  const validate = getValidator();
  if (!validate(record)) {
    _metrics.ajv_schema_error++;
    _addRejection("ajv_schema_error", record);
    const errs = (validate.errors || []).map((e) => {
      const rootPath = e.instancePath ? `/${e.instancePath.split("/")[1]}` : "/";
      return `${rootPath} ${e.message || "invalid"}`.trim();
    });
    return { ok: false, errors: errs.length ? errs : ["unknown schema error"] };
  }
  return { ok: true };
}

/**
 * @param {string} line
 * @param {{ strict?: boolean }} [opts]
 * @returns {object}
 */
function parseTraceLine(line, opts = {}) {
  const o = JSON.parse(line);
  if (opts.strict) {
    const v = validateTraceLine(o);
    if (!v.ok) {
      throw new Error(v.errors.join("; "));
    }
  }
  return o;
}


/**
 * @param {object[]} lines - parsed trace line objects from a single run
 * @returns {{
 *   ok: boolean,
 *   violations: Array<{type: string, step_id?: string|null, parent_step_id?: string, line_index?: number, to_step_id?: string, event?: string}>,
 *   warnings: Array<{type: string, ok?: boolean}>
 * }}
 *
 * **step_id lifecycle:** `agent_start` **registers** a step id (duplicate `agent_start` with same id → violation).
 * `agent_done` (and other events) may reuse that id without registering again. `agent_done` without a prior
 * `agent_start` for the same `step_id` → `agent_done_without_start`.
 *
 * Human-readable contract: docs/orchestrator/graph-validation.md
 */
function validateTraceRunGraph(lines) {
  const violations = /** @type {Array<{type: string, step_id?: string|null, parent_step_id?: string, line_index?: number, to_step_id?: string, event?: string}>} */ ([]);
  const warnings = /** @type {Array<{type: string, ok?: boolean}>} */ ([]);

  let sawAnyStepId = false;
  for (let i = 0; i < lines.length; i++) {
    const sid = lines[i].step_id;
    if (sid != null && sid !== "") sawAnyStepId = true;
  }
  if (lines.length > 0 && !sawAnyStepId) {
    warnings.push({ type: "no_steps_emitted", ok: true });
  }

  const stepIndex = new Set();
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const step_id = row.step_id;
    if (step_id == null || step_id === "") continue;
    const event = row.event;
    if (event === undefined || event === null || event === "") {
      violations.push({ type: "missing_event_with_step_id", step_id, line_index: i });
      continue;
    }

    if (event === "agent_start") {
      if (stepIndex.has(step_id)) {
        violations.push({ type: "duplicate_step_id", step_id, line_index: i });
      } else {
        stepIndex.add(step_id);
      }
    } else if (event === "agent_done") {
      if (!stepIndex.has(step_id)) {
        violations.push({ type: "agent_done_without_start", step_id, line_index: i });
      }
    } else if (!stepIndex.has(step_id)) {
      violations.push({ type: "step_id_unknown", step_id, line_index: i, event: String(event) });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const { step_id, parent_step_id } = lines[i];
    if (parent_step_id != null && parent_step_id !== "" && !stepIndex.has(parent_step_id)) {
      violations.push({ type: "orphan_parent", step_id: step_id ?? null, parent_step_id, line_index: i });
    }
  }

  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const s = row.step_id;
    const p = row.parent_step_id;
    if (s == null || s === "" || p == null || p === "") continue;
    if (!stepIndex.has(s) || !stepIndex.has(p)) continue;
    if (!adj.has(p)) adj.set(p, []);
    adj.get(p).push(s);
  }

  const cycleNodes = new Set();
  for (const [p, chs] of adj) {
    cycleNodes.add(p);
    for (const c of chs) cycleNodes.add(c);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  /** @type {Map<string, number>} */
  const color = new Map();
  function dfsCycle(u) {
    color.set(u, GRAY);
    for (const v of adj.get(u) || []) {
      const cv = color.get(v) ?? WHITE;
      if (cv === GRAY) {
        return { type: "cycle", step_id: u, to_step_id: v };
      }
      if (cv === WHITE) {
        const hit = dfsCycle(v);
        if (hit) return hit;
      }
    }
    color.set(u, BLACK);
    return null;
  }
  for (const n of cycleNodes) {
    if ((color.get(n) ?? WHITE) === WHITE) {
      const hit = dfsCycle(n);
      if (hit) {
        violations.push(hit);
        break;
      }
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}

module.exports = {
  TRACE_LINE_WRITER_VERSION,
  SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ,
  REJECTION_REASONS,
  traceSchemaVersionPolicyErrors,
  validateTraceLine,
  parseTraceLine,
  getValidationMetrics,
  resetValidationMetrics,
  validateTraceRunGraph,
  SCHEMA_PATH,
};
