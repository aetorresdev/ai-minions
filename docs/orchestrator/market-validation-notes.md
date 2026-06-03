# Market validation notes — control-first positioning (doc-only)

**Location:** `docs/orchestrator/market-validation-notes.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Shipped (v0.4 G4 slice).** Research artifact for positioning — **not** a market study, **not** runtime, **not** beta promotion.

**Canonical claims:** [harness-engineering-positioning.md](harness-engineering-positioning.md) § Claims matrix · § Execution modes.

**Related:** [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) · [security-posture.md](security-posture.md) · [alpha-release-checklist.md](alpha-release-checklist.md).

---

## Methodology (honest limits)

- **Purpose:** Support **allowed / forbidden** public claims for a control-first workflow harness.
- **Not claimed:** statistically representative survey, paid analyst report, or verified customer references.
- **Sources:** Operator pain themes (anonymized), public product positioning of competitors (high level), and **repo evidence** (contracts, traces, tests).
- **Does not block** `v0.4.0-alpha.1` tag by itself — matrix integration is the deliverable.

---

## Pain themes (three anonymized illustrations)

Representative operator language — **illustrative**, synthesized from recurring themes in platform/engineering discussions (2026-06). **Not** attributed to named individuals or customers.

| # | Theme | Illustrative quote (anonymized) |
|---|--------|-------------------------------|
| 1 | **Unreviewed autonomy** | “The agent merged on Friday; we only found out Monday when prod metrics moved — nothing in the trace said *who* approved the scope change.” |
| 2 | **Chat-as-SoT** | “Our ‘spec’ was forty messages in a thread; QA couldn’t tell which handoff was authoritative when the run failed.” |
| 3 | **Cost without guardrails** | “We burned a week of API budget in one loop because ‘done’ was whatever the model said, not whatever tests and CERBERUS recorded.” |

**Implication for positioning:** Buyers care about **governance evidence** (trace, gates, approval, validation), not another orchestration diagram.

---

## Competitor framing (high level, non-authoritative)

Comparison is **positioning**, not feature parity scoring. Ecosystem breadth favors automation-first frameworks; ai-minions competes on **control evidence**.

| Product / category | Typical public emphasis | ai-minions contrast (honest) |
|--------------------|-------------------------|------------------------------|
| **LangGraph** (and graph orchestration libs) | Stateful graphs, multi-agent flows, tool routing | We do **not** claim richer graphs; we claim **contracts + traces + fail-closed gates** around a bounded runner |
| **CrewAI / AutoGen** (role teams) | Role specialization, delegation, task automation | We support **roles as capabilities**, not “autonomous engineering teams”; **manager-owned** run with approval boundaries |
| **Claude Code / Cursor** (IDE agents) | Fast iteration, tools, local execution | **Execution harness** layer; ai-minions is **control-plane** policy/trace on top — complementary |
| **Generic “agent platform”** | Scale, autonomy, integrations | **Reject** parity claims — alpha harness with explicit gaps in [security-posture.md](security-posture.md) |

**Do not publish:** feature checklists implying we out-orchestrate LangGraph; “drop-in replacement” for any row above.

---

## Searchable phrases (SEO / messaging hints)

Phrases aligned with **control-first** positioning (use in docs, talks, README — not as guaranteed search volume):

| Phrase | ai-minions hook |
|--------|-----------------|
| AI agent governance | Approval policy, permission gates, CERBERUS, trace audit |
| Agent approval gates | `approval_skipped`, `approval_required`, policy-driven human approval |
| AI workflow control | Manager-owned orchestration, fail-closed validation |
| LLM workflow validation | `validateOutput`, QA lane, schema-backed traces |
| Spec-driven development (agents) | Durable contracts, handoff YAML, [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) (reference only) |
| AI coding agent audit trail | JSONL trace v2, `review_record`, `doubt_review_*` |

---

## Allowed vs forbidden claims (release-oriented)

Use this table for README, release notes, and talks. When in doubt, prefer **narrower** wording + link to repo contracts.

### Allowed (with evidence path)

| Claim | Evidence / doc anchor |
|-------|---------------------|
| Control-first AI workflow harness for governed AI-assisted development | This doc + [harness-engineering-positioning.md](harness-engineering-positioning.md) |
| Single-agent multi-role and supervised multi-agent **execution strategies** | § Execution modes in harness positioning |
| Mandatory validation; policy-driven human approval before DEV authority | [approval-policy-gates-contract.md](approval-policy-gates-contract.md) |
| Structured adversarial review in trace (`doubt_review_*`) | [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) |
| Cross-checked OpenSpec-style SDD patterns (**design reference only**) | [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) |
| Worktree isolation and permission gates (alpha scope) | [worktree-isolation-contract.md](worktree-isolation-contract.md), [runtime-permission-contract.md](runtime-permission-contract.md) |
| Alpha / pre-release with documented limitations | [alpha-release-checklist.md](alpha-release-checklist.md), [CHANGELOG.md](../../CHANGELOG.md) |
| Cross-checked against emerging dynamic workflow **patterns** (doc) | [dynamic-workflow-contract.md](dynamic-workflow-contract.md) |

### Forbidden (overclaim)

| Claim | Why forbidden |
|-------|----------------|
| Production-ready multi-agent framework | Alpha; explicit gaps |
| Autonomous / fully autonomous engineering | Manager-owned + gates |
| LangGraph / CrewAI / AutoGen **equivalent** or alternative | Different category; ecosystem not matched |
| OpenSpec-compatible (without adapter) | [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) |
| Swarm / decentralized multi-agent execution | Out of v0.4 scope |
| Safe parallel subagents without contract + trace proof | No evidence claim |
| Full sandbox / credential broker “solved” | [security-posture.md](security-posture.md) honest gaps |
| Beta or GA from positioning research alone | Requires product checklist + CERBERUS release sign-off |

---

## v0.4 release claim (operator-facing)

> ai-minions strengthens **control-first** execution by making **validation mandatory** and **human approval policy-driven** before DEV authority — with trace-backed review, optional SDD cross-check as **reference only**, and an honest **alpha** scope.

---

## Out of scope for this deliverable

New runtime tickets, competitor feature matrices, paid ads copy, customer logos, or benchmark scores (see evaluation benchmark work separately).
