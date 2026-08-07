'use strict';

/**
 * Run-level metadata helpers over trace rows (goal + event timestamps).
 * Shared by the run list and the status surface — kept dependency-free so both
 * operator-trace-command and operator-run-list can import without a cycle.
 */

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
 * Title/dates bundle for status-style surfaces.
 * @param {object[]} rows
 * @returns {{ goal_summary: string | null, created_at: string | null, last_event_at: string | null }}
 */
function runMetaFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const created = earliestEventTimestamp(list);
  const updated = latestEventTimestamp(list);
  return {
    goal_summary: goalSummaryFromRows(list),
    created_at: created != null ? new Date(created).toISOString() : null,
    last_event_at: updated != null ? new Date(updated).toISOString() : null,
  };
}

module.exports = {
  latestEventTimestamp,
  earliestEventTimestamp,
  goalSummaryFromRows,
  runMetaFromRows,
};
