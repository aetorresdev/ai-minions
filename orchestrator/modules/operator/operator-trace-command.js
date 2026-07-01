'use strict';

/**
 * ai-minions status/explain — read-only trace consumption via buildOperatorTraceSummary.
 * Reuses explain-run trace resolution; no second outcome SoT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { sanitizeTraceRowsForRead } = require('../trace/trace-redact');
const {
  parseJsonl,
  enforceLimits,
  resolveLatestRunFile,
  deriveExplain,
} = require('./explain-run');
const {
  buildOperatorTraceSummary,
  formatOperatorTraceSummaryLines,
} = require('./operator-trace-summary');

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
function hasSessionEnd(rows) {
  return rows.some((r) => r && r.event === 'session_end');
}

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
function hasSessionStart(rows) {
  return rows.some((r) => r && r.event === 'session_start');
}

/**
 * @param {ReturnType<typeof buildOperatorTraceSummary>} summary
 * @param {object[]} rows
 * @returns {'ready'|'warn'|'degraded'|'blocked'|'running'|'failed'|'complete'}
 */
function deriveOperatorStatusLabel(summary, rows) {
  if (!hasSessionEnd(rows) && hasSessionStart(rows)) return 'running';
  if (summary.outcome === 'complete') {
    return summary.missing_evidence.length ? 'warn' : 'complete';
  }
  if (summary.outcome === 'failed') return 'failed';
  if (summary.outcome === 'blocked') return 'blocked';
  if (summary.outcome === 'degraded') return 'degraded';
  if (summary.outcome === 'unknown') return hasSessionStart(rows) ? 'running' : 'warn';
  return 'warn';
}

/**
 * @param {ReturnType<typeof buildOperatorTraceSummary>} summary
 * @returns {string}
 */
function deriveWhatNotToDo(summary) {
  if (summary.outcome === 'blocked') {
    return 'Do not merge or claim gate-complete until blockers are resolved.';
  }
  if (summary.outcome === 'degraded') {
    return 'Do not claim full MODE/gate coverage or production-ready behavior.';
  }
  if (summary.outcome === 'failed') {
    return 'Do not retry blindly without reading failure taxonomy and fixing root cause.';
  }
  if (summary.missing_evidence.length) {
    return 'Do not claim beta/external readiness until missing evidence is addressed.';
  }
  return 'Do not treat this summary as authority over raw trace on disputes — trace wins.';
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   tracesDir?: string,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 *   resolveLatest?: typeof resolveLatestRunFile,
 * }} [options]
 */
function loadOperatorTraceContext(options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  const existsSync = options.existsSync ?? fs.existsSync;
  const resolveLatest = options.resolveLatest ?? resolveLatestRunFile;
  const tracesDir = options.tracesDir
    || process.env.ORCH_TRACES_DIR
    || path.join(os.homedir(), '.claude', 'metrics', 'traces');

  /** @type {string | null} */
  let filePath = options.filePath ? path.resolve(String(options.filePath)) : null;
  const runIdOpt = options.runId ? String(options.runId) : null;

  if (!filePath && runIdOpt) {
    filePath = path.join(tracesDir, `${runIdOpt}.jsonl`);
  }
  if (!filePath) {
    filePath = resolveLatest(tracesDir);
  }

  if (!filePath || !existsSync(filePath)) {
    return {
      ok: false,
      code: 'TRACE_NOT_FOUND',
      reason_code: 'OPERATOR_TRACE_NOT_FOUND',
      next_safe_action: 'Provide --run-id <task_id> or --file <path> to a trace JSONL file.',
      trace_file: filePath,
    };
  }

  const raw = readFileSync(filePath, 'utf8');
  const { text, truncated } = enforceLimits(raw);
  const { rows, skipped } = parseJsonl(text);
  const sorted = sanitizeTraceRowsForRead(rows.slice().sort((a, b) => {
    const ta = typeof a.ts_ms === 'number' ? a.ts_ms : 0;
    const tb = typeof b.ts_ms === 'number' ? b.ts_ms : 0;
    return ta - tb;
  }));

  const runId = runIdOpt
    || (sorted.find((r) => r && typeof r.task_id === 'string') || {}).task_id
    || (sorted.find((r) => r && typeof r.run_id === 'string') || {}).run_id
    || path.basename(filePath, '.jsonl');

  const summary = buildOperatorTraceSummary(sorted, { trace_file: filePath });
  const statusLabel = deriveOperatorStatusLabel(summary, sorted);
  const explain = deriveExplain(sorted);

  return {
    ok: true,
    run_id: runId,
    trace_file: filePath,
    rows: sorted,
    summary,
    status_label: statusLabel,
    explain,
    skipped,
    truncated,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {string}
 */
function formatOperatorStatusText(ctx) {
  const { summary, status_label: statusLabel } = ctx;
  const lines = [
    'ai-minions status',
    `  status:           ${statusLabel}`,
    `  run_id:           ${ctx.run_id}`,
    `  outcome:          ${summary.outcome}`,
    `  current_phase:    ${summary.current_phase ?? '-'}`,
    `  trace_file:       ${ctx.trace_file}`,
  ];
  if (summary.degraded_mode.active) {
    lines.push(`  degraded_codes:   ${summary.degraded_mode.reason_codes.join(', ')}`);
  }
  if (summary.blocked_gates.length) {
    lines.push(`  blockers:         ${summary.blocked_gates.join('; ')}`);
  }
  lines.push(`  cerberus:         ${summary.cerberus.verdict ?? '-'}`);
  lines.push(`  next_safe_action: ${summary.next_safe_action}`);
  lines.push('');
  lines.push(...formatOperatorTraceSummaryLines(summary));
  if (ctx.truncated) {
    lines.push('WARNING: trace truncated to last session_end segment (size limits)');
  }
  if (ctx.skipped > 0) {
    lines.push(`WARNING: ${ctx.skipped} invalid JSON line(s) skipped`);
  }
  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {string}
 */
function formatOperatorExplainText(ctx) {
  const { summary, explain } = ctx;
  /** @type {string[]} */
  const reasonCodes = [];
  if (summary.policy_decision.reason_code) reasonCodes.push(summary.policy_decision.reason_code);
  for (const code of summary.degraded_mode.reason_codes) {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
  }

  const lines = [
    'ai-minions explain',
    `  run_id:           ${ctx.run_id}`,
    `  outcome:          ${summary.outcome}`,
    `  trace_file:       ${ctx.trace_file}`,
    `  reason_codes:     ${reasonCodes.length ? reasonCodes.join(', ') : '(none recorded)'}`,
    `  missing_evidence: ${summary.missing_evidence.length ? summary.missing_evidence.join(', ') : '(none)'}`,
    `  blocking_gate:    ${summary.blocked_gates[0] ?? '-'}`,
    `  policy_source:    ${summary.policy_decision.policy_source ?? '-'}`,
    `  remediation:      ${summary.next_safe_action}`,
    `  what_not_to_do:   ${deriveWhatNotToDo(summary)}`,
  ];

  if (explain.failure_type !== undefined) {
    lines.push(`  failure_type:     ${explain.failure_type}`);
  }
  if (explain.last_failure_axis !== undefined) {
    lines.push(`  failure_axis:     ${explain.last_failure_axis}`);
  }
  if (summary.permission_denials.length) {
    const d0 = summary.permission_denials[0];
    lines.push(`  permission_denials: ${summary.permission_denials.length} (first reason: ${d0.reason_code ?? d0.decision})`);
  }
  lines.push('');
  lines.push(...formatOperatorTraceSummaryLines(summary));
  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {object}
 */
function buildOperatorStatusJson(ctx) {
  return {
    command: 'status',
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    status: ctx.status_label,
    operator_trace_summary: ctx.summary,
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {object}
 */
function buildOperatorExplainJson(ctx) {
  return {
    command: 'explain',
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    reason_codes: [
      ...(ctx.summary.policy_decision.reason_code ? [ctx.summary.policy_decision.reason_code] : []),
      ...ctx.summary.degraded_mode.reason_codes.filter(
        (c) => c !== ctx.summary.policy_decision.reason_code,
      ),
    ],
    missing_evidence: ctx.summary.missing_evidence,
    blocking_gate: ctx.summary.blocked_gates[0] ?? null,
    policy_source: ctx.summary.policy_decision.policy_source,
    remediation: ctx.summary.next_safe_action,
    what_not_to_do: deriveWhatNotToDo(ctx.summary),
    explain: ctx.explain,
    operator_trace_summary: ctx.summary,
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, loadContext?: typeof loadOperatorTraceContext }} options
 */
function runOperatorStatus(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const ctx = loadContext({
    runId: options.runId,
    filePath: options.filePath,
  });

  if (!ctx.ok) {
    return {
      ok: false,
      exitCode: 2,
      reason_code: ctx.reason_code,
      next_safe_action: ctx.next_safe_action,
      text: [
        'ai-minions status',
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ctx.next_safe_action}`,
      ].join('\n'),
      json: ctx,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    text: formatOperatorStatusText(ctx),
    json: buildOperatorStatusJson(ctx),
  };
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, loadContext?: typeof loadOperatorTraceContext }} options
 */
function runOperatorExplain(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const ctx = loadContext({
    runId: options.runId,
    filePath: options.filePath,
  });

  if (!ctx.ok) {
    return {
      ok: false,
      exitCode: 2,
      reason_code: ctx.reason_code,
      next_safe_action: ctx.next_safe_action,
      text: [
        'ai-minions explain',
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ctx.next_safe_action}`,
      ].join('\n'),
      json: ctx,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    text: formatOperatorExplainText(ctx),
    json: buildOperatorExplainJson(ctx),
  };
}

module.exports = {
  deriveOperatorStatusLabel,
  deriveWhatNotToDo,
  loadOperatorTraceContext,
  formatOperatorStatusText,
  formatOperatorExplainText,
  buildOperatorStatusJson,
  buildOperatorExplainJson,
  runOperatorStatus,
  runOperatorExplain,
};
