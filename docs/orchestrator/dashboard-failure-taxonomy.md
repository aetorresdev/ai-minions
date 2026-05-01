# Dashboards: failure taxonomy from traces

This doc is the **operational companion** to [`strict-mode.md`](./strict-mode.md) § *Canonical dashboard mapping* (`reason_code` → `failure_axis` → `failure_type`). For a single entry point that links schema, code mappers, and tests, see [`failure-semantics-contract.md`](./failure-semantics-contract.md). In this repository, supported consumption is **console output** (`dashboard:console`), **batch JSON** (`metrics:export-scenarios`), and **`jq`** over JSONL. **Hosted BI** (Grafana, Loki, etc.) is **not shipped here**; if you need charts in a central stack, build that in your own deployment using the same fields and policy order below.

## Console first (no TUI, no web UI)

Before any hosted UI, you can **“see the dashboard” in the terminal**: same policy order (reason_code → failure_axis → failure_type) plus a **cost-vs-outcome** table (top steps by Ollama tokens from `rollupStepsCostOutcome`).

From `orchestrator/`:

After `npm test`, you can still smoke the **same CLI** against a **fixture** shipped in the repo (no trace in `~/.claude/metrics/traces` required). From `orchestrator/`:

```bash
npm run dashboard:console -- --file tests/fixtures/golden-path-clean-v1.jsonl
```

For a trace from a real local run:

```bash
npm run dashboard:console -- --file ~/.claude/metrics/traces/<task_id>.jsonl
# batch (same discovery as metrics:export-scenarios — tagged scenarios by default):
npm run dashboard:console -- --batch --since-m 120
npm run dashboard:console -- --batch --include-untagged
# optional strict parse:
npm run dashboard:console -- --file trace.jsonl --strict-traces
```

Implementation: `orchestrator/console-dashboard.js` (stdout only; ASCII-only output, tables and `#` + `.` micro-bars). Not an interactive TUI - just **printed layout** you can pipe to `less`, log in CI, or paste from a scrollback buffer.

## Data sources

| Source | What you get |
|--------|----------------|
| Per-run JSONL | `~/.claude/metrics/traces/<task_id>.jsonl` — each `iteration_done` line carries `outcome`, `transition_reason.reason_code`, optional `failure_axis` / `failure_type` |
| `npm run metrics:export-scenarios` | Each run includes **`failure_taxonomy`**; the export root includes **`failure_taxonomy_aggregate`** (sums across all runs in the batch) |
| `npm run explain-run` | Human or `--json` summary with `iteration_done_summary`, `last_failure_axis` for a single file |

## Chart order (policy)

1. **Primary breakdown:** `transition_reason.reason_code` (stable enum).
2. **Second bucket:** `failure_axis` (when present — terminal `done` / `RUN_COMPLETED` often omit axis and coarse `failure_type`).
3. **SLO rollup:** `failure_type` only after the above, not alone.

Do not treat **`failure_type: contract_mismatch`** as a single root cause; always join with **`reason_code`** (see strict-mode table).

## Batch export fields (`scenario-metrics-export.js`)

Per run, **`failure_taxonomy`**:

- `iteration_done_count` — number of `iteration_done` lines in that file.
- `by_reason_code` — counts by `transition_reason.reason_code`.
- `by_failure_axis` — counts where `failure_axis` was set (non-terminal failures).
- `by_failure_type` — counts where `failure_type` was set.
- `by_outcome` — counts by `outcome`.
- `by_reason_axis_type` — composite key `reason_code|axis|type` with `-` when axis/type omitted (drill-down / heatmaps).

Root payload: **`failure_taxonomy_aggregate`** — same shape, summed over **`runs`**.

### Reader tolerance (batch export and console dashboard)

Summaries use the same counting helper as **`npm run dashboard:console`**: unknown `transition_reason.reason_code` values, missing `transition_reason`, and non-catalog `failure_type` / `failure_axis` strings are **counted as string keys** (including the literal **`(missing_reason_code)`** when the field is absent) instead of failing the export or the ASCII dashboard. That keeps older or forward-compatible traces readable. **Writer discipline** (every terminal failure emitting a stable `reason_code` on `iteration_done`) remains the contract in **`strict-mode.md`** § *Canonical dashboard mapping* and in the trace schema; fixing gaps there is separate from these read-side tables.

## Ad-hoc: `jq` over one JSONL file

List `reason_code` for every `iteration_done`:

```bash
jq -r 'select(.event=="iteration_done") | .transition_reason.reason_code // "null"' trace.jsonl
```

Count by `reason_code`:

```bash
jq -r 'select(.event=="iteration_done") | .transition_reason.reason_code // "(missing)"' trace.jsonl \
  | sort | uniq -c | sort -nr
```

## Optional: ingest to a log or trace backend

If you forward JSONL lines to Loki, Elasticsearch, OpenSearch, or similar:

- Prefer **low-cardinality** labels or facets: `event`, `reason_code`, `failure_axis`, `failure_type`, `flow_mode`, `scenario_id`.
- Keep **`task_id`** for drill-down links, not as a high-cardinality label on every stat panel.
- Parse nested `transition_reason` in the pipeline (JSON parser / OTTL) so queries use flat fields aligned with strict-mode.

For **Grafana** (or another UI), point panels at those extracted fields; keep dashboard JSON and data sources in **your** infra repo if you use them—nothing is required to be committed under this orchestrator package.
