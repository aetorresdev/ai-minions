# Recovery sweep contract

Detect and explain **incomplete or inconsistent runs** from trace JSONL. **Detect and explain first** — no automatic retry, resume, or repair without an explicit future policy.

## Finding kinds

| `finding_kind` | Meaning |
|----------------|---------|
| `missing_session_end` | `session_start` without `session_end` |
| `stranded_step` | `agent_start` for a `step_id` without matching `agent_done` |
| `unresolved_ownership_handoff` | `approval_required` with `ownership_change` never `approval_granted` |
| `pending_governance_approval` | Governance hold (pending/denied approval) |
| `no_agent_steps` | `session_start` but no `agent_start` events |

## Trace events

| Event | When |
|-------|------|
| `recovery_detected` | One row per finding |
| `recovery_blocked` | At least one finding blocks auto-recovery (`policy: no_auto_retry`) |
| `recovery_completed` | Always once per sweep; `clean: true` when no findings |

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`recovery_*` branches).

## Emission

- **Live run:** orchestrator reads the trace file before `session_end` and runs `runRecoverySweepAndTrace` (no step retries).
- **Post-hoc:** `buildRunOutcomeSummary` / export recompute findings from rows; prefers last `recovery_completed` in trace when present.

## Consumption

- **`run_outcome_summary.recovery`** — `clean`, `finding_count`, `summary`, trimmed `findings[]`, `policy`
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
