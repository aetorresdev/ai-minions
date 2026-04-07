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
> The `node` commands below are for direct use, testing, or bringing your own runner.

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

If `orchestrator-state` or `compact-handoff` MCPs are not registered, the runner **degrades gracefully** — it logs a WARNING and continues without hard gates. Gates are opt-in.

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
├── agents.js           # Agent definitions: MODE, model, system prompt
├── orchestrator.js     # Autonomous loop: plan → execute → gate → cerberus → decide
├── context-utils.js    # Context truncation helpers
├── run-orchestrator.js # CLI entry point
├── cli.js              # Interactive single-agent chat
├── CLAUDE.md           # Guardrails loaded by Claude Code agents
├── package.json
└── .env.example        # All environment variables with defaults
```
