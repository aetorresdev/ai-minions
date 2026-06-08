# Production Boundary Guard

**Location:** `docs/orchestrator/production-boundary-guard.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Canonical security model** for production trust boundaries in ai-minions. Enforcement wiring lives in follow-on tickets; this document is the **SoT** for vocabulary, default posture, evidence, and CERBERUS rejection rules.

**Related (normative detail elsewhere):**

- [security-posture.md](security-posture.md) — public threat narrative
- [runtime-permission-contract.md](runtime-permission-contract.md) — tool/shell/MCP/network gates
- [governance-gates-contract.md](governance-gates-contract.md) — human approval trace semantics
- [review-record-contract.md](review-record-contract.md) — CERBERUS `review_record` outcomes
- [MERGE-GOVERNANCE spec](../backlog-open-specs.md#merge-governance-1--pr-boundary-governance) — PR-boundary **enforcement** (depends on this doc)

**Implementation status:** **Design contract (doc-first, v0.7 M0).** Trace event `production_boundary_check` is **specified here**; runner emission and GitHub posture discovery are **not shipped** until PR-boundary governance slices land.

---

## Public framing

> ai-minions uses a **Production Boundary Guard** with **`agent_as_contributor`** as the default operating mode.

Agents are **contributors**, not **production release authorities**. The harness prepares auditable work; humans (or explicitly governed release workflows) own merge, tag, and release promotion.

---

## Default mode: `agent_as_contributor`

| Property | Meaning |
|----------|---------|
| **Mode id** | `agent_as_contributor` |
| **Authority class** | Prepare branch/PR work, run validation, attach evidence, request human review |
| **Out of default authority** | Merge to protected branches · push to protected branches · create production tags · publish production releases |
| **Exception path** | Only with **explicit exceptional policy** + CERBERUS approval — **not** alpha default |

**Safe default flow:**

```text
agent implements → creates branch → opens/updates PR → attaches evidence
  → requests human review → human merges → human tags/releases (or release-gated workflow)
```

---

## Security model (formalized)

| Concept | Application in ai-minions |
|---------|-------------------------|
| **Least privilege** | Agent PAT and harness policy: branch/PR/validation only — not merge/tag/release by default |
| **Separation of duties** | Agent prepares; distinct human (or governed workflow) approves production promotion |
| **Policy enforcement point** | GitHub branch protection / rulesets **plus** harness governance gate (when wired) |
| **Deny by default** | Undiscoverable protection or token capabilities → **fail closed** — no merge-safety claim |
| **Change management gate** | Production-sensitive promotion requires human approval + recorded evidence |
| **Privileged operation boundary** | Merge-to-prod · production tag · production release |

---

## Trust boundary (high level)

```text
Human maintainer / release workflow
        |
        |  merge · tag · release (privileged)
        v
GitHub protected branches / rulesets / CODEOWNERS
        ^
        |  PR + evidence (contributor lane)
        |
Agent (agent_as_contributor) + ai-minions harness
        |
        +-- capability controls (PAT scope, gates, traces)
        +-- prompt instructions alone do NOT define this boundary
```

---

## Allowed vs denied agent actions (default)

| Action | Default |
|--------|---------|
| Create working branch | **Allowed** |
| Commit / push to own (non-protected) branch | **Allowed** |
| Create / update pull request | **Allowed** |
| Run validations (tests, lint, scans) | **Allowed** |
| Attach evidence to PR / CERBERUS brief | **Allowed** |
| Recommend merge (narrative only) | **Allowed** |
| Request human approval | **Allowed** |
| Merge into protected branch | **Denied** |
| Push to protected branch | **Denied** |
| Create production tag | **Denied** |
| Publish production release | **Denied** |
| Bypass required status checks | **Denied** |
| Bypass required reviews / CODEOWNERS | **Denied** |
| Claim merge/tag/release is safe without inspectable evidence | **Denied** |

---

## Prompt instructions are not a security boundary

Instructions in `CLAUDE.md`, skills, or session prompts **do not** constitute enforcement.

**Capability controls** must work together:

- Limited PAT / token scope (GitHub or host)
- Protected branches and rulesets
- Required status checks and reviewers
- CODEOWNERS and required review rules
- Harness governance gate + trace evidence (when implemented)
- CERBERUS claim review

**CERBERUS must reject** any claim that agents can safely cross production boundaries **based on instructions alone**.

---

## PAT / token restrictions — necessary but not sufficient

A **limited PAT** (no merge to protected branches, no admin scopes) is **necessary** but **not sufficient** as the complete governance model.

| Why necessary | Why insufficient alone |
|---------------|------------------------|
| Reduces blast radius when misconfigured | Does not prove branch protection exists |
| Aligns with least privilege | Does not replace required reviews / CODEOWNERS |
| Prevents some accidental privileged API calls | Visibility may be partial — harness must fail closed |
| | Token class alone does not validate target branch posture |

**CERBERUS must reject** PRs or docs that present **limited-PAT-only** as a complete production governance story.

---

## GitHub enforcement points (repository side)

Operators should configure **real** enforcement on the host — ai-minions records and gates **claims**, not GitHub policy:

| Mechanism | Role |
|-----------|------|
| **Branch protection** | Blocks direct push/merge without checks/reviews |
| **Rulesets** | Org/repo policy layering beyond legacy branch rules |
| **Required status checks** | CI and other gates before merge |
| **Required reviewers** | Human review before merge |
| **CODEOWNERS** | Ownership-based review paths |

Production-sensitive branches include **default branch**, **release branches**, and any branch that **feeds production tags or releases** — even when not the repository default.

---

## Fail-closed behavior

When branch protection, rulesets, or actor/token capabilities **cannot be inspected**:

| Field / outcome | Value |
|-----------------|-------|
| `permission_visibility` | `limited` or `unknown` |
| `decision` | `requires_manual_policy_input` or `require_human` |
| Merge-safety narrative | **Must not** be claimed |

ai-minions may still **create or update the PR** and attach validation evidence. Final merge, tag, and release remain **human-controlled**.

**Rule:** Unknown permissions → prepare work, **do not** claim the production boundary is safe to cross.

---

## Four-layer enforcement model

| Layer | Owner | Role |
|-------|-------|------|
| Branch protection / rulesets | GitHub (or host) | Hard enforcement on branch/tag |
| Limited PAT / actor credentials | GitHub auth | Least privilege |
| ai-minions governance gate | ai-minions | Discover (when allowed), record evidence, block false claims |
| CERBERUS | ai-minions review lane | Validate evidence; reject overclaims |
| Human maintainer | Operator | Final merge · tag · release |

Layers are **complementary**. Removing GitHub protection while keeping a limited PAT does **not** restore a production boundary.

---

## Trace event: `production_boundary_check` (design contract)

**Status:** Specified here; **not emitted** by the runner until PR-boundary governance implementation.

**Purpose:** Replayable record that the harness evaluated (or attempted to evaluate) production-boundary posture for a governed PR or release-sensitive action — without conflating **ready for human review** with **agent may merge**.

### Minimum fields

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"production_boundary_check"` | |
| `check_schema_version` | `"1"` | |
| `mode` | `"agent_as_contributor"` | Default unless exceptional policy documented |
| `repository` | string | `owner/repo` when known |
| `pr_number` | integer \| null | When PR-scoped |
| `source_branch` | string \| null | |
| `target_branch` | string \| null | |
| `default_branch` | string \| null | Detected or config fallback |
| `protected_status` | `"known"` \| `"unknown"` \| `"not_protected"` | Target branch |
| `rulesets_visible` | boolean | Whether ruleset metadata was readable |
| `required_checks_visible` | boolean | |
| `required_reviews_visible` | boolean | |
| `actor_class` | string | e.g. `agent_pat`, `human`, `unknown` |
| `permission_visibility` | `"full"` \| `"limited"` \| `"unknown"` | |
| `direct_merge_allowed` | boolean \| null | `null` when not inspectable |
| `direct_push_protected_allowed` | boolean \| null | |
| `tag_create_allowed` | boolean \| null | |
| `release_publish_allowed` | boolean \| null | |
| `decision` | enum | See below |
| `reason_code` | string \| null | Stable machine code when `blocked` |
| `evidence_refs` | string[] | PR URL, check logs, config path — no secrets |

### `decision` enum (default contributor lane)

| Value | Meaning |
|-------|---------|
| `ready_for_human_review` | Evidence attached; **human** may review — **not** agent merge authority |
| `blocked` | Harness blocks progression or rejects unsafe claim |
| `requires_manual_policy_input` | Operator must supply policy / visibility — fail closed |

**Prohibited default workflow states** (narrative alignment with enforcement ticket):

- `agent_merged_protected_branch`
- `agent_created_production_tag`
- `agent_published_production_release`

**JSON Schema:** planned in `orchestrator/schemas/trace-v2-line.schema.json` when G1 ships emission. Until then, treat this table as the contract.

### Consumption (planned)

- `run_outcome_summary` governance section (future)
- `npm run explain-run -- --json` (future)
- CERBERUS pre-merge brief cross-check

---

## Required governance evidence (every governed PR)

When PR-boundary governance is active, each governed PR should carry:

- repository · PR number · source branch · target branch
- detected default branch · detected protected status
- detected rulesets (if visible) · required checks/reviews (if visible)
- actor identity · token/capability visibility class
- whether direct merge / push / tag / release is allowed (if inspectable)
- `decision` per table above

Until runtime discovery ships, **config fallback** and **explicit operator attestation** may populate evidence — still **fail closed** when visibility is limited.

---

## CERBERUS rejection rules (production boundary)

CERBERUS must **Request changes** or **block** when a PR or brief:

| Violation | Example claim |
|-----------|-----------------|
| Instruction-only boundary | "Agent will not merge because the prompt says so" |
| PAT-only governance | "Limited PAT is sufficient; branch protection optional" |
| Merge-safety without evidence | "Safe to merge to main" with `permission_visibility: limited` |
| Agent as release authority | Agent merged protected branch / created prod tag / published release **by default** |
| False contributor semantics | `ready_for_human_review` interpreted as agent merge approval |
| Production readiness overclaim | See [doc-runtime-drift-check.md](doc-runtime-drift-check.md) — `production-ready`, `no human required`, etc. |

CERBERUS **Approve** requires explicit evidence that capability controls and (when applicable) host protection align with **`agent_as_contributor`**.

---

## Relationship to other governance tickets

| Ticket / doc | Role |
|--------------|------|
| **PR-boundary governance** | Enforcement + GitHub discovery + gate emission of `production_boundary_check` |
| **Release governance** *(deferred)* | Tags, releases, changelog, release branch |
| **Drift-control checklist** | Per-slice human/agent discipline — does **not** replace this model |

---

## What this document is not

- Not a claim that ai-minions **enforces** GitHub branch protection (the host does).
- Not a substitute for **your** org change-management or SOC process.
- Not **production-ready** deployment guidance — see [security-posture.md](security-posture.md).
- Not runtime implementation of posture discovery — see PR-boundary governance spec.

---

## Revision

Update when default mode, trace schema, or enforcement layers ship. Prefer small factual diffs over marketing language.
