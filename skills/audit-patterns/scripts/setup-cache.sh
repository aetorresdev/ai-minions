#!/usr/bin/env bash
# setup-cache.sh — Cache directory manager for audit-patterns skill
# Usage: setup-cache.sh <init|status|update|clear> [options]
set -euo pipefail

CACHE_DIR="${HOME}/.claude/audit-cache"
MANIFEST="${CACHE_DIR}/manifest.json"
SUBDIRS=("extracted" "patterns" "reports" "artifacts")

usage() {
  cat <<'EOF'
Usage: setup-cache.sh <command> [options]

Commands:
  init                              Create cache directories and manifest
  status                            Print cache state as JSON
  update --tier T --sessions-count N  Update manifest after a run
  clear                             Delete entire cache

Options (for update):
  --tier <0|1|2|3>        Tier level that was processed
  --sessions-count <N>    Number of sessions processed
EOF
  exit 1
}

cmd_init() {
  for dir in "${SUBDIRS[@]}"; do
    mkdir -p "${CACHE_DIR}/${dir}"
  done

  if [[ ! -f "$MANIFEST" ]]; then
    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    jq -n \
      --arg created "$now" \
      --arg updated "$now" \
      '{
        version: 1,
        created: $created,
        lastUpdated: $updated,
        runs: [],
        lastTier: null,
        totalRuns: 0
      }' > "$MANIFEST"
  fi

  echo '{"ok":true,"cacheDir":"'"$CACHE_DIR"'"}'
}

cmd_status() {
  if [[ ! -f "$MANIFEST" ]]; then
    jq -n '{initialized: false, cacheDir: "'"$CACHE_DIR"'"}'
    return
  fi

  local report_count extracted_count
  report_count=$(find "${CACHE_DIR}/reports" -type f 2>/dev/null | wc -l | tr -d ' ')
  extracted_count=$(find "${CACHE_DIR}/extracted" -type f 2>/dev/null | wc -l | tr -d ' ')

  jq \
    --argjson reports "$report_count" \
    --argjson extracted "$extracted_count" \
    '. + {initialized: true, cacheDir: "'"$CACHE_DIR"'", fileCount: {reports: $reports, extracted: $extracted}}' \
    "$MANIFEST"
}

cmd_update() {
  local tier="" sessions_count=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tier) tier="$2"; shift 2 ;;
      --sessions-count) sessions_count="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$tier" || -z "$sessions_count" ]]; then
    echo "Error: --tier and --sessions-count are required" >&2
    exit 1
  fi

  if [[ ! -f "$MANIFEST" ]]; then
    echo "Error: Cache not initialized. Run 'setup-cache.sh init' first." >&2
    exit 1
  fi

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  jq \
    --arg now "$now" \
    --argjson tier "$tier" \
    --argjson count "$sessions_count" \
    '.lastUpdated = $now |
     .lastTier = $tier |
     .totalRuns += 1 |
     .runs += [{timestamp: $now, tier: $tier, sessionsProcessed: $count}]' \
    "$MANIFEST" > "${MANIFEST}.tmp" && mv "${MANIFEST}.tmp" "$MANIFEST"

  echo '{"ok":true,"tier":'"$tier"',"sessionsProcessed":'"$sessions_count"'}'
}

cmd_clear() {
  if [[ -d "$CACHE_DIR" ]]; then
    rm -rf "$CACHE_DIR"
    echo '{"ok":true,"cleared":true}'
  else
    echo '{"ok":true,"cleared":false,"reason":"cache directory did not exist"}'
  fi
}

# --- Main ---
[[ $# -lt 1 ]] && usage

command="$1"
shift

case "$command" in
  init)   cmd_init ;;
  status) cmd_status ;;
  update) cmd_update "$@" ;;
  clear)  cmd_clear ;;
  *)      usage ;;
esac
