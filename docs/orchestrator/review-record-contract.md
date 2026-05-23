# Review record contract

Durable, structured review outcomes for **QA** and **CERBERUS** — emitted as `review_record` trace events. No raw prompt or full agent output is stored in the record.

## Schema (trace event)

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"review_record"` | |
| `review_schema_version` | `"1"` | |
| `reviewer_role` | `"qa"` \| `"cerberus"` | |
| `verdict` | `"approve"` \| `"request_changes"` \| `"block"` | |
| `blockers` | string[] | Substantive blockers only (max 8 × 300 chars) |
| `non_blocking_notes` | string[] | `improvement:` / `nice-to-have:` lines |
| `evidence_refs` | string[] | Paths/refs extracted from findings |
| `reviewed_artifact_ids` | string[] | Usually harness `step_id` values |
| `iteration` | integer | Run iteration index |
| `step_id` | string (optional) | Reviewer step when applicable |

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`review_record` branch).

## Verdict rules

Parsed from the shared three-line template (`blocker:` / `improvement:` / `nice-to-have:`):

| Condition | Verdict |
|-----------|---------|
| Gate/contract failure on reviewer | `block` |
| - Substantive `blocker:` line | `block` |
| Substantive `improvement:` or `nice-to-have:` only | `request_changes` |
| All vacuous / `(none)` | `approve` |

## Consumption

- **`run_outcome_summary.review`** — `final_verdict`, per-role verdicts, trimmed `records[]`
- **`npm run explain-run -- --json`**
- **`npm run tokens:report -- <task_id> --json`**
- Scenario export `runs[].run_outcome_summary.review`

```bash
grep review_record ~/.claude/metrics/traces/<task_id>.jsonl
```

## Related

- [run-outcome-consumption.md](run-outcome-consumption.md)
- [strict-mode.md](strict-mode.md) — QA/CERBERUS output contracts
- Module: `orchestrator/review-record.js`
