---
name: orchestrator-token-report
description: "Read orchestrator execution traces (~/.claude/metrics/traces) and produce on-demand Ollama token + MCP summaries or batch JSON export by scenario_id. Use after orchestrator/ runs, when comparing E2E costs, or when debugging token-heavy loops."
---

# Orchestrator token report (traces)

Use this skill when the user asks for **token usage**, **trace metrics**, **MCP call counts** from the **ai-minions orchestrator** (`orchestrator/` at repo root), or **export metrics per E2E scenario**.

## Sources of truth

| Artifact | Path | Contents |
|----------|------|----------|
| Per-run JSONL trace | `~/.claude/metrics/traces/<task_id>.jsonl` | Every line: `ts`, `ts_ms`, `trace_schema_version` (`"2"`). `iteration_done.transition_reason`: `{ type, reason_code, details?, gate_id?, step_id? }`. Optional on **`agent_done`** (**`qa`**): `qa_triple_template`, `qa_blocker_non_vacuous` (cost-vs-outcome; see `strict-mode.md`). Schema: `orchestrator/schemas/trace-v2-line.schema.json`. Optional strict parse: `ORCH_TRACE_VALIDATE=1` or `--strict-traces` on CLIs. |
| Override trace dir | Env `ORCH_TRACES_DIR` | Same layout as above |

After `node run-orchestrator.js …`, the CLI prints **`Task ID:`** — that string is the `<task_id>` basename for the trace file.

## CLI — single run (on-demand report)

From `orchestrator/` (repo root):

```bash
npm run tokens:report -- <task_id>
node token-trace-report.js <task_id> --json
node token-trace-report.js --file /path/to/trace.jsonl
```

Human table: prompt/completion totals (from `context_stats` vs `session_end`), breakdown by `agent` + `phase`, MCP rollups from `session_end`.

## CLI — batch export by scenario

Runs that set **`scenario_id`** on `session_start` / `session_end` (via `run({ traceScenarioId: "…" })` or env **`ORCH_TRACE_SCENARIO_ID`**, or E2E helpers `e2eRun` / `strictE2eRun` in `tests/e2e*.js`) can be aggregated:

```bash
node scenario-metrics-export.js --dir ~/.claude/metrics/traces --since-m 120 --out metrics.json
```

- **`--since-m`**: only files modified in the last N minutes (optional).
- **Default:** files **without** `scenario_id` are **skipped** (avoids mixing manual runs). Use **`--include-untagged`** to include them under `scenario_id: null`.
- Output JSON: `runs[]`, `by_scenario{}`, `by_flow_mode{}`, **`by_stage`** (`by_role` / `by_phase` — Ollama token sums from `context_stats` across runs), **`usd_export_meta`** (`usd_rates_configured`, `usd_note`), optional per-run **`ollama_usd_estimate`** (includes `usd_note: "estimated"` when env rates set), `run_count`, `generated_at`.

## Interpreting gaps

- **Claude CLI / Haiku** routes in the example runner do **not** populate `ollama_*` — only Ollama HTTP paths do.
- **USD (optional):** set **`ORCH_USD_PER_MTOK_PROMPT`** and **`ORCH_USD_PER_MTOK_COMPLETION`** (both required; USD per 1e6 Ollama tokens) so `token-trace-report` / scenario export attach estimates — **always marked `usd_note: "estimated"`** (Ollama has no billing line-item API here); you supply rates only.
- **`scenario_id`** is a **label** for batching (usually the E2E test name), not a security boundary.
- **`rollup_steps` / `--json`:** per-**`step_id`** rows may include **`qa_triple_template`** and **`qa_blocker_non_vacuous`** when the QA step emitted the template flags — orthogonal to **`step_failed`**; use for dashboards, not as sole “QA rejected” signal (no template → no flags).

## Docs

- `orchestrator/README.md` — Quickstart + metrics commands
- `docs/orchestrator/strict-mode.md` — trace events, MCP audit, Ollama token fields; **`iteration_done`:** § *Canonical dashboard mapping* (`reason_code` → `failure_type` + `failure_axis`)
- `docs/orchestrator/dashboard-failure-taxonomy.md` — batch export **`failure_taxonomy`**, **`jq`**; **console:** `npm run dashboard:console` (ASCII-only framing; smoke with `tests/fixtures/golden-path-clean-v1.jsonl`); § *Reader tolerance* (export + console helpers must not throw on unknown `reason_code` or sparse `iteration_done` rows)
- `docs/orchestrator/model-routing.md` — execution trace event types

## Code references

- `orchestrator/token-trace-report.js` — parse + `buildReport`
- `orchestrator/scenario-metrics-export.js` — `collectRunsFromDir`, `buildByStage`, `buildUsdExportMeta`
- `orchestrator/orchestrator.js` — `traceScenarioId` / `scenario_id` on `session_start` / `session_end`; `composeIterationDonePayload()` / `traceIterationDone()` (closed `reason_code` before write)
