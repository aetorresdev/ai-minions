'use strict';

/**
 * Runner budget view — token rollup + USD estimate vs budget limits from trace JSONL (read-only).
 * Complements trace viewer (step graph) and console dashboard cost tables.
 */

const {
  buildRunOutcomeSummary,
  formatRunOutcomeSummaryLines,
} = require('../trace/run-outcome-summary');
const {
  buildReport,
  rollupStepsCostOutcome,
} = require('../budget/token-trace-report');
const { buildRunCostAccountingFromReport } = require('../budget/cost-accounting-dimensions');
const {
  na,
  resolveTraceFilePath,
  loadTraceRowsFromFile,
} = require('./runner-trace-viewer');

/** @param {object[]} rows @returns {object[]} */
function sortRowsByTime(rows) {
  return rows.slice().sort((a, b) => {
    const ta = typeof a.ts_ms === 'number' ? a.ts_ms : 0;
    const tb = typeof b.ts_ms === 'number' ? b.ts_ms : 0;
    if (ta !== tb) return ta - tb;
    const sa = typeof a.sequence_id === 'number' ? a.sequence_id : 0;
    const sb = typeof b.sequence_id === 'number' ? b.sequence_id : 0;
    return sa - sb;
  });
}

/**
 * @param {object[]} rows
 * @returns {object | undefined}
 */
function findLastSessionEnd(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r && r.event === 'session_end') return r;
  }
  return undefined;
}

/**
 * @param {object[]} rows
 * @returns {Array<{
 *   kind: string,
 *   phase: string | null,
 *   estimate_usd: number | null,
 *   limit_usd: number | null,
 *   threshold_usd: number | null,
 *   budget_scope: string | null,
 *   reason_code: string | null,
 *   var_name: string | null,
 *   reason: string | null,
 * }>}
 */
function collectBudgetEvents(rows) {
  /** @type {ReturnType<typeof collectBudgetEvents>} */
  const events = [];

  for (const r of sortRowsByTime(rows)) {
    if (!r || typeof r !== 'object') continue;
    const ev = typeof r.event === 'string' ? r.event : null;

    if (
      ev === 'budget_warning'
      || ev === 'budget_block'
      || ev === 'budget_exhausted'
      || ev === 'budget_config_invalid'
    ) {
      events.push({
        kind: ev,
        phase: typeof r.phase === 'string' ? r.phase : null,
        estimate_usd: typeof r.estimate_usd === 'number' ? r.estimate_usd : null,
        limit_usd: typeof r.limit_usd === 'number' ? r.limit_usd : null,
        threshold_usd: typeof r.threshold_usd === 'number' ? r.threshold_usd : null,
        budget_scope: typeof r.budget_scope === 'string' ? r.budget_scope : null,
        reason_code: typeof r.reason_code === 'string' ? r.reason_code : null,
        var_name: typeof r.var_name === 'string' ? r.var_name : null,
        reason: typeof r.reason === 'string' ? r.reason : null,
      });
      continue;
    }

    if (ev === 'iteration_done') {
      const rc = r.transition_reason && typeof r.transition_reason === 'object'
        ? r.transition_reason.reason_code
        : null;
      if (rc === 'GUARD_COST_LIMIT') {
        events.push({
          kind: 'guard_cost_limit',
          phase: typeof r.guard_phase === 'string' ? r.guard_phase : null,
          estimate_usd: typeof r.estimate_usd === 'number' ? r.estimate_usd : null,
          limit_usd: typeof r.limit_usd === 'number' ? r.limit_usd : null,
          threshold_usd: null,
          budget_scope: typeof r.budget_scope === 'string' ? r.budget_scope : null,
          reason_code: rc,
          var_name: null,
          reason: typeof r.summary === 'string' ? r.summary.slice(0, 200) : null,
        });
      }
    }
  }

  return events;
}

/**
 * @param {ReturnType<typeof collectBudgetEvents>} events
 * @returns {string}
 */
function deriveBudgetStatus(events) {
  if (!events.length) return 'no_budget_signals';
  if (events.some((e) => e.kind === 'budget_config_invalid')) return 'config_invalid';
  if (events.some((e) => e.kind === 'budget_block' || e.kind === 'budget_exhausted' || e.kind === 'guard_cost_limit')) {
    return 'blocked';
  }
  if (events.some((e) => e.kind === 'budget_warning')) return 'warning';
  return 'observed';
}

/**
 * @param {ReturnType<typeof rollupStepsCostOutcome>} roll
 * @param {number} [limit]
 * @returns {string}
 */
function formatTopStepsByTokensText(roll, limit = 10) {
  const lines = ['Top steps by Ollama tokens'];
  const sorted = roll
    .slice()
    .sort((a, b) => (b.ollama_total_tokens || 0) - (a.ollama_total_tokens || 0));
  const top = sorted.slice(0, limit).filter((s) => (s.ollama_total_tokens || 0) > 0);
  if (!top.length) {
    lines.push('  (no step_id rows with context_stats tokens)');
    return lines.join('\n');
  }
  lines.push('  step_id'.padEnd(44) + ' agent'.padEnd(14) + '  prompt   compl   total  fail');
  lines.push(`  ${'-'.repeat(88)}`);
  for (const s of top) {
    const sid = String(s.step_id);
    const sidDisp = sid.length > 44 ? `${sid.slice(0, 20)}...${sid.slice(-21)}` : sid.padEnd(44);
    const ag = String(s.agent ?? '-').slice(0, 14).padEnd(14);
    const pf = String(s.ollama_prompt_tokens).padStart(6);
    const cf = String(s.ollama_completion_tokens).padStart(6);
    const tf = String(s.ollama_total_tokens).padStart(7);
    const fl = s.step_failed ? 'Y' : ' ';
    lines.push(`  ${sidDisp} ${ag}  ${pf}  ${cf}  ${tf}   ${fl}`);
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof buildRunCostAccountingFromReport>} costAccounting
 * @returns {string[]}
 */
function formatCostAccountingLines(costAccounting) {
  if (!costAccounting || !costAccounting.cost_accounting || !costAccounting.cost_accounting.run) {
    return ['Cost accounting: (no token totals in trace)'];
  }
  const run = costAccounting.cost_accounting.run;
  const lines = [
    'Cost accounting',
    `  tokens: prompt=${run.prompt_tokens}  completion=${run.completion_tokens}  total=${run.total_tokens}`,
  ];
  const actual = run.actual;
  if (actual && typeof actual === 'object') {
    if (actual.total_usd != null) {
      lines.push(
        `  actual (env-priced estimate): total_usd=${actual.total_usd}`
          + (actual.usd_note ? `  note=${actual.usd_note}` : ''),
      );
    } else {
      lines.push(`  actual: unavailable (set ORCH_USD_PER_MTOK_* for USD estimate)`);
    }
  }
  const equiv = run.equivalent_cloud;
  if (equiv && typeof equiv === 'object') {
    if (equiv.total_usd != null) {
      lines.push(
        `  equivalent_cloud (benchmark): total_usd=${equiv.total_usd}`
          + (equiv.baseline_model ? `  baseline=${equiv.baseline_model}` : ''),
      );
    } else if (equiv.equivalent_cloud_cost_status) {
      lines.push(`  equivalent_cloud: ${equiv.equivalent_cloud_cost_status}`);
    }
  }
  return lines;
}

/**
 * @param {ReturnType<typeof collectBudgetEvents>} events
 * @param {ReturnType<typeof buildRunOutcomeSummary>} summary
 * @returns {string[]}
 */
function formatBudgetLimitsLines(events, summary) {
  const lines = ['Budget limits vs spend'];
  const block = [...events].reverse().find(
    (e) => e.kind === 'budget_block' || e.kind === 'budget_exhausted' || e.kind === 'guard_cost_limit',
  );
  const warning = [...events].reverse().find((e) => e.kind === 'budget_warning');

  if (block && block.limit_usd != null) {
    const est = block.estimate_usd != null
      ? block.estimate_usd
      : (summary.cost?.usd_estimate?.usd_total_estimate ?? null);
    lines.push(
      `  scope=${na(block.budget_scope)}  limit_usd=${block.limit_usd}`
        + (est != null ? `  estimate_usd=${est}` : '')
        + (block.phase ? `  phase=${block.phase}` : ''),
    );
    if (est != null && typeof block.limit_usd === 'number') {
      const pct = block.limit_usd > 0 ? Math.round((est / block.limit_usd) * 1000) / 10 : null;
      if (pct != null) lines.push(`  utilization: ${pct}% of limit (trace-recorded estimate)`);
    }
    lines.push(`  status: ${deriveBudgetStatus(events)}`);
    return lines;
  }

  if (warning) {
    lines.push(
      `  scope=${na(warning.budget_scope)}  limit_usd=${na(warning.limit_usd)}`
        + (warning.threshold_usd != null ? `  threshold_usd=${warning.threshold_usd}` : '')
        + (warning.estimate_usd != null ? `  estimate_usd=${warning.estimate_usd}` : ''),
    );
    lines.push(`  status: ${deriveBudgetStatus(events)}`);
    return lines;
  }

  const usd = summary.cost?.usd_estimate?.usd_total_estimate;
  if (typeof usd === 'number') {
    lines.push(`  trace_usd_estimate=${usd}  (no budget_warning/block events in trace)`);
  } else {
    lines.push('  (no budget events; set ORCH_MAX_COST_USD at run time for guard signals)');
  }
  lines.push(`  status: ${deriveBudgetStatus(events)}`);
  return lines;
}

/**
 * @param {ReturnType<typeof collectBudgetEvents>} events
 * @returns {string}
 */
function formatBudgetEventsText(events) {
  const lines = ['Budget timeline'];
  if (!events.length) {
    lines.push('  (none recorded)');
    return lines.join('\n');
  }
  for (const e of events) {
    const bits = [e.kind];
    if (e.phase) bits.push(`phase=${e.phase}`);
    if (e.budget_scope) bits.push(`scope=${e.budget_scope}`);
    if (e.estimate_usd != null) bits.push(`estimate=${e.estimate_usd}`);
    if (e.limit_usd != null) bits.push(`limit=${e.limit_usd}`);
    if (e.threshold_usd != null) bits.push(`threshold=${e.threshold_usd}`);
    if (e.var_name) bits.push(`var=${e.var_name}`);
    if (e.reason) bits.push(`reason=${e.reason}`);
    lines.push(`  - ${bits.join('  ')}`);
  }
  return lines.join('\n');
}

/**
 * @param {object[]} rows
 * @param {{ trace_file?: string }} [meta]
 * @returns {string}
 */
function formatBudgetViewText(rows, meta = {}) {
  const summary = buildRunOutcomeSummary(rows, { trace_file: meta.trace_file });
  const report = buildReport(rows);
  const costAccounting = buildRunCostAccountingFromReport(report);
  const roll = rollupStepsCostOutcome(rows);
  const budgetEvents = collectBudgetEvents(rows);
  const sessionEnd = findLastSessionEnd(rows);
  const terminalStatus = sessionEnd && sessionEnd.done === true
    ? 'done'
    : sessionEnd && sessionEnd.done === false
      ? 'failed'
      : 'running';

  const outcomeLines = formatRunOutcomeSummaryLines(summary);
  const costLine = outcomeLines.find((l) => l.startsWith('cost:')) || 'cost:  (unavailable)';

  const lines = [
    'Runner budget view',
    `  task_id:          ${na(summary.where?.task_id)}`,
    `  terminal_status:  ${terminalStatus}`,
    `  trace_file:       ${na(meta.trace_file)}`,
    `  budget_status:    ${deriveBudgetStatus(budgetEvents)}`,
    '',
    costLine,
    '',
    ...formatCostAccountingLines(costAccounting),
    '',
    ...formatBudgetLimitsLines(budgetEvents, summary),
    '',
    formatTopStepsByTokensText(roll),
    '',
    formatBudgetEventsText(budgetEvents),
    '',
    'See also: npm run dashboard:console -- --run-id <id>  |  npm run tokens:report',
  ];
  return lines.join('\n');
}

/**
 * @param {{
 *   runId?: string,
 *   filePath?: string,
 *   tracesDir?: string,
 *   validateLines?: boolean,
 * }} options
 * @returns {Promise<{ ok: boolean, text?: string, rows?: object[], error?: string, filePath?: string | null }>}
 */
async function runBudgetView(options = {}) {
  const filePath = resolveTraceFilePath(options);
  if (!filePath) {
    return { ok: false, error: 'budget requires --run-id or --file', filePath: null };
  }

  const loaded = loadTraceRowsFromFile(filePath, options);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, filePath };
  }
  if (loaded.parseErrors?.length) {
    process.stderr.write(`parse warnings: ${loaded.parseErrors.length} line(s)\n`);
  }
  return {
    ok: true,
    filePath,
    rows: loaded.rows,
    text: formatBudgetViewText(loaded.rows, { trace_file: filePath }),
  };
}

module.exports = {
  sortRowsByTime,
  findLastSessionEnd,
  collectBudgetEvents,
  deriveBudgetStatus,
  formatTopStepsByTokensText,
  formatCostAccountingLines,
  formatBudgetLimitsLines,
  formatBudgetEventsText,
  formatBudgetViewText,
  runBudgetView,
};
