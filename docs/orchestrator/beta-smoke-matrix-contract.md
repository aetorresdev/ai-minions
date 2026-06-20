# Beta smoke matrix contract

Operator-facing checklist: [beta-smoke-matrix.md](../how-to/beta-smoke-matrix.md). Machine record: [beta-smoke-matrix-record.json](../how-to/evidence/beta-smoke-matrix-record.json).

## Purpose

Close the **evidence gate** before external usability beta (v0.16): prove documented smoke paths work on minimum OS × provider × flow combinations, with trace / inspect / bundle artifacts — or record a **CERBERUS-approved exception**.

## Minimum axes

| Axis | Values |
|------|--------|
| OS | `linux`, `macos`, `docker` |
| Provider | `ollama`, `openai-compat-local` *(experimental)*, `claude-cli-api` |
| Flow | `single-agent`, `multi-agent` |
| Task tier | `trivial`, `realistic` |
| Evidence | `trace`, `inspect`, `bundle`, `failure_reason` |

## Cell result vocabulary

`PASS` · `FAIL` · `SKIP` · `PENDING` · `EXCEPTION`

`EXCEPTION` requires:

```json
{
  "cerberus_approved": true,
  "reason": "short operator-facing rationale",
  "approved_at": "YYYY-MM-DD"
}
```

`--validate-gate` rejects `EXCEPTION` cells missing non-empty `reason` or valid `approved_at`.

## Gate classes

| Class | Meaning |
|-------|---------|
| `required` | Must be `PASS` or approved `EXCEPTION` before external beta |
| `experimental` | May remain `PENDING` or `EXCEPTION` until backend ships |

Canonical cell list: `scripts/lib/beta-smoke-matrix-data.mjs` → `MINIMUM_GATE_CELLS`.

## Evidence script

`scripts/run-beta-smoke-matrix.mjs`

| Mode | Behavior |
|------|----------|
| `--skip-live` *(CI default)* | Validate matrix doc + record JSON + claim audit |
| `--validate-gate` | Also require all `required` cells PASS or approved EXCEPTION |
| `--json` | Machine-readable report |

## Reason codes

`SMOKE_MATRIX_OK` · `SMOKE_MATRIX_DOC_FAIL` · `SMOKE_MATRIX_RECORD_FAIL` · `SMOKE_MATRIX_GATE_FAIL` · `SMOKE_MATRIX_CLAIM_AUDIT_FAIL`

## Unsupported behavior

- Claiming external beta is open without gate evidence.
- Treating `PENDING` as PASS on release gate.
- Full multi-OS CI grid in v0.15 (manual attestation only).

## Out of scope (v0.15)

- Automated parallel smoke farm across all cells.
- LM Studio / llama.cpp / vLLM functional backends beyond documented experimental cell.
- Degraded-mode policy (→ separate contract doc).

## Acceptance (slice)

- [ ] Matrix how-to published with minimum gate table.
- [ ] Evidence JSON schema + committed template record.
- [ ] `run-beta-smoke-matrix.mjs` CI-safe chain + `--validate-gate` for release.
- [ ] Wired into `verify-usage-docs` and Docs usage verify workflow.
