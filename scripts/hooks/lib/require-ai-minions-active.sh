# Source from bash hooks: early-exit unless CLI/runner set both activation markers.
# Usage: path relative to hook, or source from scripts/hooks/lib/
if [[ "${AI_MINIONS_ACTIVE:-}" != "1" || -z "${AI_MINIONS_RUN_ID:-}" ]]; then
  exit 0
fi
