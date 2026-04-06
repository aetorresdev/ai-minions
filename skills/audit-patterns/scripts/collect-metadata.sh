#!/usr/bin/env bash
# collect-metadata.sh — Tier 0 metadata collector for audit-patterns skill
# Merges sessions-index.json files + stats-cache.json → single JSON to stdout
# Usage: collect-metadata.sh [--since DATE] [--project NAME]
set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
PROJECTS_DIR="${CLAUDE_DIR}/projects"
STATS_FILE="${CLAUDE_DIR}/stats-cache.json"

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

# --- Resolve relative dates (7d, 30d, 1w, 3m, 1y) to ISO date ---
resolve_since() {
  local input="$1"

  # Already ISO date
  if [[ "$input" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    echo "$input"
    return
  fi

  # Relative: Nd, Nw, Nm, Ny
  local num unit macflag
  num=$(echo "$input" | sed 's/[^0-9]//g')
  unit=$(echo "$input" | sed 's/[0-9]//g')

  case "$unit" in
    d) macflag="-${num}d" ;;
    w) macflag="-$((num * 7))d" ;;
    m) macflag="-${num}m" ;;
    y) macflag="-${num}y" ;;
    *) echo "Unknown date unit: $unit" >&2; exit 1 ;;
  esac

  date -v"$macflag" -u +"%Y-%m-%dT%H:%M:%SZ"
}

since_iso=""
if [[ -n "$since_filter" ]]; then
  since_iso=$(resolve_since "$since_filter")
fi

# --- Collect per-project session data ---
collect_sessions() {
  local all_projects='[]'

  if [[ ! -d "$PROJECTS_DIR" ]]; then
    echo "$all_projects"
    return
  fi

  for index_file in "${PROJECTS_DIR}"/*/sessions-index.json; do
    [[ -f "$index_file" ]] || continue

    local project_name
    project_name=$(jq -r '.originalPath // empty' "$index_file" 2>/dev/null | xargs basename 2>/dev/null || echo "unknown")

    # Apply project filter
    if [[ -n "$project_filter" ]] && [[ "$project_name" != *"$project_filter"* ]]; then
      continue
    fi

    local entries
    entries=$(jq '.entries // []' "$index_file" 2>/dev/null || echo '[]')

    # Apply date filter
    if [[ -n "$since_iso" ]]; then
      entries=$(echo "$entries" | jq --arg since "$since_iso" '[.[] | select(.created >= $since)]')
    fi

    local session_count first_session last_session branches
    session_count=$(echo "$entries" | jq 'length')
    first_session=$(echo "$entries" | jq -r 'if length == 0 then "" else [.[].created] | sort | first end')
    last_session=$(echo "$entries" | jq -r 'if length == 0 then "" else [.[] | (.modified // .created)] | sort | last end')
    branches=$(echo "$entries" | jq 'if length == 0 then [] else [.[].gitBranch // "unknown"] | unique end')

    # Build per-project summary
    local project_summary
    project_summary=$(jq -n \
      --arg name "$project_name" \
      --arg path "$(jq -r '.originalPath // empty' "$index_file")" \
      --argjson count "$session_count" \
      --arg first "$first_session" \
      --arg last "$last_session" \
      --argjson branches "$branches" \
      '{
        project: $name,
        projectPath: $path,
        sessionCount: $count,
        firstSession: $first,
        lastSession: $last,
        branches: $branches
      }')

    all_projects=$(echo "$all_projects" | jq --argjson p "$project_summary" '. + [$p]')
  done

  echo "$all_projects"
}

# --- Collect individual session entries ---
collect_sessions_detail() {
  local all_sessions='[]'

  if [[ ! -d "$PROJECTS_DIR" ]]; then
    echo "$all_sessions"
    return
  fi

  for index_file in "${PROJECTS_DIR}"/*/sessions-index.json; do
    [[ -f "$index_file" ]] || continue

    local project_name
    project_name=$(jq -r '.originalPath // empty' "$index_file" 2>/dev/null | xargs basename 2>/dev/null || echo "unknown")

    if [[ -n "$project_filter" ]] && [[ "$project_name" != *"$project_filter"* ]]; then
      continue
    fi

    local entries
    entries=$(jq '.entries // []' "$index_file" 2>/dev/null || echo '[]')

    if [[ -n "$since_iso" ]]; then
      entries=$(echo "$entries" | jq --arg since "$since_iso" '[.[] | select(.created >= $since)]')
    fi

    # Add project name to each session and pick key fields
    entries=$(echo "$entries" | jq --arg proj "$project_name" '
      [.[] | {
        sessionId,
        project: $proj,
        firstPrompt: (.firstPrompt // null),
        summary: (.summary // null),
        messageCount: (.messageCount // 0),
        created,
        modified: (.modified // .created),
        gitBranch: (.gitBranch // null),
        isSidechain: (.isSidechain // false)
      }]')

    all_sessions=$(echo "$all_sessions" | jq --argjson s "$entries" '. + $s')
  done

  echo "$all_sessions"
}

# --- Collect stats-cache data ---
collect_stats() {
  if [[ ! -f "$STATS_FILE" ]]; then
    jq -n '{available: false}'
    return
  fi

  local stats
  stats=$(cat "$STATS_FILE")

  # Apply date filter to daily arrays
  if [[ -n "$since_iso" ]]; then
    local since_date
    since_date=$(echo "$since_iso" | cut -c1-10)

    stats=$(echo "$stats" | jq --arg since "$since_date" '
      .dailyActivity = [.dailyActivity[]? | select(.date >= $since)] |
      .dailyModelTokens = [.dailyModelTokens[]? | select(.date >= $since)]
    ')
  fi

  echo "$stats" | jq '{
    available: true,
    totalSessions: (.totalSessions // 0),
    totalMessages: (.totalMessages // 0),
    firstSessionDate: (.firstSessionDate // null),
    longestSession: (.longestSession // null),
    dailyActivity: (.dailyActivity // []),
    dailyModelTokens: (.dailyModelTokens // []),
    modelUsage: (.modelUsage // {}),
    hourCounts: (.hourCounts // {})
  }'
}

# --- Main output ---
per_project=$(collect_sessions)
per_session=$(collect_sessions_detail)
stats=$(collect_stats)

jq -n \
  --arg collected "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg since "${since_iso:-all}" \
  --arg project "${project_filter:-all}" \
  --argjson perProject "$per_project" \
  --argjson perSession "$per_session" \
  --argjson stats "$stats" \
  '{
    tier: 0,
    collectedAt: $collected,
    filters: {since: $since, project: $project},
    sessions: {
      perProject: $perProject,
      perSession: $perSession,
      totalProjects: ($perProject | length),
      totalSessions: ($perSession | length)
    },
    stats: $stats
  }'
