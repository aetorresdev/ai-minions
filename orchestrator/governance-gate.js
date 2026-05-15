"use strict";

const { randomUUID } = require("crypto");

const GOVERNANCE_GATE_ID = "governance_human";

const APPROVAL_DENIED_REASON_CODES = /** @type {const} */ ([
  "GOVERNANCE_OPERATOR_DENIED",
  "GOVERNANCE_TIMEOUT",
  "GOVERNANCE_POLICY_MISMATCH",
]);

/**
 * @param {Record<string, unknown>} permissionTracePayload
 * @param {unknown} mcpServer
 * @param {unknown} mcpTool
 */
function summarizeMcpBlockedApproval(permissionTracePayload, mcpServer, mcpTool) {
  const toolLabel =
    mcpServer != null && String(mcpServer).trim() && mcpTool != null && String(mcpTool).trim()
      ? `${String(mcpServer)}.${String(mcpTool)}`
      : String(permissionTracePayload.tool || "unknown_tool");
  const msg = `MCP invocation requires human approval before allow (${toolLabel})`;
  return msg.slice(0, 300);
}

/**
 * Build payload for `traceEvent` (envelope fields added by orchestrator).
 *
 * @param {Record<string, unknown>} permissionTracePayload - same shape as `permission_check` body minus envelope
 * @param {object} opts
 * @param {string} opts.mcpServer
 * @param {string} opts.mcpTool
 * @param {string} [opts.approval_id]
 * @param {string} [opts.agent]
 * @param {number} [opts.iteration]
 * @param {string} [opts.step_id]
 * @param {string} [opts.role] — overrides permission row role when set
 * @param {boolean} [opts.ownership_change]
 * @param {string} [opts.handoff_contract_ref]
 * @param {string} [opts.source_role]
 * @param {string} [opts.target_role]
 */
function buildApprovalRequiredFromPermissionTrace(permissionTracePayload, opts = {}) {
  const tp =
    permissionTracePayload && typeof permissionTracePayload === "object"
      ? permissionTracePayload
      : /** @type {Record<string, unknown>} */ ({});
  let approval_id =
    opts.approval_id != null ? String(opts.approval_id).slice(0, 64) : randomUUID();
  if (approval_id.length < 8) approval_id = randomUUID();
  const agent = String(opts.agent != null ? opts.agent : (tp.actor != null ? tp.actor : "orchestrator")).slice(
    0,
    128,
  );
  const iteration = Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0;

  /** @type {Record<string, unknown>} */
  const row = {
    event: "approval_required",
    agent,
    iteration,
    approval_id,
    gate_id: GOVERNANCE_GATE_ID,
    role: String(opts.role != null ? opts.role : (tp.role != null ? tp.role : "ORCHESTRATOR")).slice(0, 64),
    reason: String(tp.reason_code != null ? tp.reason_code : "requires_approval").slice(0, 300),
    action_summary: summarizeMcpBlockedApproval(tp, opts.mcpServer, opts.mcpTool),
  };

  if (opts.step_id != null && String(opts.step_id).trim()) {
    row.step_id = String(opts.step_id).slice(0, 240);
  }
  if (tp.action_class != null) row.action_class = String(tp.action_class).slice(0, 96);
  if ("target_class" in tp) row.target_class = tp.target_class;
  if (opts.source_role != null && String(opts.source_role).trim()) {
    row.source_role = String(opts.source_role).slice(0, 64);
  }
  if (opts.target_role != null && String(opts.target_role).trim()) {
    row.target_role = String(opts.target_role).slice(0, 64);
  }
  if (opts.ownership_change === true) row.ownership_change = true;
  if (opts.handoff_contract_ref != null && String(opts.handoff_contract_ref).trim()) {
    row.handoff_contract_ref = String(opts.handoff_contract_ref).slice(0, 200);
  }

  const dec = tp.decision;
  const decision =
    dec === "allow" || dec === "deny" || dec === "requires_approval" ? dec : "requires_approval";
  row.related_permission_check = {
    tool: String(tp.tool || "").slice(0, 512),
    domain: String(tp.domain || "mcp").slice(0, 64),
    decision,
    reason_code: String(tp.reason_code || "").slice(0, 160),
  };

  return row;
}

/**
 * @param {object} opts
 * @param {string} opts.approval_id
 * @param {string} [opts.agent]
 * @param {number} [opts.iteration]
 * @param {string} [opts.step_id]
 * @param {string} [opts.notes]
 */
function buildApprovalGrantedPayload(opts) {
  const approval_id = String(opts.approval_id || "").slice(0, 64);
  if (approval_id.length < 8) throw new Error("approval_id required (min 8 chars)");
  /** @type {Record<string, unknown>} */
  const row = {
    event: "approval_granted",
    agent: String(opts.agent || "operator").slice(0, 128),
    iteration: Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0,
    approval_id,
    gate_id: GOVERNANCE_GATE_ID,
  };
  if (opts.step_id) row.step_id = String(opts.step_id).slice(0, 240);
  if (opts.notes) row.notes = String(opts.notes).slice(0, 300);
  return row;
}

/**
 * @param {object} opts
 * @param {string} opts.approval_id
 * @param {(typeof APPROVAL_DENIED_REASON_CODES)[number]} opts.reason_code
 * @param {string} [opts.agent]
 * @param {number} [opts.iteration]
 * @param {string} [opts.step_id]
 * @param {string} [opts.details]
 */
function buildApprovalDeniedPayload(opts) {
  const approval_id = String(opts.approval_id || "").slice(0, 64);
  if (approval_id.length < 8) throw new Error("approval_id required (min 8 chars)");
  const reason_code = opts.reason_code;
  if (!APPROVAL_DENIED_REASON_CODES.includes(reason_code)) {
    throw new Error(`invalid approval_denied reason_code: ${reason_code}`);
  }
  /** @type {Record<string, unknown>} */
  const row = {
    event: "approval_denied",
    agent: String(opts.agent || "operator").slice(0, 128),
    iteration: Number.isFinite(opts.iteration) ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration))) : 0,
    approval_id,
    gate_id: GOVERNANCE_GATE_ID,
    reason_code,
  };
  if (opts.step_id) row.step_id = String(opts.step_id).slice(0, 240);
  if (opts.details) row.details = String(opts.details).slice(0, 300);
  return row;
}

/**
 * Scan trace-like rows in order; last event per approval_id wins.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 * @returns {Map<string, "pending"|"granted"|"denied">}
 */
function governanceFinalStateByApprovalId(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r || typeof r !== "object" || typeof r.approval_id !== "string") continue;
    const id = r.approval_id;
    if (r.event === "approval_required") m.set(id, "pending");
    else if (r.event === "approval_granted") m.set(id, "granted");
    else if (r.event === "approval_denied") m.set(id, "denied");
  }
  return m;
}

/**
 * True when execution should not advance: any approval still pending or explicitly denied.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 */
function governanceRunnerShouldHold(rows) {
  for (const st of governanceFinalStateByApprovalId(rows).values()) {
    if (st === "pending" || st === "denied") return true;
  }
  return false;
}

/**
 * True when a row declared ownership_change on approval_required but the same approval_id
 * was never granted (delegated-handoff audits; call before applying ownership transfer).
 *
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 */
function governanceOwnershipHandoffUnresolved(rows) {
  const owns = [];
  for (const r of rows) {
    if (
      r &&
      r.event === "approval_required" &&
      r.ownership_change === true &&
      typeof r.approval_id === "string"
    ) {
      owns.push(r.approval_id);
    }
  }
  if (!owns.length) return false;
  const st = governanceFinalStateByApprovalId(rows);
  for (const id of owns) {
    if (st.get(id) !== "granted") return true;
  }
  return false;
}

module.exports = {
  GOVERNANCE_GATE_ID,
  APPROVAL_DENIED_REASON_CODES,
  buildApprovalRequiredFromPermissionTrace,
  buildApprovalGrantedPayload,
  buildApprovalDeniedPayload,
  governanceFinalStateByApprovalId,
  governanceRunnerShouldHold,
  governanceOwnershipHandoffUnresolved,
};
