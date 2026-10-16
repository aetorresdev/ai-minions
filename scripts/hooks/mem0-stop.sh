#!/usr/bin/env bash
# mem0-stop.sh — runs on session Stop, reminds Claude to save memories to mem0.
# Only outputs inside an active ai-minions run with an explicit, valid local
# Mem0 identity + project scope (same configuration as mem0-search.py).
# Never prints the configured identity.

if [[ "${AI_MINIONS_ACTIVE:-}" != "1" || -z "${AI_MINIONS_RUN_ID:-}" ]]; then
  exit 0
fi

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail closed: identity, project scope, mode and URL are validated by the same
# parser as mem0-search.py (mem0_scope.resolve_scope). Missing/invalid scope,
# shared mode, userinfo in the URL or a non-loopback host -> no reminder and
# no network call. Only the parsed, validated base URL is used below.
MEM0_URL="$(python3 -I "${HOOK_DIR}/mem0_scope.py" validated-url 2>/dev/null)" || exit 0
[[ -n "$MEM0_URL" ]] || exit 0

# Check if OpenMemory is up (no identity in the probe).
if ! curl -sf --max-time 2 "${MEM0_URL}/openapi.json" > /dev/null 2>&1; then
  exit 0  # silent — don't block session end if mem0 is down
fi

echo "{\"systemMessage\": \"mem0 is running (optional advisory store — not orchestrator memory SoT). Before closing: use add_memory only for durable, non-secret facts (decisions, preferences, project patterns) useful in a future session. Skip ephemeral task details, secrets, and unsourced claims. Only save through the OpenMemory MCP client whose client name equals the configured project scope (AI_MINIONS_MEM0_PROJECT) and whose user id equals AI_MINIONS_MEM0_USER_ID; otherwise the hook will not retrieve the memory. Saved memories are advisory-only and must not override trace JSONL, gates, or governed contracts.\"}"
