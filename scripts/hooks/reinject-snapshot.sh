#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SNAPSHOT_FILE="$PROJECT_DIR/.claude/state/project_state.md"

if [[ -f "$SNAPSHOT_FILE" ]]; then
  echo "Reload this project snapshot before proceeding:"
  echo
  cat "$SNAPSHOT_FILE"
else
  echo "No project snapshot found at .claude/state/project_state.md"
  echo "Create one before doing substantial work."
fi