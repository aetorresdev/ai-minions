# Strict Orchestration — State Store + Hard Gates

This document covers the operational detail for mode 3: strict orchestration with the `orchestrator-state` MCP. For the overview and when to use each mode, see the [README](../../README.md#usage-modes).

**Contract reference:** [agent-contract.md](agent-contract.md) § *Authoritative state (state store)*
**MCP reference:** [../../mcp-servers/orchestrator-state/README.md](../../mcp-servers/orchestrator-state/README.md)

---

## When to use this mode

- Production work or compliance-sensitive tasks
- Any flow where "the chat said so" is not enough
- You need a tamper-evident log of what happened
- You need hard gates on which file paths are approved before QA/CERBERUS can rely on them

In strict mode, the **disk store is the authority** — not the chat transcript. If a transition is not recorded in `events.jsonl`, it did not happen for protocol purposes.

---

## Session start

Declare the session header using the role block format, then immediately register the task:

```
---
## ⚫ ROLE: ORCHESTRATOR
STATE: ACTIVE
STEP: 1/N

FLOW: single_agent
GOAL: migrate auth middleware to comply with new session policy
MAX_ITERATIONS: 3
```

```
mcp__orchestrator-state__register_task(
  goal="migrate auth middleware to comply with new session policy",
  task_id="auth-migration",
  flow_mode="single_agent",
  max_iterations=3,
  approved_artifacts='["src/auth/middleware.py", "tests/test_auth.py"]'
)
```

Response:
```json
{
  "ok": true,
  "task_id": "auth-migration",
  "envelope_path": "~/.claude/.state/orchestrator/auth-migration/envelope.json",
  "events_path":   "~/.claude/.state/orchestrator/auth-migration/events.jsonl"
}
```

---

## First transition (ORCHESTRATOR → DEV, no gates)

```
mcp__orchestrator-state__advance_mode(
  task_id="auth-migration",
  to_mode="DEV",
  from_mode="ORCHESTRATOR",
  handoff_yaml="",
  iteration=-1
)
```

---

## DEV → QA gate sequence

### 1. Register any new artifact not declared at registration

```
mcp__orchestrator-state__record_artifact(
  task_id="auth-migration",
  path="src/auth/session.py",
  note="extracted from middleware refactor"
)
```

### 2. Compact DEV output into handoff YAML

```
mcp__compact-handoff__compact_handoff(
  text="<full DEV output>",
  mode_completed="DEV",
  next_mode="QA",
  iteration=1,
  max_iterations=3,
  flow_mode="single_agent"
)
```

### 3. Validate goal alignment (persists on envelope)

```
mcp__orchestrator-state__validate_goal_alignment(
  task_id="auth-migration",
  handoff_yaml="<yaml from step 2>"
)
```

Response (pass):
```json
{ "ok": true, "aligned": true, "confidence": 0.91, "notes": "all session token storage addressed" }
```

Response (fail — do not advance):
```json
{ "ok": true, "aligned": false, "notes": "session expiry policy not implemented", "missing": ["token TTL enforcement"] }
```

### 4. Dry-run gate check

```
mcp__orchestrator-state__validate_transition(
  task_id="auth-migration",
  from_mode="DEV",
  to_mode="QA",
  handoff_yaml="<yaml>",
  iteration=1
)
```

Response (pass):
```json
{ "ok": true, "allowed": true, "errors": [] }
```

Response (block — example: unapproved file):
```json
{
  "ok": true,
  "allowed": false,
  "errors": ["files_modified not in approved_artifacts: src/auth/legacy.py"]
}
```

### 5. Advance (only if `allowed: true`)

```
mcp__orchestrator-state__advance_mode(
  task_id="auth-migration",
  to_mode="QA",
  from_mode="DEV",
  handoff_yaml="<yaml>",
  iteration=1
)
```

> If `advance_mode` returns `ok: false` → ORCHESTRATOR must not authorize the next MODE.

---

## QA/CERBERUS: read clean context

```
mcp__orchestrator-state__open_envelope(
  task_id="auth-migration",
  tail_events=20
)
```

Pass the `envelope` + `events_tail` to the QA or CERBERUS subagent instead of the full chat history.

---

## What the disk state looks like

### `envelope.json` (current snapshot)

```json
{
  "task_id": "auth-migration",
  "goal": "migrate auth middleware to comply with new session policy",
  "flow_mode": "single_agent",
  "current_mode": "QA",
  "iteration": 1,
  "max_iterations": 3,
  "status": "open",
  "goal_alignment_status": "pending",
  "approved_artifacts": ["src/auth/middleware.py", "tests/test_auth.py", "src/auth/session.py"],
  "enforce_goal_alignment": true,
  "enforce_approved_artifacts": true,
  "last_event_hash": "a3f9c1..."
}
```

### `events.jsonl` (append-only, one JSON per line)

```jsonl
{"seq":1,"type":"task_registered","ts":"2026-04-07T10:00:00+00:00","payload":{"goal":"migrate auth middleware...","flow_mode":"single_agent","max_iterations":3},"prev_hash":"","hash":"e2b4a1..."}
{"seq":2,"type":"mode_advanced","ts":"2026-04-07T10:01:00+00:00","payload":{"from_mode":"ORCHESTRATOR","to_mode":"DEV","iteration":0},"prev_hash":"e2b4a1...","hash":"f93d2c..."}
{"seq":3,"type":"artifact_recorded","ts":"2026-04-07T10:25:00+00:00","payload":{"path":"src/auth/session.py","note":"extracted from middleware refactor"},"prev_hash":"f93d2c...","hash":"8a1b3e..."}
{"seq":4,"type":"goal_alignment_validated","ts":"2026-04-07T10:26:00+00:00","payload":{"aligned":true,"notes":"all session token storage addressed"},"prev_hash":"8a1b3e...","hash":"a3f9c1..."}
{"seq":5,"type":"mode_advanced","ts":"2026-04-07T10:27:00+00:00","payload":{"from_mode":"DEV","to_mode":"QA","iteration":1},"prev_hash":"a3f9c1...","hash":"d72e4f..."}
```

Each event links to the previous via `prev_hash` — the chain can be verified offline.

---

## Session close

```
mcp__orchestrator-state__close_task(
  task_id="auth-migration",
  reason="accepted by CERBERUS"
)
```

After `close_task`, `advance_mode` is rejected with `ok: false`.

---

## Degraded mode — when gates are missing

If the MCPs are not registered or `--skip-gates` is passed, the runner prints:

```
⚠  DEGRADED MODE — hard gates DISABLED
   orchestrator-state and compact-handoff MCPs are not active.
   No transitions are recorded. No goal alignment is checked.
   No approved-artifact enforcement. Output contracts still apply.
   Run without --skip-gates to enable strict mode.
```

This is not a soft warning buried in logs — it is printed before the run starts. **Output contracts (`validateOutput`) remain active** in degraded mode; only the MCP gate sequence is skipped.

---

## Rejection path — what each gate failure looks like

### Output contract failure (pre-gate, always active)

```
10:27:33 AM [dev-backend] 🟥 Output contract failed: dev-backend: output must mention at least one file modified
```

Step skipped. `contract_fail` written to trace. No handoff, no advance_mode attempted.

### Handoff structure invalid

```
10:27:44 AM [gate] 🟥 Handoff structure invalid (QA): QA handoff must include verdict
```

`gateBlocked: true` on artifact. `validate_goal_alignment` and `advance_mode` do not run for this step.

### Goal alignment blocked

```
10:27:52 AM [gate] 🟥 Goal not aligned: session expiry policy not implemented
10:27:52 AM [gate] Skipping advance_mode for this step.
```

`gateBlocked: true`. Mode does not advance. Next iteration must address the gap.

### Transition blocked (unapproved artifact)

```
10:27:58 AM [gate] 🟥 Transition blocked: files_modified not in approved_artifacts: src/auth/legacy.py
```

`gateBlocked: true`. Orchestrator must either approve the artifact via `record_artifact` or restrict DEV to approved paths.

### CERBERUS blockers — deterministic iterate

```
10:28:10 AM [cerberus] 🟥 2 blocker(s) detected — forcing iteration (deterministic)
10:28:10 AM [cerberus]   ↳ blocker: no rate limiting on the endpoint
```

Orchestrator cannot declare `done=true`. Asked only for corrections. At max iterations → closes with manual review warning.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORCHESTRATOR_STATE_ROOT` | `~/.claude/.state/orchestrator/` | Root directory for all task state |
| `ORCHESTRATOR_OLLAMA_URL` | `http://localhost:11434/api/generate` | Ollama endpoint for alignment checks |
| `ORCHESTRATOR_OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model used for `validate_goal_alignment` |

---

## Observability — live session tracking

The following files are written automatically by PostToolUse/PreToolUse hooks. They require no MCP and are readable at any time.

### Gate event log — `~/.claude/metrics/gate_events.jsonl`

One JSON line per gate event across all enforcer hooks.

| Field | Description |
|-------|-------------|
| `gate` | `handoff-enforcer` \| `qa-skill-enforcer` \| `mode-enforcer` |
| `result` | `blocked` \| `allowed` |
| `tool` | Tool that triggered the gate |
| `task_id` | Orchestrator task ID (or SESSION_ID fallback) |
| `from_mode` / `to_mode` | Transition context when applicable |
| `reason` | Why blocked or allowed |
| `iteration` | From envelope.json at time of event |

```bash
# Last blocked gates
grep '"result": "blocked"' ~/.claude/metrics/gate_events.jsonl | tail -10

# Gates for a specific task
grep '"task_id": "auth-migration"' ~/.claude/metrics/gate_events.jsonl
```

### Loop trace — `~/.claude/metrics/sessions/loop_trace.jsonl`

One JSON line per tool call with the active role at that moment.

| Field | Description |
|-------|-------------|
| `role` | Active MODE at time of tool call |
| `tool` | Tool name |
| `input` | ≤120-char summary of tool input |

```bash
# Tool call sequence for a session
grep "$CLAUDE_SESSION_ID" ~/.claude/metrics/sessions/loop_trace.jsonl
```

### Context efficiency — live in additionalContext

`context-efficiency.py` (PostToolUse `*`, PreToolUse `Read`) emits after every tool call:

```
ctx=92/100 | cache=78% | re-reads=1 (worst: config.py×3)
```

- **`ctx`** — composite score 0–100 (deductions for re-reads, repeated bash, low cache ratio)
- **`cache`** — `cache_read / (input + cache_read)` — higher means context is being reused efficiently
- **re-reads** — same file read more than once; gate blocks on 3rd read of the same file+offset
- **bash-repeats** — identical commands run more than once

Use this to decide whether to abort a session that is burning context inefficiently.

---

## Gate determinism baselines

Unit test `examples/orchestrator/tests/determinismBaseline.test.js` hashes canonical snapshots of `validateOutput()` and `validateHandoffStructure()` for fixed inputs. The expected digests live in `examples/orchestrator/tests/fixtures/gate-determinism-baseline.json` and run on every `npm test` in that package.

If you change gate messages or branching intentionally, refresh the fixture:

```bash
cd examples/orchestrator && npm run test:baseline:gate
```

This does **not** freeze Ollama or full `run()` outputs (those stay non-deterministic); it only guards the pure gate layer.

---

## Trace line envelope

Every JSONL line includes:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `ts_ms` | number | Unix epoch milliseconds (same instant as `ts`) — use for deltas and latency |
| `trace_schema_version` | string | Contract version for the whole line (see § *Trace schema versions* below) |

### Trace schema versions

| Version | Meaning | `transition_reason` on `iteration_done` | `ts_ms` |
|---------|---------|-------------------------------------------|---------|
| *(absent)* | Ad-hoc JSONL before this contract | unspecified | may be absent |
| `2` | **Published baseline** for this repo | object `{ type, details? }` | present |

There was **no** prior public “v1” trace contract in this project: **`2` is the first stable schema** we ship. Older lines without `trace_schema_version` may exist from experiments; treat them as out-of-contract unless you add a one-off migrator.

### Trace contract governance (minimal)

**Full policy (breaking vs non-breaking, mismatch, examples):** [`schema-versioning.md`](./schema-versioning.md).

1. **Bump** `TRACE_SCHEMA_VERSION` in `orchestrator.js` together with any **breaking** field rename/shape change, and update this table + `model-routing.md` + **`schema-versioning.md`** in the **same** change.
2. **Compatibility:** same major string (`"2"`) means additive fields are OK; removing or retyping fields → new version (`"3"`, …). Finer rules live in **`schema-versioning.md`**.
3. **Consumers:** read `trace_schema_version`; **ignore unknown keys**; branch parsing only when the version changes. Do not assume every line matches the newest code without checking the field.
4. **Validation / tests per version:** JSON Schema `examples/orchestrator/schemas/trace-v2-line.schema.json` — **Ajv** validates every line at **write** time (`traceEvent`). At **read** time use `parseJsonl(text, { validateLines: true })`, CLI **`--strict-traces`**, or env **`ORCH_TRACE_VALIDATE=1`** (`token-trace-report.js`, `scenario-metrics-export.js`). Tests: `tests/traceSchema.test.js`.
5. **Size / cost:** more fields per line increase storage and parse time; if traces grow large, measure bytes per run and prune or sample (operational concern, not enforced here).

Deltas and latency: use **`ts_ms`** only (`ts` is human-readable ISO for the same instant).

## Flow-aware trace metadata

Every step-level event (`agent_start`, `agent_done`, `contract_fail`, `gate_result`, `context_stats`) carries three graph fields that allow reconstructing the execution DAG from the JSONL alone:

| Field | Type | Description |
|-------|------|-------------|
| `step_id` | string | Unique per agent × iteration: `<task_id>-i<N>-<agentId>` — suffixed `-r<N>` on retry (e.g. `abc-i2-dev-backend-r1`) |
| `step_index` | number | 0-based position of the step in the plan array for this iteration |
| `retry_number` | number | How many times this `agentId` has already run in the current iteration (0 = first attempt) |

`iteration_done` events add:

| Field | Type | Description |
|-------|------|-------------|
| `transition_reason` | object | `{ "type", "reason_code", "details?", "gate_id?", "step_id?" }` — `details` truncated to 300 chars; **`reason_code`** is the stable join key for analytics (see table below) |
| `transition_reason.type` | string | `DONE` · `VALIDATION_FAIL` · `GATE_BLOCK` · `MAX_ITERATIONS` · `CONTRACT_FAIL` · `ITERATE_FALLBACK` · `ITERATE` |
| `transition_reason.reason_code` | string | Closed catalog (same enum as JSON Schema): `RUN_COMPLETED` · `CERBERUS_BLOCKERS_ITERATE` · `ORCHESTRATOR_NO_CORRECTIONS_JSON` · `MAX_ITERATIONS_CERBERUS_BLOCKERS` · `GATE_ARTIFACT_OR_HANDOFF` · `MAX_ITERATIONS_GATE_BLOCKED_ARTIFACTS` · `ORCHESTRATOR_DECIDE_CORRECTIONS` · `CONTRACT_OR_DECIDE_FAILURE` · `VALIDATION_FAILURE_GENERIC` |
| `transition_reason.gate_id` | string (optional) | When iteration ends from a gate-blocked path: which gate (e.g. `handoff_structure`, `goal_alignment`, `transition`, `output_contract`, `compact_handoff`, …) |
| `transition_reason.step_id` | string (optional) | When known: last blocked step’s `step_id` for correlation with `agent_done` / `gate_result` |
| `failure_type` | string (optional) | **Required when `outcome` ≠ `done`:** closed enum `spec_missing` · `contract_mismatch` · `hallucination` · `tool_error` · `timeout` · `cost_abort` · `retry_exceeded` — standard failure taxonomy for analytics (`failureTypeForIterationDone` in `orchestrator.js`) |

Rough mapping from `outcome` (legacy UI) to `transition_reason.type`: `done` → `DONE`; `iterate` after CERBERUS blockers + corrections → `GATE_BLOCK`; `iterate_fallback` → `ITERATE_FALLBACK`; `gate_blocked_iterate` → `GATE_BLOCK`; `max_iterations_*` → `MAX_ITERATIONS`; `iterate` after orchestrator decide JSON corrections → `ITERATE`; `stopped` (invalid decide) → `CONTRACT_FAIL`. See `transitionReason()` in `orchestrator.js`.

`step_id` is the primary join key across events within a run. Consumers (token reports, EIL visualisation) use it to correlate `agent_start` → `agent_done` → `gate_result` → `context_stats` for the same step without scanning by `(agent, iteration)` tuples.

### Graph edges

Every step-level event also carries edge fields that make the causal chain explicit:

| Field | Type | Values | Set on |
|-------|------|--------|--------|
| `parent_step_id` | string \| null | `step_id` of the preceding step, or `null` for the first step in an iteration | all step-level events |
| `edge_type` | string | `success` · `retry` · `fail` · `gate_block` · `timeout` | `agent_done`, `contract_fail`, `gate_result` |
| `edge_category` | string | `control_flow` · `failure` · `policy` · `unknown` | same as `edge_type` |

`edge_type` rules:
- `agent_done`: `retry` if `retry_number > 0`, otherwise `success`
- `contract_fail`: always `fail`
- `gate_result` passed=false: `gate_block`
- `gate_result` passed=true: `success`

`edge_category` groups edge types into semantic layers for filtering:

| `edge_type` | `edge_category` |
|-------------|----------------|
| `success`, `retry` | `control_flow` |
| `fail`, `timeout` | `failure` |
| `gate_block` | `policy` |
| _(future types)_ | `unknown` |

Together `parent_step_id` + `edge_type` + `edge_category` allow building a directed graph of the execution: each node is a `step_id`, each edge carries a typed and categorised reason for the transition.

### Graph validation

Before the step loop runs, the plan is validated via `validateStepGraph()`:
- `steps` must be an array
- each step must have an `agentId` or `agent` field

A `graph_validation_fail` trace event is emitted and execution halts if validation fails.

At emit time, `assertParentStepExists()` warns (stderr) if a `parent_step_id` references a `step_id` not yet emitted — guards against orphan edges ahead of fan-out and multi-parent support.

---

## MCP usage audit

For each `run()` of `examples/orchestrator/orchestrator.js`, every **`orchestrator-state`** tool call (via **`mcp-direct.py`** when `ORCH_MCP_TRANSPORT=direct`, or via **`claude -p`** when not) and every **`compact-handoff.compact_handoff`** call emits one **`mcp_call`** line in the per-task JSONL trace (`~/.claude/metrics/traces/<task_id>.jsonl`). Fields: `server`, `tool`, `transport` (`direct` or `claude_cli`), `duration_ms`, `ok`.

The **`session_end`** event on the same stream adds **`mcp_total_calls`**, **`mcp_by_tool`** (counts keyed as `server.tool`), **`mcp_by_transport`**, and **`mcp_failed_calls`**. Use this to spot duplicate transitions, unexpected `claude_cli` bridging, or retry storms. **`skipStateMcp: true`** runs typically log **`mcp_total_calls: 0`** (state MCPs are not invoked from the runner).

**Not in this scope:** per-call LLM token counts — those belong with token/cost metrics and scenario-level reporting (see backlog).

### Ollama token counts

When agents use **Ollama** (`/api/chat`), the example `agents.js` parses `prompt_eval_count` and `eval_count` from the JSON response and attaches them to **`context_stats`** as `ollama_prompt_tokens` and `ollama_completion_tokens` on each `askAgent` Ollama call. The summarizer step records the same fields when `summarizeHandoff` runs via Ollama.

`session_end` includes **`ollama_prompt_tokens_total`** and **`ollama_completion_tokens_total`** when at least one of those counters is non-zero. **Claude CLI** paths do not populate these fields (no token API in this example runner). **USD cost** is not inferred automatically: you can set **`ORCH_USD_PER_MTOK_PROMPT`** and **`ORCH_USD_PER_MTOK_COMPLETION`** (USD per 1e6 Ollama tokens; both required) so `token-trace-report.js` prints an optional estimate from those totals.

**On-demand readout:** `examples/orchestrator/token-trace-report.js` (npm script `tokens:report`) reads a completed `*.jsonl` and prints Ollama totals (from `context_stats` vs `session_end`) plus MCP rollups — see `examples/orchestrator/README.md`.

**Batch export:** optional `scenario_id` on `session_start` / `session_end` when `run({ traceScenarioId })` or `ORCH_TRACE_SCENARIO_ID` is set; `scenario-metrics-export.js` (`npm run metrics:export-scenarios`) aggregates tagged traces into JSON with **`runs`**, **`by_scenario`**, and **`by_flow_mode`** (grouping by `flow_mode` from each run).

---

## System-path E2E suite (examples/orchestrator)

Automated checks for **`skipStateMcp: false`** (hard gates on) without requiring the **claude CLI** to invoke MCP tools:

1. Set **`ORCH_MCP_TRANSPORT=direct`** — `orchestrator.js` routes `orchestrator-state` and `compact-handoff` calls through **`examples/orchestrator/mcp-direct.py`**, which loads the Python MCP server code from `mcp-servers/*` (after `uv sync` in each server directory).
2. **`ORCHESTRATOR_STATE_ROOT`** — tests may point this at a temp directory so the authoritative store is isolated from `~/.claude/.state/orchestrator`.
3. **`npm run test:e2e:strict`** (alias **`npm run test:e2e:system-path`**) — runs `tests/e2e.strict.test.js` (Ollama required; skips if Ollama or `mcp-direct.py` is missing).

This is **not** the same as registering MCPs inside the Anthropic Claude app: that path still uses `claude -p` when `ORCH_MCP_TRANSPORT` is unset. CI (`.github/workflows/orchestrator-e2e.yml`) runs both `test:e2e` (degraded) and `test:e2e:strict` on the self-hosted Ollama runner.

### GitHub Actions — `orchestrator-e2e.yml`

- **Runner:** `runs-on: [self-hosted, ollama]` — the machine must run Ollama on `localhost:11434` and have `uv sync` done for `mcp-servers/orchestrator-state` and `compact-handoff` (the workflow runs `uv sync` each job).
- **Dual suite:** `npm run test:e2e` then `npm run test:e2e:strict` — same contract as local “full E2E + system-path”.
- **Dispatch:** `workflow_dispatch` input `ollama_model` overrides the default `qwen2.5-coder:7b`. A best-effort `ollama pull` runs if the CLI is on `PATH`.
- **Fork PRs:** the job is **skipped** when `pull_request.head.repo` is a fork (avoids a stuck “Waiting for a runner” queue). GitHub generally treats **skipped** jobs on a completed workflow as non-blocking for merge when rules expect success/skipped/neutral — but **path/branch filters** that prevent the workflow from running at all can leave checks **Pending**. Here the workflow file still matches on fork PRs, so the run exists and the job reports skipped — usually the safe case. **Operational validation:** run at least one real fork PR with your branch protection enabled and confirm the UI before calling this risk closed.
- **Artifacts:** on failure, uploads `~/.claude/metrics/traces/`, `gate_events.jsonl`, `flow-metrics.jsonl`, and `examples/orchestrator/npm-debug.log` (7-day retention).
- **Concurrency:** one in-flight run per ref (`cancel-in-progress: true`).

Optional env: **`ORCH_PYTHON`** (default `python3`), **`ORCH_MCP_DIRECT_TIMEOUT_MS`** (default `180000`).

**Phase 1 vs later:** phase 1 proves the strict path against **real on-disk state** without Claude-hosted MCP wiring. It does **not** exhaust “strict” as a product goal. **Phase 2 (`e2e.strict.test.js`):** (1) `run()` + hash + event types; (2) **mcp-direct** `validate_transition` → `advance_mode` with YAML; (3) **`compact_handoff`** smoke; (4–5) **negative** `validate_transition` (alignment pending, iteration cap); (6) **`ORCH_TEST_SYSTEM_PATH_HARNESS=1`** (one test only; **test harness, not production**) — deterministic `askAgent` stubs + `register_task` with `enforce_goal_alignment: false` + Node bypass when the alignment LLM still returns `aligned: false`, so **`run()`** exercises real `compact_handoff`, `goal_alignment_validated` on disk, and **≥3** `mode_advanced` events. This is **system-path** coverage (MCP + disk + transitions), **not** proof of reliable goal alignment or real-model unattended runs. **`validateHandoffStructure`** is a **shallow / heuristic** check (keys, nesting, line shapes) — useful gate, **not** semantic proof of handoff truth; it accepts **nested** `files_modified` / `validation_run` (typical compact-handoff YAML) and nested **`verdict`** for CERBERUS (tradeoff: well-indented junk can still pass). Optional later: strict with **`claude -p` + MCPs registered in the Claude app** for desktop parity.

---

## Shared hook modules

These modules live in `scripts/hooks/` and are imported by the enforcer hooks — they are not standalone hooks.

### `constants.py` — single source of truth for hook constants

| Symbol | Value | Purpose |
|--------|-------|---------|
| `KNOWN_MODES` | `{"ORCHESTRATOR","OWNER","ARCHITECT","DEV","QA","CERBERUS"}` | Valid role names; used by all mode-aware hooks |
| `MODE_RE` | compiled regex | Detects `MODE: <role>` or `ROLE: <role>` in transcript text |
| `PRICE` | `{input, output, cache_w, cache_r}` | Sonnet 4.6 pricing per million tokens (update here to propagate everywhere) |
| `cost_from_tokens()` | helper | Converts token counts to USD using `PRICE` |

**Update pricing here only** — `agent-metrics.py` and `context-efficiency.py` import from this module.

### `gate_logger.py` — shared gate event writer

Imported by `handoff-enforcer.py`, `qa-skill-enforcer.py`, and `mode-enforcer.py`. Appends one JSON line per gate event to `~/.claude/metrics/gate_events.jsonl`.

```python
from gate_logger import log_gate_event

log_gate_event(
    gate="handoff-enforcer",
    result="blocked",          # "blocked" | "allowed"
    tool="advance_mode",
    reason="compact_handoff not called before advance_mode",
    task_id="auth-migration",  # optional; falls back to SESSION_ID
    from_mode="DEV",
    to_mode="QA",
)
```

Never raises — all exceptions are swallowed so a logging failure never breaks the hook chain.
