# Harness health checkpoints

Minimal checks that show whether a clone is **ready for agent-assisted work** with ai-minions. Maps to real components — not a generic demo harness checklist.

**Documentation + script** — `node scripts/bootstrap-preflight.mjs` automates checks **1**, **5**, and trace dir (**3**). `node scripts/run-primary-smoke.mjs` documents stable CLI smoke + trace path (**3**, **6**). `node scripts/run-fresh-clone-evidence.mjs` runs entry-path evidence + claim audit. See [bootstrap-preflight.md](bootstrap-preflight.md), [primary-smoke.md](primary-smoke.md), and [fresh-clone-evidence.md](fresh-clone-evidence.md). Runner TUI `preflight` covers Ollama/model policy separately.

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
| 3 | **Session state visible** | `run-primary-smoke.mjs --inspect`, `explain-run`, trace path, optional `state/project_state.md` | Cannot resume/debug — note `task_id` after each run |
| 4 | **Role rules documented** | `docs/orchestrator/agent-contract.md`, hooks in `scripts/hooks/` | MODE violations — read contract before multi_agent |
| 4b | **Skill allowlist (optional)** | `skill-registry.v1.json` + `ORCH_SKILL_REGISTRY_ENFORCE=1` for Claude Code `Skill` | Unlisted skills load freely when hook is off — see [skill-registry-contract.md](../orchestrator/skill-registry-contract.md) |
| 5 | **Validation executable** | `npm test`; strict E2E optional ([orchestrator README](../../orchestrator/README.md)) | No evidence for merge — run at least unit suite |
| 6 | **Closure with evidence** | Trace + smoke report template; CERBERUS for implementation slices | Do not merge on chat claims alone |

## Quick commands

```bash
cd ai-minions
node scripts/bootstrap-preflight.mjs --install
node scripts/run-primary-smoke.mjs
node scripts/run-fresh-clone-evidence.mjs
node scripts/run-beta-gate-hardening-evidence.mjs
node scripts/verify-usage-docs.mjs
node scripts/audit-product-claims.mjs
cd orchestrator
npm test
node run-orchestrator.js --help
```

After a smoke run:

```bash
node scripts/run-primary-smoke.mjs --inspect <task_id>
cd orchestrator
npm run explain-run -- --run-id <task_id>
npm run tokens:report -- <task_id>
```

## `doctor` / readiness check

```bash
cd ai-minions/orchestrator
npm run ai-minions -- doctor --model-policy local_only
npm run ai-minions -- doctor --live --model-policy local_only   # before worker-agent runs
```

`doctor` chains bootstrap (`PREFLIGHT_*`) and runner preflight (`OPERATOR_*`) — same bridge as [operator-preflight-bridge.md](operator-preflight-bridge.md). Legacy entry points remain valid: [bootstrap-preflight.md](bootstrap-preflight.md) · [pre-run-checklist.md](../orchestrator/pre-run-checklist.md).

## Related

- [Usage smoke guide](usage-smoke-guide.md)
- [Primary smoke command and trace path](primary-smoke.md)
- [Fresh-clone evidence and claim audit](fresh-clone-evidence.md)
- [Beta gate hardening evidence and claim audit](beta-gate-hardening-evidence.md)
- [Token hygiene guide](../orchestrator/token-hygiene-guide.md)
- [Context hygiene signals](../orchestrator/context-hygiene-signals.md)
