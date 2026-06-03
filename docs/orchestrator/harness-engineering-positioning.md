# Harness engineering positioning

**Location:** `docs/orchestrator/harness-engineering-positioning.md` (repo root). See
[PATHS.md](PATHS.md) if your workspace root differs.

This document is the **canonical framing** for why ai-minions is a **control-first AI
workflow harness** (contracts, gates, traces, budgets, permissions, human approval
boundaries) around inference—not a generic multi-agent framework. The root
[`README.md`](../../README.md) is the **short map**; it should **summarize and link
here**, not invent parallel claims.

## Positioning and public claims

### Public framing (external)

> **ai-minions** is a **control-first AI workflow harness** for senior engineers using
> AI coding agents in workflows where mistakes need review, traceability, and approval
> boundaries.

### Internal / technical framing

**Contract-driven agent harness** · **harness-engineering runtime** (manager-owned
orchestration, fail-closed gates, JSONL evidence).

### Do not lead with

- multi-agent framework (as product category)
- autonomous agents
- agentic platform
- generic orchestration framework
- swarm orchestration platform
- “LangGraph alternative”

Competing on “more powerful orchestration” vs LangGraph / CrewAI / AutoGen is **out of
scope**—those products win on ecosystem; ai-minions wins on **governance evidence**
(CERBERUS, approval gates, goal alignment, worktree isolation, cost/token controls).

### Claims matrix (positioning evidence, 2026-06)

| Allowed | Forbidden |
|---------|-----------|
| Control-first AI workflow harness for governed AI-assisted development | Production-ready multi-agent framework for autonomous engineering |
| Supports **single-agent multi-role** workflows and **supervised multi-agent** execution | Advanced multi-agent framework; swarm orchestration platform; LangGraph alternative |
| Contracts, gates, traces, and human approval boundaries | Claude Code / LangGraph / CrewAI equivalent or “drop-in replacement” |
| Cross-checked against emerging dynamic workflow patterns (doc only) | Safe parallel subagents or full sandbox without contract/runtime proof |
| Alpha / pre-release with honest limitations | Beta or production readiness from positioning reports alone |

**Technical layer model (non-duplicative):** [agent-harness.md](agent-harness.md)
lists context, memory/state, control, validation, and observability **layers**. This
file explains **what harness engineering means here**, how parts map to the repo,
and what is explicitly **not** claimed.

**Normative contracts** (behavior detail): [agent-contract.md](agent-contract.md),
[runtime-permission-contract.md](runtime-permission-contract.md),
[strict-mode.md](strict-mode.md), [capability-flow-contract.md](capability-flow-contract.md).

**Local inference (operator):** [local-model-policy.md](local-model-policy.md),
[local-model-discovery.md](local-model-discovery.md),
[local-model-selection.md](local-model-selection.md),
[local-inference-sizing.md](local-inference-sizing.md) — hardware/context guidance only, not benchmarks.

**Security narrative:** [security-posture.md](security-posture.md).

---

## What “harness engineering” means in ai-minions

The model is **one component** inside a **bounded execution environment**:

- **Inputs** are curated (contracts, selected files, compact handoff YAML), not
  “the whole repo plus the internet by default.”
- **Actions** are classified and, on gated paths, **denied before execute** when
  policy says no (MCP, shell, network, classified spawn). See
  `orchestrator/security/` and the permission contracts.
- **Progress** is **not** implied by fluent text: `validateOutput`, MCP transition
  gates, QA/CERBERUS lanes, and trace schema semantics record pass/fail.
- **Cost** is measured and can **hard-stop** a run (budget guardrails in the
  orchestrator; hooks report usage).
- **Outcomes** are **inspectable** (JSONL traces, summaries, exports)—comparisons
  should be evidence-based, not chat memory.

That is **harness engineering** in the narrow sense used here: **sensors + actuators +
policy + feedback loops + deterministic gates** around LLM steps—not “better prompts
only.”

---

## Harness mental model

**Models are replaceable reasoning engines.** The durable system boundary is the
**harness**: context curation, tools, external memory/artifacts, roles, verification,
traces, permissions, and limits.

In ai-minions, the harness includes:

- orchestrator-owned execution flow (manager-owned by default)
- role contracts and MODE gates
- compact handoff and durable artifacts
- permission and governance gates
- trace schema and run outcome consumption
- cost/budget guards
- QA / CERBERUS validation (evidence before “done”)
- explicit gaps for sandboxing, full resumability, and credential isolation

**Minimum viable harness** (e.g. `agents.md` + init checks + progress files + roles)
is a valid **personal-repo** pattern. ai-minions targets **observable, validable**
harness depth: contracts, traces, fail-closed gates, and audit—not a prettier chat.

### Common misconceptions

| Common misconception | ai-minions position |
|----------------------|---------------------|
| A better model fixes agent reliability | Reliability comes from context, contracts, validation, and runtime control |
| More tools means a better agent | Tool surface must be minimal, classified, gated, and evaluated |
| More agents means a better system | Specialists only when they improve contract, policy, tool isolation, or trace legibility |
| The agent says it is done | Done requires evidence (tests, schema, traces, QA/CERBERUS) |
| Handoff means the role changed in chat | Handoff means ownership changed under an explicit contract |
| Claude Code / Cursor *is* the whole harness | They are **execution harnesses**; ai-minions is a **control-plane harness** on top |

---

## Execution harness vs control-plane harness

**Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode** are **developer-agent
execution harnesses**: repo context, tools, file edits, shell, local config, conversational
flow. They wrap the model for day-to-day work.

**ai-minions does not replace them.** It sits **above** as a **contract-driven
orchestration / control harness**:

| Layer | Responsibility |
|-------|----------------|
| Execution harness (Claude Code, Cursor, …) | Run bounded work: edit, execute, use IDE tools |
| ai-minions | Orchestration, role contracts, handoff policy, permission gates, validation gates, traceability, cost accounting, approval semantics |

**Analogy (Jenkins):** the execution harness is the **agent/slave** (shell, git, tests).
ai-minions is closer to **controller + pipeline governance + policy + logs**—not
another editor competing with Cursor.

**Ownership rule (avoid duplicate harnesses):**

- Execution harness: *how* a step runs in the repo/session.
- ai-minions: *who* may act, *under what contract*, *with what evidence*, *at what cost*,
  and *whether the run may advance*.

If both layers decide permissions, context, completion, and approval without a clear
split, operators cannot audit outcomes—treat that as an architecture smell, not a
feature.

**Portability:** DEV may use Claude Code today, Codex or Ollama tomorrow; contracts,
traces, gates, and CERBERUS semantics stay. The **runner** changes; the **harness
contract** does not.

---

## Component map (repo anchors)

| Harness idea | Where it lives (examples) |
|--------------|---------------------------|
| Compact / structured handoff | `mcp-servers/compact-handoff/`; handoff YAML in [agent-contract.md](agent-contract.md) |
| Role contracts + MODE | [agent-contract.md](agent-contract.md); hooks under `scripts/hooks/` |
| `validateOutput` | `orchestrator/` (runner); tests under `orchestrator/` / `tests/` |
| QA / CERBERUS gates | Contract sections; trace events; hook enforcement paths |
| Trace schema, strict parsing | [strict-mode.md](strict-mode.md); `orchestrator/schemas/` |
| Permission model + gates | [runtime-permission-contract.md](runtime-permission-contract.md); `orchestrator/security/*.js` |
| Cost / iteration guards | Orchestrator guardrails; `flow-metrics.jsonl` (hooks); docs in `orchestrator/README.md` |
| Context / metric hooks | `scripts/hooks/`; [hooks-claude-code-metrics-validation.md](hooks-claude-code-metrics-validation.md) |

If a row cannot be tied to **code, contract, or test**, treat the claim as **not
allowed** in public positioning.

---

## Relations to adjacent ideas

| Adjacent term | Relationship here |
|---------------|---------------------|
| **Context engineering** | Sub-discipline **inside** the harness: what enters each turn (tools, MCP, snippets, history). **Curate** context; do not equate with “maximize prompt size.” Appears as the **context layer** in [agent-harness.md](agent-harness.md). |
| **Evals** | Useful for **harness + model** behavior, not a leaderboard chase. Quality targets belong in **contracts, gates, and traces** first. |
| **Observability** | Trace lines, `reason_code`, permission summaries, run outcome consumption—see [run-outcome-consumption.md](run-outcome-consumption.md), [dashboard-failure-taxonomy.md](dashboard-failure-taxonomy.md). |
| **Orchestration** | **Manager-owned by default** (next section). |
| **Safe autonomy** | **Not** “zero human.” Human supervision + **rejectable** machine steps. |
| **Runtime control** | Permission evaluation, gates, degraded mode, budget stop—**enforcement**, not vibes. |

---

## Execution modes (not the product category)

**ai-minions is control-first, not single-agent-only.** Multi-agent is an **execution
strategy** under governance—not the marketing category. The key contract axis is
**`role_execution_strategy`**, not “agent count.”

### Two supported execution modes

1. **Single-agent / multi-role** (`single_agent_multi_role`)  
   One model session executes multiple contractual roles **sequentially** (MODE
   transitions under contract). Best for local runs, lower cost, simpler debugging,
   and early adoption. Maps to `flow_mode: single_agent` in [agent-contract.md](agent-contract.md).

2. **Supervised multi-agent** (`supervised_multi_agent`)  
   Multiple **bounded** agents execute role-specific work under an **orchestrator-owned**
   run. The orchestrator retains ownership of **budget, permissions, trace, approvals,
   and final outcome**. Maps to `flow_mode: multi_agent` where wired; still not
   “swarm-first.”

### Not swarm-first

Decentralized or emergent multi-agent coordination is **future research** only. It
requires stronger **safety, trace, rollback, and conflict-resolution** contracts
before any release claim. Do not describe ai-minions as a swarm or emergent-coordination
platform today.

### `role_execution_strategy` (workflow contract axis)

Planned / design alignment with [dynamic-workflow-contract.md](dynamic-workflow-contract.md)
and task envelopes—**not** a separate runtime product:

```yaml
workflow:
  mode: controlled
  role_execution_strategy: single_agent_multi_role
```

```yaml
workflow:
  mode: controlled
  role_execution_strategy: supervised_multi_agent
```

**Future (blocked for release claims):**

```yaml
workflow:
  mode: experimental
  role_execution_strategy: decentralized_multi_agent
```

| Strategy | Status | Allowed for release claims |
|----------|--------|----------------------------|
| `single_agent_multi_role` | **core / default** | Yes |
| `supervised_multi_agent` | **supported / controlled** | Yes, when gates and trace evidence pass |
| `decentralized_multi_agent` | **future / experimental** | **No** |

### Public wording (execution)

**Say:** supports single-agent multi-role workflows and supervised multi-agent execution.

**Do not say yet:** advanced multi-agent framework; swarm orchestration platform;
LangGraph alternative.

---

## Orchestration model: manager-owned, bounded specialists, delegated handoff

**Default:** the **orchestrator run** keeps **ownership** of the task: plan, final
answer narrative, traces, budget, permission outcomes, approvals, and checkpoints.

**Bounded specialist invocation:** roles such as OWNER, ARCHITECT, DEV, QA, CERBERUS
are **capabilities** invoked under contract—**not** each a free-standing autonomous
agent that “owns the product” unless the workflow explicitly says otherwise.

**Delegated handoff (ownership transfer):** a **handoff** means the **next turn’s
role owns a branch** of work (budget boundary, approval boundary, artifact boundary)
as defined by YAML + gates—not every MODE line change in the transcript.

**Not a handoff:** switching phase from ARCHITECT to DEV because “design ended” is
a **workflow transition** inside the same run owner unless a **handoff artifact**
and gate semantics transfer ownership.

A future **dedicated handoff ownership contract** may further formalize delegated
branches; until then, [agent-contract.md](agent-contract.md) remains the normative
MODE + handoff reference.

### Handoffs vs “agents as tools” (applied)

| Pattern | Who keeps run ownership? | Typical signal |
|---------|--------------------------|----------------|
| **Handoff** | The **receiving** role for the delegated branch | Structured YAML + gate allows advance; branch may have its own budget/approval envelope |
| **Agents as tools** | **Orchestrator** (or current run owner) | Subagent returns **contract-shaped artifacts**; no ownership transfer |

### Valid vs invalid examples (illustrative)

- **Valid — QA → CERBERUS:** CERBERUS must **own** a blocker-review branch (release
  narrative, verdict semantics) under contract.
- **Valid — orchestrator → DEV:** DEV owns an **implementation sub-run** that is
  resumable with its own step/budget boundary **when** the contract and gates define
  that branch.
- **Invalid — ARCHITECT → DEV “because phase changed”:** phase change alone is **not**
  delegated ownership without explicit handoff semantics.
- **Invalid — QA → DEV “to ask for a fix”** while the orchestrator remains owner:
  that is a **tool-like** or follow-up instruction pattern, not a handoff, unless
  ownership is explicitly transferred.

### Diagram: manager-owned default, explicit handoff as exception

```mermaid
flowchart TB
  subgraph default [Default: manager-owned]
    O[Run owner / orchestrator plan]
    O --> S1[Invoke specialist under contract]
    S1 --> G[Gates + traces]
    G --> O
  end
  subgraph exception [Explicit handoff]
    H[Handoff YAML + gate-approved advance]
    H --> O2[Receiving role owns branch]
  end
  O -.->|only when contract says transfer| H
```

---

## What ai-minions is **not**

- **Not** a generic “agent framework” for arbitrary swarms and marketplace agents.
- **Not** a chatbot wrapper with prettier system prompts.
- **Not** swarm-first choreography where cost and accountability explode by default.
- **Not** a benchmark-chasing project—SA vs MA comparisons are explicitly
  **incomplete** in the root README maturity notes.
- **Not** a “zero-human company” control plane—humans own scope, risk, and approval.

---

## Specialist splitting: only when isolation improves

Adding roles or subagents is **not** free. It should improve at least one of:

- **Capability isolation** (different tools/paths),
- **Policy isolation** (different permission envelopes),
- **Prompt clarity** (smaller, testable contracts per surface),
- **Trace legibility** (auditors can follow branches).

If split only for “org chart aesthetics,” **do not** add specialists.

---

## External framing (cross-check, **not** roadmap authority)

Industry posts and courses (including Anthropic engineering essays on harness design,
long-running agents, context engineering, tools, MCP execution, managed agents, and
evals) are useful **vocabulary checks**. They are **not** compliance targets.

**Rule:** never claim “Anthropic-compliant,” “industry-standard harness,” or similar
without **repo-verifiable** evidence. Conceptual similarity ≠ certification.

### Anthropic titles (illustrative) → mechanisms here

Official Anthropic engineering materials include themes such as: *Harness design for
long-running application development*; *Effective harnesses for long-running agents*;
*Effective context engineering for AI agents*; *Writing effective tools for agents*;
*Code execution with MCP*; *Scaling Managed Agents*; *Demystifying evals for AI
agents*. Entry points: [anthropic.com/news](https://www.anthropic.com/news),
[anthropic.com/engineering](https://www.anthropic.com/engineering).

| External theme | ai-minions mechanism (verify in repo) |
|----------------|--------------------------------------|
| Harness design | Orchestrator runner, contracts, role gates, trace/export |
| Long-running agents | Compact handoff, durable artifacts on disk; **full durable resumability not claimed** |
| Context engineering | Compact handoff discipline, capability/manifest surfaces; context **pack** work is incremental |
| Tool design | Manifest-first classification, evaluators, gates |
| MCP / code execution | MCP + network + shell + classified spawn gates; progressive disclosure is **partial / planned** |
| Managed agents | **Not claimed** as parity—no core vault/sandbox product in runner |
| Evals | Harness quality via contracts + traces; no leaderboard narrative |

### OpenAI and other vendors (cross-check only)

OpenAI and other providers publish **multi-agent orchestration** and **tool
orchestration** patterns. Use them to sanity-check **ownership** and **delegation**
language only. They **do not** set requirements for this repository.

---

## Implemented / partial / planned / not claimed

| Bucket | Harness-relevant meaning |
|--------|--------------------------|
| **Implemented** | MODE + YAML handoffs; `validateOutput`; JSONL traces + strict schema path; permission evaluator + gates on covered call sites; token/cost hooks; budget hard-stop; role/capability prechecks where wired. |
| **Partial** | Progressive tool disclosure; some shell/network paths gated; handoff semantics evolving—see contracts for exact coverage. |
| **Planned** | Durable session/resume story; deeper tool-eval automation; richer dashboard rollups; **governed improvement loop** (proposals only—see backlog `SELF-IMPROVEMENT-LOOP-1`). |
| **Not claimed** | Managed-agent parity, kernel/container sandbox as core product, turnkey multi-tenant isolation, production SLA, **autonomous self-modifying harness** (prompt/contract/policy mutation without human approval). |

**Gaps to state plainly:** credential **broker/vault** productization and **OS-level
sandbox** isolation are **not** shipped as the default harness boundary—see
[security-posture.md](security-posture.md). **Full resumability** across all failure
modes is **not** claimed until a dedicated design lands in contracts and tests.

---

## Single source of truth (framing vs layers)

- **This file:** canonical **positioning** and orchestration vocabulary.
- **[agent-harness.md](agent-harness.md):** canonical **layer stack** (context,
  memory/state, control, validation, observability).
- **[README.md](../../README.md):** **consumer** of both—short map, no new strong
  claims.

If README and this file disagree, **update README** to match contracts + this doc.
