# Branch Naming Conventions

## Prefix Reference

| Prefix | Use When | Example |
|--------|----------|---------|
| `feature/` | Adding new functionality | `feature/add-user-auth` |
| `bugfix/` | Fixing a bug on develop/main | `bugfix/PROJ-42-fix-login` |
| `hotfix/` | Urgent production fix | `hotfix/fix-crash-on-startup` |
| `chore/` | Non-functional changes (deps, configs) | `chore/update-deps` |
| `docs/` | Documentation only | `docs/update-api-readme` |
| `refactor/` | Code restructuring, no behavior change | `refactor/extract-auth-module` |
| `test/` | Adding or fixing tests | `test/add-payment-tests` |
| `ci/` | CI/CD pipeline changes | `ci/add-lint-step` |
| `release/` | Release preparation | `release/v2.1.0` |

## Format Rules

```
<prefix>/<description>
<prefix>/<TICKET-ID>-<description>
```

- **Description**: lowercase, hyphen-separated, 2-5 words
- **Ticket ID** (optional): uppercase letters + hyphen + digits (e.g., `PROJ-42`)
- **Max length**: 80 characters total
- **No**: trailing hyphens, double hyphens, underscores, uppercase in description

## Selecting the Right Prefix

1. Does it add a capability the user didn't have before? -> `feature/`
2. Does it fix broken behavior? -> `bugfix/` (or `hotfix/` if production-critical)
3. Does it change code structure without changing behavior? -> `refactor/`
4. Does it only touch docs? -> `docs/`
5. Does it only touch tests? -> `test/`
6. Does it update dependencies, configs, or tooling? -> `chore/`
7. Does it change CI/CD? -> `ci/`

## Protected Branches

Never commit directly to: `main`, `master`, `develop`, `staging`, `production`.
Always create a feature branch and merge via PR.
