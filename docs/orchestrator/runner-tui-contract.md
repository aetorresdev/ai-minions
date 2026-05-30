# Runner TUI contract

**Product surface MVP** — launch orchestrator runs from a dedicated CLI (`runner-tui-cli.js`). Complements the **read-only** control plane (`control-plane-tui.js`); does **not** replace Claude Code/Cursor as IDE.

## CLI

From `orchestrator/`:

```bash
npm run runner:tui -- preflight --model-policy local_only [--cwd DIR] [--model NAME] [--interactive]
npm run runner:tui -- routing [--model-policy local_only|remote_ok] [--model NAME] [--flow single_agent|multi_agent]
npm run runner:tui -- run --goal "..." [--flow single_agent|multi_agent] [--model-policy local_only|remote_ok] [--interactive] [--skip-gates]
npm run runner:tui -- status --run-id <task_id> [--show-routing]
npm run runner:tui -- trace --run-id <task_id> [--follow]
npm run runner:tui -- trace --file <trace.jsonl>
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

Uses `selectLocalModel()` and `discoverLocalModels()` with **`interactive: false`** unless `--interactive` — same override precedence as the local model lane (CLI → env → YAML → auto-detect ranking). Unknown `--model-policy` values fail preflight (exit 2); **`routing` rejects unknown explicit policies before preview** (preflight parity).

### `run`

1. Runs preflight.
2. Sets `ORCH_MODEL_MODE=local_only` when policy is `local_only`.
3. Calls `orchestrator.run()` (same bridge as `run-orchestrator.js`).
4. Prints preflight summary + terminal status (`done` / `failed`).

### `status`

Reads trace JSONL from `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`) and reports terminal state from `session_end`.

With `--show-routing`, includes models recorded in `session_start` (`local_only_mode`, `selected_model`) and per-agent rows from `context_stats` / `agent_start`.

### `routing`

Prints the model policy catalog and a **per-role routing preview** for the selected policy:

| Policy | Preview behavior |
|--------|------------------|
| `local_only` | All roles → same Ollama model (from `--model`, preflight selection, or unresolved placeholder) |
| `remote_ok` | Per-role models from `resolveModel()` / default routing table |

Does not execute agents. For `local_only` without `--model`, runs the same selection path as `preflight` (including `--interactive` TTY model pick when multiple models are discovered).

### `trace`

Read-only trace inspect in the runner product surface (step timeline + gate blocks). Complements `status` (terminal outcome) and `control-plane-tui` (full inspect).

| Mode | Behavior |
|------|----------|
| Snapshot (default) | Load trace JSONL once; print outcome header, **step graph**, **gate blocks** |
| `--follow` | Poll trace file until `session_end` (or Ctrl+C); prints incremental `+ event` lines after initial snapshot |

Resolution: `--run-id` → `$ORCH_TRACES_DIR/<id>.jsonl`; `--file` overrides with explicit path.

Gate block sources: `contract_fail`, `decide_contract_fail`, `model_policy_block`, `permission_check` deny, `review_record` blockers.

Exit codes: missing trace → **2**; usage → **1**; Ctrl+C during follow → **130**.

## Model policy picker (`MODEL-ROUTING-UX-1`)

| Flag / command | Behavior |
|----------------|----------|
| `--model-policy` | Explicit policy (`local_only` default when omitted) |
| `--interactive` | On TTY: prompt for policy when `--model-policy` omitted; enables interactive local model selection in preflight |
| `routing` | Operator-facing catalog + role table before/without a run |
| `run` | After preflight, prints role routing preview before terminal status |
| `status --show-routing` | Post-run models from trace |

## Model policy

| Policy | Behavior |
|--------|----------|
| `local_only` (default) | Preflight requires Ollama + resolved local model; run enforces local-only |
| `remote_ok` | Skips local model preflight; remote providers allowed per existing routing |

Aliases: `remote-approved`, `remote_approved` → `remote_ok`. Any other **explicit** value is rejected at preflight and `routing` (exit 2, `unknown model policy: <value>`).

## Relationship to other surfaces

| Surface | Role |
|---------|------|
| `run-orchestrator.js` | Direct CLI entry (goal arg, flags) |
| **Runner TUI CLI** | Preflight + policy-aware launch + status + trace view |
| `control-plane-tui.js` | Read-only inspect of completed runs |
| `explain-run` | Narrative + JSON export |

## Limits (explicit)

- Stdout CLI only — no curses/full-screen UI in this slice.
- No auth, multi-user, or new persistence.
- No harness adapter parity (`EPIC-HARNESS-ADAPTERS` parked).
- Interactive goal/flow prompts remain out of scope.
- Cost/token rollup view → `COST-BUDGET-VIEW-TUI-1`.

## Validation

- Unit tests: `orchestrator/tests/runnerTui.test.js`, `orchestrator/tests/runnerTraceViewer.test.js`
- Manual: `trace --run-id` after `run`; `trace --follow --run-id` during active run; `trace --file tests/fixtures/golden-path-clean-v1.jsonl`

## Related

- [local-model-policy.md](local-model-policy.md)
- [local-model-selection.md](local-model-selection.md)
- [control-plane-tui-contract.md](control-plane-tui-contract.md)
