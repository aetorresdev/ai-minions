#!/usr/bin/env bash
# ai-minions install — delegates to scripts/install-ai-minions.mjs (single source of truth).
# Current installer flow: host prereqs + Ollama model discovery + .ai-minions config write.
#
# Usage (from clone root):
#   ./install.sh [--install] [--json] [--model-policy local_only|remote_ok]
#
# Equivalent:
#   node scripts/install-ai-minions.mjs "$@"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_MJS="$REPO_ROOT/scripts/install-ai-minions.mjs"

if [[ ! -f "$INSTALL_MJS" ]]; then
  echo "blocker: INSTALL_NPM_CI_FAILED" >&2
  echo "missing $INSTALL_MJS — run from ai-minions clone root" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "blocker: INSTALL_NODE_MISSING" >&2
  echo "Node.js not found in PATH — install Node 22+ (LTS) first" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec node "$INSTALL_MJS" "$@"
