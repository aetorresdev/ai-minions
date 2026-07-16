'use strict';

/**
 * Read-only operator evidence TUI — stdout panels from trace JSONL (no interactive UI).
 * Composes operator visibility layers: run state, phase timeline, blockers, cost, attach, management preview.
 */

const {
  loadOperatorTraceContext,
  deriveWhatNotToDo,
} = require('./operator-trace-command');
const {
  formatCostTokenRunSummaryLines,
  formatRunCostLine,
  formatRunLatencyLine,
} = require('./operator-cost-token-summary');
const { buildAttachManagementSummaryMd } = require('./operator-attach-bundle');
const {
  buildStepGraph,
  formatStepGraphText,
  collectGateBlocks,
  formatGateBlocksText,
} = require('./runner-trace-viewer');

const OPERATOR_EVIDENCE_TUI_SCHEMA = '1';

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
function derivePhaseTimeline(rows) {
  /** @type {string[]} */
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    if (r.event === 'mode_advanced') {
      const from = typeof r.from_mode === 'string' ? r.from_mode : '?';
      const to = typeof r.to_mode === 'string' ? r.to_mode : '?';
      out.push(`mode: ${from} → ${to}`);
    } else if (r.event === 'agent_start' && typeof r.agent === 'string') {
      const phase = typeof r.phase === 'string' ? r.phase : '-';
      out.push(`start: ${r.agent} (phase=${phase})`);
    } else if (r.event === 'agent_done' && typeof r.agent === 'string') {
      const edge = typeof r.edge_type === 'string' ? r.edge_type : '-';
      out.push(`done: ${r.agent} edge=${edge}`);
    } else if (r.event === 'iteration_done') {
      out.push(`iteration: outcome=${r.outcome ?? '?'}`);
    } else if (r.event === 'session_end') {
      out.push(`session_end: done=${r.done}`);
    }
  }
  return out;
}

/**
 * @param {string[]} lines
 * @param {number} maxLines
 * @returns {string}
 */
function previewLines(lines, maxLines = 14) {
  if (!lines.length) return '(none)';
  const slice = lines.slice(0, maxLines);
  const body = slice.map((l) => `  ${l}`).join('\n');
  if (lines.length > maxLines) {
    return `${body}\n  ... (${lines.length - maxLines} more)`;
  }
  return body;
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function buildOperatorEvidenceTuiText(ctx, options = {}) {
  const { ansi, colorOutcome } = require('./terminal-style');
  const useColor = options.useColor === true;
  const { summary, run_state: rs } = ctx;
  const phaseTimeline = derivePhaseTimeline(ctx.rows);
  const gateBlocks = collectGateBlocks(ctx.rows);
  const managementMd = buildAttachManagementSummaryMd(ctx, { inspectOk: true });
  const managementPreview = previewLines(
    managementMd.split('\n').filter((l) => l.trim().length),
    12,
  );

  const blockerLines = [];
  if (rs.blocking_reason_code) blockerLines.push(`blocking_reason_code: ${rs.blocking_reason_code}`);
  for (const g of summary.blocked_gates || []) blockerLines.push(`blocked_gate: ${g}`);
  if (summary.cerberus?.verdict) blockerLines.push(`cerberus_verdict: ${summary.cerberus.verdict}`);
  if (!blockerLines.length) blockerLines.push('(none recorded)');

  const section = (title) => ansi(useColor, '1;36', title);

  const lines = [
    '+----------------------------------------------------------------------+',
    `|  ${ansi(useColor, '1', 'ai-minions tui')} — read-only evidence (stdout; no interactive UI)     |`,
    '+----------------------------------------------------------------------+',
    'Policy: inspect only — no edits, approvals, reruns, or state mutation.',
    '',
    section('== Run status =='),
    `  run_id:                ${ctx.run_id}`,
    `  status_label:          ${colorOutcome(ctx.status_label, useColor)}`,
    `  outcome:               ${colorOutcome(summary.outcome, useColor)}`,
    `  result_code:           ${rs.result_code}`,
    `  current_phase:         ${rs.current_phase ?? '-'}`,
    `  last_successful_phase: ${rs.last_successful_phase ?? '-'}`,
    `  model:                 ${rs.model ?? 'unavailable'}`,
    `  model_backend:         ${rs.model_backend ?? 'unavailable'}`,
    `  selection_reason:      ${rs.selection_reason ?? 'unavailable'}`,
    `  trace_file:            ${ctx.trace_file}`,
    '',
    section('== Phase timeline =='),
    previewLines(phaseTimeline, 20),
    '',
    section('== Step graph (phase detail) =='),
    formatStepGraphText(buildStepGraph(ctx.rows)),
    '',
    section('== Blockers =='),
    previewLines(blockerLines, 12),
    '',
    formatGateBlocksText(gateBlocks),
    '',
    section('== Next safe action =='),
    `  ${ansi(useColor, '36', rs.next_safe_action ?? summary.next_safe_action)}`,
    `  what_not_to_do: ${deriveWhatNotToDo(summary)}`,
    '',
    section('== Evidence paths =='),
    previewLines((rs.evidence_paths || []).map(String), 10),
    '',
    section('== Cost / token (estimated — not billing) =='),
    ...formatCostTokenRunSummaryLines(ctx.cost_token_summary).map((l) => (l.startsWith('  ') ? l : `  ${l}`)),
    `  summary_cost: ${formatRunCostLine(ctx.cost_token_summary)}`,
    `  summary_latency: ${formatRunLatencyLine(ctx.cost_token_summary)}`,
    '',
    section('== Attach status =='),
    `  attach_available:      ${rs.attach_available}`,
    `  attach_action_available: ${rs.attach_action_available}`,
    `  attach_bundle_available: ${rs.attach_bundle_available}`,
    `  privacy_notice_status: ${rs.privacy_notice_status}`,
    '',
    section('== Management preview =='),
    managementPreview,
    '',
    'Commands: ai-minions status | explain | report --run-id <id>',
    'See also: docs/orchestrator/runner-tui-contract.md',
  ];

  if (ctx.truncated) {
    lines.push('');
    lines.push(ansi(useColor, '33', 'WARNING: trace truncated to last session_end segment (size limits)'));
  }
  if (ctx.skipped > 0) {
    lines.push(ansi(useColor, '33', `WARNING: ${ctx.skipped} invalid JSON line(s) skipped`));
  }

  return lines.join('\n');
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {object}
 */
function buildOperatorEvidenceTuiJson(ctx) {
  return {
    schema_version: OPERATOR_EVIDENCE_TUI_SCHEMA,
    command: 'tui',
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    status_label: ctx.status_label,
    run_state_visibility: ctx.run_state,
    operator_trace_summary: ctx.summary,
    cost_token_run_summary: ctx.cost_token_summary,
    phase_timeline: derivePhaseTimeline(ctx.rows),
    step_graph: buildStepGraph(ctx.rows),
    gate_blocks: collectGateBlocks(ctx.rows),
    management_preview_md: buildAttachManagementSummaryMd(ctx, { inspectOk: true }),
    truncated: ctx.truncated,
    skipped_lines: ctx.skipped,
  };
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   latest?: boolean,
 *   loadContext?: typeof loadOperatorTraceContext,
 * }} [options]
 */
function runOperatorEvidenceTui(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const hasFile = Boolean(options.filePath);
  const useLatest = options.latest === true && !options.runId && !hasFile;

  const effectiveRunId = hasFile
    ? undefined
    : useLatest
      ? undefined
      : options.runId;

  const ctx = loadContext({
    runId: effectiveRunId,
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
        'ai-minions tui',
        `  result_code:      ${ctx.result_code ?? 'RUN_NOT_FOUND'}`,
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ctx.next_safe_action}`,
      ].join('\n'),
      json: ctx,
    };
  }

  const useColor = options.useColor === true && options.json !== true;
  return {
    ok: true,
    exitCode: 0,
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    text: buildOperatorEvidenceTuiText(ctx, { useColor }),
    json: buildOperatorEvidenceTuiJson(ctx),
  };
}

module.exports = {
  OPERATOR_EVIDENCE_TUI_SCHEMA,
  derivePhaseTimeline,
  buildOperatorEvidenceTuiText,
  buildOperatorEvidenceTuiJson,
  runOperatorEvidenceTui,
};
