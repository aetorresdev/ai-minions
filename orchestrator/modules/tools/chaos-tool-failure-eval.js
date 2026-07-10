"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FIXTURES_PATH = path.join(__dirname, "chaos-tool-failure-fixtures.v1.json");

const FAILURE_MODES = Object.freeze([
  "mcp_timeout",
  "mcp_unreachable",
  "malformed_tool_response",
  "partial_truncated_response",
  "permission_denied_mid_invoke",
  "empty_payload",
]);

const FAILURE_MODE_TAXONOMY = Object.freeze({
  mcp_timeout: {
    reason_code: "TOOL_FAILURE_MCP_TIMEOUT",
    failure_type: "timeout",
  },
  mcp_unreachable: {
    reason_code: "TOOL_FAILURE_MCP_UNREACHABLE",
    failure_type: "unreachable",
  },
  malformed_tool_response: {
    reason_code: "TOOL_FAILURE_MALFORMED_RESPONSE",
    failure_type: "malformed_payload",
  },
  partial_truncated_response: {
    reason_code: "TOOL_FAILURE_PARTIAL_RESPONSE",
    failure_type: "malformed_payload",
  },
  permission_denied_mid_invoke: {
    reason_code: "TOOL_FAILURE_PERMISSION_DENIED",
    failure_type: "permission_denied",
  },
  empty_payload: {
    reason_code: "TOOL_FAILURE_EMPTY_PAYLOAD",
    failure_type: "empty_payload",
  },
});

const UNKNOWN_FAILURE = Object.freeze({
  reason_code: "TOOL_FAILURE_UNKNOWN",
  failure_type: "unknown",
  decision: "fail_closed",
});

const FIXTURE_EVIDENCE_SOURCE = "fixture";
const FIXTURE_EVIDENCE_TRUST = "deterministic_stub";

const FAILURE_MODE_OPERATOR_SURFACE = Object.freeze({
  mcp_timeout: {
    operator_explanation: "MCP tool call timed out before a response was received.",
    next_safe_action: "retry_with_backoff_or_check_mcp_server",
  },
  mcp_unreachable: {
    operator_explanation: "MCP server was unreachable — connection refused in stub.",
    next_safe_action: "verify_mcp_server_running_and_network_path",
  },
  malformed_tool_response: {
    operator_explanation: "Tool returned a payload that could not be parsed as valid JSON.",
    next_safe_action: "inspect_tool_contract_or_retry_with_valid_schema",
  },
  partial_truncated_response: {
    operator_explanation: "Tool returned a truncated payload — incomplete JSON.",
    next_safe_action: "request_compact_response_or_paginate_tool_output",
  },
  permission_denied_mid_invoke: {
    operator_explanation: "Tool invoke was blocked by permission policy after classification.",
    next_safe_action: "review_permission_profile_or_escalate_to_operator",
  },
  empty_payload: {
    operator_explanation: "Tool returned an empty response body.",
    next_safe_action: "verify_tool_implementation_or_retry_with_explicit_fields",
  },
});

const UNKNOWN_OPERATOR_SURFACE = Object.freeze({
  operator_explanation: "Tool failure could not be classified to a known failure mode.",
  next_safe_action: "escalate_to_operator",
});

/**
 * Deterministic stub — simulates tool/MCP failure modes without live network.
 *
 * @param {object} scenario fixture row
 * @returns {object}
 */
function simulateToolFailure(scenario) {
  const failure_mode =
    scenario && scenario.failure_mode != null ? String(scenario.failure_mode) : "";
  const tool_id = scenario && scenario.tool_id != null ? String(scenario.tool_id) : "stub_mcp";

  if (!FAILURE_MODES.includes(failure_mode)) {
    return {
      ok: false,
      tool_id,
      failure_mode,
      phase: "classify",
      unclassified: true,
      transport_error: `unknown failure_mode: ${failure_mode || "(empty)"}`,
    };
  }

  switch (failure_mode) {
    case "mcp_timeout":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "transport",
        transport_error: "timeout",
        elapsed_ms: Number(scenario.timeout_ms) || 30000,
      };
    case "mcp_unreachable":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "transport",
        transport_error: "connection_refused",
      };
    case "malformed_tool_response":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "response",
        raw_response: scenario.response_hint != null ? String(scenario.response_hint) : "{ invalid json",
        parse_error: "invalid_json",
      };
    case "partial_truncated_response":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "response",
        raw_response:
          scenario.response_hint != null ? String(scenario.response_hint) : '{"result": "partial',
        parse_error: "truncated_json",
      };
    case "permission_denied_mid_invoke":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "invoke",
        permission_denied: true,
        permission_profile:
          scenario.permission_profile != null ? String(scenario.permission_profile) : "ci-safe",
      };
    case "empty_payload":
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "response",
        raw_response: "",
        parse_error: "empty_payload",
      };
    default:
      return {
        ok: false,
        tool_id,
        failure_mode,
        phase: "classify",
        unclassified: true,
        transport_error: "unknown",
      };
  }
}

/**
 * Map simulation outcome to stable reason_code and failure_type.
 *
 * @param {object} scenario
 * @param {object} simulation
 * @returns {{ reason_code: string, failure_type: string, decision: string }}
 */
function classifyToolFailure(scenario, simulation) {
  if (simulation && simulation.unclassified === true) {
    return { ...UNKNOWN_FAILURE };
  }

  const failure_mode =
    scenario && scenario.failure_mode != null ? String(scenario.failure_mode) : "";
  const taxonomy = FAILURE_MODE_TAXONOMY[failure_mode];
  if (!taxonomy) {
    return { ...UNKNOWN_FAILURE };
  }

  return {
    reason_code: taxonomy.reason_code,
    failure_type: taxonomy.failure_type,
    decision: "fail_closed",
  };
}

/**
 * Stable operator-facing explanation and recovery action per failure mode.
 *
 * @param {string} failure_mode
 * @returns {{ operator_explanation: string, next_safe_action: string }}
 */
function resolveToolFailureOperatorSurface(failure_mode) {
  const mode = failure_mode != null ? String(failure_mode) : "";
  const surface = FAILURE_MODE_OPERATOR_SURFACE[mode];
  if (surface) {
    return {
      operator_explanation: surface.operator_explanation,
      next_safe_action: surface.next_safe_action,
    };
  }
  return {
    operator_explanation: UNKNOWN_OPERATOR_SURFACE.operator_explanation,
    next_safe_action: UNKNOWN_OPERATOR_SURFACE.next_safe_action,
  };
}

/**
 * Build trace-safe payload for tool failure eval (no raw tool response bodies).
 *
 * @param {object} opts
 */
function buildToolFailureTrace(opts) {
  const operatorSurface = resolveToolFailureOperatorSurface(opts.failure_mode);
  return {
    event: "tool_failure_eval",
    scenario_id: opts.scenario_id != null ? String(opts.scenario_id) : "",
    tool_id: opts.tool_id != null ? String(opts.tool_id) : "",
    failure_mode: opts.failure_mode != null ? String(opts.failure_mode) : "",
    failure_axis: "tool",
    failure_type: opts.failure_type != null ? String(opts.failure_type) : "",
    reason_code: opts.reason_code != null ? String(opts.reason_code) : "",
    decision: opts.decision != null ? String(opts.decision) : "fail_closed",
    source: opts.source != null ? String(opts.source) : FIXTURE_EVIDENCE_SOURCE,
    trust: opts.trust != null ? String(opts.trust) : FIXTURE_EVIDENCE_TRUST,
    operator_explanation:
      opts.operator_explanation != null
        ? String(opts.operator_explanation)
        : operatorSurface.operator_explanation,
    next_safe_action:
      opts.next_safe_action != null ? String(opts.next_safe_action) : operatorSurface.next_safe_action,
    evidence_path: opts.evidence_path != null ? String(opts.evidence_path) : "",
    phase: opts.phase != null ? String(opts.phase) : "",
  };
}

/**
 * Evaluate one fixture row — deterministic classification and trace emission.
 *
 * @param {object} scenario
 */
function evaluateChaosToolFailureScenario(scenario) {
  const simulation = simulateToolFailure(scenario);
  const classification = classifyToolFailure(scenario, simulation);
  const scenario_id = scenario.id != null ? String(scenario.id) : "";
  const tool_id = scenario.tool_id != null ? String(scenario.tool_id) : simulation.tool_id;

  const tracePayload = buildToolFailureTrace({
    scenario_id,
    tool_id,
    failure_mode: scenario.failure_mode,
    failure_type: classification.failure_type,
    reason_code: classification.reason_code,
    decision: classification.decision,
    evidence_path: `fixture:${scenario_id}`,
    phase: simulation.phase || "",
  });

  const expected = scenario.expected || {};
  const mismatches = [];

  const actualByField = {
    reason_code: classification.reason_code,
    failure_type: classification.failure_type,
    decision: classification.decision,
    source: tracePayload.source,
    trust: tracePayload.trust,
    operator_explanation: tracePayload.operator_explanation,
    next_safe_action: tracePayload.next_safe_action,
  };

  for (const field of [
    "reason_code",
    "failure_type",
    "decision",
    "source",
    "trust",
    "operator_explanation",
    "next_safe_action",
  ]) {
    if (expected[field] !== undefined && actualByField[field] !== expected[field]) {
      mismatches.push({ field, expected: expected[field], actual: actualByField[field] });
    }
  }

  if (expected.trace_event !== undefined && tracePayload.event !== expected.trace_event) {
    mismatches.push({ field: "trace_event", expected: expected.trace_event, actual: tracePayload.event });
  }

  if (tracePayload.failure_axis !== "tool") {
    mismatches.push({ field: "failure_axis", expected: "tool", actual: tracePayload.failure_axis });
  }

  if (classification.decision !== "fail_closed") {
    mismatches.push({
      field: "decision_fail_closed",
      expected: "fail_closed",
      actual: classification.decision,
    });
  }

  if (simulation.ok === true) {
    mismatches.push({ field: "simulation", expected: "failure stub", actual: "ok:true" });
  }

  return {
    id: scenario_id,
    failure_mode: scenario.failure_mode,
    pass: mismatches.length === 0,
    mismatches,
    reason_code: classification.reason_code,
    failure_type: classification.failure_type,
    decision: classification.decision,
    simulation,
    tracePayload,
    tool_failure_eval_payload_produced: tracePayload.event === "tool_failure_eval",
  };
}

function loadChaosToolFailureFixtures(filePath = DEFAULT_FIXTURES_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.scenarios)) {
    throw new Error("chaos-tool-failure fixtures: scenarios array required");
  }
  return parsed;
}

function runAllChaosToolFailureFixtures(opts = {}) {
  const fixtures = loadChaosToolFailureFixtures(opts.fixturesPath);
  const results = fixtures.scenarios.map((s) => evaluateChaosToolFailureScenario(s));
  const failed = results.filter((r) => !r.pass);
  return {
    version: fixtures.version,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
}

/**
 * @param {object[]} scenarios
 * @returns {{ ok: boolean, missing: string[] }}
 */
function assertFixtureFailureModeCoverage(scenarios) {
  const seen = new Set(scenarios.map((s) => s.failure_mode));
  const missing = FAILURE_MODES.filter((m) => !seen.has(m));
  return { ok: missing.length === 0, missing };
}

module.exports = {
  DEFAULT_FIXTURES_PATH,
  FAILURE_MODES,
  FAILURE_MODE_TAXONOMY,
  UNKNOWN_FAILURE,
  FIXTURE_EVIDENCE_SOURCE,
  FIXTURE_EVIDENCE_TRUST,
  FAILURE_MODE_OPERATOR_SURFACE,
  UNKNOWN_OPERATOR_SURFACE,
  simulateToolFailure,
  classifyToolFailure,
  resolveToolFailureOperatorSurface,
  buildToolFailureTrace,
  evaluateChaosToolFailureScenario,
  loadChaosToolFailureFixtures,
  runAllChaosToolFailureFixtures,
  assertFixtureFailureModeCoverage,
};
