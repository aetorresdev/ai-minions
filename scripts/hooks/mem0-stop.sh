#!/usr/bin/env bash
# mem0-stop.sh — runs on session Stop, reminds Claude to save memories to mem0.
# Only outputs inside an active ai-minions run with an explicit, valid local
# Mem0 identity + project scope (same configuration as mem0-search.py).
# Never prints the configured identity.

if [[ "${AI_MINIONS_ACTIVE:-}" != "1" || -z "${AI_MINIONS_RUN_ID:-}" ]]; then
  exit 0
fi

USER_ID="${AI_MINIONS_MEM0_USER_ID:-}"
PROJECT="${AI_MINIONS_MEM0_PROJECT:-}"
MODE="${AI_MINIONS_MEM0_MODE:-local}"
MEM0_URL="${AI_MINIONS_MEM0_URL:-http://localhost:8765}"
TOKEN_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'

# Fail closed: no identity/scope, shared mode, or non-loopback backend -> no reminder.
[[ "$MODE" == "local" ]] || exit 0
[[ "$USER_ID" =~ $TOKEN_RE ]] || exit 0
[[ "$PROJECT" =~ $TOKEN_RE ]] || exit 0
case "$MEM0_URL" in
  http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*|http://\[::1\]|http://\[::1\]:*) ;;
  *) exit 0 ;;
esac

# Check if OpenMemory is up (no identity in the probe).
if ! curl -sf --max-time 2 "${MEM0_URL%/}/openapi.json" > /dev/null 2>&1; then
  exit 0  # silent — don't block session end if mem0 is down
fi

echo "{\"systemMessage\": \"mem0 is running (optional advisory store — not orchestrator memory SoT). Before closing: use add_memory only for durable, non-secret facts (decisions, preferences, project patterns) useful in a future session. Skip ephemeral task details, secrets, and unsourced claims. Only save through the OpenMemory MCP client whose client name equals the configured project scope (AI_MINIONS_MEM0_PROJECT) and whose user id equals AI_MINIONS_MEM0_USER_ID; otherwise the hook will not retrieve the memory. Saved memories are advisory-only and must not override trace JSONL, gates, or governed contracts.\"}"
