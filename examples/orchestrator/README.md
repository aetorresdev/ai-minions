# Orchestrator Example

An autonomous orchestrator that follows the [MODE protocol](../../docs/orchestrator/agent-contract.md) and uses the [orchestrator-state MCP](../../mcp-servers/orchestrator-state/README.md) as the authoritative state store.

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
| Slow machine / CI | `CLAUDE_CLI_TIMEOUT=300000` | Default 180s may be too short for cold starts |
| Sensitive goal (logs to disk) | `TRACE_REDACT_GOAL=1` | Goal text omitted from trace files; only SHA-256 hash retained |
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

---

## Quickstart (no MCPs — 2 minutes)

```bash
# From repo root
cd ~/.claude/examples/orchestrator

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

For examples with environment access and credentials (n8n, write mode), see [Running the orchestrator](../../README.md#running-the-orchestrator) in the root README.

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

**Loop keeps iterating**
Cerberus is finding blockers every round. Check Cerberus output in artifacts — it may be too strict for a simple task.
Use `--iterations 1` to force a single pass.

---

## Tests

```bash
cd examples/orchestrator
npm test              # lint (ESLint + ruff) + unit tests — no auth, no Ollama, no MCPs required
npm run test:e2e      # E2E suite — requires Ollama running at localhost:11434
npm run test:e2e:all  # E2E suite with all available Ollama models
```

### CI pipelines

| Workflow | Runner | Triggers |
|----------|--------|---------|
| `orchestrator-example.yml` | GitHub cloud | Every push/PR touching `examples/orchestrator/**` or `scripts/hooks/**` |
| `orchestrator-e2e.yml` | Self-hosted (`ollama` label) | Push/PR to core files or manual `workflow_dispatch` |

The E2E workflow requires a self-hosted runner with Ollama at `localhost:11434`. See setup instructions in `.github/workflows/orchestrator-e2e.yml`.

### Coverage at a glance

| Area | Type |
|------|------|
| Output contracts (per role) | Unit |
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

### Test files

| File | Type | Requires |
|------|------|---------|
| `tests/validateOutput.test.js` | Unit | Nothing |
| `tests/orchestrator.test.js` | Unit | Nothing |
| `tests/internals.test.js` | Unit | Nothing |
| `tests/askAgent.test.js` | Integration | Nothing (CLI mocked) |
| `tests/e2e.test.js` | E2E | Ollama at localhost:11434 (auto-skip if unavailable) |

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

The gate enforces **consistency** — every path modified must have been declared in `files_read`, and `files_modified` is mandatory (absence would bypass the cross-check). It does not enforce completeness (whether all relevant files were declared). See [agent-contract.md](../../docs/orchestrator/agent-contract.md) for the known limitation.

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
- [Agent contract](../../docs/orchestrator/agent-contract.md)
- [Strict mode operational guide](../../docs/orchestrator/strict-mode.md)
- [State store MCP](../../mcp-servers/orchestrator-state/README.md)

---

## Structure

```
examples/orchestrator/
├── agents.js           # Agent definitions: MODE, model, system prompt, validateOutput()
├── orchestrator.js     # Autonomous loop: plan → execute → gate → cerberus → decide
├── context-utils.js    # Context truncation helpers
├── run-orchestrator.js # CLI entry point
├── cli.js              # Interactive single-agent chat
├── CLAUDE.md           # Guardrails loaded by Claude Code agents
├── package.json        # npm test → node --test tests/*.test.js
├── .env.example        # All environment variables with defaults
└── tests/
    ├── validateOutput.test.js   # Unit: output contracts per role (31 tests)
    ├── orchestrator.test.js     # Unit: detectBlockers + validateHandoffStructure (26 tests)
    └── askAgent.test.js         # Integration: askAgent() with mocked CLI (15 tests)
```
