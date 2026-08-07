#!/usr/bin/env bash
# mem0-stop.sh — runs on session Stop, reminds Claude to save memories to mem0
# Only outputs if OpenMemory is reachable and ai-minions activated this session.

if [[ "${AI_MINIONS_ACTIVE:-}" != "1" || -z "${AI_MINIONS_RUN_ID:-}" ]]; then
  exit 0
fi

MEM0_URL="http://localhost:8765"
USER_ID="andres"

# Check if OpenMemory is up
if ! curl -sf --max-time 2 "${MEM0_URL}/api/v1/memories/" -G \
     --data-urlencode "user_id=${USER_ID}" > /dev/null 2>&1; then
  exit 0  # silent — don't block session end if mem0 is down
fi

echo "{\"systemMessage\": \"mem0 is running (optional advisory store — not orchestrator memory SoT). Before closing: use add_memory only for durable, non-secret facts (decisions, preferences, project patterns) useful in a future session. Skip ephemeral task details, secrets, and unsourced claims. Saved memories are advisory-only and must not override trace JSONL, gates, or governed contracts. user_id=andres.\"}"
