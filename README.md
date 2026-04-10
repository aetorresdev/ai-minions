# AI Minions

**AI Minions is not a prompt collection.** It is an **orchestration system** for AI agents: enforceable role contracts, validation gates, disk-backed authoritative state, and **cost- and context-aware** execution—with enough telemetry to compare **single-agent vs multi-agent** flows without pretending the chat transcript is the source of truth.

If that sentence is opaque, this repository is probably not what you are looking for. If it is clear, everything below is the same idea unpacked.

---

## Quickstart (~2 minutes)

Get from zero to “one skill responds correctly” quickly.

### Prerequisites

- **Cursor** or **Warp** with Claude Code (or compatible agent runtime).
- **Hooks + strict runner (optional):** Node.js ≥ 18 for [`examples/orchestrator/run-orchestrator.js`](examples/orchestrator/run-orchestrator.js); register MCPs per [`examples/orchestrator/README.md`](examples/orchestrator/README.md).
- **Optional (full stack):** MCP servers and CLI tools your skills need — see [`docs/mcp-installation.md`](docs/mcp-installation.md) and the skill you plan to run (e.g. Terraform / Docker linters).

### Install skills

Copy or clone this repo so skills live under `~/.claude/skills/`:

```bash
# Option A: clone directly into ~/.claude
git clone https://github.com/YOUR_USERNAME/ai-minions.git ~/.claude

# Option B: copy only skills
mkdir -p ~/.claude/skills
cp -r /path/to/this/repo/skills/* ~/.claude/skills/
```

Each skill is a folder with a `SKILL.md` (e.g. `~/.claude/skills/reviewing-docker/SKILL.md`).

### Test one skill

In Cursor or Warp, try:

- **“Review this Dockerfile”** (Dockerfile in context) → `reviewing-docker`
- **“Review this Terraform module”** (`.tf` in context) → `reviewing-terraform`
- **“Create a CircleCI pipeline for a Node app”** → `creating-circleci`

Reproducible demos: [`examples/`](examples/).

---

## Usage modes

| Mode | Hard gates? | Best for |
|------|-------------|----------|
| **Skills only** | No | Single-concern tasks: review, scaffold, design |
| **Single-agent orchestration** | No | Multi-step work, one chat, explicit roles (`FLOW: single_agent`) |
| **Strict orchestration** | Yes (when MCPs + runner configured) | Auditable transitions, artifact allowlists (`FLOW: multi_agent` via hook-driven runner) |

### Session header fields

- **`GOAL`** (required for orchestrated modes): plain-language scope for the unit of work. It can be short or several lines; keep it factual (symptoms, constraints, definition of done).
- **`ENVIRONMENT`** (optional): declare **read vs write** and which **logical services** agents may use. Values are **never** pasted in the prompt—only **names of environment variables** that you already set in your shell (or that your launcher injects). If you omit `ENVIRONMENT`, runs stay file- and dry-run–oriented unless the model finds creds another way. Full schema, `type` table, and multi-service examples: [`docs/orchestrator/environment-access.md`](docs/orchestrator/environment-access.md).
- **Shell**: before `run-orchestrator.js` (or any tool that resolves the header), `export` the variables your YAML references (e.g. `$N8N_API_URL`, `$N8N_API_TOKEN`). If a referenced var is missing, the runner logs a warning and agents see **blockers** for missing env in the injected context—nothing fails silently.
- **`CWD`** (optional, typical in `multi_agent`): working directory for the runner; must match the project you want agents to edit.

**Example (generic `GOAL` + optional n8n access via env var names):**

```
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Debug and fix the failing automation workflow: execution loops, wrong state transitions, or bad catalog data. Use execution history and prior notes in memory; deliver a minimal fix with evidence.
MAX_ITERATIONS: 3

ENVIRONMENT:
  mode: write
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_API_URL
        key: N8N_API_TOKEN
```

Same header works with `FLOW: multi_agent`; add `CWD: /path/to/your/project` when using the background runner.

### 1. Skills only

Ask naturally — no MODE header.

```
Review this Dockerfile
```

Skills may spawn subagents (e.g. `reviewing-terraform` → `static-analysis-runner`).

### 2. Single-agent orchestration (`FLOW: single_agent`)

One session rotates roles (ORCHESTRATOR → DEV → QA → CERBERUS, etc.) per the contract. Paste a header at the **start** of your message.

Minimal header (no live APIs):

```
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Ship the agreed API change with tests and a short validation note.
MAX_ITERATIONS: 3
```

Same header with **optional** `ENVIRONMENT` (only when you need external services). Shape, `mode`, `credentials`, `type`, and `vars` → [`docs/orchestrator/environment-access.md`](docs/orchestrator/environment-access.md); only **env var names** in YAML, values in your shell — see [Session header fields](#session-header-fields).

```
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Ship the agreed API change with tests and a short validation note.
MAX_ITERATIONS: 3

ENVIRONMENT:
  mode: write
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_API_URL
        key: N8N_API_TOKEN
```

### 3. Strict orchestration (`FLOW: multi_agent`)

Same idea: **`FLOW: multi_agent`** triggers the hook that launches the Node runner so each role can run as a separate `claude` CLI step with disk-backed state and gates (when MCPs are registered). **`ENVIRONMENT`** is still optional — omit it for file-only work; add it under the same contract as above ([`environment-access.md`](docs/orchestrator/environment-access.md)).

Minimal header:

```
MODE: ORCHESTRATOR
FLOW: multi_agent
GOAL: Ship the agreed API change with tests and a short validation note.
MAX_ITERATIONS: 3
CWD: /path/to/your/project
```

With optional **`ENVIRONMENT`** (example — adjust `credentials` to your services):

```
MODE: ORCHESTRATOR
FLOW: multi_agent
GOAL: Ship the agreed API change with tests and a short validation note.
MAX_ITERATIONS: 3
CWD: /path/to/your/project

ENVIRONMENT:
  mode: write
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_API_URL
        key: N8N_API_TOKEN
```

Watch logs:

```bash
tail -f ~/.claude/logs/orchestrator.log
```

Gate sequence and failure modes: [`docs/orchestrator/strict-mode.md`](docs/orchestrator/strict-mode.md).

### CLI reference runner (`single_agent` vs `multi_agent`)

Direct invocation (bypasses the chat header); use `--skip-gates` until MCPs are installed. The first argument is the **same text** you would paste in chat: you can pass **only** a `GOAL` sentence, or a **full header** including optional `ENVIRONMENT` / `CWD`. The runner parses `ENVIRONMENT` from that string — see [Session header fields](#session-header-fields) and [`docs/orchestrator/environment-access.md`](docs/orchestrator/environment-access.md). Export the referenced variables before running.

```bash
# Goal text only (no ENVIRONMENT)
node ~/.claude/examples/orchestrator/run-orchestrator.js \
  --cwd /path/to/project \
  --flow single_agent \
  --skip-gates \
  "Ship the agreed API change with tests and a short validation note."

# Full header + ENVIRONMENT (newlines inside the quoted string).
# Set N8N_API_URL and N8N_API_TOKEN in your shell (or CI secrets) before running — never in the repo.
node ~/.claude/examples/orchestrator/run-orchestrator.js \
  --cwd /path/to/project \
  --flow multi_agent \
  --skip-gates \
  "MODE: ORCHESTRATOR
FLOW: multi_agent
GOAL: Ship the agreed API change with tests and a short validation note.
MAX_ITERATIONS: 3

ENVIRONMENT:
  mode: write
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_API_URL
        key: N8N_API_TOKEN"
```

Full flags, degraded mode, and MCP setup: [`examples/orchestrator/README.md`](examples/orchestrator/README.md). Cursor rule (MODE non‑negotiables): [`.cursor/rules/orchestrator.mdc`](.cursor/rules/orchestrator.mdc) — install elsewhere with `./scripts/install-orchestrator-rule.sh /path/to/repo`.

### Anti-loop (reminder)

- QA returns to DEV only for **`blocker`** findings; other severities go to backlog.
- If `iteration >= max_iterations`, escalate to **ORCHESTRATOR**, not another blind DEV round.

---

## The problem

- **Agents without control** drift: they mix implementation, self-review, and “ship it” in one turn. Quality collapses; nobody knows who “signed off” on what.
- **Prompts alone do not scale:** they are suggestions, not invariants. Production needs *gates*, not vibes.
- **Multi-agent is expensive:** more boundaries mean more tokens, more latency, and more failure modes—so you should only pay for separation when it buys *predictability* or *auditability*.
- **Outputs without structure are not evidence:** “the model said it worked” is not a validation run.

**Operating principle:** *If I do not understand it, I do not ship it.* This repo encodes that as contracts, traces, and explicit non-goals—not as clever wording.

---

## Core concepts (the mental model)

| Concept | What it is in this repo |
|--------|-------------------------|
| **Agents (roles)** | Fixed **MODE**s (`ORCHESTRATOR`, `OWNER`, `ARCHITECT`, `DEV`, `QA`, `CERBERUS`) with explicit **FORBID** rules so one hat cannot substitute for another. See [`docs/orchestrator/agent-contract.md`](docs/orchestrator/agent-contract.md). |
| **Contracts** | **Structured handoffs** (YAML schema) plus **per-role output contracts** in strict execution: minimum content and shape before a step counts as done. |
| **Gates** | **Hard checks** before a MODE advance: goal alignment, transition validation, approved artifacts vs `files_modified`. Implemented via the **`orchestrator-state`** MCP and an append-only **hash-chained** event log—not the chat. |
| **Orchestration** | **Single-agent** (`FLOW: single_agent`): one session, disciplined role switching. **Multi-agent** (`FLOW: multi_agent`): separate processes per role via the reference runner and hooks. Same protocol; different cost and isolation trade-offs. |
| **Context efficiency** | Deliberate limits on what crosses step boundaries (e.g. `AI_TEAM_MAX_CONTEXT_CHARS`), **context_stats** (files read / modified counts) attached to validation, and a **`context-budget`** skill for auditing context bloat. |
| **Traceability** | **JSONL execution traces** under `~/.claude/metrics/traces/` (session start, agent lifecycle, contract failures, gate results, `context_stats`, session end). Hooks aggregate **tokens, cost, and MODE** into session summaries on `Stop`. |

Skills and hooks still exist—they are **adapters and sensors** around this core, not the definition of the system.

---

## What makes this different

- **Not a LangChain clone, not CrewAI, not “agents because agents.”** There is no generic DAG-of-tools narrative. The unit of design is **governed execution**: roles, handoffs, and provable transitions when gates are on.
- **Most agent stacks optimize for capability.** This stack optimizes for **control, cost, and predictability**: local planning where it makes sense (Ollama), strict output validation (`validateOutput` in the reference runner), and optional **degraded mode** that is **loud**, not silent.
- **Authority is explicit:** when strict orchestration is enabled, **disk + MCP** define what happened; the transcript is commentary.

Reference implementation and gate semantics: [`examples/orchestrator/README.md`](examples/orchestrator/README.md). State store layout and tools: [`mcp-servers/orchestrator-state/README.md`](mcp-servers/orchestrator-state/README.md).

---

## Experiments and metrics (credibility surface)

This repository is set up to **measure** flows, not only run them:

- **`FLOW`** is a first-class label (`single_agent` | `multi_agent`) for comparing runs under the same goal.
- **Hooks** (`session-state`, `flow-metrics`, `agent-metrics`) record tokens, cost, MODE/agent activity, handoffs, and goal-alignment summaries across a session.
- **Traces** record per-step **contract failures**, **gate pass/fail**, **`qa_degraded`** flags, and **context_stats** for post-hoc analysis.

**What we document honestly:** order-of-magnitude timings and trade-offs (e.g. faster iteration with gates off vs stronger guarantees with gates on) live in [`examples/orchestrator/README.md`](examples/orchestrator/README.md). **We do not publish fake benchmark tables here**—your hardware, models, and goals dominate numbers. The machinery is there so *you* can run comparable experiments and keep the data.

---

## Architecture (compressed)

The diagram below is **intentionally minimal**: roles → handoffs → gates → authoritative disk → execution and telemetry. For the **full internal wiring** (skills, each hook, Ollama/OpenMemory, external MCPs, legend), see [`docs/orchestrator/system-architecture-diagram.md`](docs/orchestrator/system-architecture-diagram.md).

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1e1e2e", "primaryTextColor": "#cdd6f4", "primaryBorderColor": "#89b4fa", "lineColor": "#89b4fa", "secondaryColor": "#181825", "tertiaryColor": "#313244", "edgeLabelBackground": "#313244", "clusterBkg": "#181825", "clusterBorder": "#45475a", "titleColor": "#cdd6f4", "fontFamily": "monospace"}}}%%
flowchart LR
    U[User / session] --> P[MODE protocol + YAML handoffs]
    P --> G[Gates: alignment + transition + advance]
    G --> D[(Disk: envelope + events.jsonl)]
    P --> X[Runner + validateOutput + traces + hooks]
    G -.->|same task| X
```

Strict-mode operations (register task, artifact allowlists, gate order): [`docs/orchestrator/strict-mode.md`](docs/orchestrator/strict-mode.md).

---

## Non-goals

- **Not** trying to fully automate software engineering end-to-end without human ownership.
- **Not** replacing human judgment on risk, compliance, or release decisions—only making the *machine* side more legible.
- **Not** optimizing for clever prompts or “vibes-based” reliability.
- **Not** claiming session isolation from metadata alone—see **§ Authoritative state** in the contract for the honest boundary (`session_id` is audit metadata until a dedicated runner enforces isolation).

---

## Repository map (after you understand the thesis)

| Area | Purpose |
|------|---------|
| [`docs/orchestrator/agent-contract.md`](docs/orchestrator/agent-contract.md) | Roles, handoff YAML, state-store authority, output contracts. |
| [`docs/orchestrator/system-architecture-diagram.md`](docs/orchestrator/system-architecture-diagram.md) | Full operational Mermaid (skills, hooks, MCPs, disk, Ollama). |
| [`examples/orchestrator/`](examples/orchestrator/) | Node reference runner: planning, `validateOutput`, MCP gates, traces. |
| [`mcp-servers/orchestrator-state/`](mcp-servers/orchestrator-state/) | Disk-backed task store + gate MCP (pytest included). |
| [`mcp-servers/compact-handoff/`](mcp-servers/compact-handoff/) | Handoff compaction + alignment helpers (local). |
| [`scripts/hooks/`](scripts/hooks/) | Claude Code lifecycle: launch multi-agent runner, token/cost/MODE tracking, session summaries. |
| [`skills/`](skills/) | Task-scoped playbooks (Terraform, Docker, CI, n8n, observability, specs, …). |
| [`agents/`](agents/) | Specialized subagent definitions consumed by skills and workflows. |

Hook wiring: copy [`settings.json.example`](settings.json.example) to your local `settings.json` and adapt paths (do not commit secrets).

---

## Safety and scope

- **Read vs write:** skills that generate files do not imply `terraform apply`, production deploys, or unprompted pushes—human action stays in the loop.
- **Secrets:** never paste credentials into prompts; use environment variables or your platform’s secret store.

---

## License and contributing

- [MIT](LICENSE)
- [CONTRIBUTING.md](CONTRIBUTING.md)

---

*Because even AI needs governed execution—not just louder instructions.*
