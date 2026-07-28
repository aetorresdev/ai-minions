#!/usr/bin/env bash
# Capture a real terminal frame of the operator TUI landing (visual composition).
# Requires a TTY-capable host. Output is typescript(1) text — not Ink renderToString.
#
# Default runner: checkout CLI only (node orchestrator/ai-minions-cli.js tui).
# Installed/global binary is opt-in only — never preferred automatically.
#
# Usage:
#   ./orchestrator/scripts/capture-tui-landing-tty.sh [cols] [rows] [out.typescript]
#   ./orchestrator/scripts/capture-tui-landing-tty.sh --use-installed [cols] [rows] [out]
#
# Opt-in installed binary:
#   AI_MINIONS_TUI_CAPTURE_BIN=/path/to/ai-minions ./orchestrator/scripts/capture-tui-landing-tty.sh
#   ./orchestrator/scripts/capture-tui-landing-tty.sh --use-installed
#
# On success: prints provenance lines and writes <out>.meta.json beside the capture.
# Fails (non-zero) if the capture surface lacks "Start New Run" or "Overall:".
# Fails if script_rc is not 0 or 124 (timeout), even when markers are present.
# Fails on a dirty git worktree (source_tip_sha must identify executed source).

set -euo pipefail

USE_INSTALLED=0
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --use-installed)
      USE_INSTALLED=1
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do POSITIONAL+=("$1"); shift; done
      break
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      exit 2
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

COLS="${POSITIONAL[0]:-80}"
ROWS="${POSITIONAL[1]:-24}"
OUT="${POSITIONAL[2]:-/tmp/ai-minions-landing-${COLS}x${ROWS}.typescript}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ORCH="$ROOT/orchestrator"
CHECKOUT_CLI="$ORCH/ai-minions-cli.js"
META_OUT="${OUT}.meta.json"

if [[ ! -f "$CHECKOUT_CLI" ]]; then
  echo "error: checkout CLI not found: $CHECKOUT_CLI" >&2
  exit 2
fi

if ! command -v script >/dev/null 2>&1; then
  echo "error: script(1) not found; install util-linux or record a PTY another way" >&2
  exit 2
fi

if [[ -n "${AI_MINIONS_TUI_CAPTURE_BIN:-}" ]]; then
  USE_INSTALLED=1
fi

# Fail-on-dirty: source_tip_sha must identify the source that produced the frame.
# CI clean checkouts are the expected path; local dirty trees must commit or stash first.
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: not a git worktree at $ROOT; cannot pin source_tip_sha" >&2
  exit 2
fi
DIRTY="$(git -C "$ROOT" status --porcelain 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  echo "error: dirty worktree; refuse capture (source_tip_sha would not identify executed source)" >&2
  echo "error: commit or stash changes, then re-run" >&2
  exit 2
fi
SOURCE_TIP="$(git -C "$ROOT" rev-parse HEAD)"

INK="$(node -e "console.log(require('$ORCH/node_modules/ink/package.json').version)" 2>/dev/null || echo unknown)"

resolve_installed_bin() {
  local candidate="${AI_MINIONS_TUI_CAPTURE_BIN:-}"
  if [[ -n "$candidate" ]]; then
    if [[ -x "$candidate" ]]; then
      # Prefer canonical path when available.
      if command -v realpath >/dev/null 2>&1; then
        realpath "$candidate"
      else
        readlink -f "$candidate" 2>/dev/null || echo "$candidate"
      fi
      return 0
    fi
    echo "error: AI_MINIONS_TUI_CAPTURE_BIN is not executable: $candidate" >&2
    return 2
  fi
  if command -v ai-minions >/dev/null 2>&1; then
    command -v ai-minions
    return 0
  fi
  echo "error: --use-installed / AI_MINIONS_TUI_CAPTURE_BIN requested but no ai-minions binary found" >&2
  return 2
}

# Product CLI --version for both checkout (.js via node) and installed binaries.
bin_version() {
  local bin="$1"
  if [[ "$bin" == *.js ]]; then
    node "$bin" --version 2>/dev/null | head -n1 | tr -d '\r' || echo unknown
  else
    "$bin" --version 2>/dev/null | head -n1 | tr -d '\r' || echo unknown
  fi
}

if [[ "$USE_INSTALLED" -eq 1 ]]; then
  RUNNER_KIND="installed-bin"
  RUNNER_PATH="$(resolve_installed_bin)"
  RUNNER_VERSION="$(bin_version "$RUNNER_PATH")"
  INNER_CMD=(timeout 3s "$RUNNER_PATH" tui)
else
  RUNNER_KIND="checkout-cli"
  RUNNER_PATH="$CHECKOUT_CLI"
  RUNNER_VERSION="$(bin_version "$CHECKOUT_CLI")"
  INNER_CMD=(timeout 3s node "$CHECKOUT_CLI" tui)
fi

export COLUMNS="$COLS"
export LINES="$ROWS"
export AI_MINIONS_TUI_SKIP_SPLASH=1
export FORCE_COLOR="${FORCE_COLOR:-0}"

mkdir -p "$(dirname "$OUT")"

# script -q/-c semantics differ slightly across util-linux vs BSD; prefer GNU -c form.
# Prefer -e/--return so CAPTURE_RC is the child status (0 success, 124 timeout kill).
# timeout often exits 124 after killing the TUI — that is expected when a frame was captured.
script_supports_return=0
if script -q -e -c true /dev/null 2>/dev/null; then
  script_supports_return=1
fi

set +e
if script -q -c true /dev/null 2>/dev/null; then
  # Join safely for script -c string; paths with spaces are quoted.
  SCRIPT_CMD="timeout 3s"
  if [[ "$RUNNER_KIND" == "checkout-cli" ]]; then
    SCRIPT_CMD+=" node $(printf '%q' "$CHECKOUT_CLI") tui"
  else
    SCRIPT_CMD+=" $(printf '%q' "$RUNNER_PATH") tui"
  fi
  if [[ "$script_supports_return" -eq 1 ]]; then
    script -q -e -c "$SCRIPT_CMD" "$OUT"
  else
    script -q -c "$SCRIPT_CMD" "$OUT"
  fi
  CAPTURE_RC=$?
else
  # util-linux: file then -- command; BSD variants accept command argv after file.
  if [[ "$script_supports_return" -eq 1 ]]; then
    script -q -e "$OUT" -- "${INNER_CMD[@]}"
  else
    script -q "$OUT" -- "${INNER_CMD[@]}"
  fi
  CAPTURE_RC=$?
fi
set -e

if [[ ! -s "$OUT" ]]; then
  echo "error: capture produced empty output: $OUT (script_rc=$CAPTURE_RC)" >&2
  exit 1
fi

# Validate landing surface markers (ANSI-tolerant; resolve strip-ansi from orchestrator).
SURFACE_OK="$(
  (
    cd "$ORCH"
    node --input-type=module -e "
import fs from 'node:fs';
import stripAnsi from 'strip-ansi';
const plain = stripAnsi(fs.readFileSync(process.argv[1], 'utf8'));
const ok = /Start New Run/.test(plain) && /Overall:/.test(plain);
process.stdout.write(ok ? '1' : '0');
" "$OUT"
  ) 2>/dev/null || echo 0
)"

if [[ "$SURFACE_OK" != "1" ]]; then
  echo "error: capture surface missing required markers 'Start New Run' and/or 'Overall:' ($OUT)" >&2
  echo "error: runner_kind=$RUNNER_KIND runner_path=$RUNNER_PATH script_rc=$CAPTURE_RC" >&2
  exit 1
fi

# Accept only success (0) or timeout kill (124). Other non-zero = crash after paint.
if [[ "$CAPTURE_RC" -ne 0 && "$CAPTURE_RC" -ne 124 ]]; then
  echo "error: unexpected script_rc=$CAPTURE_RC (accept only 0 or 124); markers present but runner failed" >&2
  echo "error: runner_kind=$RUNNER_KIND runner_path=$RUNNER_PATH out=$OUT" >&2
  exit 1
fi

COMMAND_DISPLAY="${INNER_CMD[*]}"

# Sidecar metadata: runner provenance must be unambiguous (source tip ≠ installed runner).
META_COLS="$COLS" \
META_ROWS="$ROWS" \
META_OUT_TS="$OUT" \
META_SOURCE_TIP="$SOURCE_TIP" \
META_RUNNER_KIND="$RUNNER_KIND" \
META_RUNNER_PATH="$RUNNER_PATH" \
META_RUNNER_VERSION="$RUNNER_VERSION" \
META_INK="$INK" \
META_COMMAND="$COMMAND_DISPLAY" \
META_SCRIPT_RC="$CAPTURE_RC" \
META_OUT="$META_OUT" \
node -e "
const fs = require('fs');
const meta = {
  cols: Number(process.env.META_COLS),
  rows: Number(process.env.META_ROWS),
  out: process.env.META_OUT_TS,
  source_tip_sha: process.env.META_SOURCE_TIP,
  runner_kind: process.env.META_RUNNER_KIND,
  runner_path: process.env.META_RUNNER_PATH,
  runner_version: process.env.META_RUNNER_VERSION,
  ink_version: process.env.META_INK,
  command: process.env.META_COMMAND,
  script_rc: Number(process.env.META_SCRIPT_RC),
  note: 'Real PTY typescript; not Ink renderToString fixtures. source_tip_sha is clean checkout HEAD; runner_version is product CLI --version for both checkout and installed runners.',
};
fs.writeFileSync(process.env.META_OUT, JSON.stringify(meta, null, 2) + '\n');
"

echo "wrote=$OUT"
echo "meta=$META_OUT"
echo "cols=$COLS rows=$ROWS"
echo "source_tip_sha=$SOURCE_TIP"
echo "runner_kind=$RUNNER_KIND"
echo "runner_path=$RUNNER_PATH"
echo "runner_version=$RUNNER_VERSION"
echo "ink=$INK"
echo "script_rc=$CAPTURE_RC"
echo "note=real PTY typescript; inspect with 'cat -v' or scriptreplay if timing file present"
echo "not_claim=Ink renderToString fixtures under tests/fixtures/tui/landing/"
