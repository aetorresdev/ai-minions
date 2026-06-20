# Beta degraded-mode acceptance policy (contract)

Operator how-to: [beta-degraded-mode-policy.md](../how-to/beta-degraded-mode-policy.md).

## Purpose

Define when a **degraded** orchestrator run may be used for diagnostics but **cannot** count as external-beta success evidence.

## Rules

1. Degraded mode is allowed for diagnostics.
2. A run **disqualifies** external-beta success when any trigger applies:
   - `--skip-gates` / `skipStateMcp=true` (`DEGRADED_SKIP_GATES`)
   - Required MCP / state store unavailable (`DEGRADED_MCP_MISSING`)
   - Network permission gate bypassed (`DEGRADED_NETWORK_GATE_BYPASSED`)
   - Privacy scan unavailable on a remote-capable path (`DEGRADED_PRIVACY_SCAN_REMOTE_UNAVAILABLE`)
3. Inspect and bundle outputs must surface `degraded_mode`, `disqualifies_beta_success`, and `risk_acceptance_reason`.

## Assessment source

`scripts/lib/degraded-mode-evidence.mjs` — deterministic trace JSONL scan (no LLM).

## Inspect reason codes

`INSPECT_DEGRADED_OK` · `INSPECT_DEGRADED_DIAGNOSTIC` · `INSPECT_DEGRADED_BETA_INELIGIBLE`

## Bundle fields

`manifest.json` and `inspect-report.json` include `degraded_assessment` object with the fields above.

## Unsupported behavior

- Treating a disqualifying degraded run as smoke-matrix PASS evidence.
- Omitting degraded flags from inspect/bundle when trace shows degradation.

## Out of scope (v0.15)

- Eliminating all degraded paths.
- Auto-blocking collect-report on degraded runs (warn + surface flags only).
