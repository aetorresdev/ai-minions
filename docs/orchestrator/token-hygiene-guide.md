# Token hygiene for operators

Human practices for **ai-minions** sessions. This guide does **not** change runtime limits, billing, or model routing — it helps you spend context deliberately and read cost signals after the fact.

For **RAM/VRAM, context length, and multi-agent concurrency** before you start a heavy local run, see [local-inference-sizing.md](local-inference-sizing.md) (guidance only, not enforcement).

## When to start a new run vs continue

| Situation | Prefer |
|-----------|--------|
| New goal, different repo area, or role chain finished | **New run** — fresh `GOAL` / MODE header and new `task_id` trace |
| Same goal, small follow-up on last handoff | **Continue in chat** with explicit reference to prior artifact paths (not full re-paste) |
| Context feels bloated, repeated failures, or unrelated threads mixed in | **New run** — compaction cannot fix wrong scope |
| Only need trace inspection | **No new run** — use `npm run explain-run` / `npm run tokens:report` on existing `task_id` |

Traces live under `~/.claude/metrics/traces/<task_id>.jsonl` (override: `ORCH_TRACES_DIR`).

## When to use compact handoff

Use **`compact_handoff`** (MCP) when:

- A role finished and the **next role** needs a bounded summary, not the full chat.
- `require-handoff` / strict paths expect YAML handoff before advance.
- You are pasting into a **new** MODE block and must not re-send entire diffs or logs.

Skip re-compaction when:

- The handoff artifact already exists and is linked in `approved_artifacts`.
- You only need one-line status — say so in `GOAL` instead of attaching files.

See [agent-contract.md](agent-contract.md) and [strict-mode.md](strict-mode.md). Compaction is **lossy by design** — put decisions and file paths in the handoff, not raw tool dumps.

## When to split a large task

Split when **any** of these apply:

- More than one independent deliverable (e.g. API + UI + docs) — separate `GOAL` per run or explicit phases in `MAX_ITERATIONS`.
- ARCHITECT + DEV + QA would each need large `files_read` lists — stage ARCHITECT first with a narrow scope.
- You hit iteration limits or repeated `contract_fail` — narrow `GOAL` instead of raising iterations without cause.
- Credential or environment sets differ per phase — separate runs with distinct `ENVIRONMENT` blocks.

Keep each slice **verifiable** (one smoke command, one review target, one trace you can explain).

## How to write requests by role

| Role | Write requests that… |
|------|----------------------|
| **OWNER** | State outcome, constraints, and what is out of scope; avoid implementation detail |
| **ARCHITECT** | Name files/areas to read; ask for design + risks, not code dumps |
| **DEV** | List `files_modified` targets; one coherent change set; cite contract paths |
| **QA** | Point at artifacts to verify; require evidence (tests, trace events), not adjectives |
| **CERBERUS** | Ask for anchored findings (file/line or trace event); forbid vacuous blockers |

Always include canonical header fields (`MODE`, `FLOW`, `GOAL`, `CWD` when needed). Vague “fix everything” prompts burn tokens and fail gates.

## What not to paste in full

Avoid pasting into the goal or chat when a **path or summary** suffices:

- Whole repositories, lockfiles, or generated `dist/` trees
- Full CI logs (attach failing snippet + job name)
- Previous handoffs already on disk — reference `task_id` or artifact path
- Secret values — use `ENVIRONMENT` **variable names** only ([environment-access.md](environment-access.md))
- Unrelated PRs or issues “for context”

Prefer: “Change `orchestrator/foo.js` function X for &lt;behavior&gt;; run `npm test` in `orchestrator/`.”

## How to read the token trace report

After a run, from `orchestrator/`:

```bash
npm run tokens:report -- <task_id>
npm run tokens:report -- <task_id> --json
npm run explain-run -- --run-id <task_id>
```

| Output area | Use it to… |
|-------------|------------|
| Per-agent / per-phase totals | See which MODE dominated cost |
| `context_stats` vs `session_end` | Spot drift between mid-run and final rollups |
| MCP rollups | Find expensive tool loops |
| `--strict-traces` | Validate JSONL lines when debugging schema issues |
| Scenario export | Compare E2E labels — `node scenario-metrics-export.js` (see orchestrator README) |

**Do not** treat hook `flow-metrics.jsonl` and orchestrator traces as interchangeable — same session may appear in both with different granularity ([hooks-claude-code-metrics-validation.md](hooks-claude-code-metrics-validation.md)).

USD figures require **your** `ORCH_USD_PER_MTOK_*` rates and are marked estimated when present.

## Related

- [Usage smoke guide](../how-to/usage-smoke-guide.md)
- [Operator slash commands](../how-to/operator-slash-commands.md) — `/report-cost`, `/explain-run`
- [Context hygiene signals](context-hygiene-signals.md) — trace events (observability only)
- [Trace privacy](trace-privacy-contract.md) — redaction before sharing traces
