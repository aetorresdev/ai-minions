# Beta gate hardening evidence and claim audit

**v0.15 release criterion:** prove gate-hardening operator docs stay aligned (`verify-usage-docs`), free of inflated claims (`audit-product-claims`), and structurally valid (smoke matrix record + contract tests).

**Contract:** [beta-gate-hardening-verify-contract.md](../orchestrator/beta-gate-hardening-verify-contract.md)

---

## Modes

| Mode | What it proves | Command |
|------|----------------|---------|
| **CI gate-hardening chain** *(default in PRs)* | Doc verify + claim audit + matrix structure + contract tests | `node scripts/run-beta-gate-hardening-evidence.mjs` |
| **Doc alignment only** | README ↔ how-to markers | `node scripts/verify-usage-docs.mjs` |
| **Claim audit only** | No forbidden affirmative product claims | `node scripts/audit-product-claims.mjs` |
| **Smoke matrix structure** | Matrix doc + record JSON | `node scripts/run-beta-smoke-matrix.mjs --skip-live` |

**Not claimed:** passing this chain opens external usability beta · production SLA · automatic merge approval without orchestrator tests when runtime paths change.

---

## Quick run

From repo root:

```bash
node scripts/run-beta-gate-hardening-evidence.mjs
node scripts/run-beta-gate-hardening-evidence.mjs --json
```

**Pass:** exit `0` · all steps `pass` or documented `skip`.

**Reason codes:** `GATE_HARDENING_OK` · `GATE_HARDENING_DOCS_VERIFY_FAIL` · `GATE_HARDENING_CLAIM_AUDIT_FAIL` · `GATE_HARDENING_SMOKE_MATRIX_FAIL` · `GATE_HARDENING_CONTRACT_TESTS_FAIL`

---

## What the chain checks

| Step | Script / test | Stable codes |
|------|---------------|--------------|
| Doc alignment | `verify-usage-docs.mjs` | implicit exit code |
| Claim audit | `audit-product-claims.mjs` | `CLAIM_*` |
| Smoke matrix structure | `run-beta-smoke-matrix.mjs --skip-live` | `SMOKE_MATRIX_*` |
| Limitations/onboarding contracts | `tests/beta-limitations-onboarding.test.mjs` | — |
| Degraded-mode wiring | `tests/degraded-mode-evidence.test.mjs` | `INSPECT_DEGRADED_*` |

---

## Gate-hardening doc map

| Topic | How-to | Contract |
|-------|--------|----------|
| Limitations + onboarding | [beta-known-limitations](beta-known-limitations.md) | [beta-limitations-onboarding-contract](../orchestrator/beta-limitations-onboarding-contract.md) |
| Smoke matrix | [beta-smoke-matrix](beta-smoke-matrix.md) | [beta-smoke-matrix-contract](../orchestrator/beta-smoke-matrix-contract.md) |
| Degraded-mode policy | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) | [beta-degraded-mode-policy-contract](../orchestrator/beta-degraded-mode-policy-contract.md) |
| Privacy outbound scan | [privacy sanitize gate contract](../orchestrator/privacy-sanitize-gate-contract.md) | `PRIVACY_*` |

---

## CI

**Docs usage verify** workflow runs this chain on PRs touching gate-hardening docs/scripts. See [fresh-clone-evidence](fresh-clone-evidence.md) for the v0.11 entry-path chain (complementary, not a substitute).

---

## Related

- [beta-tester-guide](beta-tester-guide.md) — internal dry-run runbook
- [harness-health-checkpoints](harness-health-checkpoints.md) — broader harness checks
- [alpha-release-checklist](../orchestrator/alpha-release-checklist.md) — v0.15 must-have bundle
