# Modular closeout evidence contract (v0.17)

**Scope:** dry-run evidence for **v0.17 modular monolith closeout** before `v0.17.0-alpha.1` release-prep. **Not** external beta · **not** architecture-complete claim.

**Script:** `scripts/run-modular-closeout-evidence.mjs` · orchestrator shim `orchestrator/scripts/run-modular-closeout-evidence.mjs`

**How-to:** [modular-closeout-evidence.md](../how-to/modular-closeout-evidence.md)

---

## Evidence chain

| Step | Check | Fail code |
|------|-------|-----------|
| Claim audit | `audit-product-claims.mjs` | `CLOSEOUT_CLAIM_AUDIT_FAIL` |
| Root import guard | `check-root-import-guard.js` | `CLOSEOUT_ROOT_IMPORT_GUARD_FAIL` |
| Module boundaries | `lint:module-boundaries` | `CLOSEOUT_MODULE_BOUNDARIES_FAIL` |
| Doc runtime claims | `lint:docs-claims` | `CLOSEOUT_DOC_RUNTIME_CLAIMS_FAIL` |
| Closeout doc honesty | partial / not architecture-complete markers in audit docs | `CLOSEOUT_DOC_HONESTY_FAIL` |
| Harness scope | `ci-check-harness-scope.sh` | `CLOSEOUT_HARNESS_SCOPE_FAIL` |
| Parity tests | layout + export parity + root guard contract tests | `CLOSEOUT_PARITY_TESTS_FAIL` |

**Pass:** exit `0` · all steps `pass`.

---

## Not claimed

Do **not** claim architecture refactor complete, full modular monolith enforced, external beta open, production-ready, or zero compat shims.

---

## Related

- [architecture-coherence-audit.md](architecture-coherence-audit.md)
- [root-file-inventory.md](root-file-inventory.md)
- [alpha-release-checklist.md](alpha-release-checklist.md) — v0.17 section
