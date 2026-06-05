'use strict';

/**
 * Map ai-minions JSONL trace rows to collector-agnostic OTel span shapes.
 * Slice 1: mapping + redaction only — OTLP HTTP export is a follow-up slice.
 */

const crypto = require('crypto');
const { sanitizeTraceValueForRead } = require('./trace-redact');

/** Pinned at implement time — see docs/orchestrator/otel-genai-trace-export-contract.md */
const OTEL_GENAI_SEMCONV_PIN = '1.36.0';

/** @type {Record<string, { name: string, root?: boolean, genAi?: boolean, governance?: boolean }>} */
const EVENT_SPAN_MAP = {
  session_start: { name: 'orchestrator.run', root: true },
  session_end: { name: 'orchestrator.run.end' },
  permission_check: { name: 'permission.check' },
  credential_broker_used: { name: 'credential.broker' },
  approval_required: { name: 'governance.approval', governance: true },
  approval_granted: { name: 'governance.approval', governance: true },
  approval_denied: { name: 'governance.approval', governance: true },
  approval_skipped: { name: 'governance.approval', governance: true },
  doubt_review_started: { name: 'cerberus.doubt_review' },
  doubt_review_finding: { name: 'cerberus.doubt_review' },
  doubt_review_verdict: { name: 'cerberus.doubt_review' },
  review_record: { name: 'cerberus.review' },
  context_stats: { name: 'gen_ai.chat', genAi: true },
  context_compaction_started: { name: 'context.compaction' },
  context_compaction_completed: { name: 'context.compaction' },
  budget_warning: { name: 'budget.event' },
  budget_block: { name: 'budget.event' },
  budget_exhausted: { name: 'budget.event' },
  workspace_promotion_started: { name: 'workspace.promotion' },
  workspace_promotion_completed: { name: 'workspace.promotion' },
  workspace_promotion_denied: { name: 'workspace.promotion' },
  workspace_promotion_failed: { name: 'workspace.promotion' },
};

const CONTENT_KEYS = new Set([
  'goal',
  'prompt',
  'response',
  'summary',
  'handoff_yaml',
  'output',
  'raw_output',
  'message',
  'messages',
]);

const MAX_CONTENT_STRIP_DEPTH = 32;

/**
 * Precedence: explicit options.captureContent (boolean) overrides env; else
 * ORCH_OTEL_GENAI_CAPTURE_CONTENT=1 enables capture. Default: false.
 *
 * @param {{ captureContent?: boolean }} [options]
 * @returns {boolean}
 */
function resolveCaptureContent(options = {}) {
  if (options.captureContent === true) return true;
  if (options.captureContent === false) return false;
  return process.env.ORCH_OTEL_GENAI_CAPTURE_CONTENT === '1';
}

/**
 * Recursively drop CONTENT_KEYS from objects/arrays before span attribute serialization.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function stripContentKeys(value, depth = 0) {
  if (depth > MAX_CONTENT_STRIP_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripContentKeys(item, depth + 1));
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (CONTENT_KEYS.has(key)) continue;
    out[key] = stripContentKeys(child, depth + 1);
  }
  return out;
}

/**
 * @param {string} taskId
 * @returns {string} 32-char hex trace id
 */
function traceIdForTask(taskId) {
  return crypto.createHash('sha256').update(`ai-minions-trace:${taskId}`).digest('hex').slice(0, 32);
}

/**
 * @param {string} taskId
 * @param {number} index
 * @param {string} event
 * @returns {string} 16-char hex span id
 */
function spanIdForRow(taskId, index, event) {
  return crypto.createHash('sha256').update(`${taskId}:${index}:${event}`).digest('hex').slice(0, 16);
}

/**
 * @param {unknown} value
 * @returns {string | number | boolean}
 */
function otelAttributeValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

/**
 * @param {object} row
 * @param {{ captureContent?: boolean }} [options]
 * @returns {Array<{ key: string, value: string | number | boolean }>}
 */
function rowToSpanAttributes(row, options = {}) {
  const captureContent = resolveCaptureContent(options);
  const sanitized = /** @type {object} */ (sanitizeTraceValueForRead(row));
  const exportRow = captureContent ? sanitized : /** @type {object} */ (stripContentKeys(sanitized));
  /** @type {Array<{ key: string, value: string | number | boolean }>} */
  const attrs = [
    { key: 'ai_minions.event', value: String(sanitized.event || 'unknown') },
    { key: 'ai_minions.task_id', value: String(sanitized.task_id || '') },
    { key: 'ai_minions.trace_schema_version', value: String(sanitized.trace_schema_version || '') },
    { key: 'otel.gen_ai.semconv.pin', value: OTEL_GENAI_SEMCONV_PIN },
  ];

  for (const [key, value] of Object.entries(exportRow)) {
    if (key === 'event' || key === 'task_id' || key === 'trace_schema_version') continue;
    if (value === null || value === undefined) continue;
    attrs.push({ key: `ai_minions.${key}`, value: otelAttributeValue(value) });
  }

  if (sanitized.event === 'context_stats') {
    const modelName = sanitized.model ?? sanitized.agent;
    if (modelName != null) attrs.push({ key: 'gen_ai.request.model', value: String(modelName) });
    if (sanitized.ollama_prompt_tokens != null) {
      attrs.push({ key: 'gen_ai.usage.input_tokens', value: Number(sanitized.ollama_prompt_tokens) });
    }
    if (sanitized.ollama_completion_tokens != null) {
      attrs.push({ key: 'gen_ai.usage.output_tokens', value: Number(sanitized.ollama_completion_tokens) });
    }
    if (sanitized.backend != null) attrs.push({ key: 'gen_ai.system', value: String(sanitized.backend) });
  }

  if (sanitized.event === 'permission_check') {
    if (sanitized.decision != null) attrs.push({ key: 'ai_minions.permission.decision', value: String(sanitized.decision) });
    if (sanitized.reason_code != null) attrs.push({ key: 'ai_minions.permission.reason_code', value: String(sanitized.reason_code) });
  }

  return attrs;
}

/**
 * @param {number | undefined} tsMs
 * @returns {string | undefined}
 */
function unixNanoFromTsMs(tsMs) {
  if (tsMs == null || !Number.isFinite(Number(tsMs))) return undefined;
  return String(BigInt(Math.trunc(Number(tsMs))) * 1_000_000n);
}

/**
 * @param {object} row
 * @param {number} index
 * @param {{ captureContent?: boolean, rootSpanId?: string }} [options]
 * @returns {object | null}
 */
function mapTraceRowToOtelSpan(row, index, options = {}) {
  if (!row || typeof row !== 'object') return null;
  const event = String(row.event || '');
  const mapping = EVENT_SPAN_MAP[event];
  if (!mapping) return null;

  const taskId = String(row.task_id || '');
  if (!taskId) return null;

  const traceId = traceIdForTask(taskId);
  const spanId = spanIdForRow(taskId, index, event);
  const startNano = unixNanoFromTsMs(row.ts_ms) || unixNanoFromTsMs(Date.now());

  return {
    traceId,
    spanId,
    parentSpanId: mapping.root ? undefined : options.rootSpanId,
    name: mapping.name,
    kind: mapping.root ? 'SERVER' : 'INTERNAL',
    startTimeUnixNano: startNano,
    endTimeUnixNano: startNano,
    attributes: rowToSpanAttributes(row, options),
    ai_minions: {
      event,
      task_id: taskId,
      row_index: index,
    },
  };
}

/**
 * @param {object[]} rows
 * @param {{ captureContent?: boolean }} [options]
 * @returns {{ semconv_pin: string, task_id: string | null, spans: object[] }}
 */
function mapTraceRowsToOtelSpans(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const captureContent = resolveCaptureContent(options);
  /** @type {string | null} */
  let taskId = null;
  /** @type {string | undefined} */
  let rootSpanId;
  /** @type {object[]} */
  const spans = [];

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!taskId && row && row.task_id) taskId = String(row.task_id);
    if (row && row.event === 'session_start') {
      rootSpanId = spanIdForRow(String(row.task_id), i, 'session_start');
    }
    const span = mapTraceRowToOtelSpan(row, i, { ...options, captureContent, rootSpanId });
    if (span) spans.push(span);
  }

  return {
    semconv_pin: OTEL_GENAI_SEMCONV_PIN,
    task_id: taskId,
    spans,
  };
}

module.exports = {
  OTEL_GENAI_SEMCONV_PIN,
  EVENT_SPAN_MAP,
  CONTENT_KEYS,
  resolveCaptureContent,
  stripContentKeys,
  traceIdForTask,
  spanIdForRow,
  rowToSpanAttributes,
  mapTraceRowToOtelSpan,
  mapTraceRowsToOtelSpans,
};
