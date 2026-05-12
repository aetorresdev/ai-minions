# Orchestrator

An autonomous orchestrator that follows the [MODE protocol](../docs/orchestrator/agent-contract.md) and uses the [orchestrator-state MCP](../mcp-servers/orchestrator-state/README.md) as the authoritative state store.

Give it a goal — it plans, runs agents, validates transitions through hard gates, runs Cerberus review, and iterates until done or max iterations.

> **Normal invocation is via the Claude Code header** — just type the MODE header in any chat and the `UserPromptSubmit` hook launches this runner automatically:
> ```
> MODE: ORCHESTRATOR
> FLOW: multi_agent
> GOAL: your goal here
> MAX_ITERATIONS: 3
> CWD: /path/to/project
> ```

The `node` commands below are for direct use, testing, or bringing your own runner.

**Shared clone assets** (`mcp-servers/`, `scripts/hooks/`, `skills/`, top-level `agents/`): what is required when, and how failures surface — see [`docs/orchestrator/shared-dependencies.md`](../docs/orchestrator/shared-dependencies.md).

> **This is one way to run the protocol autonomously. Bring your own orchestrator if you prefer** — the contract and MCPs work independently of this example.

---

## How it works

```
ORCHESTRATOR (Ollama — local, no API cost)
  └─ plans steps as JSON

For each step:
  └─ agent runs (claude CLI — uses your active Claude Code session)
  └─ compact-handoff MCP → handoff YAML
  └─ orchestrator-state: validate_goal_alignment    🟥 BLOCK if not aligned
  └─ orchestrator-state: validate_transition        🟥 BLOCK if gates fail
  └─ orchestrator-state: advance_mode              records on disk

CERBERUS (Sonnet)
  └─ adversarial review: blocker | improvement | nice-to-have

ORCHESTRATOR (Ollama)
  └─ done=true   → close task
  └─ done=false  → next iteration (blockers only — improvements go to backlog)
```

If `orchestrator-state` or `compact-handoff` MCPs are not registered (or `--skip-gates` is passed), the runner prints a prominent **⚠ DEGRADED MODE** banner and continues without hard gates. In degraded mode: no transitions are recorded, no goal alignment is checked, no approved-artifact enforcement. Output contracts (`validateOutput`) still apply regardless.

### `compact_handoff` failure (worker steps and CERBERUS advance)

`require_handoff` defaults from the effective mode: **strict** (gates on, no `--skip-gates`) → `true`; **degraded** (`--skip-gates` / `skipStateMcp`) → `false`. Override from code with `requireHandoff: boolean`, or from CLI with `--require-handoff` / `--no-require-handoff`.

| Mode | On `compact_handoff` failure |
|------|------------------------------|
| Strict | Hard fail: artifact `gateBlocked: true`, `gateReason` prefixed with `compact_handoff failed:`, trace `compact_handoff_failed`, no silent empty handoff |

Integration (no `run()` hooks): `tests/compactHandoffStrict.integration.test.js` stubs `child_process.spawnSync`, loads `orchestrator` with `requireHandoff: true` and `skipStateMcp: true`, and asserts `gateBlocked` + `done=false` after a simulated `compact_handoff` failure.
| Degraded | Continue: artifact fields `handoff_compression: unavailable`, `handoff_fallback_used: true`, `handoff_error`, trace `compact_handoff_fallback`, and the run summary appends a visible note |

> **Gates are opt-in — but degraded mode is not silent.** If you see the banner, you are not running with full protection.

---

## Agents

| Agent | MODE | Model | Role |
|-------|------|-------|------|
| `orchestrator` | ORCHESTRATOR | Ollama `qwen2.5-coder:7b` | Plans steps + evaluates done/iterate — JSON only |
| `owner` | OWNER | Haiku | Scope, priorities, definition of done |
| `architect` | ARCHITECT | Sonnet | Design and trade-offs — no code |
| `dev-backend` | DEV | Sonnet | Backend implementation |
| `dev-frontend` | DEV | Sonnet | Frontend implementation |
| `dev-devops` | DEV | Sonnet | Infrastructure implementation |
| `qa` | QA | Sonnet | Test cases, evidence, classified findings |
| `cerberus` | CERBERUS | Sonnet | Adversarial last-mile review after DEV+QA |

`orchestrator` and the handoff summarizer run on **Ollama** (local, no API key needed).
All worker agents run via the **`claude` CLI** using your active Claude Code session.

---

## Prerequisites

| Requirement | Check |
|---|---|
| Claude Code CLI | `claude --version` |
| Active Claude session | `claude auth status` |
| Node.js ≥ 18 | `node --version` |
| Ollama running | `curl http://localhost:11434/api/tags` |
| `qwen2.5-coder:7b` pulled | `ollama list` |

The MCPs (`orchestrator-state`, `compact-handoff`) are **optional** — the orchestrator runs without them but without hard gates. See [With hard gates](#with-hard-gates-recommended) to enable them.

---

## Configuration decision table

Use this to pick the right setup for your situation.

| Situation | Recommended config | Why |
|-----------|-------------------|-----|
| First run / trying it out | `--skip-gates`, `--iterations 1` | No MCP setup needed, fast feedback |
| Local dev on a real project | `--skip-gates`, `--iterations 3` | Output contracts still enforce quality; gates add setup friction |
| Production / compliance work | Gates enabled (no `--skip-gates`) | Hard gates, tamper-evident log, approved-artifact enforcement |
| No Ollama / want pure API | Unset `OLLAMA_MODEL` | Orchestrator/summarizer fall back to `claude-haiku` automatically |
| Ollama available | `OLLAMA_MODEL=qwen2.5-coder:7b` | Free planning + summarization, no API cost for orchestrator role |
| Ollama not on `localhost:11434` | `OLLAMA_HOST`, `OLLAMA_PORT` | `runOllama()` (agent calls) uses these; defaults match local `ollama serve` |
| Slow machine / CI | `CLAUDE_CLI_TIMEOUT=300000` | Default 180s may be too short for cold starts |
| Sensitive goal (logs to disk) | `TRACE_REDACT_GOAL=1` | Goal text omitted from trace files; only SHA-256 hash retained |
| Local debug: verbatim trace strings | `ORCH_TRACE_SKIP_SECRET_REDACT=1` | Disables deterministic secret-shaped redaction in `_sanitize` **and** read-time `sanitizeTraceRowsForRead` (export, dashboard, `token-trace-report`, `explain-run`) — **local only**; combined with **`CI=true`** (or `1` / `yes`) the process **exits** on load / first redaction call |
| Single focused task | `--iterations 1`, `--flow single_agent` | Skip multi-agent overhead; one DEV + CERBERUS pass |
| Complex multi-role task | `--iterations 3`, `--flow multi_agent` | Full plan → DEV → QA → CERBERUS loop with corrections |
| QA ran degraded (Haiku fallback) | Add manual review | `qa_degraded: true` in `session_end` trace — coverage may be reduced |
| Cerberus keeps blocking | Check Cerberus output in artifacts | May be too strict; use `--iterations 1` to force single pass |

### Gates: soft vs strict vs off

| Mode | How | Protection | Cost |
|------|-----|-----------|------|
| Off (`--skip-gates`) | No MCPs needed | Output contracts only | Fastest |
| Soft (MCPs registered, default) | Gates run but empty handoff YAML passes | Contracts + goal alignment + transition checks | ~5–8 min/iteration |
| Strict (gates + full handoff) | Empty YAML fails; all keys required | Full enforcement including approved-artifact check | ~5–8 min/iteration |

### Guarantees by mode

| Guarantee | Off (`--skip-gates`) | Soft (MCPs) | Strict (MCPs + full handoff) |
|-----------|:-------------------:|:-----------:|:----------------------------:|
| Output contracts enforced | ✅ | ✅ | ✅ |
| Transitions recorded on disk | ❌ | ✅ | ✅ |
| Goal alignment checked | ❌ | ✅ | ✅ |
| Approved-artifact enforcement | ❌ | ✅ | ✅ |
| Handoff YAML required (non-empty) | ❌ | ❌ | ✅ |
| Fallback model allowed (dev-\*, qa) | ✅ | ✅ | ✅ |
| Fallback model allowed (architect, cerberus) | ❌ | ❌ | ❌ |
| Critical role contract fail stops iteration | ✅ | ✅ | ✅ |
| QA degraded flagged in trace + warning | ✅ | ✅ | ✅ |
| Goal redacted in traces + active-agent.json | `TRACE_REDACT_GOAL=1` | `TRACE_REDACT_GOAL=1` | `TRACE_REDACT_GOAL=1` |
| MCP calls logged per run (`mcp_call` + `session_end` rollups) | ❌ (no state MCP traffic) | ✅ | ✅ |
| Ollama prompt/completion token counts (`context_stats` + `session_end` totals) | Only when `OLLAMA_MODEL` + Ollama routes are used | ✅ | ✅ |

### Kill-switch guardrails (env only)

Hard limits for unattended / CI runs — **not** configurable from `run()` options (except `maxIterations` from API/CLI still wins over env for the iteration cap):

| Env | Effect |
|-----|--------|
| **`ORCH_MAX_ITERATIONS`** | Integer **1–500**. Used when `run()` is called **without** `maxIterations` (e.g. `node run-orchestrator.js` without `--iterations`). CLI `--iterations` overrides. |
| **`ORCH_MAX_RETRIES`** | Integer **0–500**. Max allowed **`retry_number`** per `agentId` within a **single outer iteration** (same agent scheduled twice in one pass → second call has `retry_number` 1). Abort → `iteration_done` with `failure_type: retry_exceeded`, `reason_code: GUARD_STEP_RETRY_LIMIT`. Unset = no limit. |
| **`ORCH_MAX_COST_USD`** | Positive float (USD). Requires **both** `ORCH_USD_PER_MTOK_PROMPT` and `ORCH_USD_PER_MTOK_COMPLETION` (same basis as `token-trace-report`). Estimates spend from accumulated Ollama prompt+completion tokens after plan, each worker, summarizer, cerberus, correct, decide. Abort → `failure_type: cost_abort`, `reason_code: GUARD_COST_LIMIT`. |

If **`ORCH_MAX_COST_USD`** is set without both USD rate envs, **`run()` throws at start** (fail-fast). When the outer loop exits with `done: false` without a prior terminal `iteration_done`, the runner emits **`MAX_ITERATIONS_LOOP_EXHAUSTED`**.

Trace path: `~/.claude/metrics/traces/<task_id>.jsonl`. See [strict-mode.md](../docs/orchestrator/strict-mode.md) § *Flow-aware trace metadata*, § *MCP usage audit*, and § *Ollama token counts*.

**Graph fields:** every step-level event carries `step_id` (primary join key, e.g. `<task_id>-i1-dev-backend`), `step_index` (0-based plan position), and `retry_number` (0 = first attempt). **Every trace line** adds `ts_ms` (epoch ms) next to `ts`. `iteration_done` adds structured `transition_reason: { type, details? }` (enum types in `strict-mode.md`). Use these to reconstruct execution flow without parsing `(agent, iteration)` tuples.

**QA cost signal (optional):** successful **`agent_done`** rows with **`agent: "qa"`** may include **`qa_triple_template`** and **`qa_blocker_non_vacuous`** (three-line finding template + non-vacuous `blocker:` line). Per-step rollups in **`token-trace-report.js`** / scenario export / **`explain-run`** surface the same keys — **separate from** **`step_failed`** (see `strict-mode.md`).

**On-demand token / MCP summary (v1):** after a run, use the `task_id` printed by `run-orchestrator.js` (or pass any trace basename):

```bash
npm run tokens:report -- <task_id>
# or: node token-trace-report.js <task_id> --json
# custom file: node token-trace-report.js --file /path/to/trace.jsonl
```

- **Env:** `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces`). **`ORCH_TRACE_VALIDATE=1`** — validate each JSONL line against trace schema v2 when parsing in `token-trace-report` / `scenario-metrics-export` (same semantics as CLI `--strict-traces`).
- **Permission rollups (JSON + text):** `permission_summary_from_session_end` when `session_end` carries `permission_summary`; `permission_summary_derived` recomputed from every `permission_check` row; text report prints a **Permission checks** section when totals exist.
- **`token_usage_summary` (JSON + text):** splits **direct** agent `context_stats` vs **infra-attributed** compaction (`invocation_type: context_compaction`, `execution_actor: context_compactor`, `attributed_to_role`). Compaction Ollama counts appear when **`compact_handoff`** returns structured JSON from **`mcp-direct.py`**. **Model fallback (Claude CLI):** after a successful degraded primary→secondary call, **`model_fallback_segments`** expand to **one `context_stats` row per segment**; **`by_role.*.by_model`** lists segments. **`fallback_reason`** on the primary segment is a **heuristic** classification from the CLI error string (coarse ops signal, not a provider-official taxonomy). Completing segments often use **`usage_accounting_status: unknown_provider_usage`** when the CLI does not report per-call tokens. Primary segment rows may include **`fallback_target`** (secondary model id) for **`by_invocation`** linking. **Observability (non-token) events:** `context_compaction_started` / `context_compaction_completed` wrap successful **`compact_handoff`** calls (attribution fields mirror compaction `context_stats`); `model_fallback_required` / `model_fallback_started` / `model_fallback_completed` fire when **`model_fallback_segments`** are present — they do **not** replace `context_stats` for rollups and are not cost-guard inputs.
- **Optional USD (Ollama only):** set both **`ORCH_USD_PER_MTOK_PROMPT`** and **`ORCH_USD_PER_MTOK_COMPLETION`** (USD per 1e6 tokens) so `token-trace-report` / scenario export attach **estimates** (`usd_note: "estimated"` — not vendor billing). Rates are yours to supply.
- **`cost_accounting` (JSON + text, advisory):** run-level **`actual`** (same **`ORCH_USD_PER_MTOK_*`** rates as the optional USD line — **reporting-only estimate**; not a new enforcement surface; **`ORCH_MAX_COST_USD`** is unchanged and not driven by this object) vs **`equivalent_cloud`** (optional benchmark: set **`ORCH_EQUIV_CLOUD_USD_PER_MTOK_PROMPT`** and **`ORCH_EQUIV_CLOUD_USD_PER_MTOK_COMPLETION`**, plus **`ORCH_EQUIV_CLOUD_BASELINE_MODEL`** for a numeric row; optional **`ORCH_EQUIV_CLOUD_BASELINE_PROVIDER`**, default `custom`). If equiv rates are unset, **`equivalent_cloud_cost_status: missing_baseline_mapping`**; if rates are set but the baseline model label is empty, **`missing_baseline_model`**. Equivalent USD is **not** provider spend and is **not** wired to **`ORCH_MAX_COST_USD`**. JSON uses **`is_billable: false`** on both dimensions (do not infer cost-guard wiring from **`cost_accounting`**).

**`compact_handoff` return shape:** With **`ORCH_MCP_TRANSPORT=direct`**, a **successful** `compact-handoff.compact_handoff` call returns **JSON** (stdout from `mcp-direct.py`): an object with **`handoff_yaml`** (string) and **`ollama_prompt_tokens`** / **`ollama_completion_tokens`** when Ollama reports usage. **Tool-side failures** remain **`error: …`** **plain strings** (e.g. unreachable Ollama) — not the structured success object; callers must branch on type. With **Claude CLI** transport, success is still a **raw YAML string** only (no compaction token API). **Compaction `context_stats` rows** are emitted after every successful handoff compaction: on the CLI path, Ollama fields are **zero by design** so infra-attribution stays visible in the trace without fabricating usage.

**Trace contract:** every JSONL line includes `trace_schema_version` (`"2"` — first published baseline). `iteration_done.transition_reason` is always an **object** `{ type, details? }`. Versioning policy (semver-like semantics, breaking vs non-breaking, mismatch): `docs/orchestrator/schema-versioning.md`. Short governance: `docs/orchestrator/strict-mode.md` § *Trace schema versions* and § *Trace contract governance*. Optional lifecycle events (`context_compaction_*`, `model_fallback_*`) are additive observability; **`token_usage_summary`** is still derived only from **`context_stats`** lines.

**Batch export by scenario:** traces can carry `scenario_id` on `session_start` / `session_end` when you pass `traceScenarioId` to `run()` or set env **`ORCH_TRACE_SCENARIO_ID`**. Tagged runs from tests use the same mechanism. Aggregate JSON includes **`consumption`** (schema version, link to **`docs/orchestrator/run-outcome-consumption.md`**, **`runs_entry_keys`**, **`reviewer_quick_path`**), **`runs`**, **`by_scenario`**, **`by_flow_mode`**, **`by_stage`** (Ollama token rollups by `agent` and by `phase` from `context_stats`), **`failure_taxonomy_aggregate`** (counts of `iteration_done` by `reason_code` / `failure_axis` / `failure_type` — per run: **`failure_taxonomy`**), **`usd_export_meta`**, optional per-run **`ollama_usd_estimate`** when USD env vars are set, and per-run **`run_outcome_summary`** (see **Readable run summary** below — same shape as `token-trace-report.js --json` and the dashboard header).

```bash
npm run metrics:export-scenarios -- --since-m 60 --out /tmp/orch-metrics.json
# flags: --dir, --include-untagged, --out (stdout if omitted)
```

**Readable run summary (export field `run_outcome_summary`):** one object answers what happened, where, why (taxonomy + gate/step signals), token cost (and optional USD when env rates are set), QA signals, and intent-grouped rollups. Example (abbreviated):

```json
{
  "schema_version": "1",
  "where": { "task_id": "abc", "scenario_id": "golden-path", "flow_mode": "single_agent", "trace_file": "/path/to/abc.jsonl" },
  "what": { "done": true, "iterations": 1, "summary": "Shipped fix", "last_transition_reason": { "type": "DONE", "reason_code": "RUN_COMPLETED" } },
  "why": { "gate_blocks": 0, "iteration_done_events": 1, "top_reason_codes": [{ "reason_code": "RUN_COMPLETED", "count": 1 }], "rollup_failed_steps": 0 },
  "cost": { "ollama_prompt_tokens": 100, "ollama_completion_tokens": 40, "ollama_total_tokens": 140, "basis": "session_end_totals_else_context_stats_sum" },
  "qa": { "qa_degraded": false, "manual_review_recommended": false, "qa_triple_template_steps": 0 },
  "intent_groups": []
}
```

**Console dashboard (no TUI; no hosted UI in this package):** stdout tables; structural framing stays ASCII. Field values copied from traces may contain non-ASCII bytes. Optional ANSI highlights semantic states (`done`, gate blocks, QA rollup markers) when stdout is a TTY and **`--color=auto`** (default), or when **`--color=always`**. **`--color=never`** or **`NO_COLOR`** (non-empty) disables color and overrides **`--color=always`**. Failure taxonomy + top steps by tokens + **`run_outcome_summary`** block:

```bash
# smoke without a local trace (fixture shipped in repo):
npm run dashboard:console -- --file tests/fixtures/golden-path-clean-v1.jsonl
npm run dashboard:console -- --file ~/.claude/metrics/traces/<task_id>.jsonl
npm run dashboard:console -- --batch --since-m 60 --include-untagged
# force ANSI even when piped: --color=always
```

See [`docs/orchestrator/dashboard-failure-taxonomy.md`](../docs/orchestrator/dashboard-failure-taxonomy.md) § *Console first*.

**Not** in this example runner: unified Anthropic token API for Claude CLI routes (Ollama paths expose token totals as above).

**Skill:** `skills/orchestrator-token-report/SKILL.md` — when to use CLIs vs reading JSONL manually.

---

## Quickstart (no MCPs — 2 minutes)

### From a terminal (without the Claude Code chat UI)

You do **not** need the Claude Code **desktop app** or a chat with the `MODE: ORCHESTRATOR` header. From this directory, **`node run-orchestrator.js`** (or **`node cli.js`**) runs the same runner. You **do** need **Node ≥ 18** and the **`claude` CLI** with a valid session (`claude auth status`), because DEV/QA/CERBERUS/… steps spawn `claude` as a subprocess (except tests that stub `askAgent`).

**Changing default models:** precedence and examples are in [`docs/orchestrator/model-routing.md`](../docs/orchestrator/model-routing.md). Short map: **`OLLAMA_MODEL`** (orchestrator/summarizer via Ollama); **`MODEL_OVERRIDE_<ROLE>`** (e.g. `MODEL_OVERRIDE_QA`); **`models.json`** profiles + **`--profile`** on `run-orchestrator.js`; hardcoded routing table in **`agents/routing/model-routing.js`**.

```bash
# From repo root (replace ~/.claude with your REPO_ROOT)
cd ~/.claude/orchestrator

# Run on a real project
node run-orchestrator.js \
  --cwd /path/to/your/project \
  --skip-gates \
  "Your goal here"
```

Example — create a simple script:

```bash
node run-orchestrator.js \
  --cwd /tmp/myproject \
  --skip-gates \
  --iterations 1 \
  "Create a Node.js script that reads a JSON file and prints each key-value pair"
```

For examples with environment access and credentials (n8n, write mode), see [Running the orchestrator](../README.md#running-the-orchestrator) in the root README.

Expected output:

```
Orchestrator starting in: /tmp/myproject
Flow: single_agent | Max iterations: 1 | Gates: DISABLED

10:26:32 AM [orchestrator] Planning...
10:26:33 AM [orchestrator] Plan ready — 1 step(s):
10:26:33 AM [dev-backend] Step 1: Create script.js that reads a JSON file...
10:26:33 AM [orchestrator] ── Iteration 1/1 ──
10:26:33 AM [dev-backend] Executing...
10:26:42 AM [gate] Compacting handoff (compact-handoff MCP)...
10:26:49 AM [gate] Handoff YAML ready
10:26:51 AM [dev-backend] Done
10:26:51 AM [cerberus] Reviewing deliverables...
10:27:03 AM [orchestrator] ✓ Done: script.js created. No blockers.
```

**Timing:** ~30–90s per iteration without gates (Ollama planning + Claude agent + Cerberus review).

---

## Explain a run

The fastest way to understand what happened after a run completes — or after a failure.

```bash
# Latest run (auto-resolved by ts_ms)
npm run explain-run

# Specific file
npm run explain-run -- --file ~/.claude/metrics/traces/my-run.jsonl

# Specific run_id
npm run explain-run -- --run-id task-abc123

# Structured JSON output
npm run explain-run -- --file /path/to/trace.jsonl --json
```

**Natural language trigger:** you can also ask the agent in plain language:

> "explain what happened in the last run"
> "why did the last run fail?"

The agent resolves the latest run automatically and runs `explain-run` without explicit flags.

**What it shows:**

| Field | Source |
|-------|--------|
| `final_status` | Last `iteration_done` or `session_end` outcome |
| `goal` | First `session_start` — omitted if absent |
| `flow_mode` | First `session_start` — omitted if absent |
| `retries` | Count of `iteration_done` with `outcome == "iterate"` |
| `failure_type` | Trace field; `UNKNOWN` if run failed and field absent |
| `cost_usd` | Sum of `cost_usd` fields — omitted if no token data |
| `intent_ids` | Unique `intent_id` values in first-seen order (from step-level rows) |
| `iteration_done_summary` | Per-`iteration_done`: `iteration`, `outcome`, optional `failure_axis` / `failure_type` / `intent_ids` |
| `last_failure_axis` | Last `failure_axis` seen on an `iteration_done` line |
| `rollup_steps` | Per-step rollup (tokens, `step_failed`, `contract_fail`, `gate_fail`, optional QA flags) — same builder as `token-trace-report` / scenario export |
| `run_outcome_summary` | **Consumption layer** — single object (`schema_version` 1): where / what / why / cost / QA / `intent_groups`; included in **`--json`** and printed after human fields (ASCII block). See [`docs/orchestrator/run-outcome-consumption.md`](../docs/orchestrator/run-outcome-consumption.md). |

**Readable run summary (one example):** run `npm run explain-run -- --file tests/fixtures/golden-path-clean-v1.jsonl --json`. The payload merges **`deriveExplain`** fields with **`run_outcome_summary`**. For field definitions and an example JSON shape, see **`docs/orchestrator/run-outcome-consumption.md`**. For failure taxonomy and console tables, see `docs/orchestrator/dashboard-failure-taxonomy.md` and `npm run dashboard:console`.

**Parse errors and size limits:** invalid JSON lines are skipped; derivation still runs on the rest. Human CLI output ends with `WARNING: <n> invalid JSON line(s) skipped` when lines were dropped. If the file exceeds 50 MB or 10,000 lines, input is truncated to the last span that includes a `session_end`, and human output starts with `WARNING: file exceeded limits (50 MB / 10000 lines) - truncated to last session_end segment`.

---

## With hard gates (recommended)

Hard gates record every transition on disk and block advances if goal alignment fails or unapproved files are detected.

### 1. Register the MCPs (one-time setup)

```bash
REPO=$HOME/.claude

# orchestrator-state (state store + gates)
cd $REPO/mcp-servers/orchestrator-state
uv venv
.venv/bin/pip install "mcp>=1.0.0" "httpx>=0.27.0" "pyyaml>=6.0.1"
claude mcp add orchestrator-state \
  $REPO/mcp-servers/orchestrator-state/.venv/bin/python \
  $REPO/mcp-servers/orchestrator-state/server.py \
  --scope user

# compact-handoff (handoff compaction via Ollama)
cd $REPO/mcp-servers/compact-handoff
uv sync --no-install-project
claude mcp add compact-handoff \
  $REPO/mcp-servers/compact-handoff/.venv/bin/python \
  $REPO/mcp-servers/compact-handoff/server.py \
  --scope user
```

Verify:

```bash
claude mcp list
# should show: orchestrator-state, compact-handoff
```

### 2. Run with gates

```bash
node run-orchestrator.js \
  --cwd /path/to/your/project \
  "Add input validation to the users API endpoint"
```

**Timing:** ~5–8 min per iteration with gates (each gate call invokes `claude` CLI internally).

### What the gate output looks like

```
10:27:18 AM [gate] Registering task "task-b4013eec" in state store...
10:27:24 AM [gate] Task registered — envelope: ~/.claude/.state/orchestrator/task-b4013eec/envelope.json
10:27:44 AM [gate] Validating goal alignment for dev-backend...
10:27:52 AM [gate] 🟩 Goal aligned (confidence: 0.91)
10:27:52 AM [gate] validate_transition: DEV → QA (iteration 1)
10:27:58 AM [gate] 🟩 Transition allowed — advancing to QA
10:28:01 AM [gate] Mode advanced → QA
```

If a gate blocks:

```
10:27:58 AM [gate] 🟥 Goal not aligned: session expiry policy not implemented
10:27:58 AM [gate] Skipping advance_mode for this step.
```

```
10:27:58 AM [gate] 🟥 Transition blocked: files_modified not in approved_artifacts: src/auth/legacy.py
```

---

## All options

```
node run-orchestrator.js [options] "goal"

Options:
  --cwd <dir>          Working directory for all agents  (default: current dir)
  --iterations <n>     Max iterations before stopping    (default: 3)
  --flow <mode>        Flow mode for metrics: single_agent | multi_agent
                                                         (default: single_agent)
  --task-id <id>       Task ID for state store           (default: auto-generated)
  --skip-gates         Disable orchestrator-state MCP gates
```

Optional project file **`minions.md`** at `--cwd` may declare **`trace_scenario_id`** (for trace batching) when `ORCH_TRACE_SCENARIO_ID` is unset. Invalid file → clear error and exit. See **`docs/orchestrator/minions-project-contract.md`**.

---

## Interactive chat (single agent)

Talk to one agent directly — useful for ad-hoc questions without running the full loop:

```bash
node cli.js
node cli.js --cwd /path/to/project
```

Select an agent from the menu and chat. Type `exit` to return to the menu.

---

## State store

When gates are enabled, every transition is recorded at:

```
~/.claude/.state/orchestrator/<task_id>/
├── envelope.json    # current state snapshot (mode, iteration, approved artifacts)
└── events.jsonl     # append-only event log with SHA-256 hash chain
```

Inspect a running or completed task:

```bash
# Read envelope + last 20 events
claude -p 'Call mcp tool orchestrator-state.open_envelope with task_id="<task_id>" and return the JSON' \
  --dangerously-skip-permissions
```

Override the root directory:

```bash
ORCHESTRATOR_STATE_ROOT=/my/custom/path node run-orchestrator.js "goal"
```

---

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `CLAUDE_CLI_TIMEOUT` | `180000` | Timeout per `claude` CLI call (ms) — increase for slow machines |
| `AI_TEAM_STEP_SUMMARY` | `1` | Set to `0` to disable Ollama handoff summaries between steps |
| `AI_TEAM_MAX_CONTEXT_CHARS` | `12000` | Max chars of prior output passed to next agent (`0` = no limit) |
| `AI_TEAM_SUMMARY_MODEL` | `qwen2.5-coder:7b` | Ollama model for handoff summaries |
| `ORCHESTRATOR_STATE_ROOT` | `~/.claude/.state/orchestrator/` | State store root directory |
| `ORCHESTRATOR_OLLAMA_URL` | `http://localhost:11434/api/generate` | Ollama endpoint for goal alignment |
| `ORCHESTRATOR_OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model for goal alignment checks |

See [`.env.example`](.env.example) for all variables.

---

## Troubleshooting

**"Ollama not reachable"**
Ollama must be running: `ollama serve`. Check: `curl http://localhost:11434/api/tags`.

**"claude CLI error" or timeout**
Increase timeout: `CLAUDE_CLI_TIMEOUT=300000 node run-orchestrator.js ...`
The orchestrator runs multiple `claude` calls per step — budget 3–5 min per agent on slow machines.

**Gates log WARNING and continue**
Expected when MCPs are not registered. Run without `--skip-gates` only after `claude mcp list` shows both MCPs.

**Ollama assigns the wrong agent to a task**
The Ollama planner (qwen2.5-coder:7b) is a small model — vague goals produce unexpected assignments.
Be specific: mention the technology, the file, and what should happen.

**`--flow multi_agent` plans with only OWNER**
The planner prompt injects a hard requirement: at least one `dev-*` step plus a later `qa` step when `FLOW` is `multi_agent`, so coding goals are not handed to scope-only roles alone.

**CERBERUS fails `[output contract]` with Ollama (`finding_classification_missing`)**
`validateOutput` requires the words `blocker`, `improvement`, or `nice-to-have` in the reply. Prompts force a three-line prefix (`blocker:` / `improvement:` / `nice-to-have:`) so small coders comply; use `(none)` when a category is empty. If it still flakes, try a larger model or cloud CERBERUS (`MODEL_OVERRIDE_CERBERUS`).

**CERBERUS “pasa” pero el texto es humo estructurado**
Con la plantilla triple, `validateOutput("cerberus", …)` aplica un **piso mínimo** (denylist; blocker vacío exige **anclaje explícito** en improvement o nice-to-have — ruta, test/tool, código entre backticks, `line N`, etc.; `cerberus_anchor_required` si solo hay prosa genérica; triple **todo** `(none)`/vacío se acepta para poder cerrar CERBERUS cuando upstream ya está gate-blocked). Sigue **sin** demostrar verdad del hallazgo. Ver `docs/orchestrator/agent-contract.md` y `gate_id` `cerberus_semantic_filler` / `cerberus_vacuous_without_substance` / `cerberus_anchor_required`.

**Loop keeps iterating**
Cerberus is finding blockers every round. Check Cerberus output in artifacts — it may be too strict for a simple task.
Use `--iterations 1` to force a single pass.

---

## Tests

```bash
cd orchestrator
npm test              # lint (ESLint + ruff) + unit tests — no auth, no Ollama, no MCPs required
npm run test:baseline:gate   # rewrite tests/fixtures/gate-determinism-baseline.json after intentional gate contract changes
npm run test:e2e      # E2E suite — requires Ollama running at localhost:11434
# Informational: N runs of DEV contract smoke with maxIterations=1 only (prints pass rate):
#   E2E_FIRST_SHOT_RUNS=5 npm run test:e2e:dev-first-shot-report
# (That metric is skipStateMcp=true only — it does not prove strict goal_alignment or full system-path health; see docs/orchestrator/strict-mode.md § "DEV first-shot metric vs strict path".)
# Single full suite with first-shot flag: E2E_DEV_CONTRACT_FIRST_SHOT=1 npm run test:e2e
npm run test:e2e:strict       # same as `test:e2e:system-path` — MCP direct + real disk gates, **no** harness (`tests/e2e.strict.test.js`); prints `alignment_failure_rate` to stdout after suite
npm run test:e2e:strict:harness  # optional: `ORCH_TEST_SYSTEM_PATH_HARNESS` deterministic `run()` path (`tests/e2e.strict.harness.test.js`) — not run in default CI strict job
npm run test:e2e:strict:all   # strict then harness (local / extended CI only)
npm run test:e2e:system-path  # alias; name reflects intent better than “strict” alone
npm run test:e2e:all  # E2E suite with all available Ollama models
```

`ORCH_MCP_TRANSPORT=direct` makes `orchestrator.js` call `mcp-direct.py` for `orchestrator-state` and `compact-handoff` instead of `claude -p`. Use `ORCH_PYTHON` if `python3` is not on `PATH`. Optional: `ORCH_MCP_DIRECT_TIMEOUT_MS` (default 180000).

### MCP permission gate

Before each **`orchestrator-state`** / **`compact-handoff`** tool invocation (Python bridge **or** Claude CLI), the runner evaluates **permission profiles** + MCP trust levels (`orchestrator/security/mcp-permission-gate.js`). Denied calls throw **before** any MCP subprocess / CLI round-trip. When a run is emitting MCP audit traces, an extra **`permission_check`** JSONL line precedes each allowed **`mcp_call`**.

### Claude CLI shell gate (agent LLM transport)

Before each **`claude`** subprocess spawned by **`agents/runtime/run-claude.js`** (Anthropic path), the runner evaluates **`orchestrator/security/claude-cli-shell-gate.js`**. The spawn is modeled as domain **`shell`** with precheck **`orchestrator_shell_spawn: claude_cli`**; **allow/deny** follows **`remote_model`** (not raw `shell` approval flags), so **`dev-local`** / **`ci-safe`** keep normal agent runs working while profiles can still set **`remote_model: deny`** to block Claude CLI access.

When MCP audit tracing is active (`beginMcpAudit` / same JSONL task as MCP), a **`permission_check`** line with **`tool: claude_cli`** is emitted before the subprocess runs.

### Classified invocation gate (manifest → evaluator, non-MCP subprocess)

For orchestrator-owned **`spawnSync`** of external CLIs (not MCP, not the Claude LLM transport), use **`agents/runtime/run-classified-shell.js`** → **`spawnClassifiedSync`**. It runs **`security/action-classifiers/classify-action.js`** (manifest + adapters), routes **`git`** to domain **`git`** and other manifest tools to **`filesystem`**, then **`evaluatePermission`** with the active profile / project policy — same merge path as the MCP and Claude CLI gates. Denied or **`requires_approval`** throws **`CLASSIFIED_SHELL_DENIED`** before spawn. **Enforcement applies only to subprocesses that go through this helper** — it does **not** retrofit unrelated transports (MCP bridge, **`run-claude`**, Ollama HTTP, or raw **`spawnSync`** elsewhere). With MCP audit tracing active, **`permission_check`** is emitted **before** allow or deny (including **`CLASSIFIED_SHELL_DENIED`**), matching MCP gate parity; tool label is manifest **`tool_id`** when known, else the executable basename. Bypass **tests only:** **`ORCH_SKIP_CLASSIFIED_SHELL_GATE=1`**.

### Ollama HTTP network gate (local model transport)

**`agents/runtime/run-ollama.js`** and **`checkOllama()`** in **`orchestrator.js`** call **`orchestrator/security/network-permission-gate.js`** before opening an HTTP connection. The evaluator uses domain **`network`** and matches **`OLLAMA_HOST` / `OLLAMA_PORT`** against **`domains.network.allow_hosts`** in the active permission profile (see **`orchestrator/security/permission-profiles.v1.json`**). For allow-list purposes, client host **`0.0.0.0`** is normalized to **`127.0.0.1`** (common **`OLLAMA_HOST`** value in CI/Docker when meaning local Ollama). Denied calls throw **`OLLAMA_NETWORK_DENIED`** (chat) or **`checkOllama`** returns false (health probe). When MCP audit tracing is active, **`permission_check`** uses **`tool: ollama_chat`** or **`ollama_health_check`**.

**Scope boundary:** The orchestrator Ollama HTTP gate applies **only** to orchestrator-owned Ollama HTTP transport. It does **not** grant or deny MCP/tool-internal network egress. Declared documentation retrieval must be authorized through **MCP / `context_retrieval` / `declared_docs_category`**, not through the Ollama **`network.allow_hosts`** policy. **Claude CLI** remains governed by **`shell` / `remote_model`**, not this gate. Generic non-Ollama HTTP egress remains **out of scope** until a dedicated slice defines proxy/sandbox/enforcement semantics.

| Variable | Effect |
|----------|--------|
| **`ORCH_PERMISSION_PROFILE`** | Built-in profile name: `dev-local` (default if unset and no project policy), `ci-safe`, `prod-guarded`. If unset, the first profile in `.ai-minions/permissions.yaml` `extends` is used when that file exists. |
| **`ORCH_MCP_DECLARED_SERVERS`** | Comma-separated extra MCP server ids treated as **locally declared** (trust tier `local_declared`), in addition to built-in `orchestrator-state` and `compact-handoff`. |
| **`ORCH_MCP_REMOTE_DECLARED_SERVERS`** | Optional comma-separated ids for **remote_declared** trust. |
| **`ORCH_CI_MCP_CONFIGURED`** | Set to **`1`** so **`ci-safe`** can satisfy **`allow_if_ci_configured`** for MCP (also true when **`CI`** is a typical truthy CI flag). |
| **`ORCH_SKIP_MCP_PERMISSION_GATE`** | Set to **`1`** to bypass the gate (tests / emergency only). **Do not** use in production. |
| **`ORCH_SKIP_SHELL_PERMISSION_GATE`** | Set to **`1`** to bypass the Claude CLI shell gate only (tests / emergency). **Do not** use in production. |
| **`ORCH_SKIP_CLASSIFIED_SHELL_GATE`** | Set to **`1`** to bypass the classified manifest→evaluator gate used by **`spawnClassifiedSync`** (tests / emergency). **Do not** use in production. |
| **`ORCH_SKIP_NETWORK_PERMISSION_GATE`** | Set to **`1`** to bypass the Ollama HTTP network gate only (tests / emergency). **Do not** use in production. |
| **`ORCH_SKIP_ROLE_CAPABILITY_GATE`** | Set to **`1`** to bypass the capability-matrix role/domain precheck before **`evaluatePermission`** (tests / emergency). **Do not** use in production. |

Design reference: `docs/orchestrator/runtime-permission-contract.md` §3–4 (domains), §8.4–§8.5 (trace shape + run rollup). **`permission_check`** field catalog + audit: `docs/orchestrator/permission-check-trace.md`.

### Test-only: `ORCH_TEST_SYSTEM_PATH_HARNESS` (not a product feature)

**Forbidden in production.** Only **`tests/e2e.strict.harness.test.js`** (`npm run test:e2e:strict:harness`) sets `ORCH_TEST_SYSTEM_PATH_HARNESS=1`. It is **not** referenced from `cli.js`, `run-orchestrator.js`, or any operator runbook — only that harness file + core orchestrator/README/docs (allowlisted in `scripts/ci-check-harness-scope.sh`). **`npm run test:e2e:strict`** (default CI) **does not** load the harness file. That path is **not** “strict E2E” in the alignment sense: deterministic `askAgent` stubs, `register_task` with `enforce_goal_alignment: false`, and a **Node-only** bypass when `validate_goal_alignment` returns `aligned: false`, so you can prove **state store + transitions + `compact_handoff`** without flaking on the alignment model. It deliberately **does not** prove trustworthy goal alignment or unattended success with production models. Do not set the variable outside that harness test subprocess.

**Companion (same subprocess only):** **`ORCH_TEST_PLAN_UNKNOWN_ROLE=1`** is referenced **only** from **`tests/capability-plan-reject.test.js`** (+ allowlisted files). With **`ORCH_TEST_SYSTEM_PATH_HARNESS=1`**, it forces the plan stub to emit an unknown `agentId` so capability validation rejects the plan before any worker runs.

### CI pipelines

| Workflow | Runner | Triggers |
|----------|--------|---------|
| `orchestrator-unit-tests.yml` (`name: orchestrator-unit-tests`) | GitHub cloud | **All PRs** to `main`/`master` (lint + unit). **Push** to `main`/`master` when `orchestrator/**`, `scripts/hooks/**`, or this workflow file changes. **No** `examples/orchestrator/**` path filter (legacy path removed). `workflow_dispatch` supported. First step runs `orchestrator/scripts/ci-check-harness-scope.sh`: fails if `ORCH_TEST_SYSTEM_PATH_HARNESS` or `ORCH_TEST_PLAN_UNKNOWN_ROLE` appears outside the allowlist, or if the pre-rename strict-gate env var name appears in tracked code (see script) |
| `orchestrator-e2e.yml` | Self-hosted (`ollama` label) | Push/PR when orchestrator core, `mcp-direct.py`, `tests/**`, `package.json` / lockfile, MCP server dirs, or this workflow change; **`workflow_dispatch`** (input `ollama_model`) |

The E2E workflow requires a self-hosted runner with labels **`self-hosted`** and **`ollama`**, Ollama at `localhost:11434`, and network for `astral-sh/setup-uv` + `npm ci`. It runs **`npm run test:e2e`** then **`npm run test:e2e:strict`** (strict suite **without** `ORCH_TEST_SYSTEM_PATH_HARNESS`; optional harness: `npm run test:e2e:strict:harness` locally). **Fork PRs:** the E2E job is skipped when the PR comes from a fork (so the run does not wait forever for a runner the fork cannot use). GitHub’s rules for **required checks** allow successful / skipped / neutral in many setups when the workflow completed; a skipped **job** is usually safer than a workflow that never starts (which can leave checks **Pending**). Still: validate once with a **real fork PR** and your branch protection, because only the GitHub UI confirms your org’s rule set. See `.github/workflows/orchestrator-e2e.yml` and `docs/orchestrator/strict-mode.md` § *GitHub Actions — orchestrator-e2e.yml*.

### Coverage at a glance

| Area | Type |
|------|------|
| Output contracts (per role) | Unit |
| Gate logic SHA256 baselines (`validateOutput` / `validateHandoffStructure`) | Unit |
| MCP invocation audit (`mcp_call` events + `session_end` rollups) | Unit (`aggregateMcpUsage`) + runtime trace |
| `files_read[]` + `files_modified` context gate (ARCHITECT + DEV) | Unit |
| Fallback policy (primary → secondary, hard-fail) | Integration |
| Trace redaction, blocker detection, handoff structure | Unit |
| Full SA/MA orchestrator loop (plan → execute → decide) | E2E (Ollama) |
| Contract violation detection, gate events, MCP hash chain | E2E (Ollama) |
| Malformed model response (decide contract) | E2E (Ollama) |
| Transition integrity — empty/malformed handoff blocks DEV+QA | E2E (Ollama) |
| Self-evaluation prevention — DEV ≠ QA agentIds | E2E (Ollama) |
| Determinism — schema consistent across runs | E2E (Ollama) |
| Context leakage — out-of-contract fields don't affect gates | E2E (Ollama) |
| Strict mode — any deviation surfaces as hard failure | E2E (Ollama) |
| Gate-blocked enforcement — `done: false` when contracts fail | E2E (Ollama) |
| Failure-first — invalid input, broken handoff, unknown agent | E2E (Ollama) |
| Strict gates without claude CLI (`skipStateMcp: false` + MCP direct); `run()` event chain; mcp-direct transitions; `compact_handoff` YAML; negativos `validate_transition`; **`alignment_failure_rate`** línea stdout; harness opcional (`test:e2e:strict:harness`) | System-path E2E (`test:e2e:strict` / `test:e2e:system-path`, 5 tests + informe alignment) |

### Test files

| File | Type | Requires |
|------|------|---------|
| `tests/validateOutput.test.js` | Unit | Nothing |
| `tests/orchestrator.test.js` | Unit | Nothing |
| `tests/internals.test.js` | Unit | Nothing |
| `tests/askAgent.test.js` | Integration | Nothing (CLI mocked) |
| `tests/e2e.test.js` | E2E | Ollama at localhost:11434 (auto-skip if unavailable) |
| `tests/e2e.strict.test.js` | System-path E2E | Ollama + `mcp-direct.py` + MCP venvs (`uv sync`); auto-skip if Ollama or `mcp-direct.py` missing |

---

## Rejection path — what "no" looks like

The system has three layers that can block progress. Here is what each rejection looks like in the logs:

### 1. Output contract (`validateOutput`) — agent emits invalid output

```
10:27:33 AM [dev-backend] 🟥 Output contract failed: dev-backend: output must mention at least one file modified
```

For non-critical roles (dev-*): the step is skipped, a `contract_fail` trace event is written, and the loop continues to the next step.

For **critical roles** (architect, qa, cerberus): the step loop `break`s — no further steps in the iteration run. The `contract_fail` trace event includes `critical: true`.

**Context gate failures** (ARCHITECT and DEV):

```
10:27:33 AM [architect] 🟥 Output contract failed: architect: output must declare files_read[] before reading artifacts
10:27:33 AM [dev-backend] 🟥 Output contract failed: dev-backend: files_read[] must not be empty — declare at least one file
10:27:33 AM [dev-backend] 🟥 Output contract failed: dev-backend: files_modified contains paths not declared in files_read: src/config.js
```

The gate enforces **consistency** — every path modified must have been declared in `files_read`, and `files_modified` is mandatory (absence would bypass the cross-check). It does not enforce completeness (whether all relevant files were declared). See [agent-contract.md](../docs/orchestrator/agent-contract.md) for the known limitation.

```
10:27:33 AM [qa] 🟥 Output contract failed: qa: output must classify at least one finding as blocker | improvement | nice-to-have
10:27:33 AM [qa] 🟥 Critical role contract fail — stopping iteration (no QA/CERBERUS/ARCHITECT degradation allowed)
```

### 2. Handoff structure invalid (`validateHandoffStructure`) — compact-handoff YAML is malformed

```
10:27:44 AM [gate] 🟥 Handoff structure invalid (QA): QA handoff must include verdict
```

`gateBlocked: true` is set on the artifact. Neither validate_goal_alignment nor advance_mode runs for this step.

### 3. Goal alignment / transition blocked (orchestrator-state MCP)

```
10:27:52 AM [gate] 🟥 Goal not aligned: session expiry policy not implemented
10:27:52 AM [gate] Skipping advance_mode for this step.
```

```
10:27:58 AM [gate] 🟥 Transition blocked: files_modified not in approved_artifacts: src/auth/legacy.py
```

`gateBlocked: true` is set on the artifact. The mode does not advance — the current MODE stays open until the next iteration resolves the issue.

### 4. CERBERUS blockers — deterministic iterate enforcement

```
10:28:10 AM [cerberus] 🟥 2 blocker(s) detected — forcing iteration (deterministic)
10:28:10 AM [cerberus]   ↳ blocker: no rate limiting on the endpoint
10:28:10 AM [cerberus]   ↳ blocker: missing CSRF token validation
```

The orchestrator **cannot** declare `done=true` when blockers exist. It is asked only for corrections. If max iterations is reached with open blockers, the run closes with a manual review warning.

---

## Runtime dependency on the claude CLI

This example is autonomous at the orchestration layer — the planner (Ollama) and the loop logic run locally without human input. However, it is **not provider-independent at execution time**: every worker agent (`dev-backend`, `qa`, `cerberus`, etc.) calls the `claude` CLI, which requires an active Claude Code session and network access to Anthropic's API.

This means:
- Running in CI or on a headless server requires a valid `claude` session pre-authenticated.
- API rate limits, quotas, or outages affect every agent call.
- Costs accrue per agent invocation (Sonnet for DEV/QA/CERBERUS, Haiku for OWNER).

If you need a provider-independent runner, replace `runClaude()` in `agents.js` with any LLM client — the MODE protocol and MCP gates are decoupled from the CLI.

### Agent isolation

Each agent call is a **fresh `claude` CLI invocation** — there is no shared session or conversation state between agents. Context is passed explicitly as text (the `contextBlock` string built in `orchestrator.js`). This means:

- Agents do not have access to prior turn history unless it is included in the prompt.
- No cross-agent memory leakage: one agent's internal reasoning is not visible to the next.
- Each call is independently billed and rate-limited by the Anthropic API.
- If an agent call fails (timeout, rate limit, contract violation), only that step is affected — the loop continues or retries depending on the role's fallback policy.

The tradeoff: context must be explicitly managed. The orchestrator controls what each agent sees via `maxContextChars` and optional Ollama handoff summaries (`AI_TEAM_STEP_SUMMARY=1`).

---

## Bring your own orchestrator

This example shows one implementation. You can replace it with any runner that:

1. Calls `orchestrator-state` MCP tools to register and gate transitions
2. Uses `compact-handoff` MCP to produce structured handoff YAML
3. Follows the MODE protocol: one role per response, no DEV self-review

References:
- [Agent contract](../docs/orchestrator/agent-contract.md)
- [Strict mode operational guide](../docs/orchestrator/strict-mode.md)
- [State store MCP](../mcp-servers/orchestrator-state/README.md)

---

## Structure

```
orchestrator/
├── agents.js              # Public facade: require("./agents") — AGENTS, askAgent, validateOutput, exports
├── agents/                # Split modules (ROLE-REGISTRY-2-S1); same API via agents.js
│   ├── routing/
│   │   └── model-routing.js   # MODEL_ROUTING, FALLBACK_POLICY, Ollama routing constants
│   ├── permissions.js         # ROLE_PERMISSION, effectiveMode()
│   ├── capability-matrix.js   # matrix + validatePlanStepsCapability (domains, handoff keys, credential ceiling)
│   ├── capability-matrix.v1.json
│   ├── validate-output.js     # validateOutput, normalizeDevContractText, CERBERUS semantic helpers
│   ├── registry.js            # buildAgents() → AGENTS (prompts + model getters)
│   ├── prompts/
│   │   └── ollama-appends.js  # OLLAMA_* system appendices for local models
│   └── runtime/
│       ├── run-ollama.js      # Ollama /api/chat
│       ├── run-claude.js      # claude CLI spawn (call-time spawnSync for test stubs)
│       └── summarize-handoff.js
├── orchestrator.js      # Autonomous loop: plan → execute → gate → cerberus → decide
├── context-utils.js     # Context truncation helpers
├── run-orchestrator.js  # CLI entry point
├── cli.js               # Interactive single-agent chat
├── CLAUDE.md            # Guardrails loaded by Claude Code agents
├── package.json         # npm test → node --test tests/*.test.js
├── .env.example         # All environment variables with defaults
└── tests/                     # representative; full list in package.json test script
    ├── validateOutput.test.js
    ├── orchestrator.test.js
    ├── askAgent.test.js
    ├── capability-matrix.test.js
    ├── capability-plan-reject.test.js  # harness: unknown plan agentId → plan_capability_reject
    ├── multiRoleChainFixture.test.js    # golden-multi-role-chain-v1.jsonl (dev → qa → cerberus)
    └── …
```

**Repo root `agents/`** (subagent specs for skills / MCP task) is **not** this folder — see [shared-dependencies.md](../docs/orchestrator/shared-dependencies.md) and [role-agent-registry.md](../docs/orchestrator/role-agent-registry.md).
