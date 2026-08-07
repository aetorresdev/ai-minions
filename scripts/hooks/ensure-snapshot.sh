#!/usr/bin/env bash
set -euo pipefail

# Normal Claude/Cursor sessions must not bootstrap orchestrator snapshots.
if [[ "${AI_MINIONS_ACTIVE:-}" != "1" ]]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/state"
SNAPSHOT_FILE="$STATE_DIR/project_state.md"

mkdir -p "$STATE_DIR"

INPUT="$(cat || true)"

# Evita loop infinito del Stop hook
if command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")"
else
  STOP_ACTIVE="false"
fi

if [[ "$STOP_ACTIVE" == "true" ]]; then
  exit 0
fi

create_snapshot_template() {
  cat > "$SNAPSHOT_FILE" <<'EOF'
# PROJECT STATE SNAPSHOT

## Goal
[Describe the current main objective]

## Current status
[What is already done, in progress, and not started]

## Decisions made
- [Decision] -> [Reason]

## Constraints
- [Technical / business / provider constraint]

## Files touched
- [path/to/file]

## Pending tasks
- [ ] [Pending item]

## Risks / open issues
- [Risk or unresolved issue]

## Exact next step
[Single next concrete action]

## Resume prompt for another LLM/provider
Continue from `state/project_state.md` (repo root).
Read it first, trust it over chat memory, then execute the Exact next step.
Do not assume unstated context.
EOF
}

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  create_snapshot_template
  echo "SNAPSHOT_BOOTSTRAP: template created at state/project_state.md (expected on first run)" >&2
  echo "Update state/project_state.md before your next stop hook." >&2
  exit 0
fi

required_sections=(
  "## Goal"
  "## Current status"
  "## Decisions made"
  "## Constraints"
  "## Files touched"
  "## Pending tasks"
  "## Risks / open issues"
  "## Exact next step"
  "## Resume prompt for another LLM/provider"
)

missing=()
for section in "${required_sections[@]}"; do
  if ! grep -Fq "$section" "$SNAPSHOT_FILE"; then
    missing+=("$section")
  fi
done

if (( ${#missing[@]} > 0 )); then
  {
    echo "Snapshot is incomplete: missing sections:"
    for s in "${missing[@]}"; do
      echo " - $s"
    done
    echo "Update state/project_state.md before stopping."
  } >&2
  exit 2
fi

# Validación ligera para evitar snapshot vacío de adorno
if grep -Eq '^\[Describe the current main objective\]$|^\[Single next concrete action\]$' "$SNAPSHOT_FILE"; then
  echo "SNAPSHOT_WARN: placeholder text remains in state/project_state.md — update before relying on snapshot." >&2
  echo "Remediation: fill Goal, Current status, and Exact next step in state/project_state.md" >&2
  exit 0
fi

exit 0