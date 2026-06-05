# Worktree result promotion contract

Explicit operator-controlled path to copy **accepted** artifacts from an isolated git worktree into the primary checkout (`repo_root`). Promotion is **separate** from workspace cleanup — denying or skipping promotion must not remove the worktree.

**Runtime:** `orchestrator/worktree-result-promotion.js` · **CLI:** `runner-tui-cli.js worktree promote|promote-deny|promotion`

**Related:** [worktree-isolation-contract.md](worktree-isolation-contract.md) · [runner-tui-contract.md](runner-tui-contract.md)

**Not claimed:** auto-merge, fan-in conflict resolution, git commit/push of promoted files, promotion without operator `--approve`.

---

## Phase separation

| Phase | Responsibility | Side effects |
|-------|----------------|--------------|
| **Execution** | Run in `run_cwd` (worktree) | Mutations under mutable paths only |
| **Artifact readiness** | `workspace_artifacts_ready` + `trace_refs` on contract | Ensures outputs are attributable |
| **Promotion** | Operator copies eligible files to `repo_root` | Files under primary checkout |
| **Cleanup** | `worktree remove` | Removes isolated tree (independent) |

Denying promotion writes a promotion record and trace line only — **no** `git worktree remove`.

---

## Eligibility

Before promote or deny:

1. Managed worktree exists (`worktree-binding.json`).
2. Valid `run-workdir-contract.json`.
3. Contract `trace_refs` includes `workspace_artifacts_ready` (links run to lifecycle evidence).

Promotion additionally requires:

- Non-empty `--artifact` list (worktree-relative paths).
- Each source file under `execution_state.mutable_paths` (typically `run_cwd` + `artifact_root`).
- Destination under `repo_root`, not inside the worktree path.
- Explicit operator approval (`--approve` / `operatorApproved: true`).
- Destination must not exist unless operator passes `--overwrite` / `allowOverwrite: true`.

**Deny uses the same eligibility guards as promote** — managed worktree, valid contract, `workspace_artifacts_ready` in `trace_refs`, and no prior `status: completed` promotion record.

---

## CLI

From `orchestrator/`:

```bash
npm run runner:tui -- worktree promote --run-id <task_id> \
  --artifact <worktree-rel-path> [--artifact ...] \
  [--dest-rel <repo-prefix>] --approve [--overwrite]

npm run runner:tui -- worktree promote-deny --run-id <task_id> [--reason-code <code>]
npm run runner:tui -- worktree promotion --run-id <task_id>
```

| Exit | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation / approval / copy error |
| 2 | Worktree not found |

---

## Promotion record

Path: `<worktree>/.claude/worktree-promotion-record.json`

| Field | Purpose |
|-------|---------|
| `schema_version` | `"1"` |
| `run_id` | Source task / run id |
| `worktree_path` | Isolated tree |
| `repo_root` | Primary checkout |
| `status` | `completed` \| `denied` |
| `operator_approved` | `true` only when promotion copied files |
| `artifacts` | `{ source_rel, dest_rel, promoted_at }[]` when completed |
| `trace_refs` | Snapshot from contract at decision time |
| `deny_reason_code` | When denied |
| `denied_at` / `promoted_at` | ISO timestamps |

---

## Trace events

Emitted by `trace-workspace-lifecycle.js` (`execution_actor: workspace_manager`). Each append updates contract `trace_refs`.

| Event | When |
|-------|------|
| `workspace_promotion_started` | After validation, before copy |
| `workspace_promotion_completed` | Successful copy + record write |
| `workspace_promotion_denied` | Operator deny; `cleanup_side_effects: false` |
| `workspace_promotion_failed` | Validation or copy failure |

`summarizeWorkspaceLifecycleFromRows` adds flags: `promotion_attempted`, `promotion_completed`, `promotion_denied`.

Disable emission: `ORCH_DISABLE_WORKSPACE_TRACE=1`.

---

## Operator playbook

| Goal | Action |
|------|--------|
| Accept worktree output | `worktree promote ... --approve` after reviewing artifacts |
| Reject without deleting tree | `worktree promote-deny` |
| Audit decision | `worktree promotion --run-id <id>` + trace JSONL |
| Remove tree later | `worktree remove` (separate step) |

---

## Limits (explicit)

| Limit | Behavior |
|-------|----------|
| **Destination overwrite** | Blocked when `dest` already exists; pass `--overwrite` to replace |
| **Partial copy failure** | Emits `workspace_promotion_failed`; files copied before failure remain on disk (no rollback) |
| **Terminal promotion record** | `status: completed` cannot be overwritten by promote or promote-deny |
| **Deny-after-deny** | Second `promote-deny` overwrites prior `denied` record — **gap**; see backlog `WORKTREE-PROMOTION-RECORD-AUDIT-1` |

---

## Validation

```bash
cd orchestrator && npm test
```

Tests: `worktreeResultPromotion.test.js`, `traceWorkspaceLifecycle.test.js`.
