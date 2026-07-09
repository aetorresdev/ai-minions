'use strict';

/**
 * RUN_ANALYST — read-only run report from trace JSONL.
 * Reuses operator trace + attach bundle builders; no second SoT.
 */

const fs = require('fs');
const path = require('path');

const { loadOperatorTraceContext, deriveWhatNotToDo } = require('./operator-trace-command');
const {
  buildAttachManagementSummaryMd,
  buildAttachOperatorNotesMd,
  buildAttachSummaryMd,
} = require('./operator-attach-bundle');
const {
  formatRunCostLine,
  formatRunLatencyLine,
} = require('./operator-cost-token-summary');

const RUN_REPORT_SCHEMA = '1';

/**
 * @param {string | null | undefined} mode
 * @returns {boolean}
 */
function isDevMode(mode) {
  if (!mode) return false;
  const u = String(mode).toUpperCase();
  return u === 'DEV' || u.startsWith('DEV-') || u.includes('DEV');
}

/**
 * @param {string | null | undefined} mode
 * @returns {boolean}
 */
function isQaMode(mode) {
  if (!mode) return false;
  const u = String(mode).toUpperCase();
  return u === 'QA' || u.startsWith('QA_') || u.startsWith('QA-') || u.includes('QA');
}

/**
 * @param {object[]} rows
 * @returns {{
 *   dev_qa_cycles: number,
 *   qa_returns_to_dev: number,
 *   gate_blocks: number,
 *   iterations: number | null,
 *   flakiness_signals: string[],
 * }}
 */
function deriveRunAnalystMetrics(rows) {
  let devQaCycles = 0;
  let qaReturnsToDev = 0;
  let gateBlocks = 0;
  /** @type {number | null} */
  let iterations = null;
  /** @type {string[]} */
  const flakinessSignals = [];
  /** @type {string | null} */
  let lastAgent = null;

  for (const r of rows) {
    if (!r) continue;
    if (r.event === 'session_end') {
      if (typeof r.gate_blocks === 'number') gateBlocks = r.gate_blocks;
      if (typeof r.iterations === 'number') iterations = r.iterations;
    }
    if (r.event === 'mode_advanced') {
      const from = r.from_mode;
      const to = r.to_mode;
      if (isDevMode(from) && isQaMode(to)) devQaCycles += 1;
      if (isQaMode(from) && isDevMode(to)) qaReturnsToDev += 1;
    }
    if (r.event === 'agent_start' && typeof r.agent === 'string') {
      const agent = r.agent;
      if (lastAgent === agent && (agent.startsWith('dev-') || agent === 'dev-backend')) {
        flakinessSignals.push(`repeated_agent_start:${agent}`);
      }
      lastAgent = agent;
    }
    if (r.event === 'iteration_done' && r.outcome && r.outcome !== 'done') {
      flakinessSignals.push(`iteration_not_done:${r.outcome}`);
    }
  }

  if (gateBlocks > 0) flakinessSignals.push(`gate_blocks:${gateBlocks}`);
  if (iterations !== null && iterations > 1) {
    flakinessSignals.push(`multi_iteration:${iterations}`);
  }

  return {
    dev_qa_cycles: devQaCycles,
    qa_returns_to_dev: qaReturnsToDev,
    gate_blocks: gateBlocks,
    iterations,
    flakiness_signals: [...new Set(flakinessSignals)],
  };
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {ReturnType<typeof deriveRunAnalystMetrics>} metrics
 * @returns {string}
 */
function buildOperatorReportMd(ctx, metrics) {
  const { summary, run_state: rs, explain } = ctx;
  const gates = summary.blocked_gates?.length
    ? summary.blocked_gates.map((g) => `- ${g}`).join('\n')
    : '- (none)';

  const flakiness = metrics.flakiness_signals.length
    ? metrics.flakiness_signals.map((s) => `- \`${s}\``).join('\n')
    : '- (none observed in trace)';

  const summaryBlock = buildAttachSummaryMd(ctx, {
    inspectOk: true,
    repoCommit: null,
    bundleBasename: `report-${ctx.run_id}`,
  });

  const notesBlock = buildAttachOperatorNotesMd(ctx, {
    inspectChecks: [],
    bundleDir: null,
  });

  const failureBlock = explain.failure_type !== undefined
    ? `\n## Failure taxonomy\n\n- **failure_type:** ${explain.failure_type}\n- **failure_axis:** ${explain.last_failure_axis ?? '-'}\n`
    : '';

  return `# Operator report

> **Read-only RUN_ANALYST** — trace-derived narrative; not billing-accurate.

${summaryBlock}

## Flow metrics (trace-derived)

| Metric | Value |
|--------|-------|
| **DEV→QA transitions** | ${metrics.dev_qa_cycles} |
| **QA→DEV returns** | ${metrics.qa_returns_to_dev} |
| **Gate blocks (session_end)** | ${metrics.gate_blocks} |
| **Iterations** | ${metrics.iterations ?? 'unavailable'} |

### Flakiness signals

${flakiness}

### Blocked gates

${gates}

## Cost / latency (estimated — not billing)

- **Cost / token:** ${formatRunCostLine(ctx.cost_token_summary)}
- **Time / latency:** ${formatRunLatencyLine(ctx.cost_token_summary)}

## What not to do

${deriveWhatNotToDo(summary)}
${failureBlock}
---

${notesBlock}

## Not claimed

- Autonomous decisions or backlog mutation
- Billing-accurate cost or ROI / productivity metrics
- Production-ready or fully autonomous operation
`;
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @param {ReturnType<typeof deriveRunAnalystMetrics>} metrics
 * @returns {string}
 */
function buildCerberusReviewInputMd(ctx, metrics) {
  const { summary, run_state: rs } = ctx;
  const files = [
    'OPERATOR_REPORT.md',
    'MANAGEMENT_SUMMARY.md',
    ctx.trace_file ? `trace: ${ctx.trace_file}` : null,
  ].filter(Boolean);

  const risks = [];
  if (summary.outcome === 'blocked') risks.push('Run blocked — merge/gate claims should wait.');
  if (summary.degraded_mode?.active) risks.push('Degraded mode active — success claims are limited.');
  if (metrics.flakiness_signals.length) {
    risks.push(`Flakiness signals: ${metrics.flakiness_signals.join(', ')}`);
  }
  if (summary.missing_evidence?.length) {
    risks.push(`Missing evidence: ${summary.missing_evidence.join(', ')}`);
  }
  if (!risks.length) risks.push('none material');

  return `**Subject:** Pre-merge review — run ${ctx.run_id}

**Scope:** Read-only RUN_ANALYST report from trace JSONL. No code changes in this artifact; operator narrative only.

**Files / areas:** ${files.join(' · ')}

**Behavior / contract:** Outcome \`${summary.outcome}\` · result_code \`${rs.result_code}\` · phase \`${rs.current_phase ?? '-'}\` · blocker \`${rs.blocking_reason_code ?? '(none)'}\`

**Evidence:** Generated from trace \`${ctx.trace_file}\` · cost line: ${formatRunCostLine(ctx.cost_token_summary)} *(estimated / not billing)*

**Risks / edge cases:** ${risks.join(' ')}

**Ask CERBERUS to verify:** [ ] Trace ↔ report alignment [ ] No unsupported ROI/billing/productivity claims [ ] Blocker/gate narrative matches trace [ ] Cost labeled estimated/not billing

**Verdict requested:** Approve | Approve with non-blocking notes | Request changes (file + concrete fix per item)
`;
}

/**
 * @param {Extract<ReturnType<typeof loadOperatorTraceContext>, { ok: true }>} ctx
 * @returns {{ operator_report: string, management_summary: string, cerberus_review_input: string }}
 */
function buildRunReportArtifacts(ctx) {
  const metrics = deriveRunAnalystMetrics(ctx.rows);
  return {
    operator_report: buildOperatorReportMd(ctx, metrics),
    management_summary: buildAttachManagementSummaryMd(ctx, { inspectOk: true }),
    cerberus_review_input: buildCerberusReviewInputMd(ctx, metrics),
    metrics,
  };
}

/**
 * @param {string} outDir
 * @param {{ operator_report: string, management_summary: string, cerberus_review_input: string }} artifacts
 * @param {{ mkdirSync?: typeof fs.mkdirSync, writeFileSync?: typeof fs.writeFileSync }} [fsOps]
 * @returns {{ out_dir: string, files: Record<string, string> }}
 */
function writeRunReportFiles(outDir, artifacts, fsOps = {}) {
  const mkdirSync = fsOps.mkdirSync ?? fs.mkdirSync;
  const writeFileSync = fsOps.writeFileSync ?? fs.writeFileSync;
  const abs = path.resolve(outDir);
  mkdirSync(abs, { recursive: true });

  const files = {
    'OPERATOR_REPORT.md': artifacts.operator_report,
    'MANAGEMENT_SUMMARY.md': artifacts.management_summary,
    'CERBERUS_REVIEW_INPUT.md': artifacts.cerberus_review_input,
  };

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(abs, name), content, 'utf8');
  }

  return { out_dir: abs, files };
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   latest?: boolean,
 *   outDir?: string,
 *   cwd?: string,
 *   loadContext?: typeof loadOperatorTraceContext,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   writeFileSync?: typeof fs.writeFileSync,
 * }} [options]
 */
function runOperatorReport(options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const hasFile = Boolean(options.filePath);
  const useLatest = options.latest === true && !options.runId && !hasFile;

  /** --file fully overrides --run / --run-id for trace identity (help contract). */
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
        'ai-minions report',
        `  result_code:      ${ctx.result_code ?? 'RUN_NOT_FOUND'}`,
        `  reason_code:      ${ctx.reason_code}`,
        `  next_safe_action: ${ctx.next_safe_action}`,
      ].join('\n'),
      json: ctx,
    };
  }

  const artifacts = buildRunReportArtifacts(ctx);
  const baseCwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  const outDir = options.outDir
    ? path.resolve(String(options.outDir))
    : path.join(baseCwd, `report-${ctx.run_id}`);

  const written = writeRunReportFiles(outDir, artifacts, {
    mkdirSync: options.mkdirSync,
    writeFileSync: options.writeFileSync,
  });

  const fileLines = Object.keys(written.files).map((f) => `  ${f}: ${path.join(written.out_dir, f)}`);

  return {
    ok: true,
    exitCode: 0,
    run_id: ctx.run_id,
    trace_file: ctx.trace_file,
    out_dir: written.out_dir,
    files: written.files,
    metrics: artifacts.metrics,
    text: [
      'ai-minions report',
      `  run_id:           ${ctx.run_id}`,
      `  trace_file:       ${ctx.trace_file}`,
      `  out_dir:          ${written.out_dir}`,
      ...fileLines,
    ].join('\n'),
    json: {
      schema_version: RUN_REPORT_SCHEMA,
      command: 'report',
      run_id: ctx.run_id,
      trace_file: ctx.trace_file,
      out_dir: written.out_dir,
      files: Object.fromEntries(
        Object.keys(written.files).map((k) => [k, path.join(written.out_dir, k)]),
      ),
      metrics: artifacts.metrics,
      operator_trace_summary: ctx.summary,
      cost_token_run_summary: ctx.cost_token_summary,
      run_state_visibility: ctx.run_state,
    },
  };
}

module.exports = {
  RUN_REPORT_SCHEMA,
  deriveRunAnalystMetrics,
  buildOperatorReportMd,
  buildCerberusReviewInputMd,
  buildRunReportArtifacts,
  writeRunReportFiles,
  runOperatorReport,
};
