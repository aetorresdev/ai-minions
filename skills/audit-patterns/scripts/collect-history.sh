#!/usr/bin/env bash
# collect-history.sh — Tier 1 history collector for audit-patterns skill
# Parses history.jsonl + session-names.jsonl → single JSON to stdout
# Usage: collect-history.sh [--since DATE] [--project NAME]
set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
HISTORY_FILE="${CLAUDE_DIR}/history.jsonl"
NAMES_FILE="${CLAUDE_DIR}/session-names.jsonl"

since_filter=""
project_filter=""

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) since_filter="$2"; shift 2 ;;
    --project) project_filter="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Resolve relative dates to epoch-ms for history.jsonl timestamps ---
resolve_since_epoch_ms() {
  local input="$1"

  if [[ "$input" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    # ISO date → epoch seconds → ms
    date -jf "%Y-%m-%dT%H:%M:%SZ" "$input" +%s 2>/dev/null | awk '{print $1 * 1000}' && return
    date -jf "%Y-%m-%d" "$input" +%s 2>/dev/null | awk '{print $1 * 1000}' && return
    echo "0"
    return
  fi

  local num unit macflag
  num=$(echo "$input" | sed 's/[^0-9]//g')
  unit=$(echo "$input" | sed 's/[0-9]//g')

  case "$unit" in
    d) macflag="-${num}d" ;;
    w) macflag="-$((num * 7))d" ;;
    m) macflag="-${num}m" ;;
    y) macflag="-${num}y" ;;
    *) echo "0"; return ;;
  esac

  date -v"$macflag" +%s | awk '{print $1 * 1000}'
}

resolve_since_iso() {
  local input="$1"

  if [[ "$input" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    echo "$input"
    return
  fi

  local num unit macflag
  num=$(echo "$input" | sed 's/[^0-9]//g')
  unit=$(echo "$input" | sed 's/[0-9]//g')

  case "$unit" in
    d) macflag="-${num}d" ;;
    w) macflag="-$((num * 7))d" ;;
    m) macflag="-${num}m" ;;
    y) macflag="-${num}y" ;;
    *) echo "1970-01-01"; return ;;
  esac

  date -v"$macflag" -u +"%Y-%m-%dT%H:%M:%SZ"
}

since_epoch_ms=""
since_iso=""
if [[ -n "$since_filter" ]]; then
  since_epoch_ms=$(resolve_since_epoch_ms "$since_filter")
  since_iso=$(resolve_since_iso "$since_filter")
fi

# --- Collect history.jsonl data ---
collect_history() {
  if [[ ! -f "$HISTORY_FILE" ]]; then
    jq -n '{available: false, totalEntries: 0, commands: [], perProject: []}'
    return
  fi

  local filter_expr='.'

  # Build jq filter pipeline
  if [[ -n "$since_epoch_ms" ]] && [[ "$since_epoch_ms" != "0" ]]; then
    filter_expr="select(.timestamp >= $since_epoch_ms)"
  fi

  if [[ -n "$project_filter" ]]; then
    filter_expr="${filter_expr} | select(.project // \"\" | test(\"${project_filter}\"; \"i\"))"
  fi

  # Process all entries through jq in one pass
  jq -s --arg filter_expr "$filter_expr" '
    # Apply filters
    [.[] | '"$filter_expr"'] |

    # Total count
    length as $total |

    # Group by command (display field)
    group_by(.display) |
    map({
      command: .[0].display,
      count: length,
      sessions: ([.[].sessionId] | unique | length),
      projects: ([.[].project // "unknown" | split("/") | last] | unique),
      lastUsed: ([.[].timestamp] | max)
    }) |
    sort_by(-.count) as $commands |

    # Per-project breakdown
    [$commands[] | .projects[]] | unique | map(. as $proj |
      {
        project: $proj,
        commandCount: ([$commands[] | select(.projects | index($proj))] | length),
        totalUses: ([$commands[] | select(.projects | index($proj)) | .count] | add // 0)
      }
    ) | sort_by(-.totalUses) as $perProject |

    {
      available: true,
      totalEntries: $total,
      uniqueCommands: ($commands | length),
      commands: ($commands | [limit(50; .[])]),
      perProject: $perProject
    }
  ' "$HISTORY_FILE"
}

# --- Collect session-names.jsonl data ---
collect_names() {
  if [[ ! -f "$NAMES_FILE" ]]; then
    jq -n '{available: false, totalNames: 0, patterns: [], coverage: null}'
    return
  fi

  local filter_expr='.'

  if [[ -n "$since_iso" ]] && [[ "$since_iso" != "1970-01-01" ]]; then
    filter_expr="select(.timestamp >= \"$since_iso\")"
  fi

  if [[ -n "$project_filter" ]]; then
    filter_expr="${filter_expr} | select(.cwd // \"\" | test(\"${project_filter}\"; \"i\"))"
  fi

  jq -s '
    [.[] | '"$filter_expr"'] |

    . as $filtered |
    length as $total |

    # Extract naming patterns (project:topic format)
    [$filtered[].name] |
    map(
      if test(":") then
        split(":") | {project: .[0], topic: .[1]}
      else
        {project: "unstructured", topic: .}
      end
    ) as $parsed |

    # Count by project prefix
    [$parsed[].project] | group_by(.) | map({
      prefix: .[0],
      count: length
    }) | sort_by(-.count) as $byPrefix |

    # Count renames (entries with non-null previous_name)
    [$filtered[] | select(.previous_name != null)] | length as $renames |

    {
      available: true,
      totalNames: $total,
      uniquePrefixes: ($byPrefix | length),
      renames: $renames,
      byPrefix: $byPrefix,
      names: [$filtered[] | {name, session_id, timestamp, project_dir}]
    }
  ' "$NAMES_FILE"
}

# --- Main output ---
history=$(collect_history)
names=$(collect_names)

jq -n \
  --arg collected "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg since "${since_iso:-all}" \
  --arg project "${project_filter:-all}" \
  --argjson history "$history" \
  --argjson names "$names" \
  '{
    tier: 1,
    collectedAt: $collected,
    filters: {since: $since, project: $project},
    history: $history,
    sessionNames: $names
  }'
