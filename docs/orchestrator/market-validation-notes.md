# Market validation notes — control-first positioning (doc-only)

**Location:** `docs/orchestrator/market-validation-notes.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Reference doc** — positioning research artifact. **Not** a market study, **not** runtime, **not** a beta promotion gate.

**Canonical claims:** [harness-engineering-positioning.md](harness-engineering-positioning.md) § Claims matrix · § Execution modes.

**Related:** [post-beta-product-direction.md](post-beta-product-direction.md) · [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) · [security-posture.md](security-posture.md) · [alpha-release-checklist.md](alpha-release-checklist.md).

---

## Methodology (honest limits)

- **Purpose:** Support **allowed / forbidden** public claims for a control-first workflow harness.
- **Not claimed:** statistically representative survey, paid analyst report, or verified customer references.
- **Sources:** Operator pain themes (anonymized), public product positioning of competitors (high level), and **repo evidence** (contracts, traces, tests).

---

## Pain themes (three anonymized illustrations)

Representative operator language — **illustrative**, synthesized from recurring themes in platform/engineering discussions. **Not** attributed to named individuals or customers.

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

### Allowed (with evidence path)

| Claim | Evidence / doc anchor |
|-------|---------------------|
| Control-first AI workflow harness for governed AI-assisted development | This doc + [harness-engineering-positioning.md](harness-engineering-positioning.md) |
| Single-agent multi-role and supervised multi-agent **execution strategies** | § Execution modes in harness positioning |
| Mandatory validation; policy-driven human approval before DEV authority | [approval-policy-gates-contract.md](approval-policy-gates-contract.md) |
| Structured CERBERUS review in trace (`doubt_review_*`) | [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) |
| OpenSpec-style SDD patterns as **design reference** | [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) |
| Worktree isolation and permission gates (alpha scope) | [worktree-isolation-contract.md](worktree-isolation-contract.md), [runtime-permission-contract.md](runtime-permission-contract.md) |
| Alpha / pre-release with documented limitations | [alpha-release-checklist.md](alpha-release-checklist.md), [CHANGELOG.md](../../CHANGELOG.md) |
| Dynamic workflow **patterns** (doc only) | [dynamic-workflow-contract.md](dynamic-workflow-contract.md) |
| Post-beta TUI/GUI, role routing, and semantic-specification work as **planned product direction** | [post-beta-product-direction.md](post-beta-product-direction.md) — reference only, no shipped-feature claim |

### Forbidden (overclaim)

| Claim | Why forbidden |
|-------|----------------|
| Production-ready multi-agent framework | Alpha; explicit gaps |
| Autonomous / fully autonomous engineering | Manager-owned + gates |
| LangGraph / CrewAI / AutoGen **equivalent** or alternative | Different category; ecosystem not matched |
| OpenSpec-compatible (without adapter) | [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) |
| Swarm / decentralized multi-agent execution | Out of current scope |
| Safe parallel subagents without contract + trace proof | No evidence claim |
| Full sandbox / credential broker “solved” | [security-posture.md](security-posture.md) honest gaps |
| Beta or GA from positioning research alone | Requires product checklist + release evidence |
| Interactive TUI, GUI, general local/external routing, or DSL as shipped before implementation evidence exists | Planned direction is not runtime evidence |

---

## Post-beta market-value hypothesis

Once the beta path is stable, three product tracks reinforce the control-first category:

| Track | User-visible value | Control-first constraint |
|-------|--------------------|--------------------------|
| **Interactive TUI / optional GUI** | Makes runs, blockers, evidence, routing, and next actions legible without reading raw traces | Must consume the canonical read model; read-only first; gated mutations only |
| **Local + external model routing by role/agent** | Balances privacy, capability, availability, latency, and cost across heterogeneous models | No silent fallback or escalation; every selection and rejection remains traceable |
| **Semantic specifications / constrained DSL** | Converts repeated intent into compact, maintainable, validator-backed artifacts | Begin with narrow eval scenarios; no general workflow language or second authority |

The market claim is not that any one feature is novel. The differentiated bundle is:

> Legible operator control + outcome-aware model economics + executable governance contracts.

Success must be evaluated by accepted outcomes and operator comprehension, not feature count, token price, or UI polish alone. Detailed sequencing and entry gates live in [post-beta-product-direction.md](post-beta-product-direction.md).

---

## Operator-facing summary

> ai-minions strengthens **control-first** execution by making **validation mandatory** and **human approval policy-driven** before DEV authority — with trace-backed review, optional SDD comparison as **reference only**, and an honest **alpha** scope.

---

## Out of scope for this deliverable

New runtime features, competitor feature matrices, paid ads copy, customer logos, or benchmark scores (see [eval-benchmark-triage.md](eval-benchmark-triage.md)).
