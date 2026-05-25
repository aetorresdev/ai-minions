# Workflow skill contract

Local **workflow skills** under `skills/<name>/SKILL.md` are instruction surfaces for the model — not executable code, not permission policy, not a marketplace catalog.

## Principles

1. **Bounded instructions** — skills describe when and how to help; they do not replace harness gates.
2. **Gates stay canonical** — `evaluatePermission`, MODE protocol, `requires_approval`, CERBERUS review, and MCP permission gates remain authoritative.
3. **No external authority** — third-party skill repos are comparison only; this repo does not claim compatibility with external marketplaces or “standards.”
4. **Operator-visible** — each skill must declare purpose, inputs, outputs, risks, and out-of-scope behavior in plain language.

## Required frontmatter

```yaml
---
name: skill-id-kebab-case
description: "One line: what it does and when to invoke (max ~200 chars for discovery)."
---
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Stable id; matches directory name under `skills/` |
| `description` | yes | Trigger text for discovery; include concrete paths/commands when helpful |

Optional frontmatter (document if used): `license`, `compatibility` — never imply runtime enforcement.

## Required body sections

Use these headings (order flexible; all must exist):

| Section | Content |
|---------|---------|
| **Purpose** | One short paragraph — problem the skill solves |
| **When to invoke** | Bullets: user phrases, artifacts, or run phases |
| **Inputs** | What the operator/model must have (paths, env, task id, trace dir) |
| **Outputs** | Commands, files, or reports produced; no vague “helps you” |
| **Risks** | Misuse, cost, secret leakage, wrong trace dir, degraded mode |
| **Out of scope** | What the skill must not claim (permissions, auto-approve, marketplace) |

## Role ↔ skill loading (documentation only)

| Orchestrator phase | Typical skills | Constraint |
|--------------------|----------------|------------|
| Operator / post-run | token report, audit patterns | Read-only; no gate bypass |
| DEV / implementation | terraform, circleci, docker review | Instructions only; shell still gated |
| Docs / proposals | proposal-*, feature-spec | No runtime mutation claims |
| CERBERUS / QA | (none by default) | Review via role contract, not skill text |

Runtime skill router and allowlist are future work; until then skills are loaded by IDE/agent discovery — treat text as untrusted input (see [security-posture.md](security-posture.md) gaps — skills threat model planned).

## Conformance checklist

Before merging a new or updated skill:

- [ ] Frontmatter `name` + `description` present
- [ ] All six body sections present
- [ ] No claim that skill text grants permissions or replaces CERBERUS
- [ ] Paths point at repo-root-relative or documented env vars (e.g. trace dir)
- [ ] References orchestrator docs/contracts by **filename**, not backlog ticket ids

## Reference skill: `orchestrator-token-report`

**Status: conformant** (doc-only alignment with this contract).

| Requirement | Status |
|-------------|--------|
| Frontmatter | ok — `name`, `description` |
| Purpose | ok — trace metrics / MCP summaries |
| When to invoke | ok — implied in description + CLI sections |
| Inputs | ok — `task_id`, trace paths, env |
| Outputs | ok — CLI tables, JSON export |
| Risks | ok — gaps section (Claude routes, USD estimates) |
| Out of scope | ok — no permission bypass claimed |

**Gaps (non-blocking):** explicit **Purpose** / **When to invoke** headings added in skill file for template parity; no runtime registry entry yet.

## Related

- [skill-security-threatmodel.md](skill-security-threatmodel.md) — skills as attack surface; threat → control → gap
- [agent-contract.md](agent-contract.md) — MODE and role contracts
- [shared-dependencies.md](shared-dependencies.md) — `skills/` layout
