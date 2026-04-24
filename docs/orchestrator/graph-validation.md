# Run-level trace graph validation

This document is the **canonical reference** for how the orchestrator validates the **step graph** over a single run’s JSONL (`validateTraceRunGraph` in `orchestrator/trace-schema.js`). Strict-mode CI uses the same function alongside per-line schema checks — see [strict-mode.md](strict-mode.md) § *Golden path (baseline trace)*.

## Purpose

- Catch **ordering and lifecycle mistakes** for `step_id` before they invalidate downstream tooling (explain-run, metrics, dashboards).
- Complement **JSON Schema** validation: schema checks shape per line; graph validation checks **cross-line** consistency.

## API

`validateTraceRunGraph(lines)` accepts an array of parsed trace line objects (same shape as after `JSON.parse` on each JSONL row). It returns:

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

**`ok`:** `true` only when `violations` is empty. **`warnings`** are non-fatal (for example a run with lines but no `step_id` anywhere).

## Step lifecycle rules

1. **`agent_start`** **registers** a `step_id`. A second `agent_start` with the same `step_id` is a violation (`duplicate_step_id`).
2. **`agent_done`** and other events (`gate_result`, `contract_fail`, `context_stats`, …) may **reuse** an existing `step_id` without registering again.
3. A line with a non-empty `step_id` must have a non-empty **`event`** string; otherwise `missing_event_with_step_id` (the line does not participate in lifecycle registration).
4. Any non–`agent_start` event that references a `step_id` that was **never** registered via `agent_start` is a violation (`step_id_unknown`). Exception path: `agent_done` without a prior start is reported as `agent_done_without_start`.
5. **`parent_step_id`**: if present on a line, the value must refer to a `step_id` that was **registered by an `agent_start` somewhere in the same run** (the same array of lines passed to `validateTraceRunGraph`). The implementation checks membership in that **final** registry of started steps — it does **not** require the parent row to appear earlier in **file / time order**. **Emit-time** checks in the writer (for example `assertParentStepExists` and stderr warnings) are **separate** from this run-level graph validation pass.
6. **Directed cycles** among `parent_step_id → step_id` edges (both endpoints registered) are reported as **`cycle`** (first cycle found wins). Self-edges (`parent_step_id === step_id`) count as a cycle.

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
