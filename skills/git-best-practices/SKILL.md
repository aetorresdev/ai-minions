---
name: git-best-practices
description: "Branch naming conventions, PR workflow, and merge strategy enforcement for Claude agents executing git operations. Use when: (1) Creating or switching branches, (2) Opening or formatting pull requests, (3) Merging branches, (4) Any git workflow that involves branching or PRs. Complements commit-commands by providing the conventions and procedures those commands should follow."
---

# Git Best Practices

Branch & PR workflow conventions for Claude agents. Follow these procedures when executing git operations involving branches or pull requests.

## Branch Workflow

### Creating a Branch

1. Determine the correct prefix from the task type (see `references/branch-conventions.md` for full table):
   - New functionality -> `feature/`
   - Bug fix -> `bugfix/` (or `hotfix/` if production-critical)
   - Code restructuring -> `refactor/`
   - Docs only -> `docs/`
   - Tests only -> `test/`
   - Dependencies/configs -> `chore/`
   - CI/CD -> `ci/`

2. Format: `<prefix>/<description>` or `<prefix>/<TICKET-ID>-<description>`
   - Description: lowercase, hyphen-separated, 2-5 words
   - Max 80 characters total

3. Validate before creating:
   ```bash
   bash scripts/validate_branch_name.sh "feature/add-user-auth"
   ```

4. Create and push:
   ```bash
   git checkout -b feature/add-user-auth
   git push -u origin feature/add-user-auth
   ```

### Protected Branches

Never commit directly to `main`, `master`, `develop`, `staging`, or `production`. Always branch and merge via PR.

## Pull Request Workflow

### Before Opening

1. Rebase on latest base branch:
   ```bash
   git fetch origin && git rebase origin/main
   ```
2. Resolve conflicts if any
3. Self-review the diff: `git diff origin/main...HEAD`
4. Verify no secrets, debug code, or commented-out code in the diff

### Creating a PR

- **Title**: Under 70 chars, imperative mood, include ticket ID if available
- **Body**: Use `scripts/pr_body_template.sh` to generate a starting template, then fill in the Summary and Test Plan sections

For detailed PR body structure and review checklists, see `references/pr-guidelines.md`.

### Merge Strategy

| Branch type | Default strategy |
|-------------|-----------------|
| `feature/`, `bugfix/`, `chore/` | Squash merge |
| `release/`, `hotfix/` | Merge commit |

Use rebase only when commit history is already clean and linear history is desired.

## Quick Reference

| Action | Command |
|--------|---------|
| Validate branch name | `bash scripts/validate_branch_name.sh <name>` |
| Generate PR body | `bash scripts/pr_body_template.sh [base-branch]` |
| Detailed branch rules | Read `references/branch-conventions.md` |
| Detailed PR rules | Read `references/pr-guidelines.md` |
