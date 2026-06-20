# Beta degraded-mode acceptance policy

**v0.15 gate criterion:** honest rules for when a degraded orchestrator run is useful for diagnostics but **cannot** count as external-beta success.

**Related:** [contract](../orchestrator/beta-degraded-mode-policy-contract.md) · [strict mode](../orchestrator/strict-mode.md) · [beta smoke matrix](beta-smoke-matrix.md) · [beta dry-run checklist](beta-dry-run-checklist.md) · [collect-run-report](collect-run-report.md) · [inspect-run-evidence](inspect-run-evidence.md)

---

## Summary

| Field | Meaning |
|-------|---------|
| `degraded_mode` | Trace shows degraded execution (banner path or policy triggers) |
| `disqualifies_beta_success` | Run cannot count toward external-beta / smoke-matrix PASS |
| `risk_acceptance_reason` | Semicolon-separated trigger codes (stable, no secrets) |

---

## Disqualifying triggers

A run **cannot** count as beta success when `risk_acceptance_reason` includes any of:

| Code | Typical trace signal |
|------|----------------------|
| `DEGRADED_SKIP_GATES` | `degraded_mode` with `skipStateMcp=true` / `--skip-gates` |
| `DEGRADED_MCP_MISSING` | State store / `register_task` / orchestrator-state MCP unavailable |
| `DEGRADED_NETWORK_GATE_BYPASSED` | `ORCH_SKIP_NETWORK_PERMISSION_GATE=1` evidenced in trace |
| `DEGRADED_PRIVACY_SCAN_REMOTE_UNAVAILABLE` | `PRIVACY_SCAN_UNAVAILABLE` on a remote-capable run |

Diagnostics-only degraded runs (other `degraded_mode` reasons) surface as **warn** — they do not silently pass as beta evidence.

---

## Where flags appear

| Surface | Fields |
|---------|--------|
| `node scripts/inspect-run-evidence.mjs <task_id> --json` | `degraded_assessment` + `INSPECT_DEGRADED_*` check |
| `node scripts/collect-run-report.mjs <task_id>` | `manifest.json` + `inspect-report.json` + `ATTACH.md` |

---

## Operator workflow

1. Prefer **strict** runs (no `--skip-gates`) for beta/smoke evidence.
2. After run, inspect:

   ```bash
   node scripts/inspect-run-evidence.mjs <task_id> --json
   ```

3. If `disqualifies_beta_success` is `true`, do **not** mark smoke-matrix cells `PASS` — file issue or use CERBERUS-approved `EXCEPTION`.
4. Collect bundle for feedback either way (flags are copied into manifest).

---

## Inspect reason codes

| Code | Meaning |
|------|---------|
| `INSPECT_DEGRADED_OK` | No degraded signals |
| `INSPECT_DEGRADED_DIAGNOSTIC` | Degraded but not beta-disqualifying (warn) |
| `INSPECT_DEGRADED_BETA_INELIGIBLE` | Disqualifying trigger — cannot count as beta success (warn) |

Inspect may still exit `0` when only degraded warnings apply; read `degraded_assessment` before claiming beta PASS.

---

## Not claimed

- Degraded diagnostics replace strict gated runs for beta evidence.
- External beta open · production SLA · silent degradation.
