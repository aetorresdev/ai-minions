---
name: orchestrator-token-report
description: "Read orchestrator execution traces (~/.claude/metrics/traces) and produce on-demand Ollama token + MCP summaries (TOKENS-RPT-1) or batch JSON export by scenario_id (C-T4). Use after examples/orchestrator runs, when comparing E2E costs, or when debugging token-heavy loops."
---

# Orchestrator token report (traces)

Use this skill when the user asks for **token usage**, **trace metrics**, **MCP call counts** from the **ai-minions orchestrator example** (`examples/orchestrator`), or **export metrics per E2E scenario**.

## Sources of truth

| Artifact | Path | Contents |
|----------|------|----------|
| Per-run JSONL trace | `~/.claude/metrics/traces/<task_id>.jsonl` | `session_start`, `context_stats` (Ollama tokens when `OLLAMA_MODEL` + Ollama path), `mcp_call`, `session_end` rollups |
| Override trace dir | Env `ORCH_TRACES_DIR` | Same layout as above |

After `node run-orchestrator.js …`, the CLI prints **`Task ID:`** — that string is the `<task_id>` basename for the trace file.

## CLI — single run (TOKENS-RPT-1)

From `examples/orchestrator`:

```bash
npm run tokens:report -- <task_id>
node token-trace-report.js <task_id> --json
node token-trace-report.js --file /path/to/trace.jsonl
```

Human table: prompt/completion totals (from `context_stats` vs `session_end`), breakdown by `agent` + `phase`, MCP rollups from `session_end`.

## CLI — batch export by scenario (C-T4)

Runs that set **`scenario_id`** on `session_start` / `session_end` (via `run({ traceScenarioId: "…" })` or env **`ORCH_TRACE_SCENARIO_ID`**, or E2E helpers `e2eRun` / `strictE2eRun` in `tests/e2e*.js`) can be aggregated:

```bash
node scenario-metrics-export.js --dir ~/.claude/metrics/traces --since-m 120 --out metrics.json
```

- **`--since-m`**: only files modified in the last N minutes (optional).
- **Default:** files **without** `scenario_id` are **skipped** (avoids mixing manual runs). Use **`--include-untagged`** to include them under `scenario_id: null`.
- Output JSON: `runs[]`, `by_scenario{}`, `run_count`, `generated_at`.

## Interpreting gaps

- **Claude CLI / Haiku** routes in the example runner do **not** populate `ollama_*` — only Ollama HTTP paths do.
- **USD cost** is not computed in v1; see backlog **C-T4** / pricing in `scripts/hooks/constants.py` for hooks, not orchestrator traces.
- **`scenario_id`** is a **label** for batching (usually the E2E test name), not a security boundary.

## Docs

- `examples/orchestrator/README.md` — Quickstart + metrics commands
- `docs/orchestrator/strict-mode.md` — trace events, MCP audit, Ollama token fields
- `docs/orchestrator/model-routing.md` — execution trace event types

## Code references

- `examples/orchestrator/token-trace-report.js` — parse + `buildReport`
- `examples/orchestrator/scenario-metrics-export.js` — `collectRunsFromDir`
- `examples/orchestrator/orchestrator.js` — `traceScenarioId` / `scenario_id` on `session_start` / `session_end`
