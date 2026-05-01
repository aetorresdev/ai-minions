# Failure semantics contract

Unified classification for **`iteration_done`** traces: stable **`transition_reason.reason_code`**, coarse **`failure_type`**, dashboard **`failure_axis`**, and **`outcome`**. This document is the **entry point** for operators and implementers; detailed tables and trace-field prose live in linked docs and tests.

## Canonical sources (read in this order)

1. **Trace schema (machine validation):** `orchestrator/schemas/trace-v2-line.schema.json` — enums for `iteration_done.transition_reason`, `failure_type`, `failure_axis`.
2. **Writer implementations:** `orchestrator/orchestrator.js` — `TRANSITION_REASON_CODES`, `FAILURE_TYPES`, `FAILURE_AXES`, `transitionReason()`, `inferReasonCode()`, `failureTypeForIterationDone()`, `failureAxisForIterationDone()`, `composeIterationDonePayload()`, `traceIterationDone()`.
3. **Semantics and dashboard mapping:** [strict-mode.md](./strict-mode.md) § *`iteration_done`*, *Writer invariant*, *Canonical dashboard mapping* (`reason_code` → `failure_type` + `failure_axis`).
4. **Consumption (CLI / exports):** [dashboard-failure-taxonomy.md](./dashboard-failure-taxonomy.md) — policy order, batch fields, reader tolerance.
5. **Public catalog re-exports** (for tools and tests): `FAILURE_TYPES`, `FAILURE_AXES`, `TRANSITION_REASON_CODES` on the orchestrator module exports.

## Writer contract

- Every **`iteration_done`** line emitted by the runner must go through **`traceIterationDone()`** → **`composeIterationDonePayload()`** so **`reason_code`** is always a member of the closed catalog and schema validation can succeed.
- **Non-success outcomes** (`outcome` ≠ `done`) must carry **`failure_type`** and **`failure_axis`** as computed by the mappers (schema enforces **`failure_type`** when outcome is not `done`).
- **Drill-down** is always **`transition_reason.reason_code`**, not **`failure_type` alone** — several flows share `contract_mismatch`; see strict-mode policy table.
- New terminal paths: extend **`inferReasonCode()`**, **`TRANSITION_REASON_CODES`**, the JSON Schema enum, **strict-mode** mapping table, **`tests/traceSchema.test.js`** (failure taxonomy matrix), and **`tests/iterationDoneEmitterContract.test.js`** (emitter paths). See strict-mode **Maintenance** paragraph.

## Reader contract (dashboards, batch export, jq)

- **`summarizeFailureTaxonomyFromRows()`** in `orchestrator/token-trace-report.js` aggregates counts by string keys; unknown or legacy **`reason_code`** / missing fields are counted under literals such as **`(missing_reason_code)`** rather than failing the pipeline — see [dashboard-failure-taxonomy.md](./dashboard-failure-taxonomy.md) § *Reader tolerance*.
- **Chart policy:** `reason_code` first, then **`failure_axis`**, then **`failure_type`** — same file § *Chart order*.

## Test anchors

| Area | File |
|------|------|
| Schema accepts representative lines | `orchestrator/tests/traceSchema.test.js` |
| Catalog × mapper matrix (`failureTypeForIterationDone` / `failureAxisForIterationDone`) | `orchestrator/tests/traceSchema.test.js` — *failure taxonomy matrix covers catalog reason_code × outcome paths* |
| Emitter paths (`composeIterationDonePayload` + schema-valid rows) | `orchestrator/tests/iterationDoneEmitterContract.test.js` |
| Taxonomy aggregation on parsed rows | `orchestrator/tests/scenarioMetricsExport.test.js` |

## Out of scope here

Trace redaction and secret-handling policy, network egress controls, and model routing behavior — unchanged by this failure classification contract (see [strict-mode.md](./strict-mode.md) and `orchestrator/trace-redact.js` for redaction).
