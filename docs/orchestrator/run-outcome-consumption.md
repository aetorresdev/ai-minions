# Run outcome consumption

Trace JSONL is authoritative; **consumption** turns it into answers a human needs without parsing every line: what happened, where, why it stopped or blocked, cost, QA signals, and intent grouping.

## Canonical shape: `run_outcome_summary`

The stable object is produced by **`buildRunOutcomeSummary()`** in `orchestrator/run-outcome-summary.js`. It has **`schema_version`: `"1"`** and these top-level keys:

| Section | Meaning |
|---------|---------|
| **`where`** | `task_id`, optional `trace_file`, `scenario_id`, `flow_mode`, `max_iterations` |
| **`what`** | `done`, `iterations`, truncated `summary`, last `iteration_done` outcome and `transition_reason` (`type`, `reason_code`) |
| **`why`** | `gate_blocks`, counts of `iteration_done`, top `reason_code`s from failure taxonomy, rollup aggregates (`rollup_failed_steps`, `rollup_contract_fail_steps`, `rollup_gate_fail_steps`) |
| **`cost`** | Ollama prompt/completion/total tokens, optional USD estimate, **`basis`** explaining token source |
| **`qa`** | `qa_degraded`, `manual_review_recommended`, `handoff_fallback_used`, QA template / substantive blocker step counts |
| **`review`** | Durable QA/CERBERUS verdicts — see [review-record-contract.md](review-record-contract.md) |
| **`recovery`** | Stranded run/step sweep — `clean`, `finding_count`, `summary`, `findings[]`, `policy` — see [recovery-sweep-contract.md](recovery-sweep-contract.md) |
| **`intent_groups`** | Per-distinct-intent aggregates: tokens, step counts, failed steps (from **`rollupStepsCostOutcome`** in `token-trace-report.js`) |

### Relation to `rollup_steps`

Per-step detail lives in **`rollupStepsCostOutcome(rows)`** (same pipeline as exports). Scenario batch export attaches **`rollup_steps`** per run and **`run_outcome_summary`** together (`scenario-metrics-export.js`). The summary **`intent_groups`** and **`why.rollup_*`** fields are derived from that rollup — use the full array when you need each `step_id`, not only aggregates.

## Where this appears

| Surface | Role |
|---------|------|
| **`npm run explain-run`** | Human output ends with **`formatRunOutcomeSummaryLines`**; **`--json`** includes **`run_outcome_summary`** next to **`deriveExplain`** fields |
| **`console-dashboard.js`** | Uses **`buildRunOutcomeSummary`** / **`formatRunOutcomeSummaryLines`** for ASCII tables |
| **`scenario-metrics-export.js`** | Each run includes **`run_outcome_summary`**; batch JSON documents fields under **`consumption`** |
| **`token-trace-report`** | Shares **`buildReport`**, rollup, and taxonomy helpers |

## Batch scenario export (`npm run metrics:export-scenarios`)

**CLI:** `orchestrator/scenario-metrics-export.js` (see `orchestrator/README.md`). The JSON object includes:

| Top-level key | Purpose |
|---------------|---------|
| **`consumption`** | **`payload_schema_version`**, path to this doc, **`runs_entry_keys`** (expected keys on each `runs[]` item), **`reviewer_quick_path`** (dot paths for outcome review) |
| **`runs`** | One object per trace file, each with **`run_outcome_summary`**, **`rollup_steps`**, **`failure_taxonomy`**, session rollups, etc. |
| **`by_scenario`**, **`by_flow_mode`**, **`by_stage`** | Aggregations for comparison |
| **`failure_taxonomy_aggregate`**, **`usd_export_meta`** | Cross-run taxonomy and USD rate help text |

Optional per-run **`ollama_usd_estimate`** appears only when USD env rates are set. Keys are listed in **`consumption.runs_entry_keys`** so exports stay self-describing.

Sanitization/redaction: rows should pass through the same pipeline as dashboard/export (**`sanitizeTraceRowsForRead`**) before consumption when reading untrusted traces.

## Example (`schema_version` 1)

Minimal successful run (illustrative — field presence may vary with trace version):

```json
{
  "schema_version": "1",
  "where": {
    "task_id": "example-task",
    "trace_file": "/path/to/trace.jsonl",
    "scenario_id": "my-scenario",
    "flow_mode": "single_agent",
    "max_iterations": 3
  },
  "what": {
    "done": true,
    "iterations": 1,
    "summary": "Delivered change …",
    "last_iteration_outcome": "done",
    "last_transition_reason": { "type": "DONE", "reason_code": "RUN_COMPLETED" }
  },
  "why": {
    "gate_blocks": 0,
    "iteration_done_events": 1,
    "top_reason_codes": [{ "reason_code": "RUN_COMPLETED", "count": 1 }],
    "rollup_failed_steps": 0,
    "rollup_contract_fail_steps": 0,
    "rollup_gate_fail_steps": 0
  },
  "cost": {
    "ollama_prompt_tokens": 100,
    "ollama_completion_tokens": 40,
    "ollama_total_tokens": 140,
    "basis": "session_end_totals_else_context_stats_sum"
  },
  "qa": {
    "qa_degraded": false,
    "manual_review_recommended": false,
    "handoff_fallback_used": false,
    "qa_triple_template_steps": 0,
    "qa_substantive_blocker_steps": 0
  },
  "intent_groups": []
}
```

## See also

- [strict-mode.md](strict-mode.md) — trace line semantics
- [agent-harness.md](agent-harness.md) — observability layer
- `orchestrator/README.md` — CLI tools (`explain-run`, dashboard, token-trace-report)
