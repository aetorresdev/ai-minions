# Operator slash commands — UX aliases (not a new runtime)

Slash names are **documentation shortcuts** for humans and IDE assistants. They map **1:1** to existing CLI/npm commands documented in [`usage-smoke-guide.md`](usage-smoke-guide.md), [`operator-guided-run.md`](operator-guided-run.md), and `node run-orchestrator.js --help`. Nothing in this file registers a parser, hook, or marketplace command.

## How to use

1. Run commands from `REPO_ROOT/orchestrator` unless noted.
2. Replace placeholders (`<task_id>`, `REPO_ROOT`) before paste.
3. High-risk actions (real orchestration with gates, credential-bearing runs) still follow permission and MODE rules — slashes do not bypass them.

## Guided `runner:tui` flow (launch / status / result)

Canonical walkthrough: [operator-guided-run.md](operator-guided-run.md). Discover full flags: `npm run runner:tui -- --help`.

| Slash alias | Canonical command | Purpose | On failure |
|-------------|-------------------|---------|------------|
| `/operator-preflight` | `node scripts/operator-preflight.mjs --install --live` | Bootstrap (`PREFLIGHT_*`) + runner preflight (`OPERATOR_*`) | Exit `1` — see [operator-preflight-bridge.md](operator-preflight-bridge.md) |
| `/runner-preflight` | `npm run runner:tui -- preflight --model-policy local_only` | Launch-layer preflight only | Exit `2` — read `blockers:` in output |
| `/launch` | `npm run runner:tui -- run --goal "..." --skip-gates --iterations 1` | Launch orchestrator run (`run` subcommand) | Exit `2` preflight blocked · `3` done:false |
| `/run-status` | `npm run runner:tui -- status --run-id <task_id>` | Re-read terminal result from trace | Exit `2` — missing trace / bad `task_id` |
| `/inspect-run` | `node scripts/inspect-run-evidence.mjs <task_id>` | Chained trace + status + trace/budget panels + explain-run | Exit `1` / `INSPECT_*` blockers; see [inspect-run-evidence.md](inspect-run-evidence.md) |
| `/collect-report` | `node scripts/collect-run-report.mjs <task_id>` | Local report bundle for GitHub attachment | Exit `1` / `BUNDLE_*` + `INSPECT_*`; see [collect-run-report.md](collect-run-report.md) |

**Runner exit codes:** `0` ok · `1` usage/runtime · `2` preflight or trace missing · `3` run finished `done:false`. See `npm run runner:tui -- --help`.

## Catalog

| Slash alias | Canonical command | Purpose | On failure |
|-------------|-------------------|---------|------------|
| `/validate` | `npm test` | Harness lint + unit/integration suite | Fix reported test/lint; see CI logs |
| `/run-smoke` | `node scripts/run-primary-smoke.mjs --run` (or `node run-orchestrator.js --skip-gates --iterations 1 "<goal>"`) | One degraded CLI iteration (alpha smoke) | Exit `1` / `SMOKE_*` blockers; see [primary-smoke.md](primary-smoke.md) |
| `/explain-run` | `npm run explain-run -- --run-id <task_id>` | Human summary of a completed trace | Missing trace file → not found message; pass `--file` if needed |
| `/report-cost` | `npm run tokens:report -- <task_id>` | Token/cost rollups for one trace | Missing JSONL → script error; try `--strict-traces` if schema warnings |
| `/validate-trace` | `npm run tokens:report -- <task_id> --strict-traces` | Parse trace with schema validation enabled | Invalid lines reported; see `ORCH_TRACE_VALIDATE` in orchestrator README |
| `/check-health` | Manual: [pre-run-checklist](../orchestrator/pre-run-checklist.md) + [harness health checkpoints](harness-health-checkpoints.md) | Preconditions before a real run | No `doctor` subcommand yet — checklist only |
| `/show-blockers` | `npm run explain-run -- --run-id <task_id>` (read **Blockers** section) | Surface blockers from last run | Same as explain-run; no separate binary |
| `/trace` | `npm run runner:tui -- trace --run-id <task_id>` | Read-only trace panel (runner TUI) | Missing trace → TUI error; set `ORCH_TRACES_DIR` if non-default |
| `/budget` | `npm run runner:tui -- budget --run-id <task_id>` | Token/cost panel for one run | Same prerequisites as `/trace` |
| `/worktree` | `npm run runner:tui -- worktree --run-id <task_id>` | Worktree binding / promotion status panel | No worktree on run → empty or not-applicable panel |

## Copy-paste blocks

### Guided flow (`/operator-preflight`, `/runner-preflight`, `/launch`, `/run-status`)

```bash
cd REPO_ROOT
node scripts/operator-preflight.mjs --install --live

cd REPO_ROOT/orchestrator
npm run runner:tui -- preflight --model-policy local_only
npm run runner:tui -- run --goal "Smoke: list three files in the repo root and stop" \
  --flow single_agent --model-policy local_only --skip-gates --iterations 1
npm run runner:tui -- status --run-id <task_id>
```

### `/inspect-run`

```bash
cd REPO_ROOT
node scripts/inspect-run-evidence.mjs <task_id>
```

### `/collect-report`

```bash
cd REPO_ROOT
node scripts/collect-run-report.mjs <task_id>
```

### `/validate`

```bash
cd REPO_ROOT/orchestrator
npm test
```

### `/run-smoke`

```bash
cd REPO_ROOT
node scripts/run-primary-smoke.mjs --run
```

Smoke note only (no live run): `node scripts/run-primary-smoke.mjs`

### `/explain-run` and `/show-blockers`

```bash
cd REPO_ROOT/orchestrator
npm run explain-run -- --run-id <task_id>
```

### `/report-cost`

```bash
cd REPO_ROOT/orchestrator
npm run tokens:report -- <task_id>
```

### `/validate-trace`

```bash
cd REPO_ROOT/orchestrator
npm run tokens:report -- <task_id> --strict-traces
```

### `/check-health`

```bash
cd REPO_ROOT/orchestrator
node --version
claude --version
curl -sS http://127.0.0.1:11434/api/tags
# Then walk through docs/orchestrator/pre-run-checklist.md
```

### `/trace`, `/budget`, `/worktree` (runner TUI)

```bash
cd REPO_ROOT/orchestrator
npm run runner:tui -- trace --run-id <task_id>
npm run runner:tui -- budget --run-id <task_id>
npm run runner:tui -- worktree --run-id <task_id>
```

Full TUI contract: [runner-tui-contract.md](../orchestrator/runner-tui-contract.md).

## Not available as slash aliases

| Requested idea | Status |
|----------------|--------|
| `/resume` | **Not implemented** — use traces + explain-run (see `--help`) |
| Autonomous command picking | **Out of scope** — operator chooses the alias |
| New permission or budget semantics | **Out of scope** — harness gates unchanged |

## Claude Code / Cursor

Paste the **canonical command** from the table when the tool does not understand slash syntax. Optional: add a project rule that points to this file — still an alias table, not executable magic.

## Related

- [Inspect run evidence](inspect-run-evidence.md)
- [Operator guided run](operator-guided-run.md)
- [Operator preflight bridge](operator-preflight-bridge.md)
- [Usage smoke guide](usage-smoke-guide.md)
- [Primary smoke command and trace path](primary-smoke.md)
- [Orchestrator README](../../orchestrator/README.md)
- [Claude GHA doc smoke spike](claude-gha-doc-smoke-spike.md) — separate optional workflow
