# Primary smoke command and trace path

Stable **primary CLI smoke** for ai-minions: one documented command, expected console output, and a known **trace/evidence path**. Degraded mode (`--skip-gates`) — fine for first contact; not a gated production run.

**When to use:** after [bootstrap preflight](bootstrap-preflight.md) passes and you want a repeatable orchestrator smoke without tribal knowledge.

**Related:** [Usage smoke guide — Step 4](usage-smoke-guide.md#step-4--cli-smoke-run) · [Operator slash commands — `/run-smoke`](operator-slash-commands.md) · [Harness health checkpoints](harness-health-checkpoints.md)

---

## Quick command (smoke note)

From clone root (`ai-minions/`):

```bash
node scripts/run-primary-smoke.mjs
```

Prints the **canonical command**, `traces_dir`, expected stdout fields (`Done`, `Task ID`), and inspect/explain follow-ups. Exit **0** when `orchestrator/` layout is present.

**Live run** (requires `claude` CLI + auth — same as `/run-smoke`):

```bash
node scripts/run-primary-smoke.mjs --run
```

**Verify trace after a run:**

```bash
node scripts/run-primary-smoke.mjs --inspect <task_id>
```

**JSON report** (automation / evidence notes):

```bash
node scripts/run-primary-smoke.mjs --json
```

Exit codes: **0** = pass · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

---

## Canonical underlying command

The wrapper documents and optionally runs this command from `orchestrator/`:

```bash
cd ai-minions/orchestrator
node run-orchestrator.js --skip-gates --iterations 1 "Smoke: list three files under orchestrator/ and stop"
```

| Field | Expected |
|-------|----------|
| Exit code | `0` on success |
| Console | `Done: true` (or `Done: false` with summary — still note **Task ID**) |
| **Task ID** | Copy from `Task ID:` line in output |
| Mode | **Degraded** — `Gates: DISABLED` / ⚠ DEGRADED MODE banner is expected |

---

## Trace / evidence path

Default (override with `ORCH_TRACES_DIR`):

```text
~/.claude/metrics/traces/<task_id>.jsonl
```

| Action | Command |
|--------|---------|
| Inspect file exists | `node scripts/run-primary-smoke.mjs --inspect <task_id>` |
| Human summary | `cd orchestrator && npm run explain-run -- --run-id <task_id>` |
| Token/cost rollup | `cd orchestrator && npm run tokens:report -- <task_id>` |

Pass: JSONL exists, non-empty, and `explain-run` reads without errors.

---

## Reason codes (stable)

Use in issues and smoke reports — not free-form paraphrase.

| `reason_code` | Meaning | Typical fix |
|---------------|---------|-------------|
| `SMOKE_REPO_LAYOUT` | Not an ai-minions clone (`orchestrator/run-orchestrator.js` missing) | Clone repo; run from `ai-minions/` root |
| `SMOKE_RUN_FAILED` | `run-orchestrator.js` exited non-zero | Check `claude` CLI/auth, Ollama, goal text; see [troubleshooting](usage-smoke-guide.md#troubleshooting) |
| `SMOKE_TASK_ID_MISSING` | Run stdout had no `Task ID:` line | Re-run; capture full stdout; file bug if reproducible |
| `SMOKE_TRACE_NOT_FOUND` | Expected JSONL missing after run | Wrong Task ID or custom `ORCH_TRACES_DIR`; `ls` traces dir |
| `SMOKE_TRACE_NOT_READABLE` | Trace path exists but empty or not JSONL | Permissions; partial run — inspect runner stderr |
| `SMOKE_OK` | Check passed | — |

---

## vs other smoke paths

| Path | Scope |
|------|--------|
| **`scripts/run-primary-smoke.mjs`** | Stable CLI smoke + trace path (this doc) |
| **`scripts/bootstrap-preflight.mjs`** | Clean-clone bootstrap before any run |
| **Claude Code MODE header** | IDE orchestration — see [usage smoke guide](usage-smoke-guide.md) Step 3 |
| **TUI checklist** | Eight manual IDE cases — [tui-manual-smoke-checklist.md](tui-manual-smoke-checklist.md) |
| **GHA doc spike** | Optional `workflow_dispatch` — not a merge gate |

---

## Out of scope (this script)

- Strict gate enforcement (remove `--skip-gates` manually for gate smoke)
- MCP registration
- Packaged global installer
- Printing env var values or tokens
