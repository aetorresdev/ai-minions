'use strict';

/**
 * ai-minions runs — read-only discovery over the existing trace JSONL store.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadOperatorTraceContext } = require('./operator-trace-command');
const { ansi, colorOutcome } = require('./terminal-style');

const RUN_LIST_SCHEMA_VERSION = '1';
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeRunsLimit(value) {
  if (value == null || value === '') return DEFAULT_RUNS_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RUNS_LIMIT) {
    return null;
  }
  return parsed;
}

/**
 * @param {object[]} rows
 * @returns {number | null}
 */
function latestEventTimestamp(rows) {
  let latest = null;
  for (const row of rows) {
    if (
      !row
      || typeof row.ts_ms !== 'number'
      || !Number.isFinite(new Date(row.ts_ms).getTime())
    ) continue;
    if (latest == null || row.ts_ms > latest) latest = row.ts_ms;
  }
  return latest;
}

/**
 * @param {object[]} rows
 * @returns {number | null}
 */
function earliestEventTimestamp(rows) {
  let earliest = null;
  for (const row of rows) {
    if (
      !row
      || typeof row.ts_ms !== 'number'
      || !Number.isFinite(new Date(row.ts_ms).getTime())
    ) continue;
    if (earliest == null || row.ts_ms < earliest) earliest = row.ts_ms;
  }
  return earliest;
}

/**
 * Goal from first session_start only — never invent from prose/logs.
 * @param {object[]} rows
 * @returns {string | null}
 */
function goalSummaryFromRows(rows) {
  for (const row of rows) {
    if (!row || row.event !== 'session_start') continue;
    if (typeof row.goal === 'string' && row.goal.trim()) return row.goal.trim();
  }
  return null;
}

/**
 * Honest action eligibility label for list/detail (no product Resume).
 * @param {{ status?: string | null, outcome?: string | null }} run
 * @returns {'inspect'|'continue_current'|'unavailable'}
 */
function actionEligibilityFromStatus(run) {
  const status = String(run?.status ?? '').toLowerCase();
  const outcome = String(run?.outcome ?? '').toLowerCase();
  if (status === 'running' || status === 'active' || outcome === 'running') {
    return 'continue_current';
  }
  if (status === 'invalid' || outcome === 'unknown') {
    return 'unavailable';
  }
  return 'inspect';
}

/**
 * Normalize list/status action_eligibility for adapters and Overview seed.
 * Absent/blank → unavailable. Invalid status forces unavailable even if a
 * conflicting value (e.g. inspect) arrives. Never invents Inspect from status.
 * @param {unknown} raw
 * @param {unknown} [status]
 * @returns {'inspect'|'continue_current'|'unavailable'}
 */
function normalizeActionEligibility(raw, status) {
  if (String(status ?? '').toLowerCase() === 'invalid') {
    return 'unavailable';
  }
  if (raw == null || String(raw).trim() === '') {
    return 'unavailable';
  }
  const e = String(raw).trim().toLowerCase();
  if (e === 'inspect' || e === 'continue_current' || e === 'unavailable') {
    return e;
  }
  return 'unavailable';
}

/**
 * Operator-facing eligibility label — never invents product Resume.
 * Missing / unknown eligibility → Unavailable (fail closed).
 * @param {unknown} eligibility
 * @returns {string}
 */
function actionEligibilityDisplayLabel(eligibility) {
  const e = String(eligibility ?? '').trim().toLowerCase();
  if (e === 'continue_current') {
    return 'Continue current (inspect first; Resume not claimed)';
  }
  if (e === 'inspect') {
    return 'Inspect only — no Resume claimed';
  }
  return 'Unavailable — inspect reason_code';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function fieldOrUnavailable(value) {
  if (value == null || value === '') return '(unavailable)';
  return String(value);
}

/**
 * Visible Runs-board / Recent-detail lines for one run (title, dates, phase, reason, eligibility).
 * @param {object} run
 * @param {{ selected?: boolean }} [opts]
 * @returns {string[]}
 */
function formatRunsBoardEntryLines(run, opts = {}) {
  const selected = opts.selected === true;
  const mark = selected ? '>' : ' ';
  const runId = run?.run_id == null || run.run_id === '' ? '-' : String(run.run_id);
  const eligibility = run?.action_eligibility == null || run.action_eligibility === ''
    ? 'unavailable'
    : String(run.action_eligibility);
  return [
    `${mark} ${runId}  ${run?.status ?? '-'} / ${run?.outcome ?? '-'} / ${run?.result_code ?? '-'}`,
    `  title: ${fieldOrUnavailable(run?.goal_summary ?? run?.summary)}`,
    `  created_at: ${fieldOrUnavailable(run?.created_at)}`,
    `  updated_at: ${fieldOrUnavailable(run?.last_event_at ?? run?.updated_at)}`,
    `  phase: ${fieldOrUnavailable(run?.current_phase)}`,
    `  reason_code: ${fieldOrUnavailable(run?.reason_code)}`,
    `  action: ${actionEligibilityDisplayLabel(eligibility)}`,
  ];
}

/**
 * @param {string} value
 * @returns {string}
 */
function formatRunIdArg(value) {
  if (/^[A-Za-z0-9._:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof loadOperatorTraceContext>} ctx
 * @returns {object}
 */
function buildRunListEntry(filePath, ctx) {
  const fallbackRunId = path.basename(filePath, '.jsonl');
  if (!ctx.ok) {
    return {
      run_id: fallbackRunId,
      result_code: ctx.result_code ?? 'RUN_TRACE_INVALID',
      status: 'invalid',
      outcome: null,
      current_phase: null,
      created_at: null,
      last_event_at: null,
      goal_summary: null,
      action_eligibility: 'unavailable',
      trace_file: filePath,
      reason_code: ctx.reason_code ?? 'OPERATOR_TRACE_INVALID',
      select_command: `ai-minions status --run-id ${formatRunIdArg(fallbackRunId)}`,
      _last_event_ts: null,
    };
  }

  const lastEventTs = latestEventTimestamp(ctx.rows);
  const firstEventTs = earliestEventTimestamp(ctx.rows);
  const goalSummary = goalSummaryFromRows(ctx.rows);
  // Selection resolves trace basenames, so do not trust an embedded task_id as the CLI selector.
  const runId = fallbackRunId;
  const status = ctx.status_label;
  const outcome = ctx.summary?.outcome ?? 'unknown';
  return {
    run_id: runId,
    result_code: ctx.run_state?.result_code ?? 'RUN_FOUND',
    status,
    outcome,
    current_phase: ctx.summary?.current_phase ?? null,
    created_at: firstEventTs == null ? null : new Date(firstEventTs).toISOString(),
    last_event_at: lastEventTs == null ? null : new Date(lastEventTs).toISOString(),
    goal_summary: goalSummary,
    action_eligibility: actionEligibilityFromStatus({ status, outcome }),
    trace_file: filePath,
    reason_code: ctx.run_state?.blocking_reason_code ?? null,
    select_command: `ai-minions status --run-id ${formatRunIdArg(runId)}`,
    _last_event_ts: lastEventTs,
  };
}

/**
 * @param {object[]} entries
 * @returns {object[]}
 */
function sortRunListEntries(entries) {
  return entries.slice().sort((a, b) => {
    const aTs = a._last_event_ts ?? -Infinity;
    const bTs = b._last_event_ts ?? -Infinity;
    if (aTs !== bTs) return bTs - aTs;
    return String(a.run_id).localeCompare(String(b.run_id));
  });
}

/**
 * @param {object} payload
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatOperatorRunsText(payload, options = {}) {
  const useColor = options.useColor === true;
  const lines = [
    ansi(useColor, '1', 'ai-minions runs'),
    `  result_code:      ${payload.result_code}`,
    `  traces_dir:       ${payload.traces_dir}`,
    `  run_count:        ${payload.run_count}`,
    `  returned_count:   ${payload.returned_count}`,
  ];

  if (!payload.runs.length) {
    lines.push('  runs:             (none)');
  } else {
    lines.push('', '  runs:');
    for (const run of payload.runs) {
      lines.push(
        `    - ${run.run_id}  status=${colorOutcome(run.status, useColor)}`
        + `  outcome=${run.outcome ?? '-'}  phase=${run.current_phase ?? '-'}`
        + `  updated=${run.last_event_at ?? '-'}  result_code=${run.result_code}`,
      );
      lines.push(`      select: ${ansi(useColor, '36', run.select_command)}`);
    }
  }
  lines.push(`  next_safe_action: ${ansi(useColor, '36', payload.next_safe_action)}`);
  return lines.join('\n');
}

/**
 * @param {{
 *   tracesDir?: string,
 *   limit?: number | string,
 *   json?: boolean,
 *   useColor?: boolean,
 *   readdirSync?: typeof fs.readdirSync,
 *   loadContext?: typeof loadOperatorTraceContext,
 * }} [options]
 */
function runOperatorRuns(options = {}) {
  const limit = normalizeRunsLimit(options.limit);
  if (limit == null) {
    const nextSafeAction = `Use --limit <1-${MAX_RUNS_LIMIT}>.`;
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'RUNS_LIMIT_INVALID',
      result_code: 'RUNS_LIMIT_INVALID',
      next_safe_action: nextSafeAction,
      text: `ai-minions runs\n  reason_code: RUNS_LIMIT_INVALID\n  next_safe_action: ${nextSafeAction}`,
      json: {
        schema_version: RUN_LIST_SCHEMA_VERSION,
        result_code: 'RUNS_LIMIT_INVALID',
        runs: [],
        next_safe_action: nextSafeAction,
      },
    };
  }

  const tracesDir = path.resolve(
    options.tracesDir
      || process.env.ORCH_TRACES_DIR
      || path.join(os.homedir(), '.claude', 'metrics', 'traces'),
  );
  const readdirSync = options.readdirSync ?? fs.readdirSync;
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  let fileNames;
  try {
    fileNames = readdirSync(tracesDir).filter((name) => String(name).endsWith('.jsonl'));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fileNames = [];
    } else {
      const nextSafeAction = 'Check trace directory permissions, then re-run: ai-minions runs';
      return {
        ok: false,
        exitCode: 2,
        reason_code: 'RUNS_READ_FAILED',
        result_code: 'RUNS_READ_FAILED',
        next_safe_action: nextSafeAction,
        text: `ai-minions runs\n  reason_code: RUNS_READ_FAILED\n  next_safe_action: ${nextSafeAction}`,
        json: {
          schema_version: RUN_LIST_SCHEMA_VERSION,
          result_code: 'RUNS_READ_FAILED',
          traces_dir: tracesDir,
          runs: [],
          next_safe_action: nextSafeAction,
        },
      };
    }
  }

  const entries = fileNames.map((name) => {
    const filePath = path.join(tracesDir, name);
    return buildRunListEntry(filePath, loadContext({ filePath }));
  });
  const sorted = sortRunListEntries(entries);
  const limited = sorted.slice(0, limit).map(({ _last_event_ts, ...entry }) => entry);
  const resultCode = entries.length ? 'RUNS_FOUND' : 'RUNS_EMPTY';
  const nextSafeAction = entries.length
    ? 'Choose a run_id above, then run: ai-minions status --run-id <task_id>'
    : 'Start a run: ai-minions start --goal "<goal>"';
  const payload = {
    schema_version: RUN_LIST_SCHEMA_VERSION,
    result_code: resultCode,
    traces_dir: tracesDir,
    run_count: entries.length,
    returned_count: limited.length,
    limit,
    runs: limited,
    next_safe_action: nextSafeAction,
  };
  const useColor = options.useColor === true && options.json !== true;

  return {
    ok: true,
    exitCode: 0,
    result_code: resultCode,
    next_safe_action: nextSafeAction,
    text: formatOperatorRunsText(payload, { useColor }),
    json: payload,
  };
}

module.exports = {
  RUN_LIST_SCHEMA_VERSION,
  DEFAULT_RUNS_LIMIT,
  MAX_RUNS_LIMIT,
  normalizeRunsLimit,
  latestEventTimestamp,
  earliestEventTimestamp,
  goalSummaryFromRows,
  actionEligibilityFromStatus,
  normalizeActionEligibility,
  actionEligibilityDisplayLabel,
  fieldOrUnavailable,
  formatRunsBoardEntryLines,
  formatRunIdArg,
  buildRunListEntry,
  sortRunListEntries,
  formatOperatorRunsText,
  runOperatorRuns,
};
