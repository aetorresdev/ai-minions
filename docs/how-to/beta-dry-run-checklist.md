# Beta dry-run checklist (internal)

Scorable checklist for the **internal beta dry-run** in [beta-tester-guide](beta-tester-guide.md). Record results before filing operator feedback.

**Score each row:** `PASS` · `FAIL` · `SKIP` (with one-line evidence).

**Exit bar:** all **required** rows `PASS` or documented `FAIL` with a filed GitHub issue — maintainer can triage **without re-running the whole path**.

**Not claimed:** external beta · production SLA · automatic issue upload.

---

## Phase 0 — Workspace

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| 0.1 | Fresh clone (or documented why not) | yes | | clone path + date |
| 0.2 | `git rev-parse --short HEAD` recorded | yes | | SHA in notes or bundle |
| 0.3 | [beta-known-limitations](beta-known-limitations.md) read | yes | | initials / date |

---

## Phase A — Entry path

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| A.1 | `npm ci` (root + `orchestrator/`) | yes | | exit code |
| A.2 | `node scripts/bootstrap-preflight.mjs` → exit `0` | yes | | `PREFLIGHT_*` or `PASS` |
| A.3 | Primary smoke plan/run *(optional)* | no | | `SMOKE_*` or skip reason |

---

## Phase B — Operator path

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| B.1 | `runner:tui` preflight attempted | yes | | exit code + `OPERATOR_*` if any |
| B.2 | `runner:tui run` completed or failure captured | yes | | `task_id` recorded |
| B.3 | `runner:tui status --task-id <id>` read | yes | | terminal status quoted |

---

## Phase C — Evidence bundle

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| C.1 | `node scripts/inspect-run-evidence.mjs <task_id>` | yes | | exit code + `INSPECT_*` |
| C.2 | `node scripts/collect-run-report.mjs <task_id>` | yes | | bundle dir path |
| C.3 | `ATTACH.md` reviewed; secrets redacted | yes | | redaction note |
| C.4 | `manifest.json` matches commit + task id | yes | | field spot-check |

---

## Phase D — Feedback loop

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| D.1 | GitHub issue opened (**Operator feedback**) | yes | | issue URL |
| D.2 | Form fields copied from `ATTACH.md` | yes | | task id + commit match bundle |
| D.3 | Steps / Expected / Actual filled (not placeholders) | yes | | issue body |
| D.4 | Severity selected (`BLOCKER` / `BUG` / `USABILITY` / `DOCS`) | yes | | label in issue |
| D.5 | Maintainer can triage without full re-run | yes | | self-review or peer note |

**Sample filled issue (synthetic):** [beta-dry-run-sample-issue](evidence/beta-dry-run-sample-issue.md)

---

## Dry-run summary

| Field | Value |
|-------|-------|
| Operator | |
| Date | |
| Repo commit | |
| Task ID | |
| Inspect verdict | PASS / FAIL |
| Issue URL | |
| Overall | PASS / FAIL |

---

## Related

| Doc | Role |
|-----|------|
| [beta-tester-guide](beta-tester-guide.md) | Step-by-step runbook |
| [operator-feedback-issue](operator-feedback-issue.md) | Form field map |
| [collect-run-report](collect-run-report.md) | Bundle + `ATTACH.md` |
| [beta-known-limitations](beta-known-limitations.md) | Honesty boundaries |
| [beta-smoke-matrix](beta-smoke-matrix.md) | External beta gate matrix (OS × provider × flow) |
