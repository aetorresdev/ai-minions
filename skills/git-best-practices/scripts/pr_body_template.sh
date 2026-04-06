#!/usr/bin/env bash
# Generate a PR body template from the current branch's commits.
# Usage: pr_body_template.sh [base-branch]
# Outputs markdown-formatted PR body to stdout.

set -euo pipefail

BASE="${1:-main}"
CURRENT=$(git branch --show-current)

if [[ "$CURRENT" == "$BASE" ]]; then
  echo "ERROR: Already on $BASE. Switch to a feature branch first." >&2
  exit 1
fi

# Gather commit info
COMMITS=$(git log "$BASE".."$CURRENT" --oneline --no-merges 2>/dev/null || echo "")
COMMIT_COUNT=$(echo "$COMMITS" | grep -c . 2>/dev/null || echo "0")
FILES_CHANGED=$(git diff --name-only "$BASE"..."$CURRENT" 2>/dev/null || echo "")
FILE_COUNT=$(echo "$FILES_CHANGED" | grep -c . 2>/dev/null || echo "0")

# Detect ticket ID from branch name
TICKET=""
if [[ "$CURRENT" =~ /([A-Z]+-[0-9]+)- ]]; then
  TICKET="${BASH_REMATCH[1]}"
fi

cat <<EOF
## Summary

<!-- Describe what this PR does and why -->

${TICKET:+**Ticket:** $TICKET}

## Changes

$COMMIT_COUNT commit(s) across $FILE_COUNT file(s):

$(echo "$FILES_CHANGED" | sed 's/^/- /')

## Test Plan

<!-- How was this tested? -->
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] No regressions observed

## Checklist

- [ ] Branch is up to date with $BASE
- [ ] No merge conflicts
- [ ] Commit messages follow conventions
- [ ] Self-reviewed the diff
EOF
