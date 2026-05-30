# Worktree isolation contract

Git worktree isolation gives each orchestrator run a **separate working tree** keyed by `task_id`. This is a **filesystem boundary** only — it does not replace permission profiles, secret handling, budget guards, governance gates, or CERBERUS review.

## Model

| Concept | Mapping |
|---------|---------|
| Primary repo | Operator checkout (`repo_root`) |
| Isolated run | Git worktree under `ORCH_WORKTREES_DIR` (default `<repo>/.claude/worktrees/<task_id>`) |
| Branch | `orch/<task_id>` (created from `HEAD` or `--base-ref`) |
| Binding | `<worktree>/.claude/worktree-binding.json` |
| Trace | Optional `session_start` fields when `cwd` is a managed worktree |

## Binding file

Path: `.claude/worktree-binding.json`

| Field | Purpose |
|-------|---------|
| `schema_version` | `"1"` |
| `task_id` | Orchestrator task id / trace basename |
| `repo_root` | Primary git root |
| `primary_cwd` | Operator cwd used to create the worktree |
| `worktree_path` | Absolute path to isolated tree |
| `branch` | Dedicated branch name |
| `base_ref` | Ref used at creation |
| `traces_dir` | Snapshot of `ORCH_TRACES_DIR` at creation (informational) |

## CLI (runner product surface)

From `orchestrator/`:

```bash
npm run runner:tui -- worktree create --run-id <task_id> [--cwd DIR] [--base-ref HEAD]
npm run runner:tui -- worktree remove --run-id <task_id> [--force]
npm run runner:tui -- worktree list [--cwd DIR]
npm run runner:tui -- worktree status [--run-id <id>|--cwd DIR]
npm run runner:tui -- run --goal "..." --worktree-isolated [--run-id <task_id>]
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage / git error |
| 2 | Not a git repo / worktree not found |

`run --worktree-isolated` creates (or reuses) the worktree, executes the run inside it, and **does not** auto-remove the worktree afterward.

## Trace fields (`session_start`)

When `cwd` contains a valid binding:

| Field | Value |
|-------|-------|
| `isolation_mode` | `git_worktree` |
| `worktree_path` | Absolute worktree path |
| `worktree_branch` | Branch name |
| `repo_root` | Primary repo root |
| `worktree_task_id` | Bound task id |

Hook context (`.claude/orch-run-context.json`) mirrors `isolation_mode`, `worktree_path`, `worktree_branch`, `repo_root`.

## Session resume

Worktree metadata is **checkpoint context**, not auto-resume permission. Resume still requires `SESSION-RESUME-1` eligibility and side-effect revalidation — see [session-resume-contract.md](session-resume-contract.md).

## Limits (explicit)

- One orchestrator run per worktree in this slice — no parallel multi-worktree engine.
- No merge/conflict automation (`CODE-CONFLICT-GUARD-1` remains P4).
- Worktrees do not sandbox network, MCP, or credentials.
- Operator must remove stale worktrees (`worktree remove`).

## Validation

- Unit tests: `orchestrator/tests/worktreeIsolation.test.js`
- Manual: create → `run --worktree-isolated` → `trace`/`budget` by `task_id` → remove

## Related

- [runner-tui-contract.md](runner-tui-contract.md)
- [session-resume-contract.md](session-resume-contract.md)
- [runtime-permission-contract.md](runtime-permission-contract.md)
