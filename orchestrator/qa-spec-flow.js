/**
 * QA_SPEC → DEV → QA_EXEC acceptance-first flow (multi_agent).
 * sync: docs/orchestrator/qa-spec-before-dev-contract.md
 */

"use strict";

const DEV_AGENT_RE = /^dev-(backend|frontend|devops)$/;

/** Default QA_SPEC task when the plan is normalized. */
const QA_SPEC_DEFAULT_TASK =
  "Define acceptance criteria and validation strategy before implementation (QA_SPEC). " +
  "Output test_strategy, acceptance_criteria, required_tests, edge_cases, non_goals, and validation_commands. " +
  "Do not write or modify production code.";

/**
 * @param {string} [flowMode]
 * @returns {boolean}
 */
function isQaSpecBeforeDevEnabled(flowMode) {
  if (flowMode !== "multi_agent") return false;
  if (process.env.ORCH_QA_SPEC_BEFORE_DEV === "0") return false;
  return true;
}

/**
 * @param {{ agentId?: string, qaPhase?: string }} step
 * @returns {"spec"|"exec"|null}
 */
function qaPhaseFromStep(step) {
  if (!step || step.agentId !== "qa") return null;
  const p = step.qaPhase != null ? String(step.qaPhase).trim().toLowerCase() : "";
  if (p === "spec" || p === "exec") return p;
  return null;
}

/**
 * Resolve handoff / MODE label for compact_handoff and validateHandoffStructure.
 * @param {string} agentId
 * @param {{ qaPhase?: string } | null | undefined} step
 * @param {string} fallbackMode — from AGENT_TO_MODE
 * @returns {string}
 */
function resolveHandoffMode(agentId, step, fallbackMode) {
  if (agentId !== "qa") return fallbackMode;
  const p = step?.qaPhase != null ? String(step.qaPhase).trim().toLowerCase() : "";
  if (p === "spec") return "QA_SPEC";
  if (p === "exec") return "QA_EXEC";
  return "QA";
}

/**
 * Insert QA_SPEC before first dev-* when enabled and missing.
 * Mark qa before first dev as spec; qa at/after first dev as exec.
 * @param {{ agentId?: string, task?: string, qaPhase?: string }[]} steps
 * @param {{ enabled?: boolean }} [opts]
 * @returns {typeof steps}
 */
function applyQaSpecBeforeDevPlan(steps, { enabled = true } = {}) {
  if (!enabled || !Array.isArray(steps) || steps.length === 0) return steps;

  const out = steps.map((s) => ({ ...s }));
  const firstDevIdx = out.findIndex((s) => s.agentId && DEV_AGENT_RE.test(String(s.agentId).trim()));

  if (firstDevIdx < 0) return out;

  let hasSpecBeforeDev = false;
  for (let i = 0; i < out.length; i++) {
    if (out[i].agentId !== "qa") continue;
    if (i < firstDevIdx) {
      out[i] = { ...out[i], qaPhase: "spec" };
      hasSpecBeforeDev = true;
    } else if (!out[i].qaPhase) {
      out[i] = { ...out[i], qaPhase: "exec" };
    }
  }

  if (!hasSpecBeforeDev) {
    out.splice(firstDevIdx, 0, {
      agentId: "qa",
      qaPhase: "spec",
      task: QA_SPEC_DEFAULT_TASK,
    });
  }

  return out;
}

/**
 * Shallow parse verdict from handoff YAML (QA_EXEC).
 * @param {string} yaml
 * @returns {string|null}
 */
function shallowHandoffVerdict(yaml) {
  if (!yaml || !yaml.trim()) return null;
  const top = yaml.match(/^verdict\s*:\s*(\S+)/im);
  if (top) return top[1].trim().toLowerCase();
  const nested = yaml.match(/^\s{1,12}verdict\s*:\s*(\S+)/im);
  if (nested) return nested[1].trim().toLowerCase();
  return null;
}

/**
 * Collect top-level YAML keys (shallow).
 * @param {string} yaml
 * @returns {Set<string>}
 */
function handoffTopKeys(yaml) {
  const presentKeys = new Set();
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{0,2}(\w[\w_-]*):/);
    if (m) presentKeys.add(m[1]);
  }
  return presentKeys;
}

function yamlHasKey(yaml, key) {
  const presentKeys = handoffTopKeys(yaml);
  if (presentKeys.has(key)) return true;
  return new RegExp(`(^|\\n)\\s{1,12}${key}\\s*:`, "m").test(yaml);
}

/**
 * @param {string} mode
 * @param {string} yaml
 * @param {{ strict?: boolean, requireQaSpecRef?: boolean }} opts
 * @returns {{ valid: boolean, reason: string }}
 */
function validateHandoffForMode(mode, yaml, opts = {}) {
  const { strict = false, requireQaSpecRef = false } = opts;
  if (!yaml || !yaml.trim()) {
    if (strict) {
      return {
        valid: false,
        reason: `${mode} handoff is empty — compact_handoff must be called before advance_mode in strict mode`,
      };
    }
    return { valid: true, reason: "" };
  }

  const presentKeys = handoffTopKeys(yaml);

  if (mode === "DEV") {
    const hasTop = presentKeys.has("files_modified") || presentKeys.has("validation_run");
    const hasNested =
      /(^|\n)\s{1,12}files_modified\s*:/m.test(yaml) || /(^|\n)\s{1,12}validation_run\s*:/m.test(yaml);
    if (!hasTop && !hasNested) {
      return { valid: false, reason: "DEV handoff must include files_modified or validation_run" };
    }
    if (requireQaSpecRef && !yamlHasKey(yaml, "acceptance_criteria") && !yamlHasKey(yaml, "qa_spec_ref")) {
      return {
        valid: false,
        reason: "DEV handoff must include acceptance_criteria or qa_spec_ref after QA_SPEC in this iteration",
      };
    }
    return { valid: true, reason: "" };
  }

  if (mode === "QA_SPEC") {
    if (!yamlHasKey(yaml, "acceptance_criteria")) {
      return { valid: false, reason: "QA_SPEC handoff must include acceptance_criteria" };
    }
    if (!yamlHasKey(yaml, "test_strategy") && !yamlHasKey(yaml, "required_tests")) {
      return { valid: false, reason: "QA_SPEC handoff must include test_strategy or required_tests" };
    }
    if (!yamlHasKey(yaml, "validation_commands")) {
      return { valid: false, reason: "QA_SPEC handoff must include validation_commands" };
    }
    return { valid: true, reason: "" };
  }

  if (mode === "QA_EXEC" || mode === "QA") {
    if (!presentKeys.has("verdict") && !/(^|\n)\s{1,12}verdict\s*:/m.test(yaml)) {
      return { valid: false, reason: `${mode} handoff must include verdict` };
    }
    const hasFindings =
      presentKeys.has("findings") ||
      presentKeys.has("issues") ||
      /(^|\n)\s{1,12}(findings|issues)\s*:/m.test(yaml);
    if (!hasFindings) {
      return { valid: false, reason: `${mode} handoff must include findings or issues` };
    }
    return { valid: true, reason: "" };
  }

  return { valid: true, reason: "" };
}

/**
 * @param {string} handoffMode
 * @param {boolean} passed
 * @param {string} [handoffYaml]
 * @returns {Record<string, unknown>}
 */
function qaSpecFlowTraceExtras(handoffMode, passed, handoffYaml = "") {
  if (handoffMode === "QA_SPEC" && passed) {
    return { event: "qa_spec_emitted", qa_phase: "spec" };
  }
  if (handoffMode === "QA_EXEC" && passed) {
    const verdict = shallowHandoffVerdict(handoffYaml);
    return {
      event: "qa_exec_verdict",
      qa_phase: "exec",
      ...(verdict ? { verdict } : {}),
    };
  }
  return {};
}

module.exports = {
  QA_SPEC_DEFAULT_TASK,
  isQaSpecBeforeDevEnabled,
  qaPhaseFromStep,
  resolveHandoffMode,
  applyQaSpecBeforeDevPlan,
  validateHandoffForMode,
  shallowHandoffVerdict,
  qaSpecFlowTraceExtras,
  DEV_AGENT_RE,
};
