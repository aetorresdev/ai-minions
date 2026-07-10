/**
 * Cohort UX discovery — friction log validation and aggregation.
 * Evidence-only; does not change operator CLI behavior.
 */

export const SCHEMA_VERSION = 1;

export const FUNNEL_COMMANDS = Object.freeze([
  "first-run",
  "smoke",
  "attach",
]);

export const TRACKED_COMMANDS = Object.freeze([
  "install",
  "init",
  "doctor",
  "first-run",
  "smoke",
  "start",
  "status",
  "explain",
  "report",
  "tui",
  "attach",
  "other",
]);

export const OUTCOMES = Object.freeze(["success", "fail", "abandon"]);

/**
 * @param {unknown} entry
 * @returns {{ ok: true, entry: object } | { ok: false, errors: string[] }}
 */
export function validateFrictionEntry(entry) {
  /** @type {string[]} */
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, errors: ["entry must be a JSON object"] };
  }
  const e = /** @type {Record<string, unknown>} */ (entry);

  if (e.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (typeof e.recorded_at !== "string" || !e.recorded_at.trim()) {
    errors.push("recorded_at is required (ISO 8601 string)");
  }
  if (typeof e.tester_id !== "string" || !e.tester_id.trim()) {
    errors.push("tester_id is required");
  }
  if (typeof e.session_id !== "string" || !e.session_id.trim()) {
    errors.push("session_id is required");
  }
  if (!Number.isInteger(e.step_index) || e.step_index < 1) {
    errors.push("step_index must be a positive integer");
  }
  if (!TRACKED_COMMANDS.includes(String(e.command))) {
    errors.push(`command must be one of: ${TRACKED_COMMANDS.join(", ")}`);
  }
  if (!OUTCOMES.includes(String(e.outcome))) {
    errors.push(`outcome must be one of: ${OUTCOMES.join(", ")}`);
  }
  if (e.exit_code != null && !Number.isInteger(e.exit_code)) {
    errors.push("exit_code must be an integer when present");
  }
  if (e.reason_code != null && typeof e.reason_code !== "string") {
    errors.push("reason_code must be a string when present");
  }
  if (e.next_safe_action_observed != null && typeof e.next_safe_action_observed !== "string") {
    errors.push("next_safe_action_observed must be a string when present");
  }
  if (
    e.next_safe_action_adequate != null
    && typeof e.next_safe_action_adequate !== "boolean"
  ) {
    errors.push("next_safe_action_adequate must be boolean when present");
  }
  if (e.needed_run_selection != null && typeof e.needed_run_selection !== "boolean") {
    errors.push("needed_run_selection must be boolean when present");
  }
  if (e.missing_info != null && typeof e.missing_info !== "string") {
    errors.push("missing_info must be a string when present");
  }
  if (e.operator_notes != null && typeof e.operator_notes !== "string") {
    errors.push("operator_notes must be a string when present");
  }
  if (e.task_id != null && typeof e.task_id !== "string") {
    errors.push("task_id must be a string when present");
  }
  if (e.ai_minions_version != null && typeof e.ai_minions_version !== "string") {
    errors.push("ai_minions_version must be a string when present");
  }
  if (e.abandon_step != null && typeof e.abandon_step !== "string") {
    errors.push("abandon_step must be a string when present");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, entry: e };
}

/**
 * @param {string} text
 * @returns {{ ok: true, entries: object[] } | { ok: false, errors: string[] }}
 */
export function parseFrictionLogLines(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  /** @type {object[]} */
  const entries = [];
  /** @type {string[]} */
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      errors.push(`line ${i + 1}: invalid JSON (${err instanceof Error ? err.message : "parse error"})`);
      continue;
    }
    const result = validateFrictionEntry(parsed);
    if (!result.ok) {
      errors.push(`line ${i + 1}: ${result.errors.join("; ")}`);
      continue;
    }
    entries.push(result.entry);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, entries };
}

/**
 * @param {object[]} entries
 */
export function summarizeFrictionLog(entries) {
  /** @type {Record<string, { success: number, fail: number, abandon: number }>} */
  const byCommand = {};
  /** @type {Record<string, number>} */
  const reasonCounts = {};
  let inadequateNextAction = 0;
  let neededRunSelection = 0;
  let missingInfoReports = 0;
  /** @type {Set<string>} */
  const sessions = new Set();
  /** @type {Set<string>} */
  const testers = new Set();

  for (const raw of entries) {
    const e = /** @type {Record<string, unknown>} */ (raw);
    const cmd = String(e.command);
    const outcome = String(e.outcome);
    sessions.add(String(e.session_id));
    testers.add(String(e.tester_id));
    if (!byCommand[cmd]) {
      byCommand[cmd] = { success: 0, fail: 0, abandon: 0 };
    }
    if (outcome === "success" || outcome === "fail" || outcome === "abandon") {
      byCommand[cmd][outcome] += 1;
    }
    if (e.reason_code) {
      const rc = String(e.reason_code);
      reasonCounts[rc] = (reasonCounts[rc] || 0) + 1;
    }
    if (e.next_safe_action_adequate === false) {
      inadequateNextAction += 1;
    }
    if (e.needed_run_selection === true) {
      neededRunSelection += 1;
    }
    if (e.missing_info && String(e.missing_info).trim()) {
      missingInfoReports += 1;
    }
  }

  /** @type {Record<string, { attempts: number, success: number, fail: number, abandon: number }>} */
  const funnel = {};
  for (const cmd of FUNNEL_COMMANDS) {
    const row = byCommand[cmd] || { success: 0, fail: 0, abandon: 0 };
    funnel[cmd] = {
      attempts: row.success + row.fail + row.abandon,
      success: row.success,
      fail: row.fail,
      abandon: row.abandon,
    };
  }

  const frictionSignals = inadequateNextAction + missingInfoReports + neededRunSelection;
  const failAbandon = Object.values(byCommand).reduce(
    (n, r) => n + r.fail + r.abandon,
    0,
  );
  const promotion_hint =
    frictionSignals >= 2 || failAbandon >= 3
      ? "review_for_v024_operator_ux"
      : "continue_cohort_collect_more";

  return {
    schema_version: SCHEMA_VERSION,
    entry_count: entries.length,
    session_count: sessions.size,
    tester_count: testers.size,
    by_command: byCommand,
    funnel,
    top_reason_codes: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason_code, count]) => ({ reason_code, count })),
    signals: {
      inadequate_next_safe_action: inadequateNextAction,
      needed_run_selection: neededRunSelection,
      missing_info_reports: missingInfoReports,
      fail_or_abandon_total: failAbandon,
    },
    promotion_hint,
  };
}
