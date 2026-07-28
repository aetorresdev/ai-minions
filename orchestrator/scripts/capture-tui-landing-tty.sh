#!/usr/bin/env bash
# Capture a real terminal frame of the operator TUI landing (visual composition).
# Requires a TTY-capable host. Output is typescript(1) text — not Ink renderToString.
#
# Usage:
#   ./orchestrator/scripts/capture-tui-landing-tty.sh [cols] [rows] [out.typescript]
#
# Example:
#   ./orchestrator/scripts/capture-tui-landing-tty.sh 80 24 /tmp/landing-80x24.typescript
#
# Optional CI artifact path (when a job provides a PTY):
#   upload the typescript file + a short metrics note (cols/rows/tip SHA).
# Full screenshot CI is intentionally out of scope here.

set -euo pipefail

COLS="${1:-80}"
ROWS="${2:-24}"
OUT="${3:-/tmp/ai-minions-landing-${COLS}x${ROWS}.typescript}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ORCH="$ROOT/orchestrator"

if ! command -v script >/dev/null 2>&1; then
  echo "error: script(1) not found; install util-linux or record a PTY another way" >&2
  exit 2
fi

TIP="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
INK="$(node -e "console.log(require('$ORCH/node_modules/ink/package.json').version)" 2>/dev/null || echo unknown)"

export COLUMNS="$COLS"
export LINES="$ROWS"
export AI_MINIONS_TUI_SKIP_SPLASH=1
export FORCE_COLOR="${FORCE_COLOR:-0}"

# Prefer installed CLI; fall back to local entry.
CMD=(timeout 3s node "$ORCH/ai-minions-cli.js" tui)
if command -v ai-minions >/dev/null 2>&1; then
  CMD=(timeout 3s ai-minions tui)
fi

mkdir -p "$(dirname "$OUT")"
# script -q/-c semantics differ slightly across util-linux vs BSD; prefer GNU form.
if script -q -c true /dev/null 2>/dev/null; then
  script -q -c "${CMD[*]}" "$OUT" || true
else
  script -q "$OUT" "${CMD[@]}" || true
fi

echo "wrote=$OUT cols=$COLS rows=$ROWS tip=$TIP ink=$INK"
echo "note=real PTY typescript; inspect with 'cat -v' or scriptreplay if timing file present"
echo "not_claim=Ink renderToString fixtures under tests/fixtures/tui/landing/"
