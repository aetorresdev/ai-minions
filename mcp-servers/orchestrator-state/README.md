# orchestrator-state MCP (state store)

Authoritative orchestration state on disk: one envelope + append-only `events.jsonl` per `task_id`. Every MODE transition is gated — unapproved files and unaligned goals block `advance_mode` before QA or CERBERUS can run.

Full operational guide (call syntax, failure cases, env vars): [`docs/orchestrator/strict-mode.md`](../../docs/orchestrator/strict-mode.md)

---

## Layout

Default root: `~/.claude/.state/orchestrator/` (override with `ORCHESTRATOR_STATE_ROOT`).

```
<ORCHESTRATOR_STATE_ROOT>/
└── <task_id>/
    ├── envelope.json   # current state snapshot (rewritten atomically on each tool call)
    ├── events.jsonl    # append-only event log with SHA-256 hash chain
    └── .lock           # per-task flock for safe concurrent access
```

### `envelope.json` — current snapshot

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
  "approved_artifacts": ["src/auth/middleware.py", "tests/test_auth.py"],
  "enforce_goal_alignment": true,
  "enforce_approved_artifacts": true,
  "session_id": null,
  "last_event_hash": "a3f9c1..."
}
```

### `events.jsonl` — append-only, one JSON per line

```jsonl
{"seq":1,"type":"task_registered","ts":"2026-04-07T10:00:00+00:00","payload":{"goal":"migrate auth middleware...","flow_mode":"single_agent","max_iterations":3},"prev_hash":"","hash":"e2b4a1..."}
{"seq":2,"type":"mode_advanced","ts":"2026-04-07T10:01:00+00:00","payload":{"from_mode":"ORCHESTRATOR","to_mode":"DEV","iteration":0},"prev_hash":"e2b4a1...","hash":"f93d2c..."}
{"seq":3,"type":"goal_alignment_validated","ts":"2026-04-07T10:26:00+00:00","payload":{"aligned":true,"notes":"all session token storage addressed"},"prev_hash":"f93d2c...","hash":"a3f9c1..."}
{"seq":4,"type":"mode_advanced","ts":"2026-04-07T10:27:00+00:00","payload":{"from_mode":"DEV","to_mode":"QA","iteration":1},"prev_hash":"a3f9c1...","hash":"d72e4f..."}
```

Each event links to the previous via `prev_hash` — the chain can be verified offline.

---

## Setup

```bash
cd mcp-servers/orchestrator-state
uv venv
.venv/bin/pip install "mcp>=1.0.0" "httpx>=0.27.0" "pyyaml>=6.0.1"
```

Register with Claude Code:

```bash
claude mcp add orchestrator-state \
  /absolute/path/to/.venv/bin/python \
  /absolute/path/to/mcp-servers/orchestrator-state/server.py \
  --scope user
```

---

## Enforcement boundary

This MCP enforces **state store constraints** (gates, artifact lists, iteration caps, goal alignment). It does **not** isolate sessions — a different agent process can still read the same chat history. Full session isolation requires a dedicated runner (L3) that controls the host. Design for it; implement this first.

| What this MCP controls | What it does NOT control |
|------------------------|--------------------------|
| Whether a MODE transition is recorded | Which tools an agent can call per MODE |
| Whether approved artifacts match `files_modified` | Chat history available to an agent |
| Whether goal alignment passed before advancing | Process or session boundaries |
| Iteration cap enforcement | External API calls made by agents |
| Tamper-evident audit log (hash chain) | Enforcement in hosts without MCP support |

---

## Tools

| Tool | Required? | Role |
|------|-----------|------|
| `register_task` | **Required** — first call | Create `task_id`, initial envelope, first event |
| `open_envelope` | Recommended | Read envelope + recent events (source of truth) |
| `record_artifact` | Required if new paths appear after registration | Add path to `approved_artifacts` |
| `validate_goal_alignment` | Required when `enforce_goal_alignment: true` | Ollama check + persist `goal_alignment_status` |
| `validate_transition` | Recommended (dry-run) | Check gates without writing — returns `allowed: true/false` + `errors` |
| `advance_mode` | **Required** — replaces prompt-only transitions | Append event + update `current_mode` if all gates pass |
| `close_task` | **Required** — signals end of task | Mark task closed — blocks all further transitions |

> `validate_transition` is a dry-run and optional, but skipping it means `advance_mode` is your first signal of a gate failure — after the agent has already committed to the transition. Use `validate_transition` first.

---

## Happy path (minimal)

```
register_task(goal=..., task_id="t1", approved_artifacts='["src/x.py"]')

advance_mode(task_id="t1", to_mode="DEV", from_mode="ORCHESTRATOR")

# DEV works … then:
compact_handoff(...)                          # compact-handoff MCP → YAML
validate_goal_alignment(task_id="t1", ...)   # must return aligned: true
validate_transition(task_id="t1", from_mode="DEV", to_mode="QA", iteration=1)
advance_mode(task_id="t1", to_mode="QA", from_mode="DEV", iteration=1)

open_envelope(task_id="t1")                  # context package for QA subagent

close_task(task_id="t1", reason="done")
```

## Gate failures

`validate_transition` / `advance_mode` return `allowed: false` + `errors` when:

- `iteration` exceeds `max_iterations`
- `goal_alignment_status` is not `"aligned"` and `enforce_goal_alignment` is true
- `files_modified` in the handoff contains paths not in `approved_artifacts` (when advancing to QA/CERBERUS from DEV/ARCHITECT)

```json
{
  "ok": true,
  "allowed": false,
  "errors": [
    "files_modified not in approved_artifacts: src/auth/legacy.py"
  ]
}
```

ORCHESTRATOR must not authorize the next MODE if `advance_mode` returns `ok: false`.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORCHESTRATOR_STATE_ROOT` | `~/.claude/.state/orchestrator/` | Root directory for all task state |
| `ORCHESTRATOR_OLLAMA_URL` | `http://localhost:11434/api/generate` | Ollama endpoint for alignment checks |
| `ORCHESTRATOR_OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model used for `validate_goal_alignment` |

---

## Tests

```bash
./scripts/test-orchestrator-state.sh
```

Or directly:

```bash
cd mcp-servers/orchestrator-state
uv run pytest tests/ -v
```

Tests use a temporary `ORCHESTRATOR_STATE_ROOT` and mock Ollama for `validate_goal_alignment` — no local model required.

### E2E (real MCP stdio)

`tests/test_e2e_stdio.py` spawns `server.py` as a subprocess and talks MCP over pipes (same as Cursor/Claude Code).

| Test | When it runs |
|------|-------------|
| `test_e2e_mcp_stdio_minimal_flow` | Always — `register_task` → `advance_mode` → `open_envelope` → `list_tools`, no Ollama needed |
| `test_e2e_mcp_stdio_goal_alignment_with_ollama` | Only if Ollama answers at `http://127.0.0.1:11434` (skipped in CI unless Ollama is present) |

Goal alignment uses the same Ollama endpoint as `compact-handoff` by default. Override with `ORCHESTRATOR_OLLAMA_URL` / `ORCHESTRATOR_OLLAMA_MODEL`.
