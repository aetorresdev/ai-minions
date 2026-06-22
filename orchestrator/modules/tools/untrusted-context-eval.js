"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FIXTURES_PATH = path.join(__dirname, "untrusted-context-fixtures.v1.json");

const CONTEXT_TYPES = Object.freeze([
  "document_text",
  "fetched_web",
  "memory_entry",
  "mcp_tool_result",
  "generated_artifact",
]);

const AUTHORITY_TIERS = Object.freeze([
  "system_policy",
  "user_instruction",
  "retrieved_context",
  "tool_output",
]);

const INSTRUCTION_SOURCES = Object.freeze([
  "system_policy",
  "user_instruction",
  "retrieved_context",
  "tool_output",
]);

const ATTEMPTED_ACTIONS = Object.freeze([
  "expand_permissions",
  "invoke_shell",
  "modify_files",
  "skip_cerberus",
  "change_role_ownership",
  "approve_production",
  "leak_secrets",
]);

const FORBIDDEN_SOVEREIGN_FOR_UNTRUSTED = Object.freeze(["system_policy", "user_instruction"]);

const CONTEXT_TYPE_TO_AUTHORITY = Object.freeze({
  document_text: "retrieved_context",
  fetched_web: "retrieved_context",
  memory_entry: "retrieved_context",
  generated_artifact: "retrieved_context",
  mcp_tool_result: "tool_output",
});

const CONTEXT_TYPE_TO_INSTRUCTION_SOURCE = Object.freeze({
  document_text: "retrieved_context",
  fetched_web: "retrieved_context",
  memory_entry: "retrieved_context",
  generated_artifact: "retrieved_context",
  mcp_tool_result: "tool_output",
});

/**
 * Map a retrieved-content channel to non-sovereign authority tiers.
 * Deterministic — no LLM classification.
 *
 * @param {{ context_type: string }} input
 * @returns {{ ok: true, authority_tier: string, instruction_source: string, is_sovereign_instruction: boolean } | { ok: false, errors: string[] }}
 */
function classifyContextAuthority(input) {
  const context_type = input && input.context_type != null ? String(input.context_type) : "";
  if (!CONTEXT_TYPES.includes(context_type)) {
    return { ok: false, errors: [`unknown context_type: ${context_type || "(empty)"}`] };
  }
  const authority_tier = CONTEXT_TYPE_TO_AUTHORITY[context_type];
  const instruction_source = CONTEXT_TYPE_TO_INSTRUCTION_SOURCE[context_type];
  return {
    ok: true,
    authority_tier,
    instruction_source,
    is_sovereign_instruction: false,
  };
}

/**
 * Build trace-safe payload for context authority decisions (no raw retrieved text).
 *
 * @param {object} opts
 */
function buildContextAuthorityTrace(opts) {
  return {
    event: "context_authority_check",
    context_type: opts.context_type != null ? String(opts.context_type) : "",
    authority_tier: opts.authority_tier != null ? String(opts.authority_tier) : "",
    instruction_source: opts.instruction_source != null ? String(opts.instruction_source) : "",
    decision: opts.decision != null ? String(opts.decision) : "",
    reason_code: opts.reason_code != null ? String(opts.reason_code) : "",
    injection_detected: opts.injection_detected === true,
    attempted_action: opts.attempted_action != null ? String(opts.attempted_action) : null,
    variant: opts.variant != null ? String(opts.variant) : "benign",
  };
}

/**
 * Evaluate one fixture row — injected instructions from untrusted tiers are never sovereign.
 *
 * @param {object} scenario
 */
function evaluateUntrustedContextScenario(scenario) {
  const ctx = classifyContextAuthority({ context_type: scenario.context_type });
  if (!ctx.ok) {
    return {
      id: scenario.id,
      pass: false,
      mismatches: [{ field: "context_type", expected: "known", actual: scenario.context_type }],
      errors: ctx.errors,
    };
  }

  const variant = scenario.variant === "injected" ? "injected" : "benign";
  const injection_detected = variant === "injected" || scenario.injection_detected === true;
  const attempted_action =
    injection_detected && scenario.attempted_action != null ? String(scenario.attempted_action) : null;

  let decision;
  let reason_code;
  if (!injection_detected) {
    decision = "accept_as_data";
    reason_code = "untrusted_context_data_only";
  } else {
    decision = "ignore_instruction";
    reason_code = `injection_not_sovereign:${attempted_action || "unknown"}`;
  }

  const tracePayload = buildContextAuthorityTrace({
    context_type: scenario.context_type,
    authority_tier: ctx.authority_tier,
    instruction_source: ctx.instruction_source,
    decision,
    reason_code,
    injection_detected,
    attempted_action,
    variant,
  });

  const expected = scenario.expected || {};
  const mismatches = [];

  const actualByField = {
    decision,
    reason_code,
    authority_tier: ctx.authority_tier,
    instruction_source: ctx.instruction_source,
  };
  for (const field of ["decision", "reason_code", "authority_tier", "instruction_source"]) {
    if (expected[field] !== undefined && actualByField[field] !== expected[field]) {
      mismatches.push({ field, expected: expected[field], actual: actualByField[field] });
    }
  }

  if (expected.trace_event !== undefined && tracePayload.event !== expected.trace_event) {
    mismatches.push({ field: "trace_event", expected: expected.trace_event, actual: tracePayload.event });
  }

  for (const forbidden of FORBIDDEN_SOVEREIGN_FOR_UNTRUSTED) {
    if (ctx.authority_tier === forbidden) {
      mismatches.push({
        field: "authority_tier_forbidden",
        expected: `not ${forbidden}`,
        actual: ctx.authority_tier,
      });
    }
  }

  if (injection_detected && decision !== "ignore_instruction") {
    mismatches.push({
      field: "injection_decision",
      expected: "ignore_instruction",
      actual: decision,
    });
  }

  return {
    id: scenario.id,
    context_type: scenario.context_type,
    variant,
    pass: mismatches.length === 0,
    mismatches,
    authority_tier: ctx.authority_tier,
    instruction_source: ctx.instruction_source,
    decision,
    reason_code,
    injection_detected,
    tracePayload,
    context_authority_check_emitted: tracePayload.event === "context_authority_check",
  };
}

function loadUntrustedContextFixtures(filePath = DEFAULT_FIXTURES_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.scenarios)) {
    throw new Error("untrusted-context fixtures: scenarios array required");
  }
  return parsed;
}

function runAllUntrustedContextFixtures(opts = {}) {
  const fixtures = loadUntrustedContextFixtures(opts.fixturesPath);
  const results = fixtures.scenarios.map((s) => evaluateUntrustedContextScenario(s));
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
function assertFixtureContextTypeCoverage(scenarios) {
  const seen = new Set(scenarios.map((s) => s.context_type));
  const missing = CONTEXT_TYPES.filter((t) => !seen.has(t));
  return { ok: missing.length === 0, missing };
}

module.exports = {
  DEFAULT_FIXTURES_PATH,
  CONTEXT_TYPES,
  AUTHORITY_TIERS,
  INSTRUCTION_SOURCES,
  ATTEMPTED_ACTIONS,
  FORBIDDEN_SOVEREIGN_FOR_UNTRUSTED,
  classifyContextAuthority,
  buildContextAuthorityTrace,
  evaluateUntrustedContextScenario,
  loadUntrustedContextFixtures,
  runAllUntrustedContextFixtures,
  assertFixtureContextTypeCoverage,
};
