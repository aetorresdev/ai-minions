# Credential broker contract

**Ticket:** `ENV-CREDENTIAL-BROKER-1` · **Status:** MVP runtime + doc (post-alpha)

**Problem:** Removing secret values from prompt/context ([`environment-access.md`](environment-access.md), `buildEnvContext`) is necessary but not sufficient. Tools that need live credentials must resolve env **outside** model context and enforce read/write **before** execution.

**Not claimed:** enterprise vault, hosted auth broker, rotation, multi-tenant isolation, full sandbox.

---

## Request shape

Runtime entry: `requestCredentialUse()` in `orchestrator/credential-broker.js`.

**Canonical API (JavaScript):** camelCase parameter names. **Aliases:** the same fields may be passed as snake_case (e.g. `credential_alias`) for compatibility; runtime normalizes before policy.

| Field (canonical) | Type | Notes |
|-------------------|------|--------|
| `credentialAlias` | string | Session credential `name` (not env var name) |
| `operationClass` | string | Normalized op: `query`, `read`, `apply`, `execute`, … |
| `target` | string | Optional resource hint; **sanitized** before trace (query params, env values, secret-shaped substrings redacted) |
| `agentId` | string | Role consuming credential |
| `sessionEnv` | object | Parsed `ENVIRONMENT` block (`mode`, `credentials`) |
| `taskId` | string | Optional — emit `credential_broker_used` trace when set |
| `tracesDir` | string | Optional trace output directory |

---

## Decision flow

1. **Effective mode** — `min(role permission, session mode)`; CERBERUS hardcoded `read` ([`agents/permissions.js`](../../orchestrator/agents/permissions.js)).
2. **Resolve credential** — match `credential_alias` to session credential; resolve `process.env` **only inside broker** (never returned in trace).
3. **Classify operation** — `read-class` vs `write-class` vs `unknown`.
4. **Policy** — deny write-class when effective mode is `read`; deny when role is `none`; deny missing/partial env.
5. **Trace** — `credential_broker_used` with alias, operation class, decision, `reason_code` — **never** secret values or substrings. Optional `target` is passed through `sanitizeBrokerTraceTarget()` (env values from session credential vars, URL query values, and `trace-redact` patterns).

---

## Operation classes

| Class | Examples (normalized) |
|-------|------------------------|
| **read** | `query`, `list`, `describe`, `read`, `plan`, `diff`, `dry_run`, `get` |
| **write** | `apply`, `activate`, `update`, `execute`, `delete`, `create`, `insert`, `patch`, `put`, `post` |
| **unknown** | Unrecognized → **deny** (fail closed) |

---

## Trace event `credential_broker_used`

| Field | Required | Notes |
|-------|----------|--------|
| `event` | yes | `credential_broker_used` |
| `credential_alias` | yes | |
| `operation_class` | yes | Requested op (normalized) |
| `operation_kind` | yes | `read` \| `write` \| `unknown` |
| `decision` | yes | `allow` \| `deny` |
| `reason_code` | yes | See table below |
| `agent_id` | yes | |
| `effective_mode` | yes | `none` \| `read` \| `write` |
| `target` | no | Sanitized resource hint only (max 200 chars after redaction) |

### `reason_code` values

| Code | Meaning |
|------|---------|
| `credential_broker_allowed` | Resolved + policy allow |
| `credential_broker_denied_read_mode` | Write-class op under read effective mode |
| `credential_broker_denied_role_none` | Role cannot use credentials |
| `credential_broker_denied_missing_env` | Required env vars unset |
| `credential_broker_denied_unknown_alias` | Alias not in session |
| `credential_broker_denied_unknown_operation` | Unclassified operation |

---

## Response shape (runtime)

```javascript
{
  allowed: boolean,
  decision: "allow" | "deny",
  reason_code: string,
  credential_alias: string,
  operation_class: string,
  // Present only when allowed — for approved tool wrapper; never log/trace these values
  resolved?: Record<string, string>,
}
```

---

## Related

- [`environment-access.md`](environment-access.md) — session header + prompt contract
- E2E proof (mocked tool wrapper): `orchestrator/tests/env-readonly-write-block-e2e.test.js` — write-class ops denied under `mode: read`, stable `credential_broker_denied_read_mode` in trace
- [`eval-benchmark-triage.md`](eval-benchmark-triage.md) — explicit gap closed for broker MVP
