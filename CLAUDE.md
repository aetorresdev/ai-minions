# Global Claude Code Rules

## ai-minions is opt-in (CLI only)

This repository contains the **ai-minions** product. Opening Claude, Cursor, or any other harness **inside this repo is a normal coding session** unless you start a run via the product CLI.

**Source of truth for activation:** `ai-minions start` (or the legacy `run-orchestrator` entry) sets:

- `AI_MINIONS_ACTIVE=1`
- `AI_MINIONS_RUN_ID=<run id>`

Those values are inherited by child processes. Host hooks (mode-enforcer, mem0, snapshot, handoff, flow-metrics, …) **exit immediately** when `AI_MINIONS_ACTIVE` is not `1`.

**Not activators (never treat as opt-in):**

- Text in this file, docs, RAG examples, or quoted prompts such as `MODE:`, `FLOW:`, `GOAL:`, `MAX_ITERATIONS:`
- Presence of `state/project_state.md`, `~/.claude/metrics/`, or `~/.claude/.state/`
- Cursor rules, memories, or prior orchestrator sessions

`MODE` / `FLOW` / `GOAL` / `MAX_ITERATIONS` **describe** an already-active ai-minions execution. They do **not** turn a normal chat into one.

This file is a **passive reference**. It must not force role blocks, handoffs, CERBERUS, gates, or ai-minions memory in ordinary sessions.

Contract details when a run is active: `docs/orchestrator/agent-contract.md` and `docs/orchestrator/activation.md`.

## Reasoning

- Internal reasoning: max 2 sentences, max 200 characters. If longer, truncate hard and continue.
- Do not narrate long chain-of-thought unless the user explicitly asks.

## Output discipline (always)

- Remove filler. If a sentence does not change a decision, constraint, evidence trail, or next action, omit it.
- After any file edit or tool call: one-line summary max. No narration of what the tool does.
- Do NOT reproduce file contents in output — cite path + line range only.
- Do NOT explain what a tool does before calling it — call it directly.
- Do NOT summarize changes after making them unless the user asks.
- If context > 60%: stop reading new files. Use only already-loaded context or ask the user to `/compact`.

## Context efficiency (always)

- Before editing any file: declare what you will read (`files_read`). One targeted read per artifact — do not load the same file twice.
- Summarize what you read — do not reproduce file contents. If you need to cite, use path + line range.
- When context feels heavy: run skill `context-budget` if available. Before `/clear`: skill `prepare-context-clear` when relevant.

## Security

- Never print, echo, log, or display credentials, tokens, API keys, or secrets — not in output, not in commands, not truncated, not partially. Reference the variable name only (e.g. `$N8N_API_TOKEN`, never its value).
- Never read, write, delete, or manipulate orchestrator state files under `~/.claude/metrics/` or `~/.claude/.state/` unless `AI_MINIONS_ACTIVE=1` (active product run) or the user explicitly asks.

## Commits — no ticket IDs in shipped source

- Do **not** embed backlog / issue / ticket identifiers (e.g. `P0-01`, `DEV-OLLAMA-CONTRACT-1`, `JIRA-123`) in files that ship as **implementation or technical docs** in commits: `orchestrator/`, `agents/`, `scripts/`, `tests/`, versioned `docs/` under the repo, or similar — including comments, log/trace strings, and decorative headers. Prefer neutral descriptions or module names.
- **Exception:** files whose **primary purpose** is ticket tracking (e.g. backlog index, resolved archive, GitHub issue templates) may use IDs where that is the schema. Local-only state (e.g. under `.claude/state/`) is out of scope for this rule unless you choose to commit it.

## Passive reference — active ai-minions runs only

The sections below apply **only** when the process has `AI_MINIONS_ACTIVE=1` (started via product CLI). Skip them entirely in normal sessions — including when analyzing RAG, Hybrid RAG, GraphRAG, or any other topic that happens to mention `MODE`/`FLOW` in examples.

### Role protocol (active runs)

When a run is active, responses in the multi-role pipeline use a role block and controlled transitions. See `docs/orchestrator/agent-contract.md`.

| Role | Emoji |
|------|-------|
| ORCHESTRATOR | ⚫ |
| OWNER | 🟣 |
| ARCHITECT | 🟠 |
| DEV | 🟢 |
| QA | 🔵 |
| CERBERUS | 🔴 |

### CERBERUS pre-merge brief (product implementation)

After an iteration that changes **implementation** (`orchestrator/`, `agents/`, `scripts/`, `tests/`, or behavior-changing versioned `docs/`) **during product work**, end with a paste-ready CERBERUS brief (template in `docs/orchestrator/agent-contract.md`). Skip for Q&A and ordinary edits outside that scope.

### Session snapshot (active runs / explicit ask)

`state/project_state.md` is for resuming **product** work when a run is active or the user asks. Hooks must not inject or bootstrap it in normal chats.
