# Harness health checkpoints

Minimal checks that show whether a clone is **ready for agent-assisted work** with ai-minions. Maps to real components — not a generic demo harness checklist.

**Documentation only** — no `doctor` subcommand yet. Use `/check-health` from [operator slash commands](operator-slash-commands.md) for the manual pre-run path.

## Demo harness vs ai-minions runtime

| Demo harness pattern | ai-minions equivalent |
|----------------------|------------------------|
| Single script bootstraps repo | `cd orchestrator && npm ci && npm test` |
| Task list in repo | MODE `GOAL` + optional root `minions.md` ([minions-project-contract.md](../orchestrator/minions-project-contract.md)) |
| Session state file | `state/project_state.md` (local); traces under `~/.claude/metrics/traces/` |
| Role rules in README | [agent-contract.md](../orchestrator/agent-contract.md) + hooks |
| Automated validation | `npm test`, optional E2E with Ollama |
| Evidence on completion | Trace JSONL + `explain-run` + smoke report template in [usage-smoke-guide.md](usage-smoke-guide.md) |

ai-minions adds **permission gates**, **CERBERUS review**, and **contract validation** — a passing demo bootstrap is necessary but not sufficient.

## Checkpoint checklist

| # | Check | Real component | Gap if missing |
|---|--------|----------------|----------------|
| 1 | **Bootstrap passes** | `orchestrator/package.json` → `npm ci` + `npm test` | Fix install/test before orchestration |
| 2 | **Task source explicit** | MODE header `GOAL` or `minions.md` | Agent scope drifts — write a bounded GOAL |
| 3 | **Session state visible** | `explain-run`, trace path, optional `state/project_state.md` | Cannot resume/debug — note `task_id` after each run |
| 4 | **Role rules documented** | `docs/orchestrator/agent-contract.md`, hooks in `scripts/hooks/` | MODE violations — read contract before multi_agent |
| 5 | **Validation executable** | `npm test`; strict E2E optional ([orchestrator README](../../orchestrator/README.md)) | No evidence for merge — run at least unit suite |
| 6 | **Closure with evidence** | Trace + smoke report template; CERBERUS for implementation slices | Do not merge on chat claims alone |

## Quick commands

```bash
cd REPO_ROOT/orchestrator
npm ci
npm test
node run-orchestrator.js --help
node scripts/verify-usage-docs.mjs   # from repo root
```

After a smoke run:

```bash
npm run explain-run -- --run-id <task_id>
npm run tokens:report -- <task_id>
```

## Future `doctor` / `check`

When a CLI subcommand exists, it should automate checks **1**, **5**, and parts of **3** (trace dir readable). Until then, this doc and [pre-run-checklist.md](../orchestrator/pre-run-checklist.md) are authoritative.

## Related

- [Usage smoke guide](usage-smoke-guide.md)
- [Token hygiene guide](../orchestrator/token-hygiene-guide.md)
- [Context hygiene signals](../orchestrator/context-hygiene-signals.md)
