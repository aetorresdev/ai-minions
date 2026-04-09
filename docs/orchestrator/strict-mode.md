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

Declare the session header, then immediately register the task:

```
MODE: ORCHESTRATOR
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
