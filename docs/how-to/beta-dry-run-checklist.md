# Beta dry-run checklist (internal)

Scorable checklist for the **internal human-ready rehearsal** in [beta-tester-guide](beta-tester-guide.md). Record results before filing operator feedback.

**v0.20 path:** installed **`ai-minions`** primary (`first-run` · `smoke` · `attach`) · [PRIVACY.md](../../PRIVACY.md) before bundle upload · [operator-blockers-and-recovery](operator-blockers-and-recovery.md) for failures.

**Dev fallback:** `npm run ai-minions` from `orchestrator/` only — not the primary scoring path.

**Score each row:** `PASS` · `FAIL` · `SKIP` (with one-line evidence).

**Exit bar:** all **required** rows `PASS` or documented `FAIL` with a filed GitHub issue — maintainer can triage **without re-running the whole path**.

**Not claimed:** external beta · production SLA · production TUI · automatic issue upload.

**Evidence chain:** `node scripts/run-human-ready-rehearsal-evidence.mjs` · record [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json)

---

## Phase 0 — Workspace

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| 0.1 | Fresh clone (or documented why not) | yes | | clone path + date |
| 0.2 | `git rev-parse --short HEAD` recorded | yes | | SHA in notes or bundle |
| 0.3 | [PRIVACY.md](../../PRIVACY.md) read | yes | | initials / date |
| 0.4 | [beta-claim-blast-radius](beta-claim-blast-radius.md) skimmed | yes | | initials / date |
| 0.5 | [operator-blockers-and-recovery](operator-blockers-and-recovery.md) skimmed | yes | | initials / date |
| 0.6 | [beta-known-limitations](beta-known-limitations.md) read (incl. redaction policy) | yes | | initials / date |
| 0.7 | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) read | yes | | initials / date |
| 0.8 | [beta-smoke-matrix](beta-smoke-matrix.md) § Minimum gate cells skimmed | yes | | initials / date |

---

## Phase A — Product install

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| A.1 | `node scripts/install-ai-minions.mjs` → product CLI ok | yes | | `product_cli_ok` or remediation |
| A.2 | `ai-minions --help` from outside `orchestrator/` | yes | | exit code |
| A.3 | `ai-minions first-run --model-policy local_only` | yes | | `FIRST_RUN_*` + `next_safe_action` |
| A.4 | `node scripts/bootstrap-preflight.mjs` *(maintainer optional)* | no | | `PREFLIGHT_*` or skip |

---

## Phase B — Operator path (installed CLI primary)

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| B.1 | `ai-minions init` if `FIRST_RUN_NEEDS_INIT` | yes | | exit code |
| B.2 | `ai-minions doctor --model-policy local_only` | yes | | exit code + `next_safe_action` |
| B.3 | `ai-minions smoke --model-policy local_only` completed or failure captured | yes | | `task_id` recorded |
| B.4 | `ai-minions status --run-id <id>` read | yes | | terminal status quoted |
| B.5 | Legacy `runner:tui` path attempted *(optional)* | no | | exit code + `OPERATOR_*` if any |

---

## Phase C — Evidence bundle

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| C.0 | [PRIVACY.md](../../PRIVACY.md) re-read before collect | yes | | initials / date |
| C.1 | `ai-minions attach --run-id <id>` or `collect-run-report.mjs` | yes | | bundle dir path |
| C.2 | `node scripts/inspect-run-evidence.mjs <task_id>` | yes | | exit code + `INSPECT_*` |
| C.3 | `ATTACH.md` reviewed; secrets redacted | yes | | redaction note |
| C.4 | `manifest.json` matches commit + task id | yes | | field spot-check |
| C.5 | `degraded_mode` / `risk_acceptance_reason` reviewed | yes | | no disqualifying beta run claimed as PASS |

---

## Phase D — Feedback loop

Use [operator-feedback-issue](operator-feedback-issue.md) for field mapping.

| # | Check | Required | Result | Evidence |
|---|-------|----------|--------|----------|
| D.1 | GitHub issue opened or **no issue found** documented | yes | | issue URL or record note |
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
| [human-ready-rehearsal-evidence](human-ready-rehearsal-evidence.md) | Automated doc-chain + live runbook |
| [beta-tester-guide](beta-tester-guide.md) | Step-by-step runbook |
| [beta-limitations-onboarding-contract](../orchestrator/beta-limitations-onboarding-contract.md) | Redaction + onboarding contract |
