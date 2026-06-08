# Recovery sweep contract

Detect and explain **incomplete or inconsistent runs** from trace JSONL. **Detect and explain first** — no automatic retry, resume, or repair without an explicit future policy.

**Status:** Baseline shipped. **Hardening slice:** additional finding kinds for review blockers, missing `iteration_done`, governance boundary gaps, and incomplete handoffs — surfaced via `run_outcome_summary.recovery` and live sweep.

## Finding kinds

| `finding_kind` | Meaning |
|----------------|---------|
| `missing_session_end` | `session_start` without `session_end` |
| `stranded_step` | `agent_start` for a `step_id` without matching `agent_done` |
| `unresolved_ownership_handoff` | `approval_required` with `ownership_change` never `approval_granted` |
| `pending_governance_approval` | Governance hold (pending/denied approval) |
| `no_agent_steps` | `session_start` but no `agent_start` events |
| `open_review_blockers` | `review_record` with `block` or `request_changes` verdict |
| `missing_iteration_done` | Agent activity for an iteration without matching `iteration_done` |
| `governance_boundary_incomplete` | `production_boundary_check` not `ready_for_human_review` |
| `incomplete_handoff` | Handoff gate blocked iteration without recovery (`compact_handoff` / `approval_granted`) |

## Trace events

| Event | When |
|-------|------|
| `recovery_detected` | One row per finding |
| `recovery_blocked` | At least one finding blocks auto-recovery (`policy: no_auto_retry`) |
| `recovery_completed` | Always once per sweep; `clean: true` when no findings |

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`recovery_*` branches).

## Emission (live vs post-hoc)

### Live run (`lifecycleMode: live_before_session_end`)

Orchestrator reads the trace file **before** writing `session_end` and runs `runRecoverySweepAndTrace(..., { lifecycleMode: "live_before_session_end" })`.

In this mode:

- **Do not** emit `missing_session_end` (the session is still open by design).
- **Do** emit `stranded_step`, governance/handoff findings, and `no_agent_steps` when applicable.
- Then `session_end` is written.

### Post-hoc (export / dashboard / `explain-run`)

`buildRunOutcomeSummary` calls `summarizeRecoveryFromRows`, which **recomputes** findings from the **full** trace (`lifecycleMode: post_hoc`).

**Source of truth for export:** recomputed `clean`, `finding_count`, `summary`, `findings[]`.

The last `recovery_completed` row in the trace, if any, is exposed only as **`historical_sweep`** (evidence of what the live sweep recorded). It may disagree with the recomputed state when `session_end` was written after a live sweep — for example a live sweep that correctly reported `clean: true` before `session_end`, while an aborted trace file analyzed later may still show `missing_session_end` in historical rows.

When recomputed state differs from `historical_sweep.clean`, `run_outcome_summary.recovery` may include `recompute_note`.

## Consumption

- **`run_outcome_summary.recovery`** — `computed_from`, `clean`, `finding_count`, `summary`, `findings[]`, `policy`, optional `historical_sweep`, optional `recompute_note`
- Scenario export `runs[].run_outcome_summary.recovery`
- Console / `token-trace-report --json` / `explain-run --json`

```bash
grep 'recovery_' ~/.claude/metrics/traces/<task_id>.jsonl
```

## Limits (explicit)

- No background daemon or scheduler.
- No auto-retry or auto-resume in this slice.
- UI surfacing is out of scope; export and trace only.

## Related

- [run-outcome-consumption.md](run-outcome-consumption.md)
- [graph-validation.md](graph-validation.md) — structural step graph checks
- Module: `orchestrator/recovery-sweep.js`
