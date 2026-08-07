# ai-minions activation (opt-in)

## Rule

**Only the product CLI / runner activates ai-minions.**

| Activates | Does not activate |
|-----------|-------------------|
| `ai-minions start --goal "…"` → `launchRun` | `MODE:` / `FLOW:` / `GOAL:` in chat, docs, or RAG quotes |
| Legacy `node orchestrator/run-orchestrator.js …` | `CLAUDE.md`, Cursor rules, `state/project_state.md` |
| Env inherited by child `claude` / hooks: **both** `AI_MINIONS_ACTIVE=1` and non-empty `AI_MINIONS_RUN_ID` | Stale files under `~/.claude/metrics/` or `~/.claude/.state/` |

`is_ai_minions_active()` / `isAiMinionsActive()` require **both** markers. `ACTIVE=1` alone is not enough.

## Host hooks

Claude Code hooks under `scripts/hooks/` (including `context-efficiency.py`, `skill-registry-enforcer.py`, `agent-metrics.py`, and `mem0-search.py`) call the activation helper (or bash equivalent) and **exit 0** when inactive. They must not treat prompt text, `ORCH_SKILL_REGISTRY_ENFORCE=1`, or legacy `orch-session` flags as activation.

## Cursor

`.cursor/rules/orchestrator.mdc` stays `alwaysApply: false` (manual / @-mention only). Do not enable every-chat orchestration. Ordinary Cursor work in this repo must not emit role blocks or create orchestrator state.

## Smoke checks

1. Normal session with quoted `FLOW: multi_agent` in a RAG example → no role block, no orch session flag, hooks no-op (including context-efficiency third-Read gate).
2. `ai-minions start --goal "…"` → child env has `AI_MINIONS_ACTIVE=1` and `AI_MINIONS_RUN_ID`; pipeline runs.
3. Leftover `orch-session-*.flag` or `ORCH_SKILL_REGISTRY_ENFORCE=1` without CLI markers → ignored.
