/**
 * Cohort UX discovery — friction log validation and aggregation.
 * Evidence-only; does not change operator CLI behavior.
 */

import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const PRODUCT_CLI_FRICTION_ENV = Object.freeze({
  file: "AI_MINIONS_COHORT_FRICTION_LOG",
  testerId: "AI_MINIONS_COHORT_TESTER_ID",
  sessionId: "AI_MINIONS_COHORT_SESSION_ID",
  stepIndex: "AI_MINIONS_COHORT_STEP_INDEX",
});

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

/** @type {ReadonlySet<string>} */
export const ALLOWED_ENTRY_KEYS = new Set([
  "schema_version",
  "recorded_at",
  "tester_id",
  "session_id",
  "step_index",
  "command",
  "outcome",
  "exit_code",
  "reason_code",
  "result_code",
  "next_safe_action_observed",
  "next_safe_action_adequate",
  "needed_run_selection",
  "missing_info",
  "operator_notes",
  "task_id",
  "ai_minions_version",
  "abandon_step",
]);

const ISO_8601_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * @param {unknown} value
 */
export function isIso8601Timestamp(value) {
  if (typeof value !== "string" || !ISO_8601_TIMESTAMP_RE.test(value)) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * @param {unknown[]} values
 * @returns {string | undefined}
 */
function firstNonEmptyString(values) {
  return values.find((value) => typeof value === "string" && value.trim());
}

/**
 * Build one privacy-safe event from a product CLI handler result.
 * Raw argv and free-form command inputs are intentionally not accepted.
 *
 * @param {{
 *   command: unknown,
 *   result: unknown,
 *   env?: Record<string, string | undefined>,
 *   recordedAt?: string,
 * }} options
 * @returns {{ ok: true, entry: object } | { ok: false, reason_code: string }}
 */
export function buildProductCliFrictionEntry(options) {
  const env = options.env ?? process.env;
  const testerId = env[PRODUCT_CLI_FRICTION_ENV.testerId];
  const sessionId = env[PRODUCT_CLI_FRICTION_ENV.sessionId];
  const stepIndex = Number(env[PRODUCT_CLI_FRICTION_ENV.stepIndex]);
  if (
    typeof testerId !== "string"
    || !testerId.trim()
    || typeof sessionId !== "string"
    || !sessionId.trim()
    || !Number.isInteger(stepIndex)
    || stepIndex < 1
  ) {
    return { ok: false, reason_code: "FRICTION_INSTRUMENTATION_CONFIG_INVALID" };
  }

  const rawResult = options.result;
  const result = rawResult && typeof rawResult === "object"
    ? /** @type {Record<string, any>} */ (rawResult)
    : {};
  const json = result.json && typeof result.json === "object" ? result.json : {};
  const traceSummary = json.operator_trace_summary && typeof json.operator_trace_summary === "object"
    ? json.operator_trace_summary
    : {};
  const runState = json.run_state_visibility && typeof json.run_state_visibility === "object"
    ? json.run_state_visibility
    : {};
  const commandRaw = String(options.command ?? "");
  const command = commandRaw === "result"
    ? "status"
    : (TRACKED_COMMANDS.includes(commandRaw) ? commandRaw : "other");
  const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : undefined;
  const reasonCode = firstNonEmptyString([
    result.reason_code,
    json.reason_code,
    json.blocking_reason_code,
    runState.blocking_reason_code,
  ]);
  const resultCode = firstNonEmptyString([
    result.result_code,
    json.result_code,
    runState.result_code,
  ]);
  const nextSafeAction = firstNonEmptyString([
    result.next_safe_action,
    json.next_safe_action,
    traceSummary.next_safe_action,
    runState.next_safe_action,
    json.remediation,
  ]);
  const taskId = firstNonEmptyString([
    result.task_id,
    result.launched?.task_id,
    json.run_id,
    runState.run_id,
  ]);

  /** @type {Record<string, unknown>} */
  const entry = {
    schema_version: SCHEMA_VERSION,
    recorded_at: options.recordedAt ?? new Date().toISOString(),
    tester_id: testerId.trim(),
    session_id: sessionId.trim(),
    step_index: stepIndex,
    command,
    outcome: exitCode === 0 || (exitCode == null && result.ok === true) ? "success" : "fail",
  };
  if (exitCode != null) entry.exit_code = exitCode;
  if (reasonCode) entry.reason_code = reasonCode;
  if (resultCode) entry.result_code = resultCode;
  if (nextSafeAction) entry.next_safe_action_observed = nextSafeAction;
  if (taskId) entry.task_id = taskId;

  const validated = validateFrictionEntry(entry);
  if (!validated.ok) {
    return { ok: false, reason_code: "FRICTION_INSTRUMENTATION_ENTRY_INVALID" };
  }
  return { ok: true, entry: validated.entry };
}

/**
 * Best-effort append for explicitly enabled product CLI instrumentation.
 * Failures are returned to the caller and never replace the command result.
 *
 * @param {{
 *   command: unknown,
 *   result: unknown,
 *   env?: Record<string, string | undefined>,
 *   recordedAt?: string,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   appendFileSync?: typeof fs.appendFileSync,
 * }} options
 * @returns {{ ok: true, enabled: boolean } | { ok: false, enabled: true, reason_code: string }}
 */
export function appendProductCliFrictionEvent(options) {
  const env = options.env ?? process.env;
  const configuredPath = env[PRODUCT_CLI_FRICTION_ENV.file];
  if (configuredPath == null || configuredPath === "") {
    return { ok: true, enabled: false };
  }
  if (typeof configuredPath !== "string" || !configuredPath.trim()) {
    return {
      ok: false,
      enabled: true,
      reason_code: "FRICTION_INSTRUMENTATION_CONFIG_INVALID",
    };
  }

  const built = buildProductCliFrictionEntry({ ...options, env });
  if (!built.ok) {
    return { ok: false, enabled: true, reason_code: built.reason_code };
  }

  try {
    const outPath = path.resolve(configuredPath);
    (options.mkdirSync ?? fs.mkdirSync)(path.dirname(outPath), { recursive: true });
    (options.appendFileSync ?? fs.appendFileSync)(
      outPath,
      `${JSON.stringify(built.entry)}\n`,
      "utf8",
    );
  } catch {
    return {
      ok: false,
      enabled: true,
      reason_code: "FRICTION_INSTRUMENTATION_WRITE_FAILED",
    };
  }
  return { ok: true, enabled: true };
}

/**
 * @param {object[]} sessionEntries
 * @param {string} command
 * @returns {"not_attempted" | "success" | "fail" | "abandon"}
 */
export function commandOutcomeInSession(sessionEntries, command) {
  const relevant = sessionEntries.filter((e) => String(e.command) === command);
  if (relevant.length === 0) {
    return "not_attempted";
  }
  if (relevant.some((e) => e.outcome === "success")) {
    return "success";
  }
  if (relevant.some((e) => e.outcome === "fail")) {
    return "fail";
  }
  if (relevant.some((e) => e.outcome === "abandon")) {
    return "abandon";
  }
  return "not_attempted";
}

/**
 * @param {object[]} entries
 * @returns {Map<string, object[]>}
 */
export function groupEntriesBySession(entries) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const raw of entries) {
    const sid = String(raw.session_id);
    if (!map.has(sid)) {
      map.set(sid, []);
    }
    map.get(sid).push(raw);
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => Number(a.step_index) - Number(b.step_index));
  }
  return map;
}

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

  for (const key of Object.keys(e)) {
    if (!ALLOWED_ENTRY_KEYS.has(key)) {
      errors.push(`unknown property: ${key}`);
    }
  }

  if (e.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (!isIso8601Timestamp(e.recorded_at)) {
    errors.push("recorded_at must be a valid ISO 8601 timestamp (e.g. 2026-07-10T16:00:00Z)");
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
  if (e.result_code != null && typeof e.result_code !== "string") {
    errors.push("result_code must be a string when present");
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
 * @param {number} numerator
 * @param {number} denominator
 */
function conversionRate(numerator, denominator) {
  if (denominator <= 0) {
    return null;
  }
  return Number((numerator / denominator).toFixed(4));
}

/**
 * @param {object[]} sessionEntries
 * @param {string} command
 * @param {number} [afterStep]
 */
function commandEntriesAfter(sessionEntries, command, afterStep = -Infinity) {
  return sessionEntries.filter(
    (e) => String(e.command) === command && Number(e.step_index) > afterStep,
  );
}

/**
 * @param {object[]} sessionEntries
 * @param {string} command
 * @param {number} [afterStep]
 */
function firstSuccessfulCommandAfter(sessionEntries, command, afterStep = -Infinity) {
  return commandEntriesAfter(sessionEntries, command, afterStep).find(
    (e) => e.outcome === "success",
  );
}

/**
 * @param {object[]} entries
 */
export function buildSessionFunnel(entries) {
  const sessions = groupEntriesBySession(entries);

  /** @type {Record<string, { attempted: number, success: number, fail: number, abandon: number }>} */
  const perStage = {};
  for (const cmd of FUNNEL_COMMANDS) {
    perStage[cmd] = { attempted: 0, success: 0, fail: 0, abandon: 0 };
  }

  let dropOffAfterFirstRun = 0;
  let dropOffAfterSmoke = 0;
  let firstRunSuccessSessions = 0;
  let smokeSuccessSessions = 0;
  let attachSuccessSessions = 0;
  let smokeAttemptedAfterFirstRunSuccess = 0;
  let attachAttemptedAfterSmokeSuccess = 0;

  for (const sessionEntries of sessions.values()) {
    for (const cmd of FUNNEL_COMMANDS) {
      const outcome = commandOutcomeInSession(sessionEntries, cmd);
      if (outcome === "not_attempted") {
        continue;
      }
      perStage[cmd].attempted += 1;
      perStage[cmd][outcome] += 1;
    }

    const firstRunSuccess = firstSuccessfulCommandAfter(sessionEntries, "first-run");

    if (firstRunSuccess) {
      firstRunSuccessSessions += 1;
      const smokeAfterFirstRun = commandEntriesAfter(
        sessionEntries,
        "smoke",
        Number(firstRunSuccess.step_index),
      );
      const smokeSuccess = smokeAfterFirstRun.find((e) => e.outcome === "success");

      if (smokeAfterFirstRun.length > 0) {
        smokeAttemptedAfterFirstRunSuccess += 1;
      }
      if (smokeSuccess) {
        smokeSuccessSessions += 1;
        const attachAfterSmoke = commandEntriesAfter(
          sessionEntries,
          "attach",
          Number(smokeSuccess.step_index),
        );
        const attachSuccess = attachAfterSmoke.find((e) => e.outcome === "success");

        if (attachAfterSmoke.length > 0) {
          attachAttemptedAfterSmokeSuccess += 1;
        }
        if (attachSuccess) {
          attachSuccessSessions += 1;
        } else {
          dropOffAfterSmoke += 1;
        }
      } else {
        dropOffAfterFirstRun += 1;
      }
    }
  }

  const sessionsTotal = sessions.size;

  return {
    sessions_total: sessionsTotal,
    per_stage: perStage,
    conversions: [
      {
        from: "first-run",
        to: "smoke",
        eligible_sessions: firstRunSuccessSessions,
        continued_sessions: smokeAttemptedAfterFirstRunSuccess,
        success_sessions: smokeSuccessSessions,
        rate: conversionRate(smokeSuccessSessions, firstRunSuccessSessions),
      },
      {
        from: "smoke",
        to: "attach",
        eligible_sessions: smokeSuccessSessions,
        continued_sessions: attachAttemptedAfterSmokeSuccess,
        success_sessions: attachSuccessSessions,
        rate: conversionRate(attachSuccessSessions, smokeSuccessSessions),
      },
    ],
    drop_offs: [
      { after_stage: "first-run", sessions: dropOffAfterFirstRun },
      { after_stage: "smoke", sessions: dropOffAfterSmoke },
    ],
  };
}

/**
 * @param {object[]} entries
 * @param {ReturnType<typeof buildSessionFunnel>} sessionFunnel
 */
function derivePromotionHint(entries, sessionFunnel) {
  const sessions = groupEntriesBySession(entries);
  /** @type {Set<string>} */
  const inadequateSessions = new Set();
  /** @type {Set<string>} */
  const runSelectionSessions = new Set();
  /** @type {Set<string>} */
  const missingInfoSessions = new Set();

  for (const raw of entries) {
    const e = /** @type {Record<string, unknown>} */ (raw);
    const sid = String(e.session_id);
    if (e.next_safe_action_adequate === false) {
      inadequateSessions.add(sid);
    }
    if (e.needed_run_selection === true) {
      runSelectionSessions.add(sid);
    }
    if (e.missing_info && String(e.missing_info).trim()) {
      missingInfoSessions.add(sid);
    }
  }

  const sessionCount = sessions.size;
  const smokeConversion = sessionFunnel.conversions.find((c) => c.from === "smoke");
  const attachNeverReached =
    sessionCount >= 2
    && smokeConversion
    && smokeConversion.eligible_sessions >= 1
    && smokeConversion.success_sessions === 0;

  if (
    sessionCount >= 2
    && (
      sessionFunnel.drop_offs[0].sessions >= 2
      || sessionFunnel.drop_offs[1].sessions >= 1
      || inadequateSessions.size >= 2
      || runSelectionSessions.size >= 2
      || missingInfoSessions.size >= 2
      || attachNeverReached
    )
  ) {
    return "review_for_v024_operator_ux";
  }
  return "continue_cohort_collect_more";
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

  const sessionFunnel = buildSessionFunnel(entries);
  const promotion_hint = derivePromotionHint(entries, sessionFunnel);

  return {
    schema_version: SCHEMA_VERSION,
    entry_count: entries.length,
    session_count: sessions.size,
    tester_count: testers.size,
    by_command: byCommand,
    session_funnel: sessionFunnel,
    top_reason_codes: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason_code, count]) => ({ reason_code, count })),
    signals: {
      inadequate_next_safe_action: inadequateNextAction,
      needed_run_selection: neededRunSelection,
      missing_info_reports: missingInfoReports,
    },
    promotion_hint,
  };
}
