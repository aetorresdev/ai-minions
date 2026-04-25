"use strict";

/**
 * Trace writer contract: every `iteration_done` path wired in `run()` must use `transitionReason()`
 * plus `composeIterationDonePayload()` so `reason_code` stays on the closed catalog and the row
 * passes trace-v2 JSON Schema (see `tests/traceSchema.test.js` matrix and `strict-mode.md`).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { validateTraceLine } = require("../trace-schema");
const { transitionReason, composeIterationDonePayload } = require("../orchestrator");

const BASE_TS = {
  ts: "2026-04-28T12:00:00.000Z",
  ts_ms: 1714305600000,
  trace_schema_version: "2",
  task_id: "emitter-contract-test",
};

function assertSchemaValid(payload) {
  const row = { ...BASE_TS, ...payload };
  const v = validateTraceLine(row);
  assert.equal(v.ok, true, (v.errors || []).join(" | "));
}

test("composeIterationDonePayload rejects missing or unknown reason_code", () => {
  assert.throws(
    () =>
      composeIterationDonePayload(1, "iterate", {
        transition_reason: { type: "ITERATE", reason_code: "NOT_IN_CATALOG" },
      }),
    /not in catalog/,
  );
  assert.throws(
    () =>
      composeIterationDonePayload(1, "iterate", {
        transition_reason: { type: "ITERATE" },
      }),
    /not in catalog/,
  );
});

test("emitter paths used by run() — schema-valid iteration_done rows", () => {
  /** @type {Array<{ label: string, iteration: number, outcome: string, tr: ReturnType<typeof transitionReason>, extra?: object, ctx?: object }>} */
  const cases = [
    { label: "plan cost guard", iteration: 0, outcome: "guard_abort", tr: transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), extra: { guard_phase: "plan" } },
    { label: "worker cost guard", iteration: 1, outcome: "guard_abort", tr: transitionReason("GUARD", "cost_limit", { reason_code: "GUARD_COST_LIMIT" }), extra: { guard_phase: "worker" } },
    {
      label: "step retry guard",
      iteration: 1,
      outcome: "guard_abort",
      tr: transitionReason("GUARD", "step_retry_limit", { reason_code: "GUARD_STEP_RETRY_LIMIT", gate_id: "dev-backend" }),
      extra: { max_step_retries: 3, agent_id: "dev-backend", retry_number: 2 },
    },
    {
      label: "cerberus blockers iterate (blocked by CERBERUS)",
      iteration: 1,
      outcome: "iterate",
      tr: transitionReason("GATE_BLOCK", "cerberus_blockers"),
      extra: { blockers: 2, corrections: 1 },
      ctx: { intent_ids: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"] },
    },
    {
      label: "orchestrator no corrections JSON (invalid correction path)",
      iteration: 1,
      outcome: "iterate_fallback",
      tr: transitionReason("ITERATE_FALLBACK", "orchestrator_no_corrections_json"),
      extra: { blockers: 1 },
    },
    {
      label: "max iterations cerberus cap",
      iteration: 3,
      outcome: "max_iterations_with_blockers",
      tr: transitionReason("MAX_ITERATIONS", "cerberus_blockers_cap"),
      extra: { blockers: 2 },
    },
    {
      label: "gate-blocked iterate — output/handoff validation class (GATE_ARTIFACT_OR_HANDOFF)",
      iteration: 1,
      outcome: "gate_blocked_iterate",
      tr: transitionReason("GATE_BLOCK", "artifact_contract_or_handoff", { step_id: "s1", gate_id: "output_contract" }),
      extra: { gate_blocks: 1 },
      ctx: { gateKinds: ["output_contract"] },
    },
    {
      label: "gate-blocked iterate — compact_handoff (tool_error)",
      iteration: 1,
      outcome: "gate_blocked_iterate",
      tr: transitionReason("GATE_BLOCK", "artifact_contract_or_handoff", { step_id: "s1", gate_id: "compact_handoff" }),
      extra: { gate_blocks: 1 },
      ctx: { gateKinds: ["compact_handoff"] },
    },
    {
      label: "max iterations gate-blocked artifacts",
      iteration: 3,
      outcome: "max_iterations_with_gate_blocks",
      tr: transitionReason("MAX_ITERATIONS", "gate_blocked_artifacts_cap"),
      extra: { gate_blocks: 2 },
    },
    { label: "run completed", iteration: 1, outcome: "done", tr: transitionReason("DONE"), extra: { summary: "ok" } },
    {
      label: "orchestrator decide corrections",
      iteration: 1,
      outcome: "iterate",
      tr: transitionReason("ITERATE", "orchestrator_decide_corrections"),
      extra: { corrections: 2 },
    },
    {
      label: "decide contract stopped",
      iteration: 1,
      outcome: "stopped",
      tr: transitionReason("CONTRACT_FAIL", "model returned invalid JSON"),
      extra: { summary: "bad" },
    },
    {
      label: "loop exhausted",
      iteration: 3,
      outcome: "loop_limit_stopped",
      tr: transitionReason("MAX_ITERATIONS", "loop_exhausted_without_done"),
      extra: { iterations: 3, max_iterations: 3 },
    },
    {
      label: "validation_fail generic (reserved early-exit; must still be schema-valid if emitted)",
      iteration: 1,
      outcome: "stopped",
      tr: transitionReason("VALIDATION_FAIL", "pre_flight_schema"),
      extra: { summary: "invalid" },
    },
  ];

  for (const c of cases) {
    const payload = composeIterationDonePayload(c.iteration, c.outcome, c.tr, c.extra || {}, c.ctx || {});
    assertSchemaValid(payload);
    assert.equal(
      payload.transition_reason.reason_code,
      c.tr.transition_reason.reason_code,
      `${c.label}: reason_code round-trip`,
    );
  }
});
