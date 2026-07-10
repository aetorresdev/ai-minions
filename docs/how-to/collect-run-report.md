# Collect run report bundle

Local report bundle for operator feedback — copies trace, inspect report, human-readable summaries, and runner panel captures into one attachable directory. Complements [inspect run evidence](inspect-run-evidence.md) for GitHub issue attachment. Known limitations for beta dry-run: [beta-known-limitations](beta-known-limitations.md).

**Before collecting or uploading:** read [PRIVACY.md](../../PRIVACY.md) and [beta-claim-blast-radius](beta-claim-blast-radius.md).

**Product CLI (preferred):** `ai-minions attach --run-id <task_id>`

**Script:** `node scripts/collect-run-report.mjs <task_id>`

**Contract:** [operator visibility guide](operator-visibility-guide.md) · trace dir `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`)

---

## Quick command

From clone root (`ai-minions/`):

```bash
ai-minions attach --run-id <task_id>
# or:
node scripts/collect-run-report.mjs <task_id>
```

Custom output directory:

```bash
ai-minions attach --run-id <task_id> --out /tmp/my-run-bundle
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

## Bundle layout (human-readable attach)

| Path | Contents | Upload? |
|------|----------|---------|
| `manifest.json` | Index: task id, commit, file list, inspect verdict, `human_readable_bundle` metadata | No |
| `ATTACH.md` | Field values aligned with [operator feedback issue form](operator-feedback-issue.md) | No |
| `SUMMARY.md` | Operator-facing run summary (local) | No |
| `OPERATOR_NOTES.md` | Local-only operator notes | No |
| `MANAGEMENT_SUMMARY.md` | Management handoff summary (local) | No |
| `shareable/SUMMARY.md` | Redacted summary for upload | Yes |
| `shareable/MANAGEMENT_SUMMARY.md` | Redacted management summary for upload | Yes |
| `shareable/shareable-manifest.json` | Upload manifest | Yes |
| `privacy-scan.json` | Privacy scan outcome | Yes |
| `redaction-report.json` | Redaction details | Optional / review first |
| `trace/<task_id>.jsonl` | Trace copy (validate JSONL before collect) | No |
| `traces/` | Additional trace copies when present | No |
| `evidence/` | Evidence artifacts | No |
| `inspect-report.json` | Full `INSPECT_*` report from [inspect-run-evidence.mjs](../../scripts/inspect-run-evidence.mjs) | No |
| `artifacts/status.txt` | Operator status capture | No |
| `artifacts/trace-panel.txt` | Runner trace panel *(unless `--skip-panels`)* | No |
| `artifacts/budget-panel.txt` | Runner budget panel *(unless `--skip-panels`)* | No |
| `artifacts/explain-run.txt` | `explain-run` stdout/stderr | No |

**Upload rule:** attach only `privacy-scan.json` and everything under `shareable/` (or zip those paths). Do **not** upload raw `trace/*.jsonl`, `OPERATOR_NOTES.md`, or unreviewed local-only files.

Redact secrets before uploading. Do not attach raw `.env` or credential files.

---

## What it runs (in order)

| Step | Layer | Action |
|------|-------|--------|
| 1 | Trace file | Valid JSONL at `$ORCH_TRACES_DIR/<task_id>.jsonl` |
| 2 | Output | Create bundle directory |
| 3 | Human-readable | Write `SUMMARY.md` · `OPERATOR_NOTES.md` · `MANAGEMENT_SUMMARY.md` from trace |
| 4 | Capture | Runner panels + explain-run (stdout/stderr files) |
| 5 | Inspect | `runInspectRunEvidence` → `inspect-report.json` |
| 6 | Privacy | Scan + build `shareable/` subset |
| 7 | Write | `manifest.json` + `ATTACH.md` |

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
| **`ai-minions status` / `explain` / `tui`** | Quick read-back without writing a bundle |
| **`ai-minions report`** | Markdown report dir for review (no privacy scan) |
| **`inspect-run-evidence.mjs`** | Quick terminal inspect — no bundle dir |
| **`ai-minions attach` / `collect-run-report.mjs`** | Attach full evidence dir to GitHub feedback |
| **`usage-smoke-guide` bug template** | Manual report without bundle |

---

## Filing feedback

1. Read [PRIVACY.md](../../PRIVACY.md).
2. Run `ai-minions attach --run-id <task_id>`.
3. Upload `privacy-scan.json` + `shareable/**` only.
4. Copy fields from `ATTACH.md` into [operator-feedback-issue](operator-feedback-issue.md).

`ATTACH.md` includes inspect-derived fields such as `degraded_mode`, `disqualifies_beta_success`, and `risk_acceptance_reason` when the inspect chain reports degraded assessment — cite these honestly in feedback issues.

---

## Related

- [operator-visibility-guide.md](operator-visibility-guide.md) — report · tui · attach overview
- [ai-minions-command-migration.md](ai-minions-command-migration.md) — product CLI mapping
- [inspect-run-evidence.md](inspect-run-evidence.md) · [operator-feedback-issue.md](operator-feedback-issue.md)
