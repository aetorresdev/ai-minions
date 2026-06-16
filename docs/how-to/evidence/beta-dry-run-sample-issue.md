# Beta dry-run — sample issue from bundle (synthetic)

**Purpose:** show how a **filled GitHub operator-feedback issue** looks when copied from a report bundle `ATTACH.md` — **actionable without maintainer rewrite**.

**Synthetic only:** task id, paths, and trace excerpts are fabricated. Do not treat as a live incident.

**Checklist:** [beta-dry-run-checklist](../beta-dry-run-checklist.md) · **Runbook:** [beta-tester-guide](../beta-tester-guide.md)

---

## Source bundle excerpt (`ATTACH.md`)

Values the operator copies into the GitHub form (from `collect-run-report.mjs` output):

```markdown
| Form field | Value |
|------------|-------|
| Task ID | `dry-run-sample-7f3a` |
| Repo commit (short SHA) | `4041d9a` |
| Operator path | runner:tui guided run |
| Inspect verdict | PASS |
| Report bundle path (local) | `/tmp/ai-minions/report-bundles/dry-run-sample-7f3a-2026-05-18T12-00-00Z` |
| Inspect blockers | see block below |
| Severity | choose one: BLOCKER · BUG · USABILITY · DOCS |

**Inspect blockers** (paste into form):

(none)
```

---

## Filled GitHub issue (expected maintainer view)

**Title:** `[operator] Dry-run sample — guided run done, inspect PASS`

**Labels:** `operator-feedback`

### Form fields

| Field | Value |
|-------|-------|
| **Task ID** | `dry-run-sample-7f3a` |
| **Repo commit** | `4041d9a` |
| **Operator path** | runner:tui guided run |
| **Inspect verdict** | PASS |
| **Report bundle path** | `/tmp/ai-minions/report-bundles/dry-run-sample-7f3a-2026-05-18T12-00-00Z` |
| **Inspect blockers** | `(none)` |
| **Severity** | USABILITY |

### Steps to reproduce

1. Fresh clone; `npm ci` at repo root and `orchestrator/`.
2. `node scripts/bootstrap-preflight.mjs` → exit `0`.
3. `cd orchestrator` → `npm run runner:tui -- preflight --model-policy local_only` → exit `0`.
4. `npm run runner:tui -- run --goal "Dry-run smoke" --flow single_agent --model-policy local_only --skip-gates --iterations 1` → exit `0`; recorded `task_id` `dry-run-sample-7f3a`.
5. `npm run runner:tui -- status --task-id dry-run-sample-7f3a` → `terminal_status: done`.
6. From repo root: `node scripts/inspect-run-evidence.mjs dry-run-sample-7f3a` → exit `0`.
7. `node scripts/collect-run-report.mjs dry-run-sample-7f3a` → bundle dir above; reviewed `ATTACH.md`.

### Expected

Bootstrap and `runner:tui` path complete on a clean tree; inspect and bundle collectors exit `0`; `ATTACH.md` fields map to the GitHub form without manual field guessing.

### Actual

All steps passed. Inspect verdict PASS; no `INSPECT_*` blockers. Copied form table from `ATTACH.md`; filled Steps/Expected/Actual from the dry-run checklist. Attached redacted `manifest.json` and `inspect-report.json` excerpts (no `.env`).

---

## Why this is sufficient for triage

| Maintainer question | Answered in issue |
|---------------------|-------------------|
| Which commit? | `4041d9a` |
| Which run? | `dry-run-sample-7f3a` |
| Operator entry? | `runner:tui guided run` |
| Evidence quality? | Inspect PASS; bundle path + attach list |
| Repro without chat? | Numbered steps from repo root / `orchestrator/` |
| Severity / routing? | `USABILITY` (example — use `BLOCKER` when blocked) |

---

## FAIL-path note

When inspect or bundle fails, keep the same structure: copy `INSPECT_*` / `BUNDLE_*` blockers from `ATTACH.md`, set **Inspect verdict** to `FAIL`, and choose **Severity** `BLOCKER` or `BUG`. The sample above documents the **happy path** only.

---

## Related

- [operator-feedback-issue](../operator-feedback-issue.md) — field map
- [`.github/ISSUE_TEMPLATE/operator-feedback.yml`](../../../.github/ISSUE_TEMPLATE/operator-feedback.yml) — live template
