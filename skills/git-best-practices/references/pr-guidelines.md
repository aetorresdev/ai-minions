# Pull Request Guidelines

## PR Title

- Under 70 characters
- Imperative mood: "Add auth middleware" not "Added auth middleware"
- Include ticket ID if available: `[PROJ-42] Fix login redirect`
- No periods at the end

## PR Size

| Size | Files | Guidance |
|------|-------|----------|
| Small | 1-5 | Ideal. Easy to review. |
| Medium | 6-15 | Acceptable. Consider splitting if unrelated changes. |
| Large | 16+ | Split into smaller PRs when possible. |

If a PR exceeds 15 files, check whether it contains logically separable changes that could be independent PRs.

## PR Body Structure

```markdown
## Summary
1-3 bullet points explaining what and why.

## Test Plan
- How was this tested?
- What scenarios were verified?
```

Use `scripts/pr_body_template.sh` to auto-generate a starting template.

## Merge Strategy

| Strategy | When to Use |
|----------|-------------|
| **Squash merge** | Feature branches with messy commit history. Produces one clean commit on main. |
| **Merge commit** | When individual commit history matters (e.g., release branches). |
| **Rebase** | When you want a linear history and commits are already clean. |

**Default**: Squash merge for feature/bugfix branches.

## Before Opening a PR

1. Rebase on latest base branch: `git fetch origin && git rebase origin/main`
2. Resolve any conflicts
3. Run tests locally
4. Self-review the diff: `git diff origin/main...HEAD`
5. Verify branch name follows conventions (run `scripts/validate_branch_name.sh`)

## Review Checklist

Before requesting review, verify:
- [ ] PR title is concise and descriptive
- [ ] PR body explains the "why"
- [ ] No unrelated changes included
- [ ] No debug code, TODOs, or commented-out code
- [ ] No secrets, credentials, or .env files
- [ ] Tests pass
- [ ] Branch is up to date with base
