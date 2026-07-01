# Modular closeout dry-run evidence (v0.17)

**Release criterion:** prove modular closeout layout is guarded — claim audit, root/import guards, honest partial docs, and layout/export parity tests — before `v0.17.0-alpha.1` release-prep.

**Contract:** [modular-closeout-evidence-contract.md](../orchestrator/modular-closeout-evidence-contract.md)

---

## Quick run

From repo root:

```bash
node scripts/run-modular-closeout-evidence.mjs
node scripts/run-modular-closeout-evidence.mjs --json
```

From `orchestrator/`:

```bash
npm run evidence:closeout
```

**Pass:** exit `0` · all steps `pass`.

**Reason codes:** `CLOSEOUT_OK` · `CLOSEOUT_CLAIM_AUDIT_FAIL` · `CLOSEOUT_ROOT_IMPORT_GUARD_FAIL` · `CLOSEOUT_MODULE_BOUNDARIES_FAIL` · `CLOSEOUT_DOC_RUNTIME_CLAIMS_FAIL` · `CLOSEOUT_DOC_HONESTY_FAIL` · `CLOSEOUT_HARNESS_SCOPE_FAIL` · `CLOSEOUT_PARITY_TESTS_FAIL`

---

## What the chain checks

| Step | Proves |
|------|--------|
| Claim audit | Operator docs free of inflated product claims (`audit-product-claims.mjs`) |
| Root import guard | No new unlisted root runtime files; shim headers valid |
| Module boundaries | Import matrix + allowlist enforced |
| Doc runtime claims | Versioned `docs/orchestrator/*.md` overclaim scan |
| Closeout doc honesty | Audit/inventory/boundaries docs state partial layout |
| Harness scope | Test-only env vars allowlisted |
| Parity tests | Physical layout, export parity, architecture audit contract |

**Not claimed:** architecture refactor complete · shim retirement · external usability beta · production readiness.

---

## Related

- [alpha-release-checklist](../orchestrator/alpha-release-checklist.md) — v0.17 must-have bundle
- [architecture-coherence-audit.md](../orchestrator/architecture-coherence-audit.md) — slice status table
