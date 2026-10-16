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
| Advisory semantic memory (optional) | `scripts/hooks/mem0-search.py` + `mem0_scope.py` — explicit identity/project scope, see [Mem0 hook identity and scope](#mem0-hook-identity-and-scope) |

---

## Mem0 hook identity and scope

The optional host hooks `scripts/hooks/mem0-search.py` (UserPromptSubmit) and `scripts/hooks/mem0-stop.sh` (Stop) have **no built-in user id** and no global fallback. Scope logic lives in `scripts/hooks/mem0_scope.py`; tests in `scripts/hooks/tests/test_mem0_scope.py`. Both hooks still exit immediately unless `AI_MINIONS_ACTIVE=1` and `AI_MINIONS_RUN_ID` are set ([activation.md](activation.md)).

### Configuration (environment only; no other source)

| Variable | Default | Rule |
|----------|---------|------|
| `AI_MINIONS_MEM0_USER_ID` | none (required) | Stable, non-secret slug `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. No e-mail, no spaces. Sent as OpenMemory `user_id`. |
| `AI_MINIONS_MEM0_PROJECT` | none (required) | Same slug rule. Must equal the OpenMemory **app name** = MCP client name used when writing (`<url>/mcp/<project>/sse/<user_id>`). |
| `AI_MINIONS_MEM0_URL` | `http://localhost:8765` | `http`/`https`, loopback host only (`localhost`, `127.0.0.0/8`, `::1`), no credentials in the URL. |
| `AI_MINIONS_MEM0_MODE` | `local` | `local` is the only supported value. `shared` is explicitly **blocked**. |
| `AI_MINIONS_MEM0_TIMEOUT_S` | `4` | Per-request timeout, `0 < t <= 30`. |

Set them in the shell that runs `ai-minions start`, or in the per-project Claude Code settings `env` block, so they are inherited by the hooks. If none is set, retrieval is **disabled** (no request is made; stderr diagnostic `outcome=disabled reason=not_configured`).

### Backend scoping facts (self-hosted OpenMemory API)

- `user_id` is caller-supplied and the REST API has no authentication: it selects a namespace, it is **not** an authorization boundary.
- `POST /api/v1/memories/filter` scopes rows server-side by `user_id` and returns `app_name` per row; there is no server-side filter by app name on this route (only by app UUID).
- The self-hosted API does not expose `POST /api/v1/memories/search/` (some Mem0 builds do). The hook tries it and falls back to filter; **both** paths pass through the same client-side check.

### Retrieval rules

1. A row is injected only if its `app_name` (or `metadata_.mcp_client`) equals `AI_MINIONS_MEM0_PROJECT`, and, when the row carries a `user_id`, it equals `AI_MINIONS_MEM0_USER_ID`. Rows with no project scope (legacy/unscoped) or a different scope are dropped.
2. Rows that read like directives to change policy, gates, roles, activation or permissions are withheld. Injected text is flattened to one bounded line under an `ADVISORY-ONLY` header that labels it untrusted data, not instructions.
3. Because a shared backend cannot be isolated by this hook, `AI_MINIONS_MEM0_MODE=shared` or any non-loopback URL is **blocked** before any request. Two operators must not point the hook at one OpenMemory instance and expect isolation.

### Outcomes

| Outcome | Reasons | Injected context |
|---------|---------|------------------|
| `ok` | `search`, `filter` | `ADVISORY-ONLY` block with scoped hints |
| `empty` | `no_scoped_match` | `ADVISORY MEMORY STATUS: empty (...)` — the scoped call succeeded with no match |
| `blocked` | `missing_user_id`, `invalid_user_id`, `missing_project_scope`, `invalid_project_scope`, `shared_backend_unsupported`, `invalid_mode`, `invalid_url`, `invalid_timeout` | status line; no request made |
| `unavailable` | `timeout`, `unreachable`, `http_error`, `bad_response`, `identity_not_found`, `<reason>_after_search_timeout` | status line; never reported as an empty successful search |
| `disabled` | `not_configured` | nothing |

Every run writes one stderr line `mem0-search: outcome=<o> reason=<r> [dropped_foreign=N dropped_unscoped=N withheld_directive=N]` — codes and counts only, never the user id, project, URL or memory content. Status lines state that absence of hints is not evidence. The hook never blocks the prompt.

### Migration from the previous fixed identity

Earlier versions queried a fixed maintainer user id and injected rows from **any** app. This is a breaking change:

- Without configuration the hook now retrieves nothing (`disabled`).
- Existing rows stay where they are; nothing is merged or rewritten. They are reachable only if you set `AI_MINIONS_MEM0_USER_ID` to the id they were written under **and** `AI_MINIONS_MEM0_PROJECT` to the app name they were written under (e.g. the MCP client name used before). Choosing that is an explicit operator decision per project; rows under other app names remain inaccessible to the hook.
- To scope new memories per project, configure the OpenMemory MCP server URL as `http://localhost:8765/mcp/<project>/sse/<user_id>` with the same values as the env vars.

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
