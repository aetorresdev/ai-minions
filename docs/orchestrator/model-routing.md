# Model Routing and Handoff Rules

Defines which model each role uses, when local fallback is safe, and what structural keys each MODE must produce in its handoff YAML.

---

## Model routing

Configured in `orchestrator/agents/routing/model-routing.js` (`MODEL_ROUTING`).

| Role | Primary | Fallback | Local safe? |
|------|---------|----------|-------------|
| `orchestrator` | `$OLLAMA_MODEL` or `claude-haiku` | `claude-haiku-4-5-20251001` | Yes |
| `summarizer` | `$OLLAMA_MODEL` or `claude-haiku` | `claude-haiku-4-5-20251001` | Yes |
| `owner` | `claude-haiku-4-5-20251001` | `$OLLAMA_MODEL` or `claude-haiku` | Yes |
| `dev-backend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-frontend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-devops` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `architect` | `claude-sonnet-4-6` | — | No |
| `qa` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `cerberus` | `claude-sonnet-4-6` | — | No |

**Local safe = true** means a local or cheaper model can substitute. Roles with `false` require strong reasoning (implementation, adversarial review) that weaker models cannot reliably provide.

### Explicit strategy by role (executable)

Single source in code: `orchestrator/agents/routing/model-routing.js` — `MODEL_ROUTING`, `FALLBACK_POLICY`; `orchestrator/agents.js` — `resolveModel()`, `resolveFallback()`. **Do not** drift this table without updating those modules and `tests/modelRoutingStrategy.test.js` (expected role keys).

| Role | Escalation / fallback rule | Notes |
|------|---------------------------|--------|
| `orchestrator`, `summarizer` | Primary fails → use `fallback` model; **degraded allowed** | JSON/summary-shaped outputs; Ollama when `OLLAMA_MODEL` set |
| `owner` | Primary fails → Ollama or Haiku **degraded** | Scope text tolerates weaker model |
| `dev-*`, `qa` | Primary fails → Haiku **degraded** | Implementation/review still gated downstream (QA/CERBERUS) |
| `architect` | **No silent degradation** — primary failure → hard fail | `resolveFallback` throws; design quality bar |
| `cerberus` | **No silent degradation** — primary failure → hard fail | Adversarial review must not run on arbitrary fallback |

Overrides: `MODEL_OVERRIDE_<ROLE>` (see below) and `models.json` profiles via `setModelProfile` / `--profile` — precedence documented in `resolveModel` JSDoc in `agents.js`.

### Ollama configuration

`orchestrator` and `summarizer` run on Ollama when `OLLAMA_MODEL` is set. If unset or Ollama is unreachable, they fall back to `claude-haiku-4-5-20251001` automatically.

```bash
# Enable Ollama (run `ollama pull <model>` first):
OLLAMA_MODEL=qwen2.5-coder:7b node run-orchestrator.js "goal"

# Supported alternatives:
# OLLAMA_MODEL=llama3.1:8b
# OLLAMA_MODEL=mistral:7b
# OLLAMA_MODEL=deepseek-coder:6.7b

# Custom Ollama host/port (default: localhost:11434):
OLLAMA_HOST=192.168.1.10 OLLAMA_PORT=11434 OLLAMA_MODEL=qwen2.5-coder:7b node run-orchestrator.js "goal"

# Without Ollama — orchestrator/summarizer use claude-haiku:
node run-orchestrator.js "goal"
```

At startup, the runner pings Ollama and logs whether it is available. No silent failures.

When **E2E or `setBackend("ollama")`** routes **CERBERUS** through the same small coder, the runner adds a rigid three-line output template (`blocker:` / `improvement:` / `nice-to-have:`) in `agents.js` and `orchestrator.js` so `validateOutput("cerberus", …)` does not reject short fluff replies. That is **format enforcement** plus a **minimal semantic floor** when the three-line template is present (`validateCerberusSemanticFloor`), including **SIGNAL-3anchor**: a vacuous `blocker` still needs an anchored `improvement` or `nice-to-have` (path, `` `code` ``, test/tool ref, etc.). Substantive, artifact-grounded review is still **not** guaranteed (see [agent-contract.md](agent-contract.md) § *Format enforcement vs quality*).

### Per-role override

Set `MODEL_OVERRIDE_<ROLE>` environment variable (role uppercased, hyphens → underscores):

```bash
MODEL_OVERRIDE_DEV_BACKEND=claude-haiku-4-5-20251001 node run-orchestrator.js "goal"
MODEL_OVERRIDE_QA=claude-haiku-4-5-20251001 node run-orchestrator.js "goal"
```

### Profile-based selection (config-driven)

> **Status:** implemented 2026-04-11. Files: `orchestrator/models.json`; `run-orchestrator.js` (`--profile`); `agents.js` (`setModelProfile`, `resolveModel` / `resolveFallback`); defaults en `agents/routing/model-routing.js`.

Instead of hardcoding models or setting individual env vars, `models.json` defines named profiles. Select a profile at runtime with `--profile`:

```bash
node run-orchestrator.js --profile fast "goal"      # haiku everywhere except CERBERUS/ARCHITECT
node run-orchestrator.js --profile quality "goal"   # opus default, sonnet for DEV
# no flag → "balanced" profile (current hardcoded defaults)
```

Override keys in `models.json` and `MODEL_OVERRIDE_*` env vars use the normalized role name — `role.toUpperCase().replace(/-/g, "_")`:

| Role | Key |
|------|-----|
| `orchestrator` | `ORCHESTRATOR` |
| `summarizer` | `SUMMARIZER` |
| `owner` | `OWNER` |
| `dev-backend` | `DEV_BACKEND` |
| `dev-frontend` | `DEV_FRONTEND` |
| `dev-devops` | `DEV_DEVOPS` |
| `architect` | `ARCHITECT` |
| `qa` | `QA` |
| `cerberus` | `CERBERUS` |

**`orchestrator/models.json`** schema:

```json
{
  "profiles": {
    "fast": {
      "default": "claude-haiku-4-5-20251001",
      "overrides": {
        "CERBERUS": "claude-sonnet-4-6",
        "ARCHITECT": "claude-sonnet-4-6"
      }
    },
    "balanced": {
      "default": "claude-sonnet-4-6",
      "overrides": {}
    },
    "quality": {
      "default": "claude-opus-4-6",
      "overrides": {
        "DEV": "claude-sonnet-4-6"
      }
    }
  }
}
```

**Resolution order (highest priority first):**

1. `MODEL_OVERRIDE_<ROLE>` env var — always wins, retrocompatible
2. `profiles.<profile>.overrides.<ROLE>` from `models.json`
3. `profiles.<profile>.default` from `models.json`
4. Hardcoded `MODEL_ROUTING` in `agents/routing/model-routing.js` (current behavior, fallback)

**Implementation target:** `resolveModel(role, profile, modelsConfig)` in `orchestrator/agents.js`; `--profile` flag parsed in `run-orchestrator.js`.

---

## Fallback policy

Configured in `orchestrator/agents/routing/model-routing.js` (`FALLBACK_POLICY`).

When the primary model fails, the runner attempts the fallback model per role. If both fail, behavior depends on the role's `degraded` flag:

| Role | Degraded allowed? | Reason |
|------|------------------|--------|
| `orchestrator` | Yes | JSON plan only — local model acceptable |
| `summarizer` | Yes | Summary only — local model acceptable |
| `owner` | Yes | Scope decisions tolerate lower model quality |
| `dev-backend` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `dev-frontend` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `dev-devops` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `architect` | **No** | Design decisions require strong reasoning — hard fail |
| `qa` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `cerberus` | **No** | Adversarial review must not be degraded — hard fail |

**Hard fail** means the step throws, `gateBlocked: true` is recorded in the artifact, and the iteration stops for that step. `architect` and `cerberus` never degrade silently.

### Architect with Ollama (`setBackend("ollama")`)

E2E and local harnesses may route **all** roles through Ollama when **`OLLAMA_MODEL`** is set. `architect` still runs **`validateOutput()`**: a **non-empty** `files_read` list must appear before design prose (same shape as cloud ARCHITECT; no `files_modified` / `validation_run`).

**Implementation (2026-04-15):** `askAgent()` appends **`OLLAMA_ARCHITECT_SYSTEM_APPEND`** to the ARCHITECT system prompt only when **`forceOllama`** is true (`setBackend("ollama")` + `OLLAMA_MODEL`). It is an explicit **few-shot prefix**: `files_read:` block first, then `Design summary:` — reduces empty/missing `files_read` from small coders. Contract tests: `validateOutput.test.js` § architect.

### DEV roles with Ollama (`setBackend("ollama")`)

**`dev-backend`**, **`dev-frontend`**, **`dev-devops`** still run the same **`validateOutput()`** as in cloud: non-empty **`files_read`**, **`files_modified`** list, and a **`validation_run`** line matching the keyword heuristic.

**Implementation (2026-04-15 onward):** `askAgent()` appends **`OLLAMA_DEV_SYSTEM_APPEND`** when **`forceOllama`** is true — YAML-first few-shot for `files_read` / `files_modified` / `validation_run`. Before **`validateOutput()`**, **`normalizeDevContractText()`** in `agents.js` strips a leading markdown YAML fence and a short preamble before `files_read:` so small models that wrap YAML still pass the same gate. **`runOllama()`** sends **`options.num_predict`** (default **2048**, override with **`OLLAMA_NUM_PREDICT`**) and **`temperature`** (default **0.2**, override **`OLLAMA_TEMPERATURE`**) to reduce empty or ultra-short replies on `/api/chat`.

**Two lanes (review standard — do not conflate them):**

1. **Default / blocking CI lane:** the DEV output-contract smoke in `tests/e2e.test.js` uses **`maxIterations: 2`**. That proves the **orchestrator loop can recover** after a bad first DEV reply (e.g. CERBERUS-driven iterate). It is **not** proof that the first DEV attempt always satisfies **`validateOutput()`**.
2. **First-shot lane (metric):** set **`E2E_DEV_CONTRACT_FIRST_SHOT=1`** to run the **same** smoke with **`maxIterations: 1`**. Use **`npm run test:e2e:dev-first-shot-report`** (runs several attempts; prints **`first_shot_pass_rate`**; optional in GitHub Actions after **`npm run test:e2e`**). **Promotion idea:** when that rate is stable over time, consider making single-iteration smoke mandatory in CI — not before.

**Implementation detail:** prompts and **`normalizeDevContractText()`** improve first-shot odds but do not, by themselves, guarantee first-shot compliance under local models.

**Scope boundary:** the two lanes above measure only DEV **output-shape** compliance under **`skipStateMcp: true`** (degraded E2E). They do **not** prove **`validate_goal_alignment`**, **`advance_mode`**, or other **strict** gates for any particular goal. A green **`first_shot_pass_rate`** run is **orthogonal** to “strict path healthy end-to-end” — see **`strict-mode.md`** § *DEV first-shot metric vs strict path*.

### Orchestrator with Ollama (plan / decide JSON)

When **`OLLAMA_MODEL`** is set, the orchestrator role uses **`runOllama`** like other Ollama-backed roles. Small coders often reply with markdown or prose instead of a single JSON object, which makes **`validateOutput("orchestrator", …)`** fail with **`orchestrator: output is not valid JSON`** before any DEV step runs.

**Implementation (2026-04-21):** `askAgent()` appends **`OLLAMA_ORCHESTRATOR_PLAN_APPEND`** for **`phase: "plan"`** and **`OLLAMA_ORCHESTRATOR_DECIDE_APPEND`** for **`phase: "decide"`** whenever the orchestrator path is served via **`runOllama`**. Same contract as cloud (JSON plan with `steps[]`, or decide object with `done` / `summary` / `corrections`).

> **QA degraded — operationally tolerable, not quality-equivalent.**
> When QA falls back to Haiku, it can still produce classified findings and a verdict. However, Haiku may miss edge cases or accept weaker evidence than Sonnet would. CERBERUS runs after QA regardless and will catch gaps — but only gaps it can observe from the final artifact. Evidence that was never collected by a degraded QA cannot be retroactively surfaced. This tradeoff is accepted; the assumption should be explicit: **QA degraded = reduced coverage, not zero coverage.**

---

## Contract versioning

`CONTRACT_VERSION` in `agents.js` is passed to `register_task` and stored in the task envelope. Bump it when any of the following change:

- Handoff YAML schema (required keys, field names)
- Role permission matrix (`ROLE_PERMISSION` in `agents/permissions.js`)
- Gate sequence (`advance_mode`, `validate_transition` requirements)
- Fallback policy (`FALLBACK_POLICY` in `agents/routing/model-routing.js`)

Current version: **1.0**

---

## Output token controls

Configured in `orchestrator/agents.js` (`MAX_OUTPUT_TOKENS` + `OUTPUT RULE` in system prompts).

### Hard token caps (`--max-tokens` flag via claude CLI)

Applied only to structured/JSON roles — cutting code agents mid-output breaks their response.

| Role | `max_tokens` | Reason |
|------|-------------|--------|
| `orchestrator` | 400 | JSON plan/decide only |
| `summarizer` | 500 | Structured handoff summary |
| All others | unlimited | Code output must not be truncated |

### Output format enforcement (`OUTPUT RULE` in system prompt)

QA and CERBERUS include an explicit rule:

> "Respond only with the required format. Any text outside this format will cause your output to be rejected."

This is soft enforcement (instruction-level, not validated by code). The goal is to reduce narrative padding in findings lists.

All agents share the global guardrail in `CLAUDE.md`:

> "Respond only with what your role requires. Any text outside the required format will cause your output to be rejected."

---

## Hard blocker enforcement (deterministic)

`detectBlockers(cerberusOutput)` in `orchestrator.js` parses CERBERUS output with a regex (`/^.*\bblocker\b.*$/gim`) — no model interpretation.

### Decision tree after CERBERUS

```
blockers > 0 AND iterations < max  → force iterate (orchestrator asked only for corrections)
blockers > 0 AND iterations >= max → done=false, summary flags gate-blocked CERBERUS findings, manual review required
blockers = 0 AND no gateBlocked    → orchestrator decides freely (done or corrections)
any artifact gateBlocked AND iter < max  → force retry of blocked steps
any artifact gateBlocked AND iter >= max → done=false, summary lists each blocked agent + reason
```

The orchestrator model **cannot** declare `done=true` when blockers exist — the code enforces iterate before the decide prompt is even sent. A `cerberus_check` trace event records blocker count and matched lines per iteration.

`done=false` is the correct terminal signal when either condition fires. It is not an error — it means "gates fired, human must decide next step." The summary will contain "Manual review required" in both cases — the prefix identifies the source: "N gate-blocked CERBERUS finding(s)" (CERBERUS path) or "N gate-blocked artifact(s)" (contract/handoff/alignment failure path).

---

## Execution trace

Every multi-agent run writes a structured JSONL trace to `~/.claude/metrics/traces/<task_id>.jsonl`. One event per step — allows post-run analysis without parsing logs.

### Event types

| Event | Fields | When |
|-------|--------|------|
| `session_start` | `flow_mode`, `max_iterations`, `cwd`, `goal` (truncated), `scenario_id?` | Before plan — `scenario_id` optional (`traceScenarioId` / `ORCH_TRACE_SCENARIO_ID`) for batch metrics export |
| `agent_start` | `agent`, `iteration`, `task` (truncated) | Before `askAgent()` |
| `agent_done` | `agent`, `iteration`, `duration_ms`, `output_chars`, `degraded?` | After successful `askAgent()` — `degraded: true` when fallback model was used |
| `contract_fail` | `agent`, `iteration`, `duration_ms`, `reason`, `critical`, `gate_id?` | When `validateOutput()` throws — `critical: true` for architect/qa/cerberus; `gate_id` identifies which specific gate failed |
| `context_stats` | `agent`, `iteration`, `files_read_count`, `files_modified_count` | After successful ARCHITECT or DEV step — counts declared files for efficiency tracking |
| `gate_result` | `agent`, `iteration`, `gate`, `passed`, `reason?`, `confidence?`, `from_mode?`, `to_mode?` | After each gate check |
| `iteration_done` | `iteration`, `outcome`, `transition_reason` `{ type, reason_code, details?, gate_id?, step_id? }`, `summary?`, `corrections?`, … | After orchestrator decide / blocker paths |
| `session_end` | `iterations`, `done`, `summary`, `agents_run[]`, `gate_blocks`, `qa_degraded?`, `manual_review_recommended?`, `scenario_id?` (if tagged), MCP rollups, `ollama_*_total` when Ollama used | Before return |

All events include `ts` (ISO timestamp), `ts_ms` (epoch ms), `trace_schema_version` (current `"2"`), and `task_id`.

Gate names (`gate_result`): `handoff_structure`, `goal_alignment`, `transition`.

Gate IDs (`contract_fail.gate_id`): `empty_output`, `orchestrator_json`, `orchestrator_plan_steps`, `orchestrator_plan_step_fields`, `orchestrator_decide_done`, `orchestrator_decide_summary`, `orchestrator_decide_corrections`, `files_read_missing`, `files_read_empty`, `files_modified_missing`, `files_read_vs_modified`, `validation_run_missing`, `finding_classification_missing`.

### Example trace file (`~/.claude/metrics/traces/task-b4013eec.jsonl`)

```jsonl
{"ts":"2026-04-09T10:27:01.000Z","task_id":"task-b4013eec","event":"session_start","flow_mode":"multi_agent","max_iterations":3,"goal":"Add input validation to POST /users"}
{"ts":"2026-04-09T10:27:03.000Z","task_id":"task-b4013eec","event":"agent_start","agent":"dev-backend","iteration":1,"task":"Implement input validation on POST /users endpoint"}
{"ts":"2026-04-09T10:27:41.000Z","task_id":"task-b4013eec","event":"agent_done","agent":"dev-backend","iteration":1,"duration_ms":38200,"output_chars":2841}
{"ts":"2026-04-09T10:27:41.000Z","task_id":"task-b4013eec","event":"context_stats","agent":"dev-backend","iteration":1,"files_read_count":2,"files_modified_count":1}
{"ts":"2026-04-09T10:27:44.000Z","task_id":"task-b4013eec","event":"gate_result","agent":"dev-backend","iteration":1,"gate":"handoff_structure","passed":true}
{"ts":"2026-04-09T10:27:52.000Z","task_id":"task-b4013eec","event":"gate_result","agent":"dev-backend","iteration":1,"gate":"goal_alignment","passed":true,"confidence":0.91}
{"ts":"2026-04-09T10:27:58.000Z","task_id":"task-b4013eec","event":"gate_result","agent":"dev-backend","iteration":1,"gate":"transition","from_mode":"DEV","to_mode":"QA","passed":true}
{"ts":"2026-04-09T10:28:30.000Z","task_id":"task-b4013eec","event":"agent_start","agent":"qa","iteration":1,"task":"Validate POST /users input validation implementation"}
{"ts":"2026-04-09T10:28:55.000Z","task_id":"task-b4013eec","event":"contract_fail","agent":"qa","iteration":1,"duration_ms":25100,"reason":"qa: output must classify at least one finding as blocker | improvement | nice-to-have","critical":true,"gate_id":"finding_classification_missing"}
{"ts":"2026-04-09T10:29:10.000Z","task_id":"task-b4013eec","event":"cerberus_check","iteration":1,"blockers":1,"items":["blocker: no rate limiting on the endpoint"]}
{"ts":"2026-04-09T10:29:12.000Z","task_id":"task-b4013eec","event":"iteration_done","iteration":1,"outcome":"iterate","blockers":1,"corrections":1}
{"ts":"2026-04-09T10:31:45.000Z","task_id":"task-b4013eec","event":"iteration_done","iteration":2,"outcome":"done","summary":"Input validation and rate limiting implemented. No blockers."}
{"ts":"2026-04-09T10:31:46.000Z","task_id":"task-b4013eec","event":"session_end","iterations":2,"done":true,"agents_run":["dev-backend","qa","cerberus"],"gate_blocks":1}
```

Read it with: `cat ~/.claude/metrics/traces/<task_id>.jsonl | jq .` For Ollama token totals and MCP rollups without manual `jq`, use `orchestrator/token-trace-report.js` (`npm run tokens:report -- <task_id>`).

---

## Strict output enforcement (`validateOutput`)

`validateOutput(agentId, output, { phase })` in `agents.js` enforces the per-role output contract **inside `askAgent()`** — runs after every agent call, before the result is returned to the orchestrator. Throws on failure; no silent retry.

| Trigger | Behavior |
|---------|---------|
| Empty output (any role) | Throws — `${agentId}: empty output` |
| Orchestrator non-JSON | Throws — `orchestrator: output is not valid JSON` |
| DEV missing file reference | Throws — must mention at least one file modified |
| DEV missing validation run | Throws — must include at least one validation run |
| QA/CERBERUS no classified finding | Throws — must classify at least one finding |

**Critical-role contract fail** (architect, qa, cerberus): when `validateOutput()` throws for these roles, the step loop `break`s — no further steps in the iteration run. A `contract_fail` trace event is written with `critical: true`. This prevents a broken QA from being silently skipped with DEV output passing to CERBERUS unchecked.

The `phase` parameter (`"plan"` / `"decide"`) is passed from `orchestrator.js` for orchestrator calls to select the correct sub-contract. Single-agent and multi-agent flows use the same validation path.

---

## Handoff structure rules

After each agent completes, `compact-handoff` MCP produces a YAML handoff. `validateHandoffStructure()` (in `orchestrator.js`) performs a **shallow, heuristic** key-/line-shape check before the MCP gates run — it is **not** a semantic YAML validator and does not attest that listed runs or paths are factual.

**Empty YAML behavior depends on mode:**
- **Soft mode** (default, `--skip-gates`): empty YAML passes — compact-handoff may not be registered.
- **Strict mode** (gates active): empty YAML fails — `compact_handoff` is required before `advance_mode`.

### Required keys per MODE

| MODE | Required keys | Notes |
|------|--------------|-------|
| `DEV` | `files_modified` **or** `validation_run` | At least one must be present |
| `QA` | `verdict` **and** (`findings` **or** `issues`) | Both required together |
| `CERBERUS` | `verdict` **and** no open `blockers` | `blockers` key present with list items = blocked |
| `OWNER`, `ARCHITECT`, `ORCHESTRATOR` | None | No structural check |

### What happens on failure

A structural validation failure sets `gateBlocked: true` on the artifact and skips both the MCP gates and `advance_mode` for that step. It does **not** throw — the loop continues to the next step or iteration.

Output:
```
10:27:44 AM [gate] 🟥 Handoff structure invalid (QA): QA handoff must include verdict
```

### Handoff YAML shape (compact-handoff output)

```yaml
mode_completed: DEV
next_mode: QA
iteration: 1

files_modified:
  - src/api/users.py
  - tests/test_users.py

validation_run: pytest tests/test_users.py — 12 passed

summary: Added input validation to POST /users endpoint. All existing tests pass.
```

```yaml
mode_completed: QA
next_mode: CERBERUS
iteration: 1

verdict: pass

findings:
  - type: improvement
    description: Missing edge case for empty username

issues: []

summary: All acceptance criteria met. One non-blocking improvement noted.
```

```yaml
mode_completed: CERBERUS
next_mode: ORCHESTRATOR
iteration: 1

verdict: pass

blockers: []

improvements:
  - description: Consider rate limiting on the endpoint

summary: No blockers. One improvement logged to backlog.
```
