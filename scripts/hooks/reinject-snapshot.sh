#!/usr/bin/env bash
set -euo pipefail

# Do not inject project_state into ordinary chats in this repo.
if [[ "${AI_MINIONS_ACTIVE:-}" != "1" || -z "${AI_MINIONS_RUN_ID:-}" ]]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SNAPSHOT_FILE="$PROJECT_DIR/state/project_state.md"

if [[ -f "$SNAPSHOT_FILE" ]]; then
  echo "Reload this project snapshot before proceeding:"
  echo
  cat "$SNAPSHOT_FILE"
else
  echo "No project snapshot found at state/project_state.md"
  echo "Create one before doing substantial work."
fi