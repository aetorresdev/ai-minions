# OpenTelemetry GenAI trace export contract

Collector-agnostic export path for ai-minions JSONL traces. **JSONL remains SoT** for harness behavior; OTel spans are a **derived** observability plane.

**Pinned semconv:** OpenTelemetry GenAI `1.36.0` (constant `OTEL_GENAI_SEMCONV_PIN` in `otel-genai-trace-map.js`).

---

## Slice 1 (shipped in this ticket)

| Component | Role |
|-----------|------|
| `otel-genai-trace-map.js` | Map selected JSONL `event` rows → span shapes + attribute redaction |
| `tests/otelGenaiTraceMap.test.js` | Mapping, parent/root linkage, secret redaction, GenAI usage attrs |

**Not in slice 1:** OTLP HTTP exporter (`OTEL_EXPORTER_OTLP_ENDPOINT`) — follow-up slice.

---

## Span mapping (subset)

| JSONL `event` | OTel span `name` |
|---------------|------------------|
| `session_start` | `orchestrator.run` (root) |
| `session_end` | `orchestrator.run.end` |
| `permission_check` | `permission.check` |
| `context_stats` | `gen_ai.chat` |
| `review_record` | `cerberus.review` |
| `doubt_review_*` | `cerberus.doubt_review` |
| `approval_*` | `governance.approval` |
| `budget_*` | `budget.event` |
| `workspace_promotion_*` | `workspace.promotion` |

Unmapped events are **omitted** (no span) — JSONL SoT unchanged.

---

## Correlation

- `traceId` = deterministic hash of `task_id` (stable per run).
- Span attributes always include `ai_minions.task_id` and `ai_minions.event`.
- Root span = first `session_start`; child spans reference `parentSpanId` when present.

---

## Content capture policy

| Env / option | Default | Behavior |
|--------------|---------|----------|
| `ORCH_OTEL_GENAI_CAPTURE_CONTENT` | unset / `0` | Strip `goal`, `prompt`, `response`, `handoff_yaml`, and similar content keys from span attributes |
| `ORCH_OTEL_GENAI_CAPTURE_CONTENT=1` | opt-in | Include content keys (operator risk — not for CI) |

All string attributes pass through `trace-redact` secret-shaped redaction regardless.

**Forbidden claims:** Sentry-required backend · prompt/response in spans by default · JSONL SoT replacement.

---

## Validation

```bash
cd orchestrator && npm test
```

Future slice: in-memory OTLP collector fixture + `OTEL_EXPORTER_OTLP_ENDPOINT` integration test.
