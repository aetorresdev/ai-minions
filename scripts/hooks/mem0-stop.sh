#!/usr/bin/env bash
# mem0-stop.sh — runs on session Stop, reminds Claude to save memories to mem0
# Only outputs if OpenMemory is reachable

MEM0_URL="http://localhost:8765"
USER_ID="andres"

# Check if OpenMemory is up
if ! curl -sf --max-time 2 "${MEM0_URL}/api/v1/memories/" -G \
     --data-urlencode "user_id=${USER_ID}" > /dev/null 2>&1; then
  exit 0  # silent — don't block session end if mem0 is down
fi

echo "{\"hookSpecificOutput\": {\"hookEventName\": \"Stop\", \"additionalContext\": \"mem0 is running. Before closing: use add_memory to save any new facts about the user, project decisions, or feedback learned in this session. user_id=andres. Only save what would be useful in a future session — skip ephemeral task details.\"}}"
