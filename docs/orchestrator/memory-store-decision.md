# Memory and local storage decision

**Design-first evaluation** — separates storage categories, compares options, and records a **go/no-go** for a unified local store. **No runtime implementation** in this slice.

Context is finite; storage semantics must not become an unbounded closet of stale facts. Session resume ([session-resume-contract.md](session-resume-contract.md)) already derives checkpoints from traces — this doc decides whether a **separate store** is warranted and how it must relate to that layer.

---

## Decision (go / no-go)

| Verdict | Scope |
|---------|--------|
| **Go — keep separated planes** | Trace JSONL remains **source of truth** for observability, review records, recovery, and post-hoc resume. Disk MCP envelopes, in-memory run state, and hook-local files stay in their existing roles. |
| **No-go — unified store (v0.1.x)** | Do **not** introduce one SQLite/DB bucket labeled “memory” that merges trace payloads, semantic facts, session checkpoints, and cache. |
| **Conditional go — future index only** | A small **SQLite catalog** (task_id, mtime, scenario_id, resume eligibility summary hash) may be added **later** as an **operator index** pointing at trace files — never replacing JSONL or duplicating full payloads. Requires its own implementation ticket. |

> **SQLite index is not approved for implementation in this PR.** Any implementation requires a follow-up ticket with schema, migrations, tests, privacy review, and export compatibility.

**Recommendation:** Ship **separation + contracts** now; defer any DB index until an operator pain point is measured (slow scans of large trace dirs, repeated export jobs).

---

## Category boundaries (mandatory)

Do not collapse these into a single “state store.”

| Category | What it holds | Authority | Typical location today | TTL / staleness |
|----------|---------------|-----------|------------------------|-----------------|
| **Trace log** | Append-only run events (`session_*`, `agent_*`, `permission_check`, `review_record`, `recovery_*`, …) | **Canonical** for audit and export | `~/.claude/metrics/traces/<task_id>.jsonl` | Retained until operator deletes; no automatic expiry |
| **Run state (gates)** | Envelope, transitions, approved artifacts for MODE gates | **Authoritative for gate recording** when MCP on | `ORCHESTRATOR_STATE_ROOT/<task_id>/` via `orchestrator-state` MCP | Task-scoped; not long-lived semantic memory |
| **Run state (runtime)** | In-flight step/intent snapshot | **Ephemeral**; mirrored on `session_end` | `runState` in `orchestrator/run-state.js` | Cleared when process exits |
| **Session log / resume** | Operational checkpoint: goal, step, blockers, permission/cost snapshot | **Derived** from trace (recomputable) | `buildSessionCheckpointFromRows` / `run_outcome_summary.resume` | Invalid when trace or policy diverges; not ground truth alone |
| **Compact handoff artifacts** | Structured YAML between roles | **Contract input**; gated by MCP | compact-handoff MCP + trace `compact_handoff_*` | Scoped to iteration/handoff; superseded by later handoffs |
| **Review records** | QA/CERBERUS verdicts, blockers | **Durable in trace** | `review_record` events | Open blockers until superseding review or run end |
| **Recovery findings** | Stranded step / incomplete session signals | **Derived** (post-hoc recompute SoT) | `recovery-sweep.js` + `run_outcome_summary.recovery` | Historical `recovery_completed` may disagree after `session_end` |
| **Persistent memory (semantic)** | User/project facts across sessions | **External to orchestrator** | Host hooks (e.g. mem0), editor memory — not orchestrator runtime | Must carry provenance; never override trace/gates |
| **Cache** | Model context reuse metrics | **Observability only** | `context_stats`, cache fields in traces | Not persisted as standalone facts store |

---

## Relationship to session resume

**The memory store does not implement resume.**

| Layer | Role |
|-------|------|
| **Trace JSONL** | SoT for events resume logic consumes |
| **Session resume module** | Derives checkpoint + eligibility; may emit `session_*` trace lines when harness wired |
| **Hypothetical future index** | Optional fast lookup: `task_id` → trace path + last known `eligible` + `block_codes` hash — **must** revalidate against full trace before side effects |

Rules:

1. Checkpoints without `task_id` are **export-only** (see session resume contract) — not index rows pretending to be traces.
2. Resume **never** treats semantic memory or cache stats as permission to skip gates.
3. Duplicating entire traces into a DB **doubles** redaction/retention risk — avoid.

Injection rules for what enters prompts: [context-package-contract.md](context-package-contract.md).

---

## Storage option matrix

| Use case | Flat files (JSON/JSONL) | SQLite (local) | Notes |
|----------|-------------------------|----------------|-------|
| Trace log | **Recommended (current)** | Poor fit for append-only audit | Schema v2 + redaction already invested |
| Gate envelope + artifacts | **Recommended (current)** | Possible later; no urgent win | MCP tools expect paths today |
| Resume checkpoint | **Derive from trace** | Index only (pointers) | Checkpoint object is not a second SoT |
| Semantic memory | Files via host hooks | Optional external product | Out of orchestrator core |
| Operator catalog / search | `grep`, export CLIs | **Candidate** if trace dirs grow | Must not fork SoT |
| Cache | **Do not persist** | N/A | Trace may record ratios; not a fact DB |

**Operational burden:** flat traces are simple to inspect, copy, and redact-read; SQLite adds migration, backup, and “stale row as truth” failure mode unless every read reconciles with trace.

---

## TTL, provenance, and stale-as-truth rules

Any stored **fact** (outside raw trace lines) must include:

| Field | Purpose |
|-------|---------|
| `source` | `trace`, `operator`, `hook`, `import`, … |
| `source_ref` | e.g. `task_id`, file path, envelope id |
| `recorded_at` | ISO timestamp |
| `supersedes` | optional id of prior fact |
| `ttl_expires_at` | optional; absent = explicit operator delete only |

**Rules:**

1. **Trace wins** on conflict for run outcomes, permissions, and review verdicts.
2. **Never promote** index/cache/semantic memory to gate authority without a fresh permission check.
3. **Expire or mark stale** facts when `source_ref` trace is deleted or superseded.
4. **No silent merge** of session operational state into long-lived memory — different retention and redaction class.

---

## Privacy and redaction risks

| Risk | Mitigation |
|------|------------|
| Duplicating trace payloads into a DB | **Avoid**; index metadata only |
| Stale semantic memory presented as current | Provenance + TTL; UI/docs must label “recalled memory” vs “run evidence” |
| Hidden state not in trace | Gate state must remain inspectable; new stores must link to `task_id` / trace path |
| Secrets in memory tables | Same shape-based redaction policy as [trace-privacy-contract.md](trace-privacy-contract.md); no weaker copy |
| Cross-run credential bleed | [environment-access.md](environment-access.md) — memory must not inherit undeclared env access |

---

## Example record shapes (illustrative)

Not implemented — documentation only.

**Trace line (canonical)** — already schema-defined; excerpt:

```json
{
  "ts_ms": 1747569600000,
  "trace_schema_version": "2",
  "task_id": "task-abc",
  "event": "review_record",
  "reviewer_role": "cerberus",
  "verdict": "block",
  "blockers": ["missing tests"]
}
```

**Derived session checkpoint (export object, not a store row):**

```json
{
  "task_id": "task-abc",
  "session_complete": false,
  "review_summary": { "open_blockers": ["missing tests"] },
  "recovery_clean": true,
  "computed_from": "full_trace"
}
```

**Hypothetical future index row (pointer only):**

```json
{
  "task_id": "task-abc",
  "trace_path": "~/.claude/metrics/traces/task-abc.jsonl",
  "trace_mtime_ms": 1747569600000,
  "resume_eligible": false,
  "block_codes_hash": "sha256:…",
  "indexed_at": "2026-05-25T12:00:00.000Z"
}
```

**Semantic memory fact (host hook — not orchestrator core):**

```json
{
  "fact_id": "mem-001",
  "content_summary": "User prefers Terraform modules over root modules",
  "source": "operator_confirmed",
  "source_ref": "session:manual",
  "recorded_at": "2026-05-20T09:00:00.000Z",
  "ttl_expires_at": "2027-05-20T09:00:00.000Z"
}
```

**Cache (trace observability — not a standalone store):**

```json
{
  "event": "context_stats",
  "cache_read_tokens": 12000,
  "input_tokens": 4000
}
```

---

## What exists today (inventory)

| Plane | Implementation |
|-------|----------------|
| Traces | `orchestrator/orchestrator.js` writer; read via `token-trace-report`, export, dashboard |
| Gate state | `mcp-servers/orchestrator-state/` |
| Resume derivation | `orchestrator/session-resume.js` |
| Recovery | `orchestrator/recovery-sweep.js` |
| Review | `orchestrator/review-record.js` |
| Project snapshot (operator) | `state/project_state.md` at repo root — human/LLM resumption, not runtime SoT |
| Flow hook state | `scripts/hooks/flow-metrics.py` session JSON — metrics only |

---

## Promotion criteria (future implementation ticket)

Promote SQLite index or new store slice only when **all** apply:

1. Measured operator pain (e.g. trace dir scan > N files, repeated batch export latency).
2. Design preserves trace SoT and redaction path.
3. Threat model updated for new retention surface.
4. Tests prove index rows never authorize side effects without trace revalidation.

---

## Related

- [session-resume-contract.md](session-resume-contract.md)
- [recovery-sweep-contract.md](recovery-sweep-contract.md)
- [review-record-contract.md](review-record-contract.md)
- [trace-privacy-contract.md](trace-privacy-contract.md)
- [agent-harness.md](agent-harness.md) — memory/state layer
- [agent-contract.md](agent-contract.md) — authoritative state store
- [run-outcome-consumption.md](run-outcome-consumption.md)
- [context-package-contract.md](context-package-contract.md)
