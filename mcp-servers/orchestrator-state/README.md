# orchestrator-state MCP (state store)

Authoritative orchestration state on disk: one envelope + append-only `events.jsonl` per `task_id`.

## Layout

Default root: `~/.claude/.state/orchestrator/` (override with `ORCHESTRATOR_STATE_ROOT`).

```
<ORCHESTRATOR_STATE_ROOT>/<task_id>/envelope.json
<ORCHESTRATOR_STATE_ROOT>/<task_id>/events.jsonl
```

## Setup

```bash
cd mcp-servers/orchestrator-state
uv venv
.venv/bin/pip install "mcp>=1.0.0" "httpx>=0.27.0" "pyyaml>=6.0.1"
```

Register (example):

```bash
claude mcp add orchestrator-state \
  /absolute/path/to/.venv/bin/python \
  /absolute/path/to/mcp-servers/orchestrator-state/server.py \
  --scope user
```

## Tests

From repo root:

```bash
./scripts/test-orchestrator-state.sh
```

Or from this directory (creates `.venv` if missing):

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest tests/ -v
```

Tests use a temporary `ORCHESTRATOR_STATE_ROOT` and **mock Ollama** for `validate_goal_alignment` — no local model required.

### E2E (real MCP stdio)

`tests/test_e2e_stdio.py` spawns `server.py` as a subprocess and talks MCP over pipes (same as Cursor/Claude Code).

| Test | When it runs |
|------|----------------|
| `test_e2e_mcp_stdio_minimal_flow` | Always (`register_task` → `advance_mode` → `open_envelope` → `list_tools`, no Ollama) |
| `test_e2e_mcp_stdio_goal_alignment_with_ollama` | Only if Ollama answers at `http://127.0.0.1:11434/api/tags` (skipped in CI unless Ollama is present) |

## Tools

| Tool | Role |
|------|------|
| `register_task` | Create `task_id`, initial envelope, first event |
| `open_envelope` | Read envelope + recent events (source of truth) |
| `record_artifact` | Add path to `approved_artifacts` |
| `validate_goal_alignment` | Ollama check + persist `goal_alignment_status` |
| `validate_transition` | Dry-run gates (no write) |
| `advance_mode` | Append `mode_advanced` + update `current_mode` if allowed |
| `close_task` | Mark task closed |

Goal alignment uses the same Ollama endpoint as `compact-handoff` by default (`localhost:11434`, `qwen2.5-coder:7b`). Override with `ORCHESTRATOR_OLLAMA_URL` / `ORCHESTRATOR_OLLAMA_MODEL`.

## Flow (strict)

1. `register_task` → get `task_id`
2. `record_artifact` for every path QA/CERBERUS may rely on (or pass `approved_artifacts` at register)
3. `compact_handoff` (compact-handoff MCP) → YAML
4. `validate_goal_alignment` (this MCP) → must show `aligned: true` in JSON for gate to pass
5. `validate_transition` → then `advance_mode` with `handoff_yaml`

If `enforce_approved_artifacts` is true, every path under `files_modified` in the handoff must appear in `approved_artifacts` before advancing to **QA** or **CERBERUS** from **DEV** or **ARCHITECT**.
