# Dashboards: failure taxonomy from traces

This doc is the **operational companion** to [`strict-mode.md`](./strict-mode.md) § *Canonical dashboard mapping* (`reason_code` → `failure_axis` → `failure_type`). Use it when wiring Grafana, batch jobs, or ad-hoc analysis over JSONL traces.

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

## Ingest to Loki / Elasticsearch

If you ship each JSONL line as a log record:

- Prefer **low-cardinality** labels or facets: `event`, `reason_code`, `failure_axis`, `failure_type`, `flow_mode`, `scenario_id`.
- Keep **`task_id`** for drill-down links, not as a high-cardinality label on every stat panel.
- Parse nested `transition_reason` in the pipeline (JSON parser / OTTL) so dashboards query flat fields.

## Grafana

There is **no** checked-in Grafana JSON in this repo yet: backends and label conventions differ per deployment. Build panels from:

- **Batch:** load `failure_taxonomy_aggregate` from `npm run metrics:export-scenarios -- --out metrics.json` (Transform → rows, or Infinity CSV plugin).
- **Live:** Loki/Tempo queries over ingested trace lines once fields are extracted per the table in strict-mode.

When you add a provisioned dashboard JSON under version control, reference this doc and the strict-mode table in the dashboard description.
