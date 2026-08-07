# ai-minions activation (opt-in)

## Rule

**Only the product CLI / runner activates ai-minions.**

| Activates | Does not activate |
|-----------|-------------------|
| `ai-minions start` → `launchRun` | `MODE:` / `FLOW:` / `GOAL:` in chat, docs, or RAG quotes |
| Legacy `node orchestrator/run-orchestrator.js …` | `CLAUDE.md`, Cursor rules, `state/project_state.md` |
| Env inherited by child `claude` / hooks: `AI_MINIONS_ACTIVE=1`, `AI_MINIONS_RUN_ID=<id>` | Stale files under `~/.claude/metrics/` or `~/.claude/.state/` |

## Host hooks

Claude Code hooks under `scripts/hooks/` call `is_ai_minions_active()` (or bash `AI_MINIONS_ACTIVE=1`) and **exit 0** when inactive. They must not treat prompt text as activation.

## Cursor

`.cursor/rules/orchestrator.mdc` stays `alwaysApply: false` (manual / @-mention only). Do not enable every-chat orchestration. Ordinary Cursor work in this repo must not emit role blocks or create orchestrator state.

## Smoke checks

1. Normal session with quoted `FLOW: multi_agent` in a RAG example → no role block, no orch session flag, hooks no-op.
2. `ai-minions start "…"` → child env has `AI_MINIONS_ACTIVE=1` and a run id; pipeline runs.
3. Leftover `orch-session-*.flag` without env → ignored.
