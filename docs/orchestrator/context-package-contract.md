# Context package contract

**Design-first contract** — defines what may be **assembled and injected** into an agent invocation. **No runtime builder**, **no new trace events**, **no cache implementation** in this slice.

A **context package** is a **bounded input bundle** for one inference or role step. It is **not** a memory store, trace, cache, or compact handoff — though it may **include references or excerpts** derived from those planes.

Storage boundaries: [memory-store-decision.md](memory-store-decision.md). Session resume derives from trace — it does **not** own package assembly: [session-resume-contract.md](session-resume-contract.md).

---

## Implementation boundary (read first)

**SQLite index is not approved for implementation in this PR.** Any SQLite catalog, schema, migrations, or runtime store requires a **follow-up ticket** with schema, migrations, tests, privacy review, and export compatibility.

**This document does not approve:**

- Runtime context package builder in `orchestrator.js`
- Cache subsystem or persistence
- Live `session_*` trace emission
- New trace event types for package assembly

---

## Definition

| Term | Meaning |
|------|---------|
| **Context package** | Curated set of inputs passed to one agent call (prompt envelope + cited artifacts + constraints) |
| **Assembly** | Selection, summarization, and ordering — **future** runtime; this doc specifies rules only |
| **Injection** | What the model/harness actually sees for that turn |

**Hard rule:** Persistent memory is **advisory** unless refreshed, sourced, and validated against current trace/run evidence.

---

## Planes: store vs package

| Plane | [Memory store decision](memory-store-decision.md) | Context package (this doc) |
|-------|---------------------------------------------------|----------------------------|
| **Trace** | Canonical historical SoT | Source to **derive** facts and constraints — prefer refs over replay |
| **Run state** | Gate envelope / ephemeral snapshot | May supply **minimal** active task context |
| **Session log / resume** | Derived checkpoint; index-only if ever stored | May feed **resumable** context when trace-validated |
| **Memory (semantic)** | Facts with TTL/provenance | Enters only if **current**, scoped, and **advisory** |
| **Cache** | Non-authoritative optimization | **Never** injected as ground truth |
| **Compact handoff** | Artifact on disk / MCP output | Valid **input**; not package SoT |
| **Review records** | Durable in trace | Enter as **constraints** when blockers/review active |

**Division of labor:**

- **Store** persists or indexes (when implemented).
- **Context package** selects and injects.
- **Trace** remains SoT for audit and conflict resolution.

---

## Input kinds (catalog)

Each item in a package SHOULD declare `source_kind` and `source_ref`.

| Input kind | Typical source | Default inclusion stance |
|------------|----------------|-------------------------|
| User request | Operator / goal envelope | **Required** |
| Active task / contract | Envelope, MODE header | **Required** |
| Role contract | `agents/` prompts, validateOutput rules | **Required** |
| Prior agent output (bounded) | Last step artifact or handoff excerpt | **Optional** — summarize |
| Blockers / review records | `review_record` in trace | **Required** when open blockers |
| Compact handoff artifact | MCP compact-handoff YAML | **Optional** — prefer over raw history |
| Trace-derived facts | Export / explain-run / checkpoint | **Optional** — refs preferred |
| Memory facts | Host hook / operator-approved store | **Optional** — advisory only |
| Cache hits | Ephemeral derived summaries | **Excluded** from truth; **optional** hint only |

**Host mem0 hooks:** `scripts/hooks/mem0-search.py` has **two** host-layer behaviors: (1) existing **FLOW/MODE bootstrap** instructions and `orch-session` flag wiring — strict orchestration/session behavior, outside the memory contract; (2) optional **semantic-memory injection** when OpenMemory returns hits. **Only the semantic-memory payload is advisory-only** — not orchestrator memory SoT; injected hits must be validated against the current task envelope, trace JSONL, and governed contracts; trace wins on conflict. `mem0-stop.sh` is an optional advisory capture reminder only. See also `memory-store-decision.md`.

---

## Inclusion policy

Every candidate input MUST map to exactly one category:

| Category | Meaning |
|----------|---------|
| **required** | Omitting it makes the invocation **invalid** for that role/step |
| **optional** | May be included when within budget and relevance rules |
| **excluded** | Must not appear (wrong role, wrong phase, or policy) |
| **rejected** | Was considered and **denied** — record `rejected_with_reason` for traceability |

**Not sufficient:** “include useful context.” Packages must be **explainable**: each item has `reason`, `source_ref`, and category.

### Rejection reasons (closed set for docs/examples)

- `over_budget`
- `stale_fact`
- `duplicate_of_trace`
- `wrong_role`
- `not_in_allowed_inputs`
- `privacy_redaction`
- `unverified_memory`

---

## Freshness and provenance

Every **durable fact** (memory, trace-derived summary, handoff excerpt) included as more than a one-line pointer MUST carry:

| Field | Required when |
|-------|----------------|
| `source.type` | Always |
| `source.ref` | Always — trace line, file path, envelope id, doc path |
| `provenance.created_at` | Durable facts |
| `provenance.created_by` | e.g. `human_reviewed_doc`, `trace_event`, `operator` |
| `freshness.ttl` or `freshness.expires_at` | Reusable facts |
| `freshness.stale_behavior` | e.g. `advisory_only`, `exclude`, `summarize_with_warning` |

**Rules:**

1. **Stale facts** may appear only as **historical context**, never as authoritative truth.
2. **Trace wins** on conflict with memory or cache-derived text.
3. **Cache** entries MUST carry `truth_status: not_authoritative` if referenced at all.

---

## Anti-bloat rules

1. **Token budget placeholder:** packages SHOULD declare a notional `max_tokens` or `max_items` per role (exact numbers live in a future routing ticket — not fixed here).
2. **Summarize before inject** — full files and full trace dumps are **rejected** by default.
3. **Prefer references** (`source_ref`, artifact id, trace pointer) over bulk payload.
4. **Reject unrelated prior context** — no “helpful” history from other tasks without explicit envelope link.
5. **No duplicate planes** — do not paste trace JSONL into the package when export already consumed it for the same fact.
6. **One handoff per transition** — align with compact-handoff policy in [agent-contract.md](agent-contract.md).

---

## Traceability

Future assembly (when implemented) MUST be able to answer:

- What was included?
- What was excluded or rejected, and why?
- Which `source_ref` backed each required item?

**Design intent:** optional future **`context_package_manifest`** export object (not trace v2 in this slice) — JSON list of items with categories and refs, no hidden prompt magic.

---

## Relationship to session resume

Session resume **derives from canonical trace / session events**. A memory store may hold **references or indexes only**; it **does not own** resume semantics.

When resuming:

1. Build checkpoint from trace (existing module).
2. Assemble a **fresh** context package from checkpoint + allowed artifacts — not from chat memory alone.
3. Re-run permission evaluation before side effects (see session resume contract).

---

## Relationship to compact handoff

| Artifact | Role in package |
|----------|-----------------|
| **Compact handoff YAML** | Primary **structured** carrier between MODEs — may be **required or optional** depending on the step |
| **Raw agent output** | **Excluded** when handoff exists — avoid paying twice |
| **open_envelope** (QA/CERBERUS) | **Required** subset per [agent-contract.md](agent-contract.md) — not full implementation history |

Cost attribution for compaction is handled by the future cost/token accounting contract, not this document.

---

## Example record shapes (illustrative)

Not implemented — documentation only.

**Memory fact (advisory):**

```json
{
  "kind": "memory_fact",
  "fact_id": "mem_20260525_001",
  "scope": "project",
  "statement": "Trace JSONL remains the source of truth for resume decisions.",
  "source": {
    "type": "decision_doc",
    "ref": "docs/orchestrator/memory-store-decision.md"
  },
  "provenance": {
    "created_by": "human_reviewed_doc",
    "created_at": "2026-05-25T00:00:00Z"
  },
  "freshness": {
    "ttl": "90d",
    "stale_behavior": "advisory_only"
  }
}
```

**Context package item:**

```json
{
  "kind": "context_package_item",
  "category": "required",
  "source_kind": "review_record",
  "source_ref": "trace:task-abc:review_record:cerberus",
  "reason": "Active blocker constrains next DEV task",
  "allowed_for_roles": ["DEV", "QA", "CERBERUS"],
  "expires_after": "current_task"
}
```

**Cache entry (non-authoritative):**

```json
{
  "kind": "cache_entry",
  "cache_key": "repo_doc_summary:abc123",
  "value_ref": "cache/doc-summary/abc123.json",
  "source": "derived",
  "ttl": "24h",
  "truth_status": "not_authoritative"
}
```

**Rejected item (audit trail):**

```json
{
  "kind": "context_package_item",
  "category": "rejected",
  "source_kind": "memory_fact",
  "source_ref": "mem:stale-042",
  "rejected_with_reason": "stale_fact",
  "detail": "TTL expired; superseded by trace review_record"
}
```

---

## Before / after (conceptual)

**Before (anti-pattern):** DEV step receives full chat transcript, entire trace JSONL, all mem0 hits, and three full source files — no categories, no refs.

**After (contract-aligned):** DEV step receives: goal envelope (**required**), role contract (**required**), compact handoff YAML (**optional** → promoted required after ARCHITECT), open blocker from last `review_record` (**required**), two `files_read` paths (**optional**), mem0 hit marked **advisory_only** (**optional**), prior trace dump (**rejected**, `duplicate_of_trace`).

---

## Fresh review package (CTX-HYGIENE — design contract)

Named package type for **QA/CERBERUS review without implementation-history contamination**. This is a **contract shape only** — no runtime builder in this slice. Aligns with [agent-contract.md](agent-contract.md) exported-context guidance and [review-record-contract.md](review-record-contract.md).

**When to use:** validating completed work (approve / request changes) from bounded artifacts — **not** re-reading raw exploration transcript or full trace dumps.

```yaml
fresh_review_package:
  goal_ref: "<task envelope or resume pointer>"
  handoff_ref: "<compact handoff path or inline YAML ref>"
  approved_artifacts:
    - path: "docs/example.md"
      reason: "changed by DEV; in approved_artifacts"
  evidence_refs:
    - "test:npm test → pass"
    - "trace:<task_id>:review_record:cerberus"
  excluded_context:
    - kind: "raw_transcript"
      reason: "implementation history excluded for reviewer freshness"
    - kind: "duplicate_trace_dump"
      reason: "trace refs used instead of full JSONL replay"
  reviewer_mode: QA | CERBERUS
  freshness_marker: "<iso8601 or handoff sequence>"
  limitations:
    - "Does not replace validateOutput or CERBERUS merge authority"
    - "Trace remains SoT; package is injection policy only"
```

**Observable checks (manual / future validator):**

| Check | Pass | Fail |
|-------|------|------|
| Goal present | `goal_ref` set | missing goal |
| Handoff or approved artifacts | at least one | neither |
| Contamination excluded | `excluded_context` documents rejected kinds | full transcript injected as authority |
| Reviewer mode | `QA` or `CERBERUS` | ambiguous |

**Not in scope:** auto-stripping chat history · new trace events · replacing `compact_handoff` MCP · mem0 as SoT.

---

## Limits (explicit)

- No orchestrator runtime assembly in v0.1.x from this doc alone.
- No UI for package inspection.
- No replacement of `validateOutput`, permission gates, or MODE protocol.
- No claim that “context package” equals production context engineering tooling.

---

## Related

- [memory-store-decision.md](memory-store-decision.md)
- [session-resume-contract.md](session-resume-contract.md)
- [agent-harness.md](agent-harness.md) — context layer
- [agent-contract.md](agent-contract.md) — handoffs and QA/CERBERUS export package
- [token-hygiene-guide.md](token-hygiene-guide.md)
- [context-hygiene-signals.md](context-hygiene-signals.md)
- [trace-privacy-contract.md](trace-privacy-contract.md)
- [run-outcome-consumption.md](run-outcome-consumption.md)
