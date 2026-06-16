# Inspect run evidence

Operator inspect path for a **completed** orchestrator run — trace file, `runner:tui` panels, and `explain-run` narrative. Complements [operator guided run](operator-guided-run.md) after Phase 4.

**Script:** `node scripts/inspect-run-evidence.mjs <task_id>`

**Contract:** [runner-tui-contract.md](../orchestrator/runner-tui-contract.md) · trace dir `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`)

---

## Quick command

From clone root (`ai-minions/`):

```bash
node scripts/inspect-run-evidence.mjs <task_id>
```

Skip trace/budget panels (status + explain-run only):

```bash
node scripts/inspect-run-evidence.mjs <task_id> --skip-panels
```

JSON report:

```bash
node scripts/inspect-run-evidence.mjs <task_id> --json
```

Exit codes: **0** = all checks pass · **1** = blocker(s) on stderr (`blocker: INSPECT_*`).

---

## What it runs (in order)

| Step | Layer | Command / check |
|------|-------|-----------------|
| 1 | Trace file | Validates `$ORCH_TRACES_DIR/<task_id>.jsonl` exists and is non-empty JSONL |
| 2 | Status | `npm run runner:tui -- status --run-id <task_id>` |
| 3 | Trace panel | `npm run runner:tui -- trace --run-id <task_id>` *(unless `--skip-panels`)* |
| 4 | Budget panel | `npm run runner:tui -- budget --run-id <task_id>` *(unless `--skip-panels`)* |
| 5 | Narrative | `npm run explain-run -- --run-id <task_id>` |

Manual equivalents and slash aliases: [operator-slash-commands.md](operator-slash-commands.md) (`/inspect-run`, `/trace`, `/budget`, `/explain-run`).

---

## `INSPECT_*` reason codes

| `reason_code` | Meaning | Typical fix |
|---------------|---------|-------------|
| `INSPECT_OK` | Step passed | — |
| `INSPECT_TASK_ID_MISSING` | No `task_id` argument | Pass task id from `run` / `status` output |
| `INSPECT_TRACE_NOT_FOUND` | JSONL missing | Confirm `ORCH_TRACES_DIR` and run completed |
| `INSPECT_TRACE_NOT_READABLE` | Empty or non-JSONL trace | Re-run or check trace writer |
| `INSPECT_STATUS_TRACE_MISSING` | `status` exit `2` | Same as trace missing |
| `INSPECT_STATUS_INVOKE_FAILED` | `status` exit `1` | `npm run runner:tui -- --help` |
| `INSPECT_TRACE_PANEL_FAILED` | `trace` panel failed | See runner-tui-contract |
| `INSPECT_BUDGET_PANEL_FAILED` | `budget` panel failed | See runner-tui-contract |
| `INSPECT_EXPLAIN_FAILED` | `explain-run` failed or empty | `npm run explain-run -- --run-id <task_id>` manually |

---

## vs other inspect tools

| Tool | Use when |
|------|----------|
| **`run-primary-smoke.mjs --inspect`** | Primary smoke path (`run-orchestrator.js`) — `SMOKE_*` codes |
| **`inspect-run-evidence.mjs`** | Operator `runner:tui` workflow — `INSPECT_*` codes + panels |
| **`runner:tui -- trace/budget`** | Single panel only |
| **`explain-run`** | Narrative only |

---

## Out of scope

- GitHub issue filing — use [collect run report](collect-run-report.md) + [operator feedback issue](operator-feedback-issue.md)
- No packaged installer · no production TUI claim

---

## Related

- [Operator guided run](operator-guided-run.md)
- [Operator slash commands](operator-slash-commands.md)
- [Primary smoke](primary-smoke.md)
