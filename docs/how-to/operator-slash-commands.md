# Operator slash commands — UX aliases (not a new runtime)

Slash names are **documentation shortcuts** for humans and IDE assistants. They map **1:1** to existing CLI/npm commands documented in [`usage-smoke-guide.md`](usage-smoke-guide.md) and `node run-orchestrator.js --help`. Nothing in this file registers a parser, hook, or marketplace command.

## How to use

1. Run commands from `REPO_ROOT/orchestrator` unless noted.
2. Replace placeholders (`<task_id>`, `REPO_ROOT`) before paste.
3. High-risk actions (real orchestration with gates, credential-bearing runs) still follow permission and MODE rules — slashes do not bypass them.

## Catalog

| Slash alias | Canonical command | Purpose | On failure |
|-------------|-------------------|---------|------------|
| `/validate` | `npm test` | Harness lint + unit/integration suite | Fix reported test/lint; see CI logs |
| `/run-smoke` | `node run-orchestrator.js --skip-gates --iterations 1 "<goal>"` | One degraded CLI iteration (alpha smoke) | Exit `1` / inline gate blocks; check goal and `minions.md` in `--cwd` |
| `/explain-run` | `npm run explain-run -- --run-id <task_id>` | Human summary of a completed trace | Missing trace file → not found message; pass `--file` if needed |
| `/report-cost` | `npm run tokens:report -- <task_id>` | Token/cost rollups for one trace | Missing JSONL → script error; try `--strict-traces` if schema warnings |
| `/validate-trace` | `npm run tokens:report -- <task_id> --strict-traces` | Parse trace with schema validation enabled | Invalid lines reported; see `ORCH_TRACE_VALIDATE` in orchestrator README |
| `/check-health` | Manual: [pre-run-checklist](../orchestrator/pre-run-checklist.md) + [harness health checkpoints](harness-health-checkpoints.md) | Preconditions before a real run | No `doctor` subcommand yet — checklist only |
| `/show-blockers` | `npm run explain-run -- --run-id <task_id>` (read **Blockers** section) | Surface blockers from last run | Same as explain-run; no separate binary |

## Copy-paste blocks

### `/validate`

```bash
cd REPO_ROOT/orchestrator
npm test
```

### `/run-smoke`

```bash
cd REPO_ROOT/orchestrator
node run-orchestrator.js --skip-gates --iterations 1 "Smoke: list three files under orchestrator/ and stop"
```

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

## Not available as slash aliases

| Requested idea | Status |
|----------------|--------|
| `/resume` | **Not implemented** — use traces + explain-run (see `--help`) |
| Autonomous command picking | **Out of scope** — operator chooses the alias |
| New permission or budget semantics | **Out of scope** — harness gates unchanged |

## Claude Code / Cursor

Paste the **canonical command** from the table when the tool does not understand slash syntax. Optional: add a project rule that points to this file — still an alias table, not executable magic.

## Related

- [Usage smoke guide](usage-smoke-guide.md)
- [Orchestrator README](../../orchestrator/README.md)
- [Claude GHA doc smoke spike](claude-gha-doc-smoke-spike.md) — separate optional workflow
