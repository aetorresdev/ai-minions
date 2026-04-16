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

## Gate determinism baselines (C-T2)

Unit test `examples/orchestrator/tests/determinismBaseline.test.js` hashes canonical snapshots of `validateOutput()` and `validateHandoffStructure()` for fixed inputs. The expected digests live in `examples/orchestrator/tests/fixtures/gate-determinism-baseline.json` and run on every `npm test` in that package.

If you change gate messages or branching intentionally, refresh the fixture:

```bash
cd examples/orchestrator && npm run test:baseline:gate
```

This does **not** freeze Ollama or full `run()` outputs (those stay non-deterministic); it only guards the pure gate layer.

---

## E2E-STRICT (examples/orchestrator)

Automated checks for **`skipStateMcp: false`** (hard gates on) without requiring the **claude CLI** to invoke MCP tools:

1. Set **`ORCH_MCP_TRANSPORT=direct`** — `orchestrator.js` routes `orchestrator-state` and `compact-handoff` calls through **`examples/orchestrator/mcp-direct.py`**, which loads the Python MCP server code from `mcp-servers/*` (after `uv sync` in each server directory).
2. **`ORCHESTRATOR_STATE_ROOT`** — tests may point this at a temp directory so the authoritative store is isolated from `~/.claude/.state/orchestrator`.
3. **`npm run test:e2e:strict`** — runs `tests/e2e.strict.test.js` (Ollama required; skips if Ollama or `mcp-direct.py` is missing).

This is **not** the same as registering MCPs inside the Anthropic Claude app: that path still uses `claude -p` when `ORCH_MCP_TRANSPORT` is unset. CI (`.github/workflows/orchestrator-e2e.yml`) runs both `test:e2e` (degraded) and `test:e2e:strict` on the self-hosted Ollama runner.

Optional env: **`ORCH_PYTHON`** (default `python3`), **`ORCH_MCP_DIRECT_TIMEOUT_MS`** (default `180000`).

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
