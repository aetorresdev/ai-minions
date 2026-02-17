---
name: reviewing-circleci
description: Review CircleCI configuration files for validity, optimization, security, and best practices. Use when the user asks to review, check, audit, validate, or optimize .circleci/config.yml files or CircleCI pipelines.
---

# CircleCI Config Review

Static analysis and best-practice review of `.circleci/config.yml` files. No API access required — all checks are performed locally against the config file.

## Prerequisites

No CLI tools or API access required. All checks are performed through manual file analysis.

> **Note**: The CircleCI CLI exists but requires an API token for `config validate` and `config process` (server-side validation). Since we have no API access, it is not used.

## Input

Expects a `.circleci/config.yml` file or directory containing one. Config may use CircleCI 2.1 features (orbs, commands, executors, pipelines).

### Multi-file / Dynamic Config Detection

CircleCI does NOT support native YAML includes. If the config is split across files, it uses one of these patterns:

| Pattern | How to detect | What to do |
|---|---|---|
| **Dynamic Config** | `setup: true` at top level + job using `continuation/continue` orb | Read the generated/continued config (usually `.circleci/continue_config.yml` or similar) |
| **Path filtering** | Uses `circleci/path-filtering` orb | Read the mapping config and each referenced config file |
| **Config packing** | Multiple YAML files in `.circleci/` merged by external tooling | Read all `.yml` files under `.circleci/` |
| **External scripts** | `run` steps call `.sh`, `Makefile`, `python` scripts | Read referenced scripts to understand actual build logic |

**Review process for multi-file configs:**

1. Start with `.circleci/config.yml` — identify if it uses `setup: true` or delegates to other files.
2. Use Glob to find all `.yml`/`.yaml` files under `.circleci/`.
3. Read every config file found — review each one with the same checks.
4. If `run` steps call external scripts, read those scripts to check for hardcoded secrets, missing error handling, or logic that should be in the config.
5. Report findings per file, with a combined summary at the end.

## Before Reviewing

1. Glob for all `.yml`/`.yaml` files under `.circleci/`.
2. Read `.circleci/config.yml` first. Check for `setup: true` or multi-file patterns (see Input section).
3. If multi-file, read all referenced config files and external scripts.
4. For detailed patterns and anti-patterns, see [reference.md](reference.md).

## Agents

This skill uses 3 subagents that run **in parallel** with clearly separated responsibilities. No checks are duplicated between agents.

Each agent is defined as a subagent file in `~/.cursor/agents/`:

| Agent | File | Scope |
|---|---|---|
| `circleci-structural-validator` | `~/.cursor/agents/circleci-structural-validator.md` | Config correctness: YAML, keys, references, orbs, images, naming, DRY |
| `circleci-optimizer` | `~/.cursor/agents/circleci-optimizer.md` | Performance and cost: caching, parallelism, resource classes, workflow graph, timeouts |
| `circleci-security-reviewer` | `~/.cursor/agents/circleci-security-reviewer.md` | Security: secrets, OIDC, Docker, branch protection, approval gates, token handling, injection |

All three agents share access to [reference.md](reference.md) for detailed patterns and anti-patterns.

## Output Format

Each agent reports independently, then results are combined. Use colored indicators for severity:

- **Critical**: 🔴 (blocks pipeline correctness or security)
- **Warnings**: 🟠 (optimization or best-practice issue)
- **Passed**: 🟢 (correctly implemented)

```
## Review: .circleci/config.yml

### 🟢 Structural Validation (structural-validator)
🟢 What's correct
🔴 Issue (if any)
    Location: ...
    Fix: ...

### 🟠 Optimization (optimizer)
🟠 Issue description
    Location: job `job_name` or workflow `workflow_name`
    Fix: How to fix
🟢 What's correct

### 🔴 Security (security-reviewer)
🔴 Issue description
    Location: job `job_name`, step N
    Fix: How to fix
🟢 What's correct

---
Summary: 🔴 X critical, 🟠 Y warnings, 🟢 Z passed
```

## Rules

- Be specific — include the job name, step, or workflow where the issue is found.
- Be actionable — show the fix with a config snippet, not just the problem.
- If no issues found, confirm with a clean report.
- Do NOT suggest features that require CircleCI API access or paid-only features without noting it.
- When suggesting orbs, verify the orb name is real (e.g., `circleci/node`, `circleci/aws-cli`).
- Do NOT flag patterns that are intentional trade-offs (e.g., no cache on ephemeral jobs).
- Do NOT flag `-auto-approve` on `terraform apply` in CI — it is expected behavior.
- Do NOT duplicate checks between agents — each agent owns its scope exclusively.
- DO flag legacy patterns (static AWS keys, deprecated images, `version: 2`) as 🟠 with upgrade guidance.
