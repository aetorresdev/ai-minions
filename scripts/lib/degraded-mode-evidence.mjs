/**
 * Degraded-mode assessment from orchestrator trace JSONL.
 * Used by inspect-run-evidence and collect-run-report for beta gate honesty.
 */

import fs from "node:fs";

export const POLICY_VERSION = 1;

/** @typedef {'DEGRADED_SKIP_GATES' | 'DEGRADED_MCP_MISSING' | 'DEGRADED_NETWORK_GATE_BYPASSED' | 'DEGRADED_PRIVACY_SCAN_REMOTE_UNAVAILABLE' | 'DEGRADED_MODE_EVENT'} DegradedTriggerCode */

export const TRIGGER_CODES = {
  SKIP_GATES: "DEGRADED_SKIP_GATES",
  MCP_MISSING: "DEGRADED_MCP_MISSING",
  NETWORK_GATE_BYPASSED: "DEGRADED_NETWORK_GATE_BYPASSED",
  PRIVACY_SCAN_REMOTE_UNAVAILABLE: "DEGRADED_PRIVACY_SCAN_REMOTE_UNAVAILABLE",
  GENERIC_EVENT: "DEGRADED_MODE_EVENT",
};

/** Codes that disqualify a run from counting as external-beta success. */
export const DISQUALIFYING_TRIGGER_CODES = new Set([
  TRIGGER_CODES.SKIP_GATES,
  TRIGGER_CODES.MCP_MISSING,
  TRIGGER_CODES.NETWORK_GATE_BYPASSED,
  TRIGGER_CODES.PRIVACY_SCAN_REMOTE_UNAVAILABLE,
]);

/**
 * @param {string} traceFile
 * @returns {Record<string, unknown>[]}
 */
export function readTraceEvents(traceFile) {
  const text = fs.readFileSync(traceFile, "utf8");
  /** @type {Record<string, unknown>[]} */
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(/** @type {Record<string, unknown>} */ (parsed));
      }
    } catch {
      // caller validates JSONL separately
    }
  }
  return events;
}

/**
 * @param {Record<string, unknown>[]} events
 * @returns {boolean}
 */
function isRemoteCapableRun(events) {
  for (const ev of events) {
    if (ev.local_only_mode === false) return true;
    if (ev.event === "session_start" && ev.local_only_mode !== true) {
      const goal = String(ev.goal ?? "");
      if (/claude|anthropic|remote/i.test(goal)) return true;
    }
  }
  const blob = JSON.stringify(events);
  return /"provider"\s*:\s*"(claude|anthropic|openai)"/i.test(blob)
    || /runClaude|remote_ok/i.test(blob);
}

/**
 * @param {string} reason
 * @returns {DegradedTriggerCode | null}
 */
function classifyDegradedReason(reason) {
  const r = String(reason ?? "");
  if (r === "skipStateMcp=true" || /--skip-gates/i.test(r)) {
    return TRIGGER_CODES.SKIP_GATES;
  }
  if (/register_task|state store|orchestrator-state|compact-handoff|MCP unavailable/i.test(r)) {
    return TRIGGER_CODES.MCP_MISSING;
  }
  return TRIGGER_CODES.GENERIC_EVENT;
}

/**
 * @param {Record<string, unknown>[]} events
 * @returns {{ degraded_mode: boolean, disqualifies_beta_success: boolean, risk_acceptance_reason: string | null, triggers: DegradedTriggerCode[], degraded_events: { reason: string, trigger: DegradedTriggerCode | null }[], policy_version: number }}
 */
export function assessDegradedModeFromEvents(events) {
  /** @type {Set<DegradedTriggerCode>} */
  const triggers = new Set();
  /** @type {{ reason: string, trigger: DegradedTriggerCode | null }[]} */
  const degradedEvents = [];

  for (const ev of events) {
    if (ev.event !== "degraded_mode") continue;
    const reason = String(ev.reason ?? "");
    const trigger = classifyDegradedReason(reason);
    degradedEvents.push({ reason, trigger });
    if (trigger) triggers.add(trigger);
  }

  const blob = JSON.stringify(events);
  if (/ORCH_SKIP_NETWORK_PERMISSION_GATE["']?\s*[:=]\s*["']?1/i.test(blob)
    || /"ORCH_SKIP_NETWORK_PERMISSION_GATE"\s*:\s*"1"/.test(blob)) {
    triggers.add(TRIGGER_CODES.NETWORK_GATE_BYPASSED);
  }

  if (/PRIVACY_SCAN_UNAVAILABLE/.test(blob) && isRemoteCapableRun(events)) {
    triggers.add(TRIGGER_CODES.PRIVACY_SCAN_REMOTE_UNAVAILABLE);
  }

  const disqualifying = [...triggers].some((t) => DISQUALIFYING_TRIGGER_CODES.has(t));
  const degraded_mode = degradedEvents.length > 0 || disqualifying;

  /** @type {string | null} */
  let risk_acceptance_reason = null;
  if (disqualifying) {
    risk_acceptance_reason = [...triggers]
      .filter((t) => DISQUALIFYING_TRIGGER_CODES.has(t))
      .join("; ");
  } else if (degraded_mode) {
    risk_acceptance_reason = degradedEvents
      .map((d) => d.trigger ?? TRIGGER_CODES.GENERIC_EVENT)
      .join("; ");
  }

  return {
    degraded_mode,
    disqualifies_beta_success: disqualifying,
    risk_acceptance_reason,
    triggers: [...triggers],
    degraded_events: degradedEvents,
    policy_version: POLICY_VERSION,
  };
}

/**
 * @param {string} traceFile
 * @returns {ReturnType<typeof assessDegradedModeFromEvents>}
 */
export function assessDegradedModeFromTrace(traceFile) {
  return assessDegradedModeFromEvents(readTraceEvents(traceFile));
}
