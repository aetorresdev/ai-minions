# Context hygiene signals (observability)

**Observability only** — these trace events suggest operator actions; they do **not** block runs, compact handoffs automatically, or enforce token limits.

Emitted as `context_hygiene_signal` rows in JSONL traces (`trace_schema_version: "2"`).

## Signals

| `signal_id` | When emitted | Suggested operator action |
|-------------|--------------|---------------------------|
| `context_growth_rate` | Prompt tokens (`ollama_prompt_tokens` on `context_stats`) grew ≥ **1.5×** vs the previous observed agent call in the same run | Narrow scope, compact handoff, or split the task |
| `repeated_large_input_detected` | Same agent, iteration, and large prompt token count seen twice in a row (≥ **8000** tokens by default) | Stop re-pasting; reference file paths or existing handoff artifacts |
| `compaction_recommended` | Prompt ≥ **8000** and iteration ≥ **2** | Run `compact_handoff` before the next role transition |
| `fresh_run_recommended` | Iteration ≥ **5** with prompt still near the run peak (≥ **90%** of peak, peak ≥ **8000**) | Start a new run with a fresh `GOAL` / `task_id` |

Thresholds are defaults in `orchestrator/context-hygiene-signals.js` (not env-configurable in this slice).

## Trace shape (example)

```json
{
  "event": "context_hygiene_signal",
  "signal_id": "context_growth_rate",
  "severity": "warn",
  "suggestion": "Context grew quickly between agent calls — consider compact handoff or a narrower GOAL.",
  "metrics": { "prompt_tokens": 2000, "previous_prompt_tokens": 1000, "growth_ratio": 2 },
  "agent": "dev-backend",
  "iteration": 1
}
```

## Reading signals

```bash
cd orchestrator
npm run explain-run -- --run-id <task_id>
npm run tokens:report -- <task_id> --json
grep context_hygiene_signal ~/.claude/metrics/traces/<task_id>.jsonl
```

Rollups in `token_usage_summary` still derive from **`context_stats`** only — hygiene signals are additive.

## Related

- [Token hygiene guide](token-hygiene-guide.md) — human habits
- Module: `orchestrator/context-hygiene-signals.js`
