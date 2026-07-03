# Human-ready rehearsal evidence (v0.19 / v0.20)

**Release criterion:** internal dry-run proves a near-external operator can follow docs from clone → product CLI → evidence bundle → GitHub feedback **without maintainer translation**, with privacy notice before upload.

**v0.20 add-on:** Mac/Docker live attestation via **installed `ai-minions`** (PATH shim) — see [install-evidence](install-evidence.md) and record [installed_cli_evidence](evidence/human-ready-rehearsal-record.json).

**Not claimed:** external beta cohort · production support SLA · doc-chain alone substitutes for v0.20 installed CLI live gate.

---

## Quick run (doc-chain validation)

From repo root:

```bash
node scripts/run-human-ready-rehearsal-evidence.mjs
node scripts/run-human-ready-rehearsal-evidence.mjs --json
```

**Pass:** exit `0` · all steps `pass`.

**Reason codes:** `REHEARSAL_OK` · `REHEARSAL_DOCS_VERIFY_FAIL` · `REHEARSAL_CLAIM_AUDIT_FAIL` · `REHEARSAL_REQUIRED_DOCS_FAIL` · `REHEARSAL_RECORD_FAIL` · `REHEARSAL_CHECKLIST_FAIL` · `REHEARSAL_SAMPLE_ISSUE_FAIL` · `REHEARSAL_PRIVACY_ORDER_FAIL`

---

## Live operator dry-run (human rehearsal)

1. Read [PRIVACY.md](../../PRIVACY.md) and [beta-known-limitations](beta-known-limitations.md) onboarding order.
2. Run product install: `node scripts/install-ai-minions.mjs` — then use **`ai-minions`** from `$HOME` (not `cd orchestrator`).
3. Follow [beta-tester-guide](beta-tester-guide.md) using the **installed product CLI primary path** (legacy `npm run ai-minions` = dev fallback only).
4. Score [beta-dry-run-checklist](beta-dry-run-checklist.md) — all required rows `PASS` or documented `FAIL`.
5. Before Phase C bundle collect: confirm privacy notice read (checklist row C.0).
6. Mac/Docker install evidence: `node scripts/run-install-evidence.mjs --json` — record `evidence_class` + commit in [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json) `installed_cli_evidence`.
7. File feedback or record **no issue found** — update record with commit, date, `task_id`, and issue URL.

**Synthetic feedback artifact (template dry-run):** [beta-dry-run-sample-issue.md](evidence/beta-dry-run-sample-issue.md)

---

## What the automated chain checks

| Step | Proves |
|------|--------|
| verify-usage-docs | Operator doc alignment guards (E19-1..3) |
| Claim audit | No inflated beta claims in scanned docs |
| Required docs | PRIVACY, checklist, sample issue, blocker/recovery guides exist |
| Rehearsal record | JSON schema + required fields |
| Checklist v0.19 | PRIVACY, product CLI, blast-radius, blocker recovery markers |
| Sample issue | Product CLI path + PRIVACY + synthetic disclaimer |
| Privacy ordering | PRIVACY linked before bundle collect in key docs |

---

## Operator path (v0.20 installed CLI — live gate)

```bash
cd ai-minions
node scripts/install-ai-minions.mjs
cd ~
ai-minions --help
ai-minions init --model-policy local_only
ai-minions doctor --model-policy local_only
ai-minions start --goal "Rehearsal: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1 --model-policy local_only
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
cd ai-minions
node scripts/collect-run-report.mjs <task_id>
```

Read [PRIVACY.md](../../PRIVACY.md) **before** `collect-run-report.mjs`. Legacy `runner:tui` remains documented as advanced — [operator-guided-run](operator-guided-run.md).

## Operator path (v0.19 repo-local — baseline only)

```bash
cd ai-minions/orchestrator
npm run ai-minions -- init --model-policy local_only
npm run ai-minions -- doctor --model-policy local_only
npm run ai-minions -- start --goal "Rehearsal: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1 --model-policy local_only
npm run ai-minions -- status --run-id <task_id>
npm run ai-minions -- explain --run-id <task_id>
cd ..
node scripts/collect-run-report.mjs <task_id>
```

**Not valid v0.20 beta evidence** until installed CLI path passes [install-evidence](install-evidence.md) live gate.

---

## Related

- [beta-dry-run-checklist](beta-dry-run-checklist.md) · [beta-tester-guide](beta-tester-guide.md)
- [operator-blockers-and-recovery](operator-blockers-and-recovery.md) · [beta-claim-blast-radius](beta-claim-blast-radius.md)
- [operator-feedback-issue](operator-feedback-issue.md)
