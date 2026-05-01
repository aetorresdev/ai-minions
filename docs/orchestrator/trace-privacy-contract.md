# Trace privacy and redaction contract

How sensitive-shaped content is kept out of **persisted JSONL traces** and **read-side exports** (dashboard, batch metrics, CLIs). Shape-based, deterministic rules — not full secret scanning or PII detection.

## Canonical sources

1. **Writer path:** `orchestrator/orchestrator.js` — **`_sanitize()`** runs **`redactSensitivePlaintext()`** from **`orchestrator/trace-redact.js`** on leak-prone string fields before schema validation and append to the trace file. Field list and caps: [strict-mode.md](./strict-mode.md) § *Writer-time secret redaction*.
2. **Read-time defense-in-depth:** **`sanitizeTraceRowsForRead()`** in **`orchestrator/trace-redact.js`** — bounded deep walk over parsed JSONL rows (same patterns on every string). Used by **`token-trace-report.js`**, **`scenario-metrics-export.js`** / **`collectRunsFromDir`**, **`console-dashboard.js`**, **`explain-run.js`** when ingesting files that may not have passed the writer sanitizer.
3. **Classification table (policy for external sharing):** [strict-mode.md](./strict-mode.md) § *Trace field classification (exports, dashboards, shared logs)*.
4. **Patterns:** Bearer-shaped tokens, `sk-` API key prefix, AWS access key id shape, GitHub PAT shape, Slack bot token shape, URL `user:password@` before host → **`[REDACTED:…]`** placeholders. See **`redactSensitivePlaintext()`** in code for exact regex scope.

## Environment behavior

| Variable | Effect |
|----------|--------|
| **`TRACE_REDACT_GOAL=1`** | Omit goal text entirely (hash-only form); see writer comments in orchestrator. |
| **`ORCH_TRACE_SKIP_SECRET_REDACT=1`** | Skip redaction (local debugging only). **Refused** when **`CI`** is a truthy CI flag — process exits when loading **`trace-redact.js`** with both set. |

## Test anchors

| Area | File |
|------|------|
| Pattern unit tests, `_sanitize`, read sanitizer, CLI smoke (`token-trace-report`, `explain-run`) | `orchestrator/tests/traceSecretRedact.test.js` |
| Export rollups redact nested strings in **`by_agent_phase`** keys | `orchestrator/tests/scenarioMetricsExport.test.js` |

## Limits (explicit)

- **Blob size:** Writer applies **string length caps** after redaction on common text fields (`task`, `reason`, `summary`, `transition_reason.details`, etc.); see **`_sanitize()`**. No separate “strip megabyte payload” event — prefer schema/truncation at emit site for new events.
- **Unknown shapes:** Strings that do not match the listed patterns pass through unchanged — operators must avoid putting raw secrets in trace fields.
- **Out of scope for this contract:** network egress policy, runtime permission model (see other orchestrator docs).
