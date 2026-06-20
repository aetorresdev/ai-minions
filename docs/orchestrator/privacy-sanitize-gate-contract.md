# Privacy sanitize gate contract

Outbound sensitive-data scanning and redaction before remote LLM prompts and shareable operator bundles.

**Implementation:** `orchestrator/security/sensitive-data-scanner.js`  
**Consumers:** `orchestrator/agents.js` (Claude CLI prompts), `scripts/collect-run-report.mjs` (shareable bundle)

## Problem

Traces, ATTACH bundles, and remote prompts can leak PII or secret-shaped values. External beta requires deterministic redaction and fail-closed remote blocking when scanning cannot complete.

## Public API name

`SensitiveDataScanner` module exports — not `PresidioScanner`. Presidio is an optional internal adapter only.

## Inputs

| Input | Source |
|-------|--------|
| Outbound text | Remote Claude prompt (`askAgent`, `chatWithAgent`) |
| Bundle text artifacts | `.json`, `.jsonl`, `.md`, `.txt` under report bundle dir |

Optional environment:

| Variable | Effect |
|----------|--------|
| `PRIVACY_USE_PRESIDIO=1` | Request Presidio adapter (v0.15: unavailable; regex fallback runs) |
| `PRIVACY_SCAN_FORCE_FAIL=1` | Test hook — forces scan failure |

## Outputs

Scan result (summaries only — never original secret values):

```json
{
  "privacy_scan_status": "ok",
  "reason_code": "PRIVACY_SCAN_OK",
  "redaction_counts": { "pii": 0, "secret": 0 },
  "redacted_artifact_path": null
}
```

Bundle collector additionally writes:

- `privacy-scan.json` — aggregate counts and reason code
- `shareable/` — redacted mirrors of text artifacts for upload

## Status / reason codes

| Code | When |
|------|------|
| `PRIVACY_SCAN_OK` | No sensitive shapes detected |
| `PRIVACY_PII_REDACTED` | Email or phone redacted |
| `PRIVACY_SECRET_REDACTED` | Secret-shaped tokens redacted (API keys, bearer, AWS, GitHub, URL creds, `.env`-style values) |
| `PRIVACY_SCAN_UNAVAILABLE` | Optional Presidio requested but unavailable; regex may still run |
| `PRIVACY_SCAN_FAILED_BLOCKED` | Scan failed — remote path blocked |

`privacy_scan_status`: `ok` · `redacted` · `blocked` · `unavailable`

## Policy

| Path | Scan failure | Redaction |
|------|--------------|-----------|
| Remote Claude | **Block** (`PRIVACY_SANITIZE_BLOCKED`) | Privacy-owned forced redaction before send — **ignores** `ORCH_TRACE_SKIP_SECRET_REDACT` |
| Local-only / bundle shareable | **Warn**, continue | Deterministic redaction on all `shareable/**` copies |

Raw top-level bundle files (`trace/*.jsonl`, unredacted artifacts) are **local-only**. Upload default: `privacy-scan.json` + `shareable/**` only.

## Unsupported behavior

- Logging original secret or PII values
- Proceeding with remote provider when scan fails (default)
- Full DLP platform scope

## Tests

- `orchestrator/tests/sensitiveDataScanner.test.js` — fixtures, bundle redaction, remote block
- `orchestrator/tests/askAgent.test.js` — remote prompt redaction integration
- `tests/collect-run-report.test.mjs` — shareable bundle privacy gate

## Trace fields (future)

When wired to trace reporter: `privacy_scan_status`, `reason_code`, `redaction_counts` only — no raw matches.
