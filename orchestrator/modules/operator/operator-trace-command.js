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
  buildRunStateVisibility,
  formatOperatorTraceSummaryLines,
  formatRunStateVisibilityLines,
} = require('./operator-trace-summary');
const {
  buildCostTokenRunSummary,
  formatCostTokenRunSummaryLines,
} = require('./operator-cost-token-summary');
const { buildLoopEnvelopeFromRows } = require('./operator-tui-loop-envelope');

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
 * @returns {'warn'|'degraded'|'blocked'|'running'|'failed'|'complete'}
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
 *   repoRoot?: string,
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
      result_code: 'RUN_NOT_FOUND',
      next_safe_action: 'Provide --run-id <task_id> or --file <path> to a trace JSONL file.',
      trace_file: filePath,
    };
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return {
      ok: false,
      code: 'TRACE_INVALID',
      reason_code: 'OPERATOR_TRACE_INVALID',
      result_code: 'RUN_TRACE_INVALID',
      next_safe_action: 'Trace file is unreadable; check permissions or re-run with a valid completed trace JSONL.',
      trace_file: filePath,
    };
  }
  if (!String(raw).trim()) {
    return {
      ok: false,
      code: 'TRACE_INVALID',
      reason_code: 'OPERATOR_TRACE_INVALID',
      result_code: 'RUN_TRACE_INVALID',
      next_safe_action: 'Trace file is empty; re-run with a valid completed trace JSONL.',
      trace_file: filePath,
    };
  }

  const { text, truncated } = enforceLimits(raw);
  const { rows, skipped } = parseJsonl(text);
  if (!rows.length) {
    return {
      ok: false,
      code: 'TRACE_INVALID',
      reason_code: 'OPERATOR_TRACE_INVALID',
      result_code: 'RUN_TRACE_INVALID',
      next_safe_action: 'Trace file has no valid JSONL rows; inspect file or re-run the workflow.',
      trace_file: filePath,
      skipped,
    };
  }
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

  const repoRoot = options.repoRoot
    ? path.resolve(String(options.repoRoot))
    : require('./operator-doctor-evidence').resolveOperatorRepoRoot({});
  const {
    resolveEvidenceArtifactPaths,
    deriveRedactionStatus,
  } = require('./operator-doctor-evidence');
  const artifactPaths = resolveEvidenceArtifactPaths(String(runId), repoRoot, { existsSync });
  const redaction = deriveRedactionStatus(artifactPaths.attach_bundle, { existsSync, readFileSync });
  const run_state = buildRunStateVisibility(summary, sorted, {
    ...artifactPaths,
    privacy_notice_status: redaction.status,
  });
  const cost_token_summary = buildCostTokenRunSummary(sorted, { trace_file: filePath });

  return {
    ok: true,
    run_id: runId,
    trace_file: filePath,
    rows: sorted,
    summary,
    run_state,
    cost_token_summary,
    status_label: statusLabel,
    explain,
    skipped,
    truncated,
    artifact_paths: artifactPaths,
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatOperatorStatusText(ctx, options = {}) {
  const { ansi, colorOutcome } = require('./terminal-style');
  const useColor = options.useColor === true;
  const { summary, status_label: statusLabel, run_state: runState } = ctx;
  const lines = [
    ansi(useColor, '1', 'ai-minions status'),
    `  status:           ${colorOutcome(statusLabel, useColor)}`,
    `  result_code:      ${runState.result_code}`,
    `  run_id:           ${ctx.run_id}`,
    `  outcome:          ${colorOutcome(summary.outcome, useColor)}`,
    `  current_phase:    ${summary.current_phase ?? '-'}`,
    `  last_successful_phase: ${runState.last_successful_phase ?? '-'}`,
    `  blocking_reason_code:  ${runState.blocking_reason_code ?? '-'}`,
    `  model:            ${runState.model ?? 'unavailable'}`,
    `  model_backend:    ${runState.model_backend ?? 'unavailable'}`,
    `  selection_reason: ${runState.selection_reason ?? 'unavailable'}`,
    `  attach_available: ${runState.attach_available}`,
    `  attach_action_available: ${runState.attach_action_available}`,
    `  attach_bundle_available: ${runState.attach_bundle_available}`,
    `  privacy_notice_status: ${runState.privacy_notice_status}`,
    `  trace_file:       ${ctx.trace_file}`,
  ];
  if (runState.attach_action_available && !runState.attach_available) {
    lines.push(
      '  attach_note:      attach_available=false means no bundle on disk yet; run attach to create one',
    );
  }
  if (summary.degraded_mode.active) {
    lines.push(`  degraded_codes:   ${ansi(useColor, '33', summary.degraded_mode.reason_codes.join(', '))}`);
  }
  if (summary.blocked_gates.length) {
    lines.push(`  blockers:         ${ansi(useColor, '1;31', summary.blocked_gates.join('; '))}`);
  }
  lines.push(`  cerberus:         ${summary.cerberus.verdict ?? '-'}`);
  lines.push(`  tool_failure:     ${runState.tool_failure_summary?.availability ?? 'unavailable'}`);
  lines.push(`  context_authority: ${runState.context_authority_status?.availability ?? 'unavailable'}`);
  lines.push(`  next_safe_action: ${ansi(useColor, '36', summary.next_safe_action)}`);
  lines.push('');
  lines.push(...formatCostTokenRunSummaryLines(ctx.cost_token_summary));
  lines.push(...formatRunStateVisibilityLines(runState));
  lines.push(...formatOperatorTraceSummaryLines(summary));
  if (ctx.truncated) {
    lines.push(ansi(useColor, '33', 'WARNING: trace truncated to last session_end segment (size limits)'));
  }
  if (ctx.skipped > 0) {
    lines.push(ansi(useColor, '33', `WARNING: ${ctx.skipped} invalid JSON line(s) skipped`));
  }
  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatOperatorExplainText(ctx, options = {}) {
  const { ansi, colorOutcome } = require('./terminal-style');
  const useColor = options.useColor === true;
  const { summary, explain } = ctx;
  /** @type {string[]} */
  const reasonCodes = [];
  const blocking = ctx.run_state?.blocking_reason_code;
  if (typeof blocking === 'string' && blocking.length) reasonCodes.push(blocking);
  if (summary.policy_decision.reason_code && !reasonCodes.includes(summary.policy_decision.reason_code)) {
    reasonCodes.push(summary.policy_decision.reason_code);
  }
  for (const code of summary.degraded_mode.reason_codes) {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
  }

  const lines = [
    ansi(useColor, '1', 'ai-minions explain'),
    `  run_id:           ${ctx.run_id}`,
    `  outcome:          ${colorOutcome(summary.outcome, useColor)}`,
    `  trace_file:       ${ctx.trace_file}`,
    `  reason_codes:     ${reasonCodes.length ? ansi(useColor, '33', reasonCodes.join(', ')) : '(none recorded)'}`,
    `  missing_evidence: ${summary.missing_evidence.length ? summary.missing_evidence.join(', ') : '(none)'}`,
    `  blocking_gate:    ${summary.blocked_gates[0] ? ansi(useColor, '1;31', summary.blocked_gates[0]) : '-'}`,
    `  blocking_reason_code: ${ctx.run_state?.blocking_reason_code ?? '-'}`,
    `  policy_source:    ${summary.policy_decision.policy_source ?? '-'}`,
    `  tool_failure:     ${ctx.run_state.tool_failure_summary?.availability ?? 'unavailable'}`,
    `  context_authority: ${ctx.run_state.context_authority_status?.availability ?? 'unavailable'}`,
    `  remediation:      ${ansi(useColor, '36', summary.next_safe_action)}`,
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
  lines.push(...formatCostTokenRunSummaryLines(ctx.cost_token_summary));
  lines.push(...formatOperatorTraceSummaryLines(summary));
  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {object}
 */
function buildOperatorStatusJson(ctx) {
  const loop_envelope = buildLoopEnvelopeFromRows(ctx.rows, {
    explain: ctx.explain,
    summary: ctx.summary,
    cost: ctx.cost_token_summary,
    run_state: ctx.run_state,
    status_label: ctx.status_label,
  });
  return {
    command: 'status',
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    status: ctx.status_label,
    run_state_visibility: ctx.run_state,
    tool_failure_summary: ctx.run_state.tool_failure_summary,
    context_authority_status: ctx.run_state.context_authority_status,
    cost_token_run_summary: ctx.cost_token_summary,
    operator_trace_summary: ctx.summary,
    loop_envelope,
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
      ...(ctx.run_state.blocking_reason_code ? [ctx.run_state.blocking_reason_code] : []),
      ...(ctx.summary.policy_decision.reason_code
        && ctx.summary.policy_decision.reason_code !== ctx.run_state.blocking_reason_code
        ? [ctx.summary.policy_decision.reason_code]
        : []),
      ...ctx.summary.degraded_mode.reason_codes.filter(
        (c) => c !== ctx.summary.policy_decision.reason_code
          && c !== ctx.run_state.blocking_reason_code,
      ),
    ],
    blocking_reason_code: ctx.run_state.blocking_reason_code,
    missing_evidence: ctx.summary.missing_evidence,
    blocking_gate: ctx.summary.blocked_gates[0] ?? null,
    policy_source: ctx.summary.policy_decision.policy_source,
    remediation: ctx.summary.next_safe_action,
    what_not_to_do: deriveWhatNotToDo(ctx.summary),
    tool_failure_summary: ctx.run_state.tool_failure_summary,
    context_authority_status: ctx.run_state.context_authority_status,
    explain: ctx.explain,
    run_state_visibility: ctx.run_state,
    cost_token_run_summary: ctx.cost_token_summary,
    operator_trace_summary: ctx.summary,
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, useColor?: boolean, loadContext?: typeof loadOperatorTraceContext }} options
 */
function runOperatorStatus(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const useColor = options.useColor === true && options.json !== true;
  const ctx = loadContext({
    runId: options.runId,
    filePath: options.filePath,
  });

  if (!ctx.ok) {
    return {
      ok: false,
      exitCode: 2,
      reason_code: ctx.reason_code,
      result_code: ctx.result_code ?? 'RUN_NOT_FOUND',
      next_safe_action: ctx.next_safe_action,
      text: [
        'ai-minions status',
        `  result_code:      ${ctx.result_code ?? 'RUN_NOT_FOUND'}`,
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ctx.next_safe_action}`,
      ].join('\n'),
      json: ctx,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    text: formatOperatorStatusText(ctx, { useColor }),
    json: buildOperatorStatusJson(ctx),
  };
}

/**
 * @param {{ runId?: string, filePath?: string, json?: boolean, useColor?: boolean, loadContext?: typeof loadOperatorTraceContext }} options
 */
function runOperatorExplain(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const useColor = options.useColor === true && options.json !== true;
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
    text: formatOperatorExplainText(ctx, { useColor }),
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
