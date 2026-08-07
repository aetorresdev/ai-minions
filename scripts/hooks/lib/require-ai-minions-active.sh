# Source from bash hooks: early-exit unless ai-minions CLI/runner activated this process.
# Usage: source "$(dirname "$0")/lib/require-ai-minions-active.sh"  OR  path relative to hook.
if [[ "${AI_MINIONS_ACTIVE:-}" != "1" ]]; then
  exit 0
fi
