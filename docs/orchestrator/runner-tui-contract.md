# Runner TUI contract

**Product surface MVP** — launch orchestrator runs from a dedicated CLI (`runner-tui-cli.js`). Complements the **read-only** control plane (`control-plane-tui.js`); does **not** replace Claude Code/Cursor as IDE.

## CLI

From `orchestrator/`:

```bash
npm run runner:tui -- preflight --model-policy local_only [--cwd DIR] [--model NAME]
npm run runner:tui -- run --goal "..." [--flow single_agent|multi_agent] [--model-policy local_only|remote_ok] [--skip-gates]
npm run runner:tui -- status --run-id <task_id>
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage / runtime error |
| 2 | Preflight blocked or status trace missing |
| 3 | Run finished with `done: false` |

## Commands

### `preflight`

Resolves model policy and (for `local_only`) local model selection + Ollama reachability. **No agents executed.**

Uses `selectLocalModel()` and `discoverLocalModels()` — same precedence as the local model lane (CLI → env → YAML → auto → TTY).

### `run`

1. Runs preflight.
2. Sets `ORCH_MODEL_MODE=local_only` when policy is `local_only`.
3. Calls `orchestrator.run()` (same bridge as `run-orchestrator.js`).
4. Prints preflight summary + terminal status (`done` / `failed`).

### `status`

Reads trace JSONL from `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`) and reports terminal state from `session_end`.

## Model policy

| Policy | Behavior |
|--------|----------|
| `local_only` (default) | Preflight requires Ollama + resolved local model; run enforces local-only |
| `remote_ok` | Skips local model preflight; remote providers allowed per existing routing |

Aliases: `remote-approved`, `remote_approved` → `remote_ok`.

## Relationship to other surfaces

| Surface | Role |
|---------|------|
| `run-orchestrator.js` | Direct CLI entry (goal arg, flags) |
| **Runner TUI CLI** | Preflight + policy-aware launch + status |
| `control-plane-tui.js` | Read-only inspect of completed runs |
| `explain-run` | Narrative + JSON export |

## Limits (explicit)

- Stdout CLI only — no curses/full-screen UI in this slice.
- No auth, multi-user, or new persistence.
- No harness adapter parity (`EPIC-HARNESS-ADAPTERS` parked).
- Interactive goal/flow prompts deferred to `MODEL-ROUTING-UX-1` / future TTY polish.

## Validation

- Unit tests: `orchestrator/tests/runnerTui.test.js` (mocked discovery/selection/run; golden trace status).
- Manual: `preflight` with Ollama up/down; `run --goal "smoke"` with `--skip-gates`; `status --run-id` after run.

## Related

- [local-model-policy.md](local-model-policy.md)
- [local-model-selection.md](local-model-selection.md)
- [control-plane-tui-contract.md](control-plane-tui-contract.md)
