'use strict';

/**
 * Append validated trace v2 JSONL lines (shared by orchestrator and workspace lifecycle).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateTraceLine } = require('./trace-schema');

const TRACE_SCHEMA_VERSION = '2';

/**
 * @returns {string}
 */
function getTracesDir() {
  const env = process.env.ORCH_TRACES_DIR && String(process.env.ORCH_TRACES_DIR).trim();
  return env ? path.resolve(env) : path.join(os.homedir(), '.claude', 'metrics', 'traces');
}

/**
 * @param {string} taskId
 * @param {string} [tracesDir]
 * @returns {string}
 */
function traceFilePath(taskId, tracesDir = getTracesDir()) {
  return path.join(tracesDir, `${taskId}.jsonl`);
}

/**
 * @param {string} taskId
 * @param {string} [tracesDir]
 * @returns {number}
 */
function countTraceLines(taskId, tracesDir = getTracesDir()) {
  const fp = traceFilePath(taskId, tracesDir);
  if (!fs.existsSync(fp)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
    if (line.trim()) n += 1;
  }
  return n;
}

/**
 * @param {string} taskId
 * @param {Record<string, unknown>} event
 * @param {{ tracesDir?: string, tsMs?: number, throwOnInvalid?: boolean, silentWriteFailure?: boolean }} [options]
 */
function appendTraceEvent(taskId, event, options = {}) {
  const tracesDir = options.tracesDir || getTracesDir();
  const tsMs = typeof options.tsMs === 'number' ? options.tsMs : Date.now();
  const record = {
    ...event,
    task_id: taskId,
    trace_schema_version: TRACE_SCHEMA_VERSION,
    ts: new Date(tsMs).toISOString(),
    ts_ms: tsMs,
  };
  const v = validateTraceLine(record);
  if (!v.ok) {
    if (options.throwOnInvalid !== false) {
      throw new Error(`trace line failed JSON Schema: ${v.errors.join('; ')}`);
    }
    return { ok: false, errors: v.errors };
  }

  try {
    fs.mkdirSync(tracesDir, { recursive: true });
    const lineIndex = countTraceLines(taskId, tracesDir);
    fs.appendFileSync(traceFilePath(taskId, tracesDir), `${JSON.stringify(record)}\n`);
    return { ok: true, record, line_index: lineIndex, traces_dir: tracesDir };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!options.silentWriteFailure) {
      process.stderr.write(`[trace] WARNING: could not write trace (${msg})\n`);
    }
    return { ok: false, error: msg };
  }
}

module.exports = {
  TRACE_SCHEMA_VERSION,
  getTracesDir,
  traceFilePath,
  countTraceLines,
  appendTraceEvent,
};
