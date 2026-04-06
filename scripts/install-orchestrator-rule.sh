#!/usr/bin/env bash
# Install orchestrator.mdc into TARGET/.cursor/rules/
# Usage: install-orchestrator-rule.sh [TARGET_DIR]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RULE_SRC="$REPO_ROOT/.cursor/rules/orchestrator.mdc"
TARGET="$(cd "${1:-.}" && pwd)"
DEST="$TARGET/.cursor/rules"
[[ -f "$RULE_SRC" ]] || { echo "Missing $RULE_SRC" >&2; exit 1; }
mkdir -p "$DEST"
cp -f "$RULE_SRC" "$DEST/"
echo "Installed: $DEST/orchestrator.mdc"
echo "Note: If TARGET is not this repo, edit the .mdc 'Canonical contract' line to absolute path:"
echo "  $REPO_ROOT/docs/orchestrator/agent-contract.md"
echo "Or copy docs/orchestrator/ into TARGET. See docs/orchestrator/PATHS.md"
