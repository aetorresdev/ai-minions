# Beta gate hardening — verify and claim audit (contract)

Operator how-to: [beta-gate-hardening-evidence.md](../how-to/beta-gate-hardening-evidence.md).

## Purpose

Wire **deterministic doc verification** and **product-claim audit** for the v0.15 external-beta gate-hardening doc bundle — without opening external beta or changing runtime behavior.

## Evidence chain (CI default)

`node scripts/run-beta-gate-hardening-evidence.mjs` runs:

1. `verify-usage-docs.mjs` — README ↔ how-to alignment + contract markers.
2. `audit-product-claims.mjs` — forbidden affirmative claims in operator docs (includes v0.15 beta gate docs).
3. `run-beta-smoke-matrix.mjs --skip-live` — matrix doc + record JSON structure.
4. Contract unit tests — `beta-limitations-onboarding`, `degraded-mode-evidence`.

## Claim audit scope (operator docs)

Includes v0.15 gate-hardening how-tos:

- `beta-known-limitations.md` · `beta-tester-guide.md` · `beta-dry-run-checklist.md`
- `beta-smoke-matrix.md` · `beta-degraded-mode-policy.md`
- Plus existing v0.11–v0.14 operator docs in `CLAIM_AUDIT_PATHS`.

## README requirements

Root `README.md` must link gate-hardening docs and expose the three validation commands:

- `node scripts/verify-usage-docs.mjs`
- `node scripts/audit-product-claims.mjs`
- `node scripts/run-beta-gate-hardening-evidence.mjs`

## Unsupported behavior

- Treating claim-audit pass as external-beta cohort approval.
- Skipping claim audit on gate-hardening doc edits in release-prep.

## Out of scope (this slice)

- Release tag / CHANGELOG cut (→ release-prep slice).
- Live smoke-matrix cell attestation (maintainer manual).
