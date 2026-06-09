"use strict";

/**
 * Stranded run/step recovery semantics — detect and explain incomplete traces.
 * No auto-retry without explicit policy. See docs/orchestrator/recovery-sweep-contract.md
 */

const {
  governanceOwnershipHandoffUnresolved,
  governanceRunnerShouldHold,
} = require("./governance-gate");

const RECOVERY_SCHEMA_VERSION = "1";
const MAX_FINDINGS = 16;
const MAX_DESC_LEN = 300;

/** @typedef {"missing_session_end"|"stranded_step"|"unresolved_ownership_handoff"|"pending_governance_approval"|"no_agent_steps"} RecoveryFindingKind */

/**
 * @param {string} s
 * @returns {string}
 */
function truncateDesc(s) {
  const t = String(s || "").trim();
  if (t.length <= MAX_DESC_LEN) return t;
  return `${t.slice(0, MAX_DESC_LEN - 1)}…`;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectStrandedSteps(rows) {
  /** @type {Map<string, { agent: string | null, iteration: number | null }>} */
  const started = new Map();
  /** @type {Set<string>} */
  const completed = new Set();

  for (const r of rows) {
    if (!r || typeof r.step_id !== "string" || !r.step_id.length) continue;
    if (r.event === "agent_start") {
      if (!started.has(r.step_id)) {
        started.set(r.step_id, {
          agent: typeof r.agent === "string" ? r.agent : null,
          iteration: typeof r.iteration === "number" ? r.iteration : null,
        });
      }
    } else if (r.event === "agent_done") {
      completed.add(r.step_id);
    }
  }

  /** @type {object[]} */
  const findings = [];
  for (const [step_id, meta] of started) {
    if (completed.has(step_id)) continue;
    findings.push({
      finding_kind: "stranded_step",
      severity: "error",
      blocks_auto_recovery: true,
      step_id,
      agent: meta.agent,
      iteration: meta.iteration,
      description: truncateDesc(`Step ${step_id} has agent_start without matching agent_done`),
    });
  }
  return findings;
}

/**
 * @param {object[]} rows
 * @param {{ skipMissingSessionEnd?: boolean }} [opts]
 * @returns {object[]}
 */
function detectSessionLifecycle(rows, opts = {}) {
  const hasStart = rows.some((r) => r && r.event === "session_start");
  const hasEnd = rows.some((r) => r && r.event === "session_end");
  /** @type {object[]} */
  const findings = [];

  if (!opts.skipMissingSessionEnd && hasStart && !hasEnd) {
    findings.push({
      finding_kind: "missing_session_end",
      severity: "error",
      blocks_auto_recovery: true,
      step_id: null,
      description: "Trace has session_start but no session_end — run may have aborted or trace was truncated",
    });
  }

  if (hasStart && !rows.some((r) => r && r.event === "agent_start")) {
    findings.push({
      finding_kind: "no_agent_steps",
      severity: "warn",
      blocks_auto_recovery: true,
      step_id: null,
      description: "Run started but no agent_start events were emitted",
    });
  }

  return findings;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectHandoffAndGovernance(rows) {
  /** @type {object[]} */
  const findings = [];

  if (governanceOwnershipHandoffUnresolved(rows)) {
    findings.push({
      finding_kind: "unresolved_ownership_handoff",
      severity: "error",
      blocks_auto_recovery: true,
      step_id: null,
      description: "Delegated ownership handoff has approval_required without approval_granted",
    });
  }

  if (governanceRunnerShouldHold(rows)) {
    findings.push({
      finding_kind: "pending_governance_approval",
      severity: "warn",
      blocks_auto_recovery: true,
      step_id: null,
      description: "Governance approval is pending or denied — runner must hold until operator resolves",
    });
  }

  return findings;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectOpenReviewBlockers(rows) {
  /** @type {object[]} */
  const openRecords = [];
  for (const r of rows) {
    if (!r || r.event !== "review_record") continue;
    if (r.verdict === "block" || r.verdict === "request_changes") {
      openRecords.push(r);
    }
  }
  if (openRecords.length === 0) return [];

  let hasBlock = false;
  /** @type {string[]} */
  const details = [];
  for (const rec of openRecords) {
    if (rec.verdict === "block") hasBlock = true;
    const role = rec.reviewer_role != null ? String(rec.reviewer_role) : "unknown";
    const blockers = Array.isArray(rec.blockers) ? rec.blockers : [];
    const detail = blockers.length
      ? `${role}: ${String(blockers[0]).trim()}`
      : `${role}: ${rec.verdict}`;
    if (detail && details.length < 4) details.push(detail);
  }

  return [{
    finding_kind: "open_review_blockers",
    severity: hasBlock ? "error" : "warn",
    blocks_auto_recovery: true,
    step_id: null,
    description: truncateDesc(`Open review blockers: ${details.join("; ")}`),
  }];
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectMissingIterationDone(rows) {
  /** @type {Set<number>} */
  const iterationsActive = new Set();
  /** @type {Set<number>} */
  const iterationsDone = new Set();

  for (const r of rows) {
    if (!r) continue;
    if (
      (r.event === "agent_start" || r.event === "agent_done")
      && typeof r.iteration === "number"
    ) {
      iterationsActive.add(r.iteration);
    }
    if (r.event === "iteration_done" && typeof r.iteration === "number") {
      iterationsDone.add(r.iteration);
    }
  }

  /** @type {object[]} */
  const findings = [];
  for (const iter of [...iterationsActive].sort((a, b) => a - b)) {
    if (iterationsDone.has(iter)) continue;
    findings.push({
      finding_kind: "missing_iteration_done",
      severity: "error",
      blocks_auto_recovery: true,
      step_id: null,
      iteration: iter,
      description: truncateDesc(
        `Iteration ${iter} has agent activity but no matching iteration_done terminal event`,
      ),
    });
  }
  return findings;
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectGovernanceBoundaryIncomplete(rows) {
  /** @type {object | null} */
  let lastCheck = null;
  for (const r of rows) {
    if (r && r.event === "production_boundary_check") lastCheck = r;
  }
  if (!lastCheck || lastCheck.decision === "ready_for_human_review") return [];

  const decision = String(lastCheck.decision || "unknown");
  const reason = lastCheck.reason_code != null ? String(lastCheck.reason_code) : null;
  const desc = reason
    ? `production_boundary_check decision=${decision} (${reason})`
    : `production_boundary_check decision=${decision}`;

  return [{
    finding_kind: "governance_boundary_incomplete",
    severity: decision === "blocked" ? "error" : "warn",
    blocks_auto_recovery: true,
    step_id: null,
    description: truncateDesc(desc),
  }];
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function detectIncompleteHandoff(rows) {
  let blockedAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.event !== "iteration_done" || r.outcome !== "gate_blocked_iterate") continue;
    const tr = r.transition_reason && typeof r.transition_reason === "object" ? r.transition_reason : {};
    const code = tr.reason_code != null ? String(tr.reason_code) : "";
    const gateKinds = Array.isArray(r.gate_kinds) ? r.gate_kinds.map(String) : [];
    if (
      gateKinds.includes("compact_handoff")
      || /handoff|compact_handoff|GATE_ARTIFACT/i.test(code)
    ) {
      blockedAt = i;
    }
  }
  if (blockedAt < 0) return [];

  const after = rows.slice(blockedAt + 1);
  const recovered = after.some((r) => {
    if (!r) return false;
    if (r.event === "compact_handoff_fallback") return true;
    if (r.event === "mcp_call" && r.tool === "compact_handoff") return true;
    if (r.event === "approval_granted") return true;
    return false;
  });
  if (recovered) return [];

  return [{
    finding_kind: "incomplete_handoff",
    severity: "error",
    blocks_auto_recovery: true,
    step_id: null,
    description: "Handoff gate blocked iteration without subsequent compact_handoff or approval_granted",
  }];
}

/**
 * @param {object[]} rows
 * @param {{ lifecycleMode?: "post_hoc" | "live_before_session_end" }} [opts]
 * @returns {{ findings: object[], finding_count: number, blocks_auto_recovery: boolean, clean: boolean, summary: string, lifecycle_mode: string }}
 */
function analyzeRecoveryFromRows(rows, opts = {}) {
  const lifecycleMode = opts.lifecycleMode === "live_before_session_end"
    ? "live_before_session_end"
    : "post_hoc";
  const safe = Array.isArray(rows) ? rows : [];
  const findings = [
    ...detectSessionLifecycle(safe, {
      skipMissingSessionEnd: lifecycleMode === "live_before_session_end",
    }),
    ...detectStrandedSteps(safe),
    ...detectHandoffAndGovernance(safe),
  ].slice(0, MAX_FINDINGS);

  const blocks_auto_recovery = findings.some((f) => f.blocks_auto_recovery === true);
  const clean = findings.length === 0;
  let summary;
  if (clean) {
    summary = "No stranded steps or incomplete session/handoff signals detected";
  } else {
    const kinds = [...new Set(findings.map((f) => f.finding_kind))];
    summary = `Recovery sweep found ${findings.length} issue(s): ${kinds.join(", ")}`;
  }

  return {
    findings,
    finding_count: findings.length,
    blocks_auto_recovery,
    clean,
    summary,
    lifecycle_mode: lifecycleMode,
  };
}

/**
 * Post-hoc / export: recompute from full trace is source of truth.
 * `sweep_event` is the last `recovery_completed` row when present (historical evidence only).
 *
 * @param {object[]} rows
 * @returns {{ findings: object[], finding_count: number, blocks_auto_recovery: boolean, clean: boolean, summary: string, sweep_event: object | null, computed_from: string }}
 */
function summarizeRecoveryFromRows(rows) {
  const analysis = analyzeRecoveryFromRows(rows, { lifecycleMode: "post_hoc" });
  /** @type {object | null} */
  let sweep_event = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.event === "recovery_completed") {
      sweep_event = {
        finding_count: typeof r.finding_count === "number" ? r.finding_count : analysis.finding_count,
        clean: r.clean === true,
        summary: typeof r.summary === "string" ? r.summary : analysis.summary,
        policy: typeof r.policy === "string" ? r.policy : "no_auto_retry",
      };
      break;
    }
  }

  return {
    ...analysis,
    computed_from: "full_trace",
    sweep_event,
  };
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {object} finding
 */
function traceRecoveryDetected(traceEvent, taskId, finding) {
  traceEvent(taskId, {
    event: "recovery_detected",
    recovery_schema_version: RECOVERY_SCHEMA_VERSION,
    finding_kind: finding.finding_kind,
    severity: finding.severity,
    description: truncateDesc(finding.description),
    blocks_auto_recovery: finding.blocks_auto_recovery === true,
    ...(finding.step_id ? { step_id: finding.step_id } : {}),
    ...(typeof finding.agent === "string" ? { agent: finding.agent } : {}),
    ...(typeof finding.iteration === "number" ? { iteration: finding.iteration } : {}),
  });
}

/**
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {ReturnType<typeof analyzeRecoveryFromRows>} analysis
 */
function traceRecoverySweepOutcome(traceEvent, taskId, analysis) {
  if (analysis.blocks_auto_recovery) {
    traceEvent(taskId, {
      event: "recovery_blocked",
      recovery_schema_version: RECOVERY_SCHEMA_VERSION,
      policy: "no_auto_retry",
      reason: truncateDesc(analysis.summary),
      finding_count: analysis.finding_count,
    });
  }

  traceEvent(taskId, {
    event: "recovery_completed",
    recovery_schema_version: RECOVERY_SCHEMA_VERSION,
    policy: "no_auto_retry",
    finding_count: analysis.finding_count,
    clean: analysis.clean,
    summary: truncateDesc(analysis.summary),
  });
}

/**
 * Post-hoc sweep on trace rows. Emits recovery_detected per finding, then blocked/completed.
 * Does not mutate runtime state or retry steps.
 *
 * @param {(taskId: string, ev: Record<string, unknown>) => void} traceEvent
 * @param {string} taskId
 * @param {object[]} rows
 * @param {{ lifecycleMode?: "post_hoc" | "live_before_session_end" }} [opts]
 * @returns {ReturnType<typeof analyzeRecoveryFromRows>}
 */
function runRecoverySweepAndTrace(traceEvent, taskId, rows, opts = {}) {
  const lifecycleMode = opts.lifecycleMode === "live_before_session_end"
    ? "live_before_session_end"
    : "post_hoc";
  const analysis = analyzeRecoveryFromRows(rows, { lifecycleMode });
  for (const finding of analysis.findings) {
    traceRecoveryDetected(traceEvent, taskId, finding);
  }
  traceRecoverySweepOutcome(traceEvent, taskId, analysis);
  return analysis;
}

module.exports = {
  RECOVERY_SCHEMA_VERSION,
  analyzeRecoveryFromRows,
  summarizeRecoveryFromRows,
  traceRecoveryDetected,
  traceRecoverySweepOutcome,
  runRecoverySweepAndTrace,
};
