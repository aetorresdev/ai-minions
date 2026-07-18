# Beta cohort guard evidence (v0.20 E20-6)

**Release criterion:** automated guard proves checklist + issue evidence + guided CLI path + performative-beta honesty **before** any external tester cohort opens.

**Contract:** doc-chain only until operator records `LIVE_PASS` on [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json).

**Not claimed:** passing this guard alone opens external cohort · production SLA · substitutes for live operator dry-run on Mac/Docker.

---

## Quick run

From repo root:

```bash
node scripts/run-beta-cohort-guard.mjs
node scripts/run-beta-cohort-guard.mjs --json
```

**Pass:** exit `0` · all steps `pass`.

**Reason codes:** `COHORT_GUARD_OK` · `COHORT_GUARD_REHEARSAL_FAIL` · `COHORT_GUARD_INSTALLED_CLI_FAIL` · `COHORT_GUARD_GUIDED_PATH_FAIL` · `COHORT_GUARD_PERFORMATIVE_BETA_FAIL` · `COHORT_GUARD_LIVE_PASS_DOC_FAIL` · `COHORT_GUARD_ISSUE_EVIDENCE_FAIL` · `COHORT_GUARD_RECORD_FAIL`

---

## What the chain checks

| Step | Proves |
|------|--------|
| human_ready_rehearsal | [human-ready rehearsal](human-ready-rehearsal-evidence.md) doc chain (verify, checklist, sample issue, privacy order) |
| installed_cli_ci | [install evidence](install-evidence.md) shim gate (`--installed-cli-ci`) |
| guided_path_checklist | [beta-dry-run-checklist](beta-dry-run-checklist.md) scores installed `ai-minions` primary (`first-run` → `smoke` → `attach`) — no required `npm run` / `cd orchestrator` rows |
| performative_beta_guard | No affirmative “external beta is open” claims in beta-facing docs |
| live_pass_doc_contract | `LIVE_PASS` required-before-cohort wording; forbids optional-style live attestation phrasing |
| issue_evidence_chain | [operator-feedback-issue](operator-feedback-issue.md) + template + [sample issue](evidence/beta-dry-run-sample-issue.md) |
| cohort_guard_record | `record.cohort_guard` in rehearsal record JSON |

---

## Operator workflow (before external cohort)

1. Complete [beta-dry-run-checklist](beta-dry-run-checklist.md) using installed `ai-minions` only.
2. Run `node scripts/run-beta-cohort-guard.mjs` → exit `0`.
3. **Required before external cohort:** complete live operator dry-run and update [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json) with:
   - `record.status` = `LIVE_PASS`
   - `repo_commit`
   - `rehearsal_date`
   - `task_id`
   - redacted `issue_url` or no-issue-found note
   - `installed_cli_evidence` fields (commit, attestation date, evidence class)
4. **Only after both conditions are true** may maintainers invite external testers (maintainer-approved repos only):
   - `node scripts/run-beta-cohort-guard.mjs` exits `0`
   - `human-ready-rehearsal-record.json` records `record.status` = `LIVE_PASS`

5. **UX discovery (parallel):** while cohort runs, collect friction evidence per [cohort-ux-discovery-runbook](cohort-ux-discovery-runbook.md). Operator UX cut ships in **`v0.24.0-beta.1`**; friction logs remain for ongoing cohort quality — not a substitute for `LIVE_PASS`.

**Not sufficient alone:** doc-chain `DOC_CHAIN_PASS` or cohort guard exit `0` without `LIVE_PASS`.

---

## Performative-beta guard

Docs scanned for **affirmative** external-cohort-open claims (negated lines in “Not claimed” sections are OK). Examples blocked:

- “external beta is open”
- “external tester cohort is open”
- “public beta cohort open”
- “beta cohort has launched”

---

## Related

- [beta-tester-guide](beta-tester-guide.md) · [beta-known-limitations](beta-known-limitations.md)
- [human-ready-rehearsal-evidence](human-ready-rehearsal-evidence.md) · [install-evidence](install-evidence.md)
- [operator-feedback-issue](operator-feedback-issue.md)
