# Trace line schema versioning

JSON Lines traces do **not** have a built-in semver mechanism. This document defines how **`trace_schema_version`** is chosen, bumped, and interpreted so writers and consumers stay aligned.

## Canonical format

- **`trace_schema_version`** is a **string** carried on every trace line (see `strict-mode.md` § *Trace line envelope*).
- **Today:** only **`"2"`** is published for this repository. It labels the JSON Schema at `examples/orchestrator/schemas/trace-v2-line.schema.json` (Ajv validation at write time).
- **Future labels:** we may introduce **`MAJOR.MINOR`** (e.g. `"2.1"`) for **additive** changes within the same major contract, or move to **`"3"`** for the next **breaking** generation. Until then, treat the field as a **monotonic contract label**, not as npm semver.

## Breaking vs non-breaking

| Change | Classification | Action |
|--------|----------------|--------|
| Remove or rename a **required** field; change a field **type**; **tighten** validation (e.g. new required subfield) | **Breaking** | New **major** label (e.g. `"2"` → `"3"`), new JSON Schema file, bump **`TRACE_LINE_WRITER_VERSION`** in `examples/orchestrator/trace-schema.js` (and bundled schema enum), update this doc and `strict-mode.md` in the **same** change. |
| Add **optional** fields; add enum values that old consumers **ignore** safely (forward-compatible parsing) | **Non-breaking** | Either keep the same label and extend one schema, or introduce **`2.1`**-style minor if we split files per minor (policy TBD when the first minor ships). |
| Documentation-only | Neither | No version bump. |

**Rule of thumb:** if an old consumer that **ignores unknown keys** and only reads fields it knows would **misinterpret** or **crash** on a line produced by new code, the change is **breaking**.

## Mismatch behavior

| Layer | Behavior |
|-------|----------|
| **Writer** (`traceEvent` in `orchestrator.js`) | Envelope fields (`task_id`, `trace_schema_version`, `ts`, `ts_ms`) are applied **after** the sanitized payload so callers cannot override the writer version. Each line is validated with **`validateTraceLine`** in `trace-schema.js`: a **policy** step (accepted versions for this binary) then **Ajv** against the bundled schema. Invalid lines **fail the run** (no silent downgrade). |
| **Reader — strict** | `parseTraceLine(line, { strict: true })`, **`ORCH_TRACE_VALIDATE=1`**, or CLI **`--strict-traces`**: policy rejects unknown/missing **`trace_schema_version`** with an explicit error (`this binary only accepts …; got <type>`); then Ajv. Error messages expose only the **root field name** and the **type** of the invalid value — never raw field content or nested subpaths — to prevent payload leakage in logs. |
| **Reader — non-strict** | `JSON.parse` only: you get objects without schema checks. **Unknown or wrong `trace_schema_version`** may parse as JSON but is **out of contract**; pipelines must not treat that as validated telemetry. |

There is **no** automatic cross-version rewrite at read time today; multi-version read compatibility and trace migration tooling are separate, planned efforts (outside the scope of this document).

## Runtime version gate (code)

- **Constants:** `TRACE_LINE_WRITER_VERSION` and `SUPPORTED_TRACE_SCHEMA_VERSIONS_FOR_READ` in `examples/orchestrator/trace-schema.js` — extend the `Set` when this binary ships multiple readers.
- **API:** `traceSchemaVersionPolicyErrors(record)` returns policy-only errors; `validateTraceLine` runs policy first, then JSON Schema.
- **Metrics:** `getValidationMetrics()` returns a snapshot `{ policy_missing_version, policy_unsupported_version, ajv_schema_error, rejections[] }` — counters increment on every rejection; `rejections` holds the last 50 entries (FIFO cap). Each entry has the shape `{ reason, event?, step_id?, reason_code? }` where `reason` is always a member of the exported `REJECTION_REASONS` enum (`"policy_missing_version" | "policy_unsupported_version" | "ajv_schema_error"`); optional fields are omitted (never null) when not present in the record as strings. `resetValidationMetrics()` resets all counters and clears `rejections` (useful in tests).

## Bump checklist (maintainers)

1. Decide **breaking vs non-breaking** (table above).
2. Update or add JSON Schema under `examples/orchestrator/schemas/`.
3. Set **`TRACE_LINE_WRITER_VERSION`** in `trace-schema.js` and the schema file `enum` for `trace_schema_version` to the new label (`orchestrator.js` re-exports the same value as `TRACE_SCHEMA_VERSION`).
4. Update **`strict-mode.md`** (version table + governance) and **this file**.
5. Update **`examples/orchestrator/README.md`** if the user-facing contract string changes.
6. Add/adjust tests in `tests/traceSchema.test.js` (and any ingest CLIs).

## Examples

**Valid v2 line (shape abbreviated):**

```json
{
  "ts": "2026-04-15T12:00:00.000Z",
  "ts_ms": 1713182400000,
  "trace_schema_version": "2",
  "task_id": "task-abc",
  "event": "session_start",
  "flow_mode": "single_agent",
  "max_iterations": 1,
  "cwd": "/tmp",
  "goal": "x"
}
```

**Invalid — unsupported version (rejected by schema enum):**

```json
{
  "ts": "2026-04-15T12:00:00.000Z",
  "ts_ms": 1713182400000,
  "trace_schema_version": "99",
  "task_id": "task-abc",
  "event": "session_start"
}
```

**Invalid — wrong type:**

```json
{
  "trace_schema_version": 2,
  "task_id": "x",
  "event": "session_start"
}
```

Strict validation surfaces these as Ajv errors; see tests in `examples/orchestrator/tests/traceSchema.test.js`.

## explain-run consumers

`examples/orchestrator/explain-run.js` reads trace JSONL and derives a human or JSON summary. It is a **read-only consumer** — it does not validate against the JSON Schema at read time (best-effort parse: invalid lines are skipped). It reads these fields:

| Field | Events | Notes |
|-------|--------|-------|
| `run_id` / `task_id` | any | Used to identify the run in output |
| `ts_ms` | any | Required for sort order; missing treated as 0 |
| `event` | any | Drives all derivations |
| `outcome` | `iteration_done`, `session_end` | `final_status` and retry count |
| `goal`, `flow_mode` | `session_start` | First occurrence only; omitted if absent |
| `failure_type` | any | Taken verbatim; `UNKNOWN` if run failed and field absent |
| `cost_usd` | any | Summed only when numeric; field omitted from output if no data |
| `sequence_id` | any | Tie-breaker for run_id resolution |

Adding optional fields to `trace-v2-line.schema.json` does **not** break `explain-run` — it reads only what it knows. Removing or renaming any field in the table above is a **breaking change** that requires updating `explain-run.js` in the same changeset.

## Related paths

| Artifact | Path |
|----------|------|
| JSON Schema (v2 line) | `examples/orchestrator/schemas/trace-v2-line.schema.json` |
| Validator + policy | `examples/orchestrator/trace-schema.js` (`TRACE_LINE_WRITER_VERSION`, `validateTraceLine`) |
| Write-time alias | `TRACE_SCHEMA_VERSION` in `examples/orchestrator/orchestrator.js` (= `TRACE_LINE_WRITER_VERSION`) |
| Operational strict-mode notes | `docs/orchestrator/strict-mode.md` § *Trace schema versions* |
