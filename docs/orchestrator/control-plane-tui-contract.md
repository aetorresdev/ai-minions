# Control plane TUI contract

**Read-only** terminal inspection for orchestrator runs. Consumes existing trace JSONL and **`run_outcome_summary`** — no agent execution, no state mutation, no approvals, no policy edits.

This slice delivers a **stdout inspect CLI** (`control-plane-tui.js`), not a full-screen interactive TUI library. Batch mode lists runs; single-run mode shows one run’s control-plane fields.

## CLI

From `orchestrator/`:

```bash
npm run control-plane:tui -- --file tests/fixtures/golden-path-clean-v1.jsonl
npm run control-plane:tui -- --run-id <task_id>
npm run control-plane:tui -- --batch --since-m 60 --include-untagged
```

Same trace resolution as `explain-run` (`--run-id`, `ORCH_TRACES_DIR`).

## Displayed fields (single run)

| Section | Source | Missing data |
|---------|--------|--------------|
| Run identity | `run_outcome_summary.where` | `(not available)` |
| Status / outcome | `run_outcome_summary.what` | `(not available)` |
| Last step | Last `agent_done` or rollup | `(not available)` |
| Blockers | `review_record` via `run_outcome_summary.review` | `(not available)` |
| Permission summary | `session_end.permission_summary` or derived rollup | `(not available)` |
| Cost / tokens | `run_outcome_summary.cost` | `(not available)` |
| Recovery | `run_outcome_summary.recovery` | `(not available)` |
| Resume | `run_outcome_summary.resume` | `(not available)` |
| Paths | Trace file path + pointer to explain-run / token report | — |

**Rule:** absent fields show **`(not available)`** — the CLI does not infer or fabricate values.

## Relationship to other surfaces

| Surface | Role |
|---------|------|
| `explain-run` | Narrative + JSON export |
| `console-dashboard` | Failure taxonomy tables + rollups |
| **Control plane TUI** | Operator **run inspect** panel (outcome, gates, blockers, recovery, resume) |
| Future web control plane | Out of scope |

Storage planes and resume semantics: [memory-store-decision.md](memory-store-decision.md), [session-resume-contract.md](session-resume-contract.md).

## Limits (explicit)

- No interactive keybindings or curses UI in v0.1.x.
- No auth, multi-user, or new persistence.
- No write paths to orchestrator-state, traces, or policy files.
- Web control plane exploration is future work (read-only, if ever).

## Validation

- Unit tests: `orchestrator/tests/controlPlaneTui.test.js` (golden clean + blocked fixture, ASCII-only).
- Manual: inspect a successful run and a failed/blocked run; compare with `npm run explain-run -- --file …`.

## Related

- [run-outcome-consumption.md](run-outcome-consumption.md)
- [review-record-contract.md](review-record-contract.md)
- [recovery-sweep-contract.md](recovery-sweep-contract.md)
- [session-resume-contract.md](session-resume-contract.md)
