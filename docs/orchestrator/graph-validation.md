# Run-level trace graph validation

This document is the **canonical reference** for how the orchestrator validates the **step graph** over a single run’s JSONL (`validateTraceRunGraph` in `orchestrator/trace-schema.js`). Strict-mode CI uses the same function alongside per-line schema checks — see [strict-mode.md](strict-mode.md) § *Golden path (baseline trace)*.

## Purpose

- Catch **ordering and lifecycle mistakes** for `step_id` before they invalidate downstream tooling (explain-run, metrics, dashboards).
- Complement **JSON Schema** validation: schema checks shape per line; graph validation checks **cross-line** consistency.

## API

`validateTraceRunGraph(lines)` accepts an array of parsed trace line objects (same shape as after `JSON.parse` on each JSONL row).

**Return value (only shape):**

```ts
{
  ok: boolean;
  violations: Array<{
    type: string;
    step_id?: string | null;
    parent_step_id?: string;
    line_index?: number;
    to_step_id?: string;
    event?: string;
  }>;
  warnings: Array<{ type: string; ok?: boolean }>;
}
```

- **`ok`:** `true` iff `violations.length === 0` (warnings do not affect `ok`).
- **`violations`:** hard failures; see the table below.
- **`warnings`:** non-fatal signals only (e.g. `no_steps_emitted` when the run has lines but no non-empty `step_id` on any line).

## Step lifecycle rules (ordered)

1. **`agent_start`** registers `step_id`. A second `agent_start` for the same id is a violation: **`duplicate_step_id`**.
2. **`agent_done`** and other events (`gate_result`, `contract_fail`, …) may **reuse** a `step_id` already registered by `agent_start`; they do not register a new id.
3. A **non-empty** `step_id` requires a **non-empty** `event` string; otherwise **`missing_event_with_step_id`** (that line does not participate in registration).
4. A **non–`agent_start`** event whose `step_id` is not in the registry → **`step_id_unknown`**. The special case **`agent_done`** without a prior **`agent_start`** for that id → **`agent_done_without_start`**.
5. A **non-empty** `parent_step_id` must refer to a `step_id` present in the run’s **final** registry (all ids registered by any `agent_start` in the same `lines` array); otherwise **`orphan_parent`**. Membership is **not** checked in file order; **emit-time** writer checks (e.g. `assertParentStepExists`) are separate from this pass.
6. **Directed** edges `parent_step_id → step_id` (both endpoints in that registry) are checked for cycles; a cycle is **`cycle`** (first hit wins). **`parent_step_id === step_id`** counts as a cycle.

## Violation types (today)

| `type` | Meaning |
|--------|---------|
| `missing_event_with_step_id` | `step_id` is set but `event` is missing, null, or empty. |
| `duplicate_step_id` | Second `agent_start` reusing the same `step_id`. |
| `agent_done_without_start` | `agent_done` for a `step_id` that was never started. |
| `step_id_unknown` | Non-start event uses a `step_id` not in the registry (includes missing `agent_start`). |
| `orphan_parent` | `parent_step_id` is set but does not match any `step_id` registered via `agent_start` in this run. |
| `cycle` | A directed cycle exists in the parent→child edge set (both endpoints registered); includes `to_step_id` for the back edge target when applicable. |

### Warnings (non-fatal)

| `type` | When | Notes |
|--------|------|--------|
| `no_steps_emitted` | At least one input line, but **no** line carries a non-empty `step_id`. | Carries `ok: true`; top-level `ok` stays `true` if there are no violations. |

`line_index` is the 0-based index of the offending line in the input array when applicable.

## CI and fixtures

- **Golden path:** `orchestrator/tests/fixtures/golden-path-clean-v1.jsonl` is validated with `validateTraceRunGraph` in `orchestrator/tests/goldenPath.test.js`.
- **Unit tests:** graph cases live in `orchestrator/tests/traceSchema.test.js` (naming may vary — search for `validateTraceRunGraph`).

## Related contract prose

[agent-contract.md](agent-contract.md) § *Runtime control plane* summarizes `step_id` ownership in one sentence and points here for detail.

## Future extensions (not implemented here)

Examples that **may** be added later without changing the contract above until documented: richer cycle reporting (full ring), multi-graph components, or stricter coupling with emit-time parent ordering. Track those as separate design items if you extend `validateTraceRunGraph`.
