# Run-level trace graph validation

This document is the **canonical reference** for how the orchestrator validates the **step graph** over a single run’s JSONL (`validateTraceRunGraph` in `orchestrator/trace-schema.js`). Strict-mode CI uses the same function alongside per-line schema checks — see [strict-mode.md](strict-mode.md) § *Golden path (baseline trace)*.

## Purpose

- Catch **ordering and lifecycle mistakes** for `step_id` before they invalidate downstream tooling (explain-run, metrics, dashboards).
- Complement **JSON Schema** validation: schema checks shape per line; graph validation checks **cross-line** consistency.

## API

`validateTraceRunGraph(lines)` accepts an array of parsed trace line objects (same shape as after `JSON.parse` on each JSONL row). It returns:

```ts
{ ok: boolean, violations: Array<{
  type: string;
  step_id?: string | null;
  parent_step_id?: string;
  line_index?: number;
}> }
```

## Step lifecycle rules

1. **`agent_start`** **registers** a `step_id`. A second `agent_start` with the same `step_id` is a violation (`duplicate_step_id`).
2. **`agent_done`** and other events (`gate_result`, `contract_fail`, `context_stats`, …) may **reuse** an existing `step_id` without registering again.
3. Any non–`agent_start` event that references a `step_id` that was **never** registered via `agent_start` is a violation (`step_id_unknown`). Exception path: `agent_done` without a prior start is reported as `agent_done_without_start`.
4. **`parent_step_id`**: if present on a line, the parent `step_id` must already be registered when that line is processed in the parent pass (`orphan_parent`).

## Violation types (today)

| `type` | Meaning |
|--------|---------|
| `duplicate_step_id` | Second `agent_start` reusing the same `step_id`. |
| `agent_done_without_start` | `agent_done` for a `step_id` that was never started. |
| `step_id_unknown` | Non-start event uses a `step_id` not in the registry (includes missing `agent_start`). |
| `orphan_parent` | `parent_step_id` does not refer to a registered step. |

`line_index` is the 0-based index of the offending line in the input array when applicable.

## CI and fixtures

- **Golden path:** `orchestrator/tests/fixtures/golden-path-clean-v1.jsonl` is validated with `validateTraceRunGraph` in `orchestrator/tests/goldenPath.test.js`.
- **Unit tests:** graph cases live in `orchestrator/tests/traceSchema.test.js` (naming may vary — search for `validateTraceRunGraph`).

## Related contract prose

[agent-contract.md](agent-contract.md) § *Runtime control plane* summarizes `step_id` ownership in one sentence and points here for detail.

## Future extensions (not implemented here)

Examples that **may** be added later without changing the contract above until documented: directed-edge cycle detection, warnings for runs with no `step_id`, stricter rules for `event` missing on lines that carry `step_id`. Track those as separate backlog items if you extend `validateTraceRunGraph`.
