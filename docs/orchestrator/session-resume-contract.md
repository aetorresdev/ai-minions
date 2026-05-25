# Session resume contract

Durable **session checkpoint** and **resume eligibility** for long-running orchestrator runs. **Explain and gate** — no scheduler, no auto-resume, no background daemon.

Recovery sweep ([recovery-sweep-contract.md](recovery-sweep-contract.md)) answers “is this trace incomplete?” Session resume answers “may an operator continue this run from a checkpoint without violating gates, blockers, or policy?”

## Checkpoint contents

A checkpoint (`buildSessionCheckpointFromRows`) captures operational state — not semantic memory:

| Field | Source |
|-------|--------|
| `task_id`, `scenario_id`, `resume_of_task_id` | `session_start` |
| `active_goal`, `active_step_id`, `active_role`, `iteration` | last agent / iteration rows |
| `approved_artifact_ids` | `session_end` when present |
| `compact_handoff_available` | `compact_handoff` / MCP signals |
| `handoff_contract` | ref, accepted, stale, incomplete |
| `review_summary` | `review_record` rows — open blockers from `block` / `request_changes` |
| `permission_checkpoint` | profile, policy_source, permission_check total |
| `cost_checkpoint` | Ollama totals from `session_end` when present |
| `recovery_clean` | recomputed recovery sweep |
| `session_complete` | whether `session_end` exists |

Session log ≠ memory store. Memory holds knowledge; checkpoint holds auditable run state (storage fit evaluated separately in the memory-store design lane).

## Resume rules

1. **Eligible** only when `evaluateResumeEligibility` returns `eligible: true`.
2. **Block** when any of:
   - `open_review_blockers` — QA/CERBERUS blockers still open
   - `recovery_not_clean` — recovery sweep findings (except `missing_session_end` on incomplete sessions)
   - `stale_handoff_contract` / `incomplete_handoff_contract` — delegated ownership invalid
   - `governance_hold` — approval pending/denied
   - `permission_profile_changed` / `permission_policy_changed` — vs checkpoint when operator supplies current profile
   - `incomplete_checkpoint` — missing `task_id` or session already completed (`session_end` written)
3. **Side effects:** even when eligible, `side_effects_require_revalidation: true` — permissions must be re-evaluated before shell/MCP/network actions; checkpoint does not grant stale allows.
4. **Resume run identity:** new run’s `session_start.resume_of_task_id` points at prior `task_id`; export distinguishes via `trace_signals.is_resume_run`.

## Trace events

| Event | When |
|-------|------|
| `session_checkpoint_created` | Operator or tooling materializes checkpoint (requires non-empty `task_id`) |
| `session_resume_requested` | Operator requests resume |
| `session_resume_loaded` | Harness accepted checkpoint and loaded minimal context |
| `session_resume_blocked` | Resume denied; includes `block_codes` (requires non-empty `task_id`) |

Incomplete checkpoints without `task_id` belong in **`run_outcome_summary.resume`** / export objects only — do not emit them as trace v2 lines.

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`session_*` branches).

## Consumption

- **`run_outcome_summary.resume`** — eligibility, block codes, checkpoint summary (post-hoc from full trace)
- Module: `orchestrator/session-resume.js`

```bash
grep 'session_' ~/.claude/metrics/traces/<task_id>.jsonl
```

## Limits (explicit)

- No auto-resume or auto-retry.
- No UI in this slice.
- No mandatory database — flat trace + checkpoint object only.
- Multi-user session handoff out of scope.

## Related

- [recovery-sweep-contract.md](recovery-sweep-contract.md)
- [review-record-contract.md](review-record-contract.md)
- [run-outcome-consumption.md](run-outcome-consumption.md)
- [governance-gates-contract.md](governance-gates-contract.md)
