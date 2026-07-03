# Beta dry-run — sample issue from bundle (synthetic)

**Purpose:** show how a **filled GitHub operator-feedback issue** looks when copied from a report bundle `ATTACH.md` — **actionable without maintainer rewrite**.

**Synthetic only:** task id, paths, and trace excerpts are fabricated. Do not treat as a live incident.

**v0.19 path:** product CLI primary · [PRIVACY.md](../../../PRIVACY.md) read before bundle collect.

**Checklist:** [beta-dry-run-checklist](../beta-dry-run-checklist.md) · **Runbook:** [beta-tester-guide](../beta-tester-guide.md) · **Evidence:** [human-ready-rehearsal-evidence](../human-ready-rehearsal-evidence.md)

---

## Source bundle excerpt (`ATTACH.md`)

Values the operator copies into the GitHub form (from `collect-run-report.mjs` output):

```markdown
| Form field | Value |
|------------|-------|
| Task ID | `dry-run-sample-7f3a` |
| Repo commit (short SHA) | `aaf76d9` |
| Operator path | product CLI (`npm run ai-minions`) |
| Inspect verdict | PASS |
| Report bundle path (local) | `/tmp/ai-minions/report-bundles/dry-run-sample-7f3a-2026-07-03T12-00-00Z` |
| Inspect blockers | see block below |
| Severity | choose one: BLOCKER · BUG · USABILITY · DOCS |

**Inspect blockers** (paste into form):

(none)
```

---

## Filled GitHub issue (expected maintainer view)

**Title:** `[operator] Dry-run sample — product CLI done, inspect PASS`

**Labels:** `operator-feedback`

### Form fields

| Field | Value |
|-------|-------|
| **Task ID** | `dry-run-sample-7f3a` |
| **Repo commit** | `aaf76d9` |
| **Operator path** | product CLI (`npm run ai-minions`) |
| **Inspect verdict** | PASS |
| **Report bundle path** | `/tmp/ai-minions/report-bundles/dry-run-sample-7f3a-2026-07-03T12-00-00Z` |
| **Inspect blockers** | `(none)` |
| **Severity** | USABILITY |

### Steps to reproduce

1. Read [PRIVACY.md](../../../PRIVACY.md) (Phase 0 / before bundle).
2. Fresh clone; `npm ci` at repo root and `orchestrator/`.
3. `node scripts/bootstrap-preflight.mjs` → exit `0`.
4. `cd orchestrator` → `npm run ai-minions -- init --model-policy local_only` → exit `0`.
5. `npm run ai-minions -- doctor --model-policy local_only` → exit `0`.
6. `npm run ai-minions -- start --goal "Rehearsal smoke" --skip-gates --iterations 1 --model-policy local_only` → exit `0`; `task_id` `dry-run-sample-7f3a`.
7. `npm run ai-minions -- status --run-id dry-run-sample-7f3a` → outcome readable.
8. From repo root: `node scripts/inspect-run-evidence.mjs dry-run-sample-7f3a` → exit `0`.
9. Re-read PRIVACY.md; `node scripts/collect-run-report.mjs dry-run-sample-7f3a` → bundle dir above; reviewed `ATTACH.md`.

### Expected

Product CLI path completes on a clean tree; privacy notice read before bundle collect; inspect and bundle collectors exit `0`; `ATTACH.md` fields map to the GitHub form without manual field guessing.

### Actual

All steps passed. Inspect verdict PASS; no `INSPECT_*` blockers. Copied form table from `ATTACH.md`; filled Steps/Expected/Actual from the dry-run checklist. Attached redacted `manifest.json` and `inspect-report.json` excerpts (no `.env`).

---

## Why this is sufficient for triage

| Maintainer question | Answered in issue |
|---------------------|-------------------|
| Which commit? | `aaf76d9` |
| Which run? | `dry-run-sample-7f3a` |
| Operator entry? | product CLI (`npm run ai-minions`) |
| Privacy before upload? | PRIVACY.md read in steps 1 and 9 |
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
