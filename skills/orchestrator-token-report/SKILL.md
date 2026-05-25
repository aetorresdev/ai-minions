---
name: orchestrator-token-report
description: "Read orchestrator execution traces (~/.claude/metrics/traces) and produce on-demand Ollama token + MCP summaries or batch JSON export by scenario_id. Use after orchestrator/ runs, when comparing E2E costs, or when debugging token-heavy loops."
---

# Orchestrator token report (traces)

## Purpose

On-demand **read-only** analysis of orchestrator JSONL traces: Ollama token totals, per-step rollups, MCP usage, failure taxonomy, and batch export by `scenario_id`. Does not run agents or mutate traces.

## When to invoke

- User asks for **token usage**, **trace metrics**, or **MCP call counts** from the ai-minions orchestrator.
- After `node run-orchestrator.js …` when you have a **Task ID** from CLI output.
- Comparing E2E scenario costs or debugging token-heavy loops.
- Batch aggregation when traces carry **`scenario_id`** (tests or `ORCH_TRACE_SCENARIO_ID`).

## Inputs

| Input | Notes |
|-------|-------|
| `<task_id>` | Basename under `~/.claude/metrics/traces/<task_id>.jsonl` |
| Trace file path | `--file /path/to/trace.jsonl` |
| Env `ORCH_TRACES_DIR` | Override trace directory |
| Env `ORCH_TRACE_SCENARIO_ID` | Labels runs for batch export |
| Optional USD rates | `ORCH_USD_PER_MTOK_PROMPT` + `ORCH_USD_PER_MTOK_COMPLETION` (both required for estimates) |

From `orchestrator/` (repo root):

```bash
npm run tokens:report -- <task_id>
node token-trace-report.js <task_id> --json
node scenario-metrics-export.js --dir ~/.claude/metrics/traces --since-m 120 --out metrics.json
```

## Outputs

- Human tables: prompt/completion totals, breakdown by `agent` + `phase`, MCP rollups.
- JSON: `buildReport`, `run_outcome_summary` (via `--json` / export), `runs[]` / `by_scenario{}` from scenario export.
- Contract reference: [workflow-skill-contract.md](../../docs/orchestrator/workflow-skill-contract.md) — **conformant** migrante.

## Risks

- **Claude CLI / Haiku** routes do not populate `ollama_*` — only Ollama HTTP paths do.
- USD figures are **estimates** (`usd_note: "estimated"`) — you supply rates; no billing API.
- **`scenario_id`** is a batch label, not a security boundary.
- Wrong trace dir or task id → empty or misleading report; verify Task ID from run output.
- QA template flags on rollups are observability hints, not sole “QA rejected” signal.

## Out of scope

- Does **not** grant permissions, bypass gates, or replace CERBERUS/QA review.
- Does **not** modify traces, orchestrator state, or run new agent steps.
- Not a skill marketplace or external standard — local instructions only.

## Sources of truth

| Artifact | Path | Contents |
|----------|------|----------|
| Per-run JSONL trace | `~/.claude/metrics/traces/<task_id>.jsonl` | Every line: `ts`, `ts_ms`, `trace_schema_version` (`"2"`). Schema: `orchestrator/schemas/trace-v2-line.schema.json`. |
| Override trace dir | Env `ORCH_TRACES_DIR` | Same layout as above |

## Docs

- `orchestrator/README.md` — Quickstart + metrics commands
- `docs/orchestrator/strict-mode.md` — trace events, MCP audit, Ollama token fields
- `docs/orchestrator/dashboard-failure-taxonomy.md` — batch export failure taxonomy
- `docs/orchestrator/run-outcome-consumption.md` — `run_outcome_summary` shape

## Code references

- `orchestrator/token-trace-report.js` — parse + `buildReport`
- `orchestrator/scenario-metrics-export.js` — batch export
- `orchestrator/run-outcome-summary.js` — consumption layer
