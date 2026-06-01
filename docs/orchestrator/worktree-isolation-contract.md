# Worktree isolation contract

Git worktree isolation gives each orchestrator run a **separate working tree** keyed by `task_id`. This is a **filesystem boundary** only — it does not replace permission profiles, secret handling, budget guards, governance gates, or CERBERUS review.

## Model

| Concept | Mapping |
|---------|---------|
| Primary repo | Operator checkout (`repo_root`) |
| Isolated run | Git worktree under `ORCH_WORKTREES_DIR` (default `<repo>/.claude/worktrees/<task_id>`) |
| Branch | `orch/<task_id>` (created from `HEAD` or `--base-ref`) |
| Binding | `<worktree>/.claude/worktree-binding.json` (W1 — transitional) |
| Run workdir contract | `<worktree>/.claude/run-workdir-contract.json` (W2 — canonical) |
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

## Run workdir contract (W2)

Path: `.claude/run-workdir-contract.json`

Canonical record for **where a run executes** and how artifacts/cleanup are addressed. `readRunWorkdirContract` loads the contract file when present; otherwise synthesizes from the W1 binding (backward compatible).

| Field | Purpose |
|-------|---------|
| `schema_version` | `"1"` |
| `run_id` | Orchestrator task id |
| `repo_root` | Primary git root (**read-only** source of truth for the run) |
| `base_ref` | Ref at workspace creation |
| `worktree_path` | Isolated execution directory |
| `run_cwd` | Process cwd for the run (equals `worktree_path` when isolated) |
| `artifact_root` | Per-run mutable artifact directory (default `<worktree>/.claude/run-artifacts/<run_id>`) |
| `cleanup_policy` | `retain` \| `cleanup_on_success` \| `cleanup_always` |
| `created_at` | ISO timestamp |
| `retained_after_failure` | When true, failed runs keep workspace by policy |
| `trace_refs` | Pointers for trace lines / event ids (W3) |
| `worktree_isolated` | When true, runner must not assume `repo_root` as implicit cwd |
| `execution_state` | Mutable paths: `run_cwd`, `worktree_path`, `artifact_root` |
| `business_artifacts` | `artifact_root`, `trace_refs`, `read_only_paths` (includes `repo_root`) |

**Separation rule:** execution state is what the run may mutate; business artifacts are outputs/handoff/trace refs attributed to the run; `repo_root` stays read-only unless the operator explicitly works outside isolation.

## CLI (runner product surface)

From `orchestrator/`:

```bash
npm run runner:tui -- worktree create --run-id <task_id> [--cwd DIR] [--base-ref HEAD]
npm run runner:tui -- worktree remove --run-id <task_id> [--force]
npm run runner:tui -- worktree list [--cwd DIR]
npm run runner:tui -- worktree status [--run-id <id>|--cwd DIR]
npm run runner:tui -- worktree contract [--run-id <id>|--cwd DIR]
npm run runner:tui -- run --goal "..." --worktree-isolated [--run-id <task_id>]
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage / git error |
| 2 | Not a git repo / worktree not found |

`worktree remove` calls `git worktree remove` **without** `--force` unless the operator passes `--force`. Managed worktrees typically have an untracked binding file — removal without `--force` fails until the operator opts in to destructive cleanup.

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

- Unit tests: `orchestrator/tests/worktreeIsolation.test.js`, `orchestrator/tests/runWorkdirContract.test.js`
- Manual: create → `run --worktree-isolated` → `trace`/`budget` by `task_id` → remove

## Related

- [runner-tui-contract.md](runner-tui-contract.md)
- [session-resume-contract.md](session-resume-contract.md)
- [runtime-permission-contract.md](runtime-permission-contract.md)
