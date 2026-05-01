# Claude Code hooks — compact policy, metric trust, end-of-run validation

Canonical hook scripts live under `scripts/hooks/` (see `shared-dependencies.md`). This document describes **compact read policy** and snapshot scope, **metric trust levels** and phase classification, and the **end-of-run validation** footer on flow metrics.

## Compact policy and snapshot scope

### Compact policy (deterministic)

Implemented in `context-efficiency.py`:

- **PreToolUse / Read:** For each `(file_path, offset)`, allow at most `MAX_READS_PER_FILE` reads (default **2** — block on the third identical read). Decision depends only on persisted `ctx_efficiency.reads` and the current tool input.
- **PostToolUse:** Recomputes efficiency score from session counters; optional **one-shot** budget warning when score &lt; `CTX_EFFICIENCY_BUDGET_WARN_MIN_SCORE` (default **45**), gated by `budget_warn_emitted` so it does not spam.

Same stdin + same `~/.claude/metrics/sessions/<SESSION_ID>.json` state ⇒ same allow/block and same warning emission.

### Snapshot — **not implemented in this hook**

`context-efficiency.py` does **not** implement Claude session snapshot reinjection, compact-boundary capture, or shell snapshot scripts. Those are **out of scope** here (product behaviour or repo scripts such as `scripts/hooks/*.sh`).

State owned by this hook: **`ctx_efficiency`** only under `~/.claude/metrics/sessions/<SESSION_ID>.json`.

## Metric trust levels and phase classification

### Trust levels (hook output and JSONL records)

| Level | Meaning | Examples |
|-------|---------|----------|
| **Observed** | Taken from transcript lines | Token counts from `usage` on assistant messages |
| **Estimated** | Model / formula, not billing | USD cost = token sums × `constants.PRICE` |
| **Inferred** | Best-effort regex / heuristics | MODE/ROLE phases, DEV→QA cycle counts from transcript |
| **Persisted merge** | Cross-run state file | `flow_mode`, `dev_qa_ever` when session id present |

### Missing / unknown / ambiguous

- **`missing_session_id`:** No `CLAUDE_SESSION_ID` — persisted flow hook state is not loaded; flow field may come only from the current transcript slice.
- **`state_invalid`:** Persisted JSON failed sanitize — defaults applied; see warnings.
- **`flow_ambiguous`:** Transcript disagrees with persisted flow mode — warning appended; merge policy is defined in `merge_flow_report()`.

Empty **phases** means no `MODE:` / `ROLE:` lines matched in assistant **text** — not proof the session had no modes (formatting or tool-only replies can hide them).

### Phase classification

Phases are **usable for hook reporting** when: (1) MODE lines appear as plain text in assistant messages matching `MODE_RE` in `constants.py`; (2) each phase row aggregates tokens for turns after that MODE until the next MODE. Unit tests in `scripts/hooks/tests/test_flow_metrics_phases_and_footer.py` cover a common multi-MODE path.

## End-of-run validation summary

`flow-metrics.py` appends **`format_end_of_run_validation()`** to the Stop hook `systemMessage` after the main `format_summary()` block. It states:

- WARN vs OK from accumulated **warning flags**
- Phase and USD **trust** caveats (same semantics as the metric-trust section above)
- Session id present vs missing (linked to persisted state)
- Resolved **flow field** and source/scope

**Explicit scope-out (follow-on):** a single aggregated JSON dashboard across all hooks, or CI aggregation of hook stderr — use trace JSONL + this summary for now.

## Related files

- `scripts/hooks/context-efficiency.py` — compact policy docstring + behaviour  
- `scripts/hooks/flow-metrics.py` — estimated labels + end-of-run footer  
- `scripts/hooks/constants.py` — `MODE_RE`, `PRICE`  
- `scripts/hooks/tests/test_flow_metrics_phases_and_footer.py` — phase + footer tests  
- `scripts/hooks/tests/test_hooks_negative.py` — malformed stdin / no transcript  
