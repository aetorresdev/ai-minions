"use strict";

const { randomUUID } = require("crypto");

/** @typedef {"required"|"risk_based"|"preview_only"|"auto"} ApprovalPolicyMode */

/** @typedef {"product_scope"|"architecture_plan"|"dev_execution"} ApprovalGateId */

const APPROVAL_POLICY_MODES = /** @type {const} */ ([
  "required",
  "risk_based",
  "preview_only",
  "auto",
]);

const APPROVAL_GATE_IDS = /** @type {const} */ ([
  "product_scope",
  "architecture_plan",
  "dev_execution",
]);

const APPROVAL_SKIPPED_REASON_CODES = /** @type {const} */ ([
  "POLICY_EPIC_LOW_RISK",
  "POLICY_VALIDATION_ONLY",
  "POLICY_PREVIEW_ACKNOWLEDGED",
  "POLICY_AUTO_MODE",
]);

const RISK_LEVELS = /** @type {const} */ (["low", "medium", "high"]);

const DEFAULT_APPROVAL_POLICY = {
  product_scope: "risk_based",
  architecture_plan: "risk_based",
  dev_execution: "risk_based",
};

/**
 * @typedef {object} GateInputContext
 * @property {"idea"|"epic"|"task"} [input_type]
 * @property {boolean} [required_fields_present]
 * @property {number} [unresolved_assumptions]
 * @property {"low"|"medium"|"high"} [risk_level]
 * @property {boolean} [validation_passed]
 * @property {boolean} [scope_validation_passed]
 * @property {boolean} [architecture_validation_passed]
 * @property {boolean} [human_product_scope_granted]
 * @property {boolean} [human_architecture_granted]
 * @property {boolean} [human_dev_execution_granted]
 * @property {string[]} [affected_areas]
 * @property {boolean} [migration_required]
 * @property {boolean} [rollback_plan_missing]
 * @property {boolean} [scope_changes_detected]
 * @property {boolean} [preview_acknowledged]
 */

/**
 * @param {unknown} v
 * @returns {GateInputContext}
 */
function normalizeGateContext(v) {
  const c = v && typeof v === "object" ? /** @type {Record<string, unknown>} */ (v) : {};
  const inputRaw = c.input_type != null ? String(c.input_type).toLowerCase() : "idea";
  const input_type =
    inputRaw === "epic" || inputRaw === "task" ? /** @type {"epic"|"task"} */ (inputRaw) : "idea";
  const riskRaw = c.risk_level != null ? String(c.risk_level).toLowerCase() : "high";
  const risk_level = RISK_LEVELS.includes(/** @type {typeof RISK_LEVELS[number]} */ (riskRaw))
    ? /** @type {"low"|"medium"|"high"} */ (riskRaw)
    : "high";
  const assumptions = Number(c.unresolved_assumptions);
  return {
    input_type,
    required_fields_present: c.required_fields_present === true,
    unresolved_assumptions: Number.isFinite(assumptions) ? Math.max(0, Math.floor(assumptions)) : 1,
    risk_level,
    validation_passed: c.validation_passed === true,
    scope_validation_passed: c.scope_validation_passed === true,
    architecture_validation_passed: c.architecture_validation_passed === true,
    human_product_scope_granted: c.human_product_scope_granted === true,
    human_architecture_granted: c.human_architecture_granted === true,
    human_dev_execution_granted: c.human_dev_execution_granted === true,
    affected_areas: Array.isArray(c.affected_areas)
      ? c.affected_areas.map((a) => String(a).toLowerCase()).slice(0, 16)
      : [],
    migration_required: c.migration_required === true,
    rollback_plan_missing: c.rollback_plan_missing === true,
    scope_changes_detected: c.scope_changes_detected === true,
    preview_acknowledged: c.preview_acknowledged === true,
  };
}

/**
 * Parse simple gate fields from compact handoff YAML (best-effort; fail closed on ambiguity).
 *
 * @param {string} yaml
 * @returns {Partial<GateInputContext>}
 */
function parseGateFieldsFromHandoffYaml(yaml) {
  if (!yaml || !String(yaml).trim()) return {};
  const text = String(yaml);
  /** @param {RegExp} re */
  const pick = (re) => {
    const m = re.exec(text);
    return m ? m[1].trim() : null;
  };
  /** @type {Partial<GateInputContext>} */
  const out = {};
  const input_type = pick(/input_type:\s*(\w+)/i);
  if (input_type) out.input_type = /** @type {GateInputContext["input_type"]} */ (input_type.toLowerCase());
  const risk = pick(/risk_level:\s*(\w+)/i);
  if (risk) out.risk_level = /** @type {GateInputContext["risk_level"]} */ (risk.toLowerCase());
  const assumptions = pick(/unresolved_assumptions:\s*(\d+)/i);
  if (assumptions != null) out.unresolved_assumptions = parseInt(assumptions, 10);
  if (/required_fields_present:\s*true/i.test(text)) out.required_fields_present = true;
  if (/validation_passed:\s*true/i.test(text)) out.validation_passed = true;
  if (/scope_validation_passed:\s*true/i.test(text)) out.scope_validation_passed = true;
  if (/architecture_validation_passed:\s*true/i.test(text)) {
    out.architecture_validation_passed = true;
  }
  if (/human_product_scope_granted:\s*true/i.test(text)) out.human_product_scope_granted = true;
  if (/human_architecture_granted:\s*true/i.test(text)) out.human_architecture_granted = true;
  if (/human_dev_execution_granted:\s*true/i.test(text)) out.human_dev_execution_granted = true;
  if (/migration_required:\s*true/i.test(text)) out.migration_required = true;
  if (/rollback_plan_missing:\s*true/i.test(text)) out.rollback_plan_missing = true;
  if (/scope_changes_detected:\s*true/i.test(text)) out.scope_changes_detected = true;
  const areas = [...text.matchAll(/affected_area:\s*(\w+)/gi)].map((m) => m[1].toLowerCase());
  if (areas.length) out.affected_areas = areas;
  return out;
}

/**
 * @param {ReadonlyArray<{ agentId?: string, handoffYaml?: string }>} artifacts
 */
function buildGateContextFromArtifacts(artifacts) {
  /** @type {Partial<GateInputContext>} */
  let merged = {};
  for (const a of artifacts || []) {
    if (!a || !a.handoffYaml) continue;
    merged = { ...merged, ...parseGateFieldsFromHandoffYaml(a.handoffYaml) };
    if (a.agentId === "architect") {
      merged.architecture_validation_passed =
        merged.architecture_validation_passed === true || /architecture_validation_passed:\s*true/i.test(a.handoffYaml);
    }
    if (a.agentId === "owner") {
      merged.scope_validation_passed =
        merged.scope_validation_passed === true || /scope_validation_passed:\s*true/i.test(a.handoffYaml);
    }
  }
  return normalizeGateContext(merged);
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
function loadApprovalPolicyFromEnv(env = process.env) {
  /** @type {Record<string, ApprovalPolicyMode>} */
  const policy = { ...DEFAULT_APPROVAL_POLICY };
  const map = [
    ["ORCH_APPROVAL_PRODUCT_SCOPE", "product_scope"],
    ["ORCH_APPROVAL_ARCHITECTURE", "architecture_plan"],
    ["ORCH_APPROVAL_DEV_EXECUTION", "dev_execution"],
  ];
  for (const [key, gate] of map) {
    const raw = env[key];
    if (raw && APPROVAL_POLICY_MODES.includes(/** @type {ApprovalPolicyMode} */ (raw))) {
      policy[gate] = /** @type {ApprovalPolicyMode} */ (raw);
    }
  }
  return policy;
}

const HIGH_RISK_AREAS = new Set([
  "security",
  "permissions",
  "runtime",
  "cost_controls",
  "release_gate",
]);

/**
 * @param {ApprovalGateId} gateId
 * @param {GateInputContext} ctx
 * @param {ApprovalPolicyMode} mode
 */
function evaluateApprovalGate(gateId, ctx, mode) {
  const validationRequired = true;
  let humanRequired = true;
  /** @type {(typeof APPROVAL_SKIPPED_REASON_CODES)[number] | null} */
  let skipReason = null;

  if (mode === "required") {
    humanRequired = true;
  } else if (mode === "auto") {
    humanRequired = false;
    skipReason = "POLICY_AUTO_MODE";
  } else if (mode === "preview_only") {
    humanRequired = !ctx.preview_acknowledged;
    if (!humanRequired) skipReason = "POLICY_PREVIEW_ACKNOWLEDGED";
  } else if (mode === "risk_based") {
    if (gateId === "product_scope") {
      const epicReady =
        ctx.input_type === "epic" &&
        ctx.required_fields_present &&
        ctx.unresolved_assumptions === 0 &&
        ctx.risk_level === "low";
      const forceHuman =
        ctx.input_type === "idea" ||
        !ctx.required_fields_present ||
        ctx.unresolved_assumptions > 0 ||
        ctx.scope_changes_detected ||
        ctx.risk_level !== "low";
      humanRequired = !epicReady || forceHuman;
      if (!humanRequired) skipReason = "POLICY_EPIC_LOW_RISK";
    } else if (gateId === "architecture_plan") {
      const areas = ctx.affected_areas || [];
      const highTouch = areas.some((a) => HIGH_RISK_AREAS.has(a));
      const forceHuman =
        highTouch ||
        ctx.migration_required ||
        ctx.rollback_plan_missing ||
        ctx.risk_level === "medium" ||
        ctx.risk_level === "high";
      humanRequired = forceHuman;
      if (!humanRequired) skipReason = "POLICY_EPIC_LOW_RISK";
    } else {
      humanRequired = ctx.input_type === "idea" || ctx.risk_level !== "low" || !ctx.required_fields_present;
      if (!humanRequired) skipReason = "POLICY_EPIC_LOW_RISK";
    }
  }

  let validationPassed = false;
  if (gateId === "product_scope") {
    validationPassed =
      ctx.scope_validation_passed === true ||
      (ctx.validation_passed === true && ctx.required_fields_present);
  } else if (gateId === "architecture_plan") {
    validationPassed = ctx.architecture_validation_passed === true || ctx.validation_passed === true;
  } else {
    validationPassed =
      (ctx.scope_validation_passed === true || ctx.validation_passed === true) &&
      (ctx.architecture_validation_passed === true || ctx.input_type === "task");
  }

  return {
    gate_id: gateId,
    policy_mode: mode,
    validation_required: validationRequired,
    validation_passed: validationPassed,
    human_required: humanRequired,
    skip_reason_code: humanRequired ? null : skipReason,
  };
}

/**
 * @param {object} opts
 * @param {ApprovalGateId} opts.gate_id
 * @param {ApprovalPolicyMode} opts.policy_mode
 * @param {(typeof APPROVAL_SKIPPED_REASON_CODES)[number]} opts.reason_code
 * @param {string} [opts.agent]
 * @param {number} [opts.iteration]
 * @param {string} [opts.step_id]
 * @param {"low"|"medium"|"high"} [opts.risk_level]
 * @param {string[]} [opts.artifact_refs]
 */
function buildApprovalSkippedPayload(opts) {
  const gate_id = opts.gate_id;
  if (!APPROVAL_GATE_IDS.includes(gate_id)) {
    throw new Error(`invalid approval_skipped gate_id: ${gate_id}`);
  }
  const policy_mode = opts.policy_mode;
  if (!APPROVAL_POLICY_MODES.includes(policy_mode)) {
    throw new Error(`invalid approval_skipped policy_mode: ${policy_mode}`);
  }
  const reason_code = opts.reason_code;
  if (!APPROVAL_SKIPPED_REASON_CODES.includes(reason_code)) {
    throw new Error(`invalid approval_skipped reason_code: ${reason_code}`);
  }
  /** @type {Record<string, unknown>} */
  const row = {
    event: "approval_skipped",
    agent: String(opts.agent || "orchestrator").slice(0, 128),
    iteration: Number.isFinite(opts.iteration)
      ? Math.max(0, Math.floor(/** @type {number} */ (opts.iteration)))
      : 0,
    gate_id,
    policy_mode,
    reason_code,
    approval_id: randomUUID(),
  };
  if (opts.step_id) row.step_id = String(opts.step_id).slice(0, 240);
  if (opts.risk_level && RISK_LEVELS.includes(opts.risk_level)) row.risk_level = opts.risk_level;
  if (opts.artifact_refs && opts.artifact_refs.length) {
    row.artifact_refs = opts.artifact_refs.map((r) => String(r).slice(0, 200)).slice(0, 8);
  }
  return row;
}

/**
 * @param {ApprovalGateId} gateId
 * @param {GateInputContext} ctx
 */
function humanGrantForGate(gateId, ctx) {
  if (gateId === "product_scope") return ctx.human_product_scope_granted === true;
  if (gateId === "architecture_plan") return ctx.human_architecture_granted === true;
  if (gateId === "dev_execution") return ctx.human_dev_execution_granted === true;
  return false;
}

/**
 * Fail-closed: DEV may run only when validations pass and human gates are satisfied or policy-traced skip applies.
 *
 * @param {GateInputContext} ctx
 * @param {ReturnType<typeof loadApprovalPolicyFromEnv>} policy
 */
function evaluateDevExecutionGate(ctx, policy) {
  const normalized = normalizeGateContext(ctx);
  const gates = /** @type {ApprovalGateId[]} */ ([
    "product_scope",
    "architecture_plan",
    "dev_execution",
  ]);
  /** @type {ReturnType<typeof evaluateApprovalGate>[]} */
  const evaluations = [];
  /** @type {Record<string, unknown>[]} */
  const traceSkips = [];

  for (const gateId of gates) {
    const mode = policy[gateId] || "risk_based";
    const ev = evaluateApprovalGate(gateId, normalized, mode);
    evaluations.push(ev);

    if (!ev.validation_passed) {
      return {
        allowed: false,
        reason: `${gateId}: validation not passed`,
        evaluations,
        traceSkips,
      };
    }

    if (ev.human_required) {
      if (!humanGrantForGate(gateId, normalized)) {
        return {
          allowed: false,
          reason: `${gateId}: human approval required`,
          evaluations,
          traceSkips,
        };
      }
    } else if (ev.skip_reason_code) {
      traceSkips.push(
        buildApprovalSkippedPayload({
          gate_id: gateId,
          policy_mode: mode,
          reason_code: ev.skip_reason_code,
          risk_level: normalized.risk_level,
        }),
      );
    }
  }

  return { allowed: true, reason: null, evaluations, traceSkips };
}

/**
 * CERBERUS helper: detect policy-external skip (human bypass without traced skip/grant).
 *
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 */
function cerberusDetectInvalidApprovalBypass(rows) {
  const skippedGates = new Set();
  const grantedGates = new Set();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (r.event === "approval_skipped" && typeof r.gate_id === "string") {
      skippedGates.add(r.gate_id);
    }
    if (r.event === "approval_granted" && typeof r.gate_id === "string") {
      grantedGates.add(r.gate_id);
    }
  }
  /** @type {string[]} */
  const findings = [];
  for (const gateId of APPROVAL_GATE_IDS) {
    if (!skippedGates.has(gateId) && !grantedGates.has(gateId)) {
      findings.push(`missing_policy_trace_for_${gateId}`);
    }
  }
  return { invalid: findings.length > 0, findings };
}

module.exports = {
  APPROVAL_POLICY_MODES,
  APPROVAL_GATE_IDS,
  APPROVAL_SKIPPED_REASON_CODES,
  DEFAULT_APPROVAL_POLICY,
  normalizeGateContext,
  parseGateFieldsFromHandoffYaml,
  buildGateContextFromArtifacts,
  loadApprovalPolicyFromEnv,
  evaluateApprovalGate,
  buildApprovalSkippedPayload,
  evaluateDevExecutionGate,
  cerberusDetectInvalidApprovalBypass,
};
