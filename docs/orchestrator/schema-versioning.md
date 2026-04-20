# Trace line schema versioning

JSON Lines traces do **not** have a built-in semver mechanism. This document defines how **`trace_schema_version`** is chosen, bumped, and interpreted so writers and consumers stay aligned.

## Canonical format

- **`trace_schema_version`** is a **string** carried on every trace line (see `strict-mode.md` § *Trace line envelope*).
- **Today:** only **`"2"`** is published for this repository. It labels the JSON Schema at `examples/orchestrator/schemas/trace-v2-line.schema.json` (Ajv validation at write time).
- **Future labels:** we may introduce **`MAJOR.MINOR`** (e.g. `"2.1"`) for **additive** changes within the same major contract, or move to **`"3"`** for the next **breaking** generation. Until then, treat the field as a **monotonic contract label**, not as npm semver.

## Breaking vs non-breaking

| Change | Classification | Action |
|--------|----------------|--------|
| Remove or rename a **required** field; change a field **type**; **tighten** validation (e.g. new required subfield) | **Breaking** | New **major** label (e.g. `"2"` → `"3"`), new JSON Schema file, bump `TRACE_SCHEMA_VERSION` in `orchestrator.js`, update this doc and `strict-mode.md` in the **same** change. |
| Add **optional** fields; add enum values that old consumers **ignore** safely (forward-compatible parsing) | **Non-breaking** | Either keep the same label and extend one schema, or introduce **`2.1`**-style minor if we split files per minor (policy TBD when the first minor ships). |
| Documentation-only | Neither | No version bump. |

**Rule of thumb:** if an old consumer that **ignores unknown keys** and only reads fields it knows would **misinterpret** or **crash** on a line produced by new code, the change is **breaking**.

## Mismatch behavior

| Layer | Behavior |
|-------|----------|
| **Writer** (`traceEvent` in `orchestrator.js`) | Lines are validated with Ajv against the schema for `TRACE_SCHEMA_VERSION`. Invalid lines **fail the run** (no silent downgrade). |
| **Reader — strict** | `parseTraceLine(line, { strict: true })`, **`ORCH_TRACE_VALIDATE=1`**, or CLI **`--strict-traces`**: invalid or unknown **`trace_schema_version`** for the bundled schema → **throw / fail** (same as any other schema error). |
| **Reader — non-strict** | `JSON.parse` only: you get objects without schema checks. **Unknown or wrong `trace_schema_version`** may parse as JSON but is **out of contract**; pipelines must not treat that as validated telemetry. |

There is **no** automatic cross-version rewrite at read time in this ticket; see backlog **TEL-COMPAT-1** / **TEL-MIGRATE-1** for planned compatibility and migration tooling.

## Bump checklist (maintainers)

1. Decide **breaking vs non-breaking** (table above).
2. Update or add JSON Schema under `examples/orchestrator/schemas/`.
3. Set **`TRACE_SCHEMA_VERSION`** in `orchestrator.js` to the new label (must match schema `enum` for that line contract).
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

## Related paths

| Artifact | Path |
|----------|------|
| JSON Schema (v2 line) | `examples/orchestrator/schemas/trace-v2-line.schema.json` |
| Validator | `examples/orchestrator/trace-schema.js` |
| Write-time version constant | `TRACE_SCHEMA_VERSION` in `examples/orchestrator/orchestrator.js` |
| Operational strict-mode notes | `docs/orchestrator/strict-mode.md` § *Trace schema versions* |
