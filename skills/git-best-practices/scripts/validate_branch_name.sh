#!/usr/bin/env bash
# Validates a git branch name against naming conventions.
# Usage: validate_branch_name.sh <branch-name>
# Exit 0 = valid, Exit 1 = invalid (prints reason to stderr)

set -euo pipefail

BRANCH="${1:-}"

if [[ -z "$BRANCH" ]]; then
  echo "Usage: validate_branch_name.sh <branch-name>" >&2
  exit 1
fi

# Protected branches — never work directly on these
PROTECTED="^(main|master|develop|staging|production)$"
if [[ "$BRANCH" =~ $PROTECTED ]]; then
  echo "ERROR: '$BRANCH' is a protected branch. Create a feature branch instead." >&2
  exit 1
fi

# Valid prefixes
VALID_PREFIX="^(feature|bugfix|hotfix|chore|docs|refactor|test|ci|release)/"
if [[ ! "$BRANCH" =~ $VALID_PREFIX ]]; then
  echo "ERROR: Branch '$BRANCH' must start with a valid prefix." >&2
  echo "Valid prefixes: feature/, bugfix/, hotfix/, chore/, docs/, refactor/, test/, ci/, release/" >&2
  exit 1
fi

# Check format: prefix/short-description (lowercase, hyphens, optional ticket ID)
VALID_FORMAT="^(feature|bugfix|hotfix|chore|docs|refactor|test|ci|release)/([A-Z]+-[0-9]+-)?[a-z0-9]+(-[a-z0-9]+)*$"
if [[ ! "$BRANCH" =~ $VALID_FORMAT ]]; then
  echo "ERROR: Branch '$BRANCH' has invalid format." >&2
  echo "Expected: <prefix>/<description> or <prefix>/<TICKET-123>-<description>" >&2
  echo "  - Description must be lowercase with hyphens" >&2
  echo "  - No trailing hyphens, no double hyphens" >&2
  echo "Examples:" >&2
  echo "  feature/add-user-auth" >&2
  echo "  bugfix/PROJ-42-fix-login" >&2
  echo "  chore/update-deps" >&2
  exit 1
fi

# Length check
if [[ ${#BRANCH} -gt 80 ]]; then
  echo "ERROR: Branch name too long (${#BRANCH} chars). Max 80 characters." >&2
  exit 1
fi

echo "OK: '$BRANCH' is a valid branch name."
exit 0
