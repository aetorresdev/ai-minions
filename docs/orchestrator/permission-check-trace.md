# Permission decision traces (`permission_check`)

**Status:** implemented — JSON Schema validation on trace writes (`event: permission_check`).

**Related:** [runtime-permission-contract.md](runtime-permission-contract.md) §8, `orchestrator/security/trace-security-decision.js`, `orchestrator/schemas/trace-v2-line.schema.json`.

## Purpose

Every permission evaluation that produces trace output must be **auditable after the fact** without leaking secrets:

- Which **permission profile** was active (`permission_profile` — same semantics as docs that mention `run_mode`).
- Why allow/deny/requires_approval (`reason_code`, `decision`).
- Which domain/tool class was evaluated (`domain`, `tool`, `action_class`, `target_class`).

**No raw prompts, URLs with query strings, credential values, or arbitrary user payloads** belong in this line. The builder **`traceSecurityDecision()`** only copies a fixed subset of evaluator input/output.

## Event shape (full JSONL line)

Trace lines share the global envelope: `ts`, `ts_ms`, `trace_schema_version`, `task_id`, `event`.

For `event === "permission_check"`, these payload fields are **required**:

| Field | Meaning |
|-------|---------|
| `actor` | Who initiated the check (string). |
| `role` | Active orchestrator role (string). |
| `tool` | Tool identifier (e.g. `server.tool` for MCP, **`claude_cli`** for Anthropic CLI spawn, **`ollama_chat`** / **`ollama_health_check`** for Ollama HTTP). |
| `domain` | Permission domain (`filesystem`, `mcp`, `shell`, **`network`**, `context_retrieval`, …). |
| `action_class` | Classified action (`read`, `external_side_effect`, …). |
| `target_class` | Normalized target class or `null`. |
| `decision` | `allow` \| `deny` \| `requires_approval` |
| `reason_code` | Stable machine-readable reason (evaluator vocabulary). |
| `policy_source` | Where policy came from (`built_in_profile`, merged project policy, …). |
| `permission_profile` | Active profile name (`dev-local`, `ci-safe`, …). |
| `requires_approval` | Boolean. |

**Note on “warn”:** the evaluator does **not** emit a separate `decision: warn`. Warn-style policy paths are expressed via **`reason_code`** (e.g. MCP trust warn paths) together with `decision` `allow` or `deny`.

### Compatibility — dashboards and rollups (e.g. future security summaries)

- **Do not** infer “warning” outcomes from `decision` alone — it only takes **`allow` \| `deny` \| `requires_approval`**.
- Rollups that must capture warn-style policy paths must key off **`reason_code`** (and optionally substring/prefix conventions such as `*_warn_*`), not `decision`.
- Aggregating only by `decision` can **omit or mislabel** warn semantics and make summaries look healthier than they are.

## Example (allow)

```json
{
  "ts": "2026-05-05T18:00:00.000Z",
  "ts_ms": 1746464400000,
  "trace_schema_version": "2",
  "task_id": "task-example",
  "event": "permission_check",
  "actor": "orchestrator",
  "role": "ORCHESTRATOR",
  "tool": "orchestrator-state.register_task",
  "domain": "mcp",
  "action_class": "external_side_effect",
  "target_class": null,
  "decision": "allow",
  "reason_code": "mcp_trust_allow",
  "policy_source": "built_in_profile",
  "permission_profile": "dev-local",
  "requires_approval": false
}
```

## Example (deny)

Same envelope; `decision`: `"deny"`, `requires_approval`: `false`, and a deny `reason_code` (e.g. `mcp_trust_warn_deny`, `credential_export_denied`).

## Auditing from exports

1. Filter JSONL where `event === "permission_check"`.
2. Group by `permission_profile` then `reason_code` to see policy outcomes under each mode.
3. Join with the following `mcp_call` line (when present) by proximity/`task_id` to correlate permission outcome with MCP execution.

## Validation

Writes go through `validateTraceLine()` in `orchestrator/trace-schema.js`; invalid `permission_check` lines fail fast at emit time.
