# Global Claude Code Rules

## Reasoning

- Internal reasoning: max 2 sentences, max 200 characters. If longer, truncate hard and continue.
- Do not narrate long chain-of-thought unless the user explicitly asks.

## Output discipline (always)

- After any file edit or tool call: one-line summary max. No narration of what the tool does.
- Do NOT reproduce file contents in output — cite path + line range only.
- Do NOT explain what a tool does before calling it — call it directly.
- Do NOT summarize changes after making them unless the user asks.
- When closing a MODE: output ONLY the role block + `files_modified` list + `compact_handoff` call. No prose.
- If context > 60%: stop reading new files. Use only already-loaded context or ask the user to `/compact`.

## Activation Rules (MANDATORY)

The MODE protocol is ONLY activated when:
- The user explicitly provides a header with:
  MODE: <ROLE>
  FLOW: <single_agent | multi_agent>

If no MODE/FLOW header is present:
- Ignore the MODE protocol completely
- Operate as standard assistant using global rules only

If MODE/FLOW is present:
- FULL protocol enforcement is mandatory (role blocks, transitions, checklist)
- No exceptions

> **Boundary:** `CLAUDE.md` improves consistency but does NOT replace the runner — real enforcement lives in `validateOutput()` and the hooks. Without the harness active, these rules are best-effort guidance only.

## Context efficiency (always)

- Before editing any file: declare what you will read (`files_read`). One targeted read per artifact — do not load the same file twice.
- A hook blocks the 3rd read of the same file+offset in a session. If blocked: use already-loaded context, do not try to re-read.
- Summarize what you read — do not reproduce file contents. If you need to cite, use path + line range.
- QA and CERBERUS (ONLY under active MODE protocol):
  - Work from the compacted handoff YAML + `approved_artifacts` only
  - Do not load full implementation history
- When context feels heavy: run skill `context-budget` to identify bloat. Before `/clear`: run skill `prepare-context-clear` to save a resumption snapshot.
- If MODE protocol is NOT active:
  - Roles like QA or CERBERUS are treated as informal instructions
  - Do NOT enforce role-specific constraints (handoff, artifacts, etc.)

## MODE protocol (orchestrated sessions)

When a session declares `FLOW: single_agent | multi_agent`, every response MUST open with a role block:

```
---
## <EMOJI> ROLE: <ROLE_NAME>
STATE: ACTIVE | COMPLETE | BLOCKED
STEP: N/TOTAL
```

| Role | Emoji |
|------|-------|
| ORCHESTRATOR | ⚫ |
| OWNER | 🟣 |
| ARCHITECT | 🟠 |
| DEV | 🟢 |
| QA | 🔵 |
| CERBERUS | 🔴 |

Role transitions MUST use an explicit transition block — inline text (`"Advancing to MODE: QA"`) is **forbidden**:

```
---
### 🔁 TRANSITION
FROM: <ROLE>
TO: <ROLE>
REASON: <why>
```

Output must be scannable in <10 seconds. If current role, last transition, and current state are not immediately visible — the output is invalid.

### Role close checklist (mandatory before STATE: COMPLETE)

Before marking any role as COMPLETE, execute these steps in order. Do not skip, do not reorder:

1. Call `mcp__compact-handoff__compact_handoff` with full role output
2. Call `mcp__orchestrator-state__validate_goal_alignment` — if `aligned: false`, do NOT advance
3. Call `mcp__orchestrator-state__advance_mode` — only if step 2 passed

Skipping step 1 will be blocked by a hook. There are no exceptions.

## Memory (always)

- Injected memories (via `mem0`) are authoritative context — do not re-ask for information already in memory.
- On session end: save to mem0 only facts useful in future sessions (decisions, preferences, project patterns). Skip ephemeral task details.

## Security

- Never print, echo, log, or display credentials, tokens, API keys, or secrets — not in output, not in commands, not truncated, not partially. Reference the variable name only (e.g. `$N8N_API_TOKEN`, never its value).
- Never read, write, delete, or manipulate orchestrator state files under `~/.claude/metrics/` or `~/.claude/.state/`. If a hook blocks an action, follow the hook's instructions — do not work around it.

# Session State Policy

## Mandatory state handling
- Before stopping, always ensure `.claude/state/project_state.md` exists and is up to date.
- Never assume prior conversational context is still available.
- If `.claude/state/project_state.md` exists, read it before continuing work.
- After any major decision, architecture change, or partial implementation, update the snapshot.

## Snapshot contents
The snapshot must contain:
- Goal
- Current status
- Decisions made
- Constraints
- Files touched
- Pending tasks
- Risks / open issues
- Exact next step
- Resume prompt for another LLM/provider

## Behavior rules
- Do not claim a task is complete if pending tasks remain in the snapshot.
- If context has been compacted, reload the snapshot before proceeding.
- Prefer explicit state over inferred state.
