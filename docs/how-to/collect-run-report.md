# Collect run report bundle

Local report bundle for operator feedback — copies trace, inspect report, and runner panel captures into one attachable directory. Complements [inspect run evidence](inspect-run-evidence.md) for GitHub issue attachment (v0.13 feedback templates are out of scope).

**Script:** `node scripts/collect-run-report.mjs <task_id>`

**Contract:** [runner-tui-contract.md](../orchestrator/runner-tui-contract.md) · trace dir `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`)

---

## Quick command

From clone root (`ai-minions/`):

```bash
node scripts/collect-run-report.mjs <task_id>
```

Custom output directory:

```bash
node scripts/collect-run-report.mjs <task_id> --out /tmp/my-run-bundle
```

Skip trace/budget panel captures (status + explain-run still collected):

```bash
node scripts/collect-run-report.mjs <task_id> --skip-panels
```

JSON report:

```bash
node scripts/collect-run-report.mjs <task_id> --json
```

Default output: `report-bundles/<task_id>-<timestamp>/` under repo root (gitignored). Exit codes: **0** = all checks pass · **1** = blocker(s) on stderr (`blocker: BUNDLE_*` and `INSPECT_*` when inspect failed).

---

## Bundle layout

| Path | Contents |
|------|----------|
| `manifest.json` | Index: task id, commit, file list, inspect verdict |
| `ATTACH.md` | Human checklist + copy-paste GitHub issue skeleton |
| `trace/<task_id>.jsonl` | Trace copy (validate JSONL before collect) |
| `inspect-report.json` | Full `INSPECT_*` report from [inspect-run-evidence.mjs](../../scripts/inspect-run-evidence.mjs) |
| `artifacts/status.txt` | `runner:tui status` stdout/stderr |
| `artifacts/trace-panel.txt` | `runner:tui trace` *(unless `--skip-panels`)* |
| `artifacts/budget-panel.txt` | `runner:tui budget` *(unless `--skip-panels`)* |
| `artifacts/explain-run.txt` | `explain-run` stdout/stderr |

Redact secrets before uploading. Do not attach raw `.env` or credential files.

---

## What it runs (in order)

| Step | Layer | Action |
|------|-------|--------|
| 1 | Trace file | Valid JSONL at `$ORCH_TRACES_DIR/<task_id>.jsonl` (same parse as inspect path) |
| 2 | Output | Create bundle directory |
| 3 | Capture | Runner panels + explain-run (stdout/stderr files) |
| 4 | Inspect | `runInspectRunEvidence` → `inspect-report.json` |
| 5 | Write | `manifest.json` + `ATTACH.md` |

Slash alias: [operator-slash-commands.md](operator-slash-commands.md) (`/collect-report`).

---

## `BUNDLE_*` reason codes

| `reason_code` | Meaning | Typical fix |
|---------------|---------|-------------|
| `BUNDLE_OK` | Step passed | — |
| `BUNDLE_TASK_ID_MISSING` | No `task_id` argument | Pass task id from run output |
| `BUNDLE_TRACE_NOT_FOUND` | JSONL missing | Confirm `ORCH_TRACES_DIR` |
| `BUNDLE_TRACE_NOT_READABLE` | Empty or invalid JSONL | Fix trace or re-run |
| `BUNDLE_OUTPUT_DIR_FAILED` | Cannot create `--out` dir | Check permissions / path |
| `BUNDLE_COLLECT_FAILED` | File write error | Disk space / permissions |
| `BUNDLE_INSPECT_BLOCKED` | Inspect reported failures | Bundle still written — see `inspect-report.json` |

Inspect detail codes remain `INSPECT_*` inside `inspect-report.json`.

---

## vs other tools

| Tool | Use when |
|------|----------|
| **`inspect-run-evidence.mjs`** | Quick terminal inspect — no bundle dir |
| **`collect-run-report.mjs`** | Attach full evidence dir to GitHub feedback |
| **`usage-smoke-guide` bug template** | Manual report without bundle |

---

## Out of scope

- GitHub issue templates / feedback forms (later release)
- Automatic zip upload
- No packaged installer · no production TUI claim

---

## Related

- [Inspect run evidence](inspect-run-evidence.md)
- [Operator guided run](operator-guided-run.md)
- [Usage smoke guide — Bug report template](usage-smoke-guide.md#bug-report-template)
