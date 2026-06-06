# External harness benchmark triage

**Status:** design deliverable (doc-only).

**Purpose:** Map **external** agent and harness benchmarks to **observable** ai-minions behaviors (gates, traces, tools, permissions, MCP, cost, resume) without optimizing for public leaderboards or importing heavy suites prematurely.

**Related:** [market-validation-notes.md](market-validation-notes.md) · [dynamic-workflow-contract.md](dynamic-workflow-contract.md) · [tool-ergonomics-guidelines.md](tool-ergonomics-guidelines.md).

**Not claimed:** benchmark leader, “12-factor compliant,” “Claude Code equivalent,” or production eval certification.

---

## Eval framing

Public agent evals often measure **model + harness together**. Suites that score only final code correctness weakly observe permission denials, approval skips, trace shape, or policy-driven gates — the primary validation surface for this repo.

---

## Internal minimum (before external suites)

| Eval | Mechanism | Decision |
|------|-----------|----------|
| **Tool ergonomics / misuse** | [tool-ergonomics-guidelines.md](tool-ergonomics-guidelines.md), `security/tool-eval.js`, `tool-eval-fixtures.v1.json` | **Run and extend first** — add fixtures when tools change |
| **Strict E2E** | `npm run test:e2e:strict:all` | Regression for handoffs, MCP chain, transitions |
| **Graph / failure taxonomy** | [graph-validation.md](graph-validation.md), [failure-semantics-contract.md](failure-semantics-contract.md) | Harness path integrity |

**Go/no-go:** No external benchmark becomes a **dependency** without an explicit implementation plan. External pilot runs are **operator-opt-in** after internal gates stay green.

---

## Core benchmark matrix

| Benchmark | Primary signal | Harness behavior | Model quality | Permission / gates | Traceability | MCP / tools | Cost overhead | **Decision** |
|-----------|----------------|------------------|---------------|-------------------|--------------|-------------|---------------|--------------|
| [SWE-bench Verified](https://www.swebench.com/) | Patch correctness on real issues | Low | **High** | Low | Low (task outcome) | Medium (env tools) | High ($, infra) | **Reject** as harness-primary pilot |
| [MCP-Bench](https://github.com/Accenture/mcp-bench) | MCP server/tool reliability | Medium | Medium | Medium | Medium | **High** | Medium | **Pilot when** broker + readonly E2E mature |
| [MCPBench](https://github.com/modelscope/MCPBench) | MCP server evaluation | Medium | Medium | Low–Medium | Medium | **High** | Medium | **Defer** (do not dual-pilot with MCP-Bench) |
| [OSWorld-MCP](https://github.com/xlang-ai/OSWorld) | Desktop + MCP tool use | Medium | Medium | Medium | Medium | High | **High** (VM) | **Reject** for now |
| [τ²-bench](https://github.com/sierra-research/tau2-bench) | Multi-turn tool use in domains | Medium | Medium | Medium | Medium | Medium | Medium | **Defer** |
| [Terminal-Bench](https://www.tbench.ai/) / Harbor | Shell/coding in terminal | Medium–High | High | Medium (spawn class) | Medium | Medium (shell) | High | **Defer** |

### Pilot recommendation (max one external)

| Choice | Verdict |
|--------|---------|
| **Now** | **None** — extend tool-eval fixtures and strict E2E |
| **Next external pilot (when ready)** | **MCP-Bench** — best overlap with MCP paths ai-minions already exercises |
| **Explicitly not piloting** | SWE-bench Verified (model leaderboard), OSWorld-MCP (desktop VM), dual MCP-Bench + MCPBench |

---

## Appendix A — Mission Control / Aegis (reference)

**Source:** [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control).

Compare **Aegis sign-off / skills scanner** ideas to **CERBERUS + harness contracts** — **no** dashboard adoption, external agent registry, or UI roadmap inflation.

| Idea | ai-minions mechanism | Triage |
|------|----------------------|--------|
| Agent registry + heartbeat | `task_registered`, state store, runner TUI | **Already covered** |
| Cost panels | budget guard, token traces, runner TUI | **Already covered** |
| Review gate on skills | [skill-security-threatmodel.md](skill-security-threatmodel.md), [workflow-skill-contract.md](workflow-skill-contract.md) | **Partial** — local skills only |
| MCP audit trail | Trace JSONL, permission-check trace | **Partial** — audit via traces |
| Dashboard / multi-project UI | [control-plane-tui-contract.md](control-plane-tui-contract.md) (read-only CLI) | **Rejected** — no web control plane |
| Trust score / opaque agent scoring | `review_record` + `doubt_review_*` | **Already covered** (no trust score claim) |
| External agent registration | Supervisor-owned roles only | **Rejected** |
| Skills hub import | Allowlisted local `SKILL.md` only | **Rejected** |

---

## Appendix B — Picrew awesome-agent-harness (reference)

**Source:** [Picrew/awesome-agent-harness](https://github.com/Picrew/awesome-agent-harness) — curated list, **not** authority.

| Category | ai-minions anchor | Triage |
|----------|-------------------|--------|
| Orchestration / multi-agent | MODE protocol, [harness-engineering-positioning.md](harness-engineering-positioning.md) | **Already covered** |
| Context / state / memory | [context-hygiene-signals.md](context-hygiene-signals.md), [memory-store-decision.md](memory-store-decision.md) | **Already covered** |
| Sandbox / credential isolation | [security-posture.md](security-posture.md), [credential-broker-contract.md](credential-broker-contract.md) | **Explicit gap** — broker not shipped |
| Protocols (MCP, A2A, etc.) | MCP direct transport, tool manifest | **Partial** — MCP yes; A2A not in scope |
| Evals / benchmarks | This doc + tool-eval fixtures | **Covered here** |
| Observability | Traces, [run-outcome-consumption.md](run-outcome-consumption.md) | **Already covered** |
| Governance / approval | [governance-gates-contract.md](governance-gates-contract.md), [approval-policy-gates-contract.md](approval-policy-gates-contract.md) | **Already covered** |

**Rejected:** per-repo tickets from the awesome list, framework import by popularity.

---

## Appendix C — Swarm patterns (reference)

**Sources:** Kimi K2.6 Agent Swarm; Claude Code Agent Teams — **no** compatibility claim.

| Pattern | ai-minions stance | Triage |
|---------|-------------------|--------|
| Coordinator-centric swarm | **Supervisor-owned** multi-role (`flow_mode`) | **Compare only** — no swarm/decentralized claims |
| Peer-to-peer agent teams | Not implemented | **Rejected** without explicit RFC |
| Fan-out / synthesis | [dynamic-workflow-contract.md](dynamic-workflow-contract.md); **no runtime** | **Explicit gap** (contract only) |
| Auto-run without approval | `approval_policy`, `validation: always` | **Rejected** |
| Fake parallelism | Budget + trace refs; no synthesis engine | **Explicit gap** |

---

## Appendix D — awesome-agent-orchestrators (reference)

**Source:** [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators).

Claims below are **unverified** unless validated from each project's own docs.

| Repo | ai-minions relevance |
|------|----------------------|
| bernstein | **Compare** — loop ownership vs harness |
| sortie | **Compare** — worktree parity → [worktree-isolation-contract.md](worktree-isolation-contract.md) |
| scion | **Compare** — gates only |
| wit | **Compare** — symbol-level conflict (future) |
| kodo | **Compare** — CI patterns only |
| tutti, agentsmesh, swarm-protocol, Dex, orc, ORCH, shire | **Ignore** — swarm/mesh aesthetic or naming only |

**Do not copy:** zero-human company framing; swarm-first architecture; auto-commit without policy; Kanban-as-contract; “secure/autonomous” marketing without trace evidence.

---

## Appendix E — 12-Factor Agents (reference)

**Source:** [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) — engineering patterns, **not** a compliance badge.

| Principle (summary) | ai-minions mechanism | Status |
|---------------------|----------------------|--------|
| Own your prompts | Role contracts, `agents/`, MODE blocks | **Implemented** |
| Own your context window | context hygiene signals, compact handoff MCP | **Implemented** |
| Tools as structured outputs | Tool manifest, tool-eval, permission evaluator | **Implemented** |
| Own your control flow | Manager-owned orchestrator loop | **Implemented** |
| Launch / pause / resume | [session-resume-contract.md](session-resume-contract.md) | **Implemented** (operator-triggered) |
| Contact humans with tool calls | governance + approval policy gates | **Implemented** |
| Small, focused agents | Fixed role set | **Implemented** (discipline by policy) |
| Stateless reducer / replay | Trace JSONL + run state | **Partial** |
| Unify execution and business state | State store + trace envelope | **Partial** |
| Compact errors into context | Failure semantics, sanitized traces | **Partial** |
| Trigger from anywhere | CLI, hooks, MCP | **Partial** |
| Natural language → tool calls | Model + tool routing | **Covered** |

**Not claimed:** “12-factor compliant.” Allowed: *compared against 12-Factor Agents principles* with gaps explicit above.

---

## Appendix F — Dynamic workflow patterns (extended)

**Source:** Claude Code Dynamic Workflows (research preview) — **no** compatibility claim. Contract minimum: [dynamic-workflow-contract.md](dynamic-workflow-contract.md) § External pattern comparison.

| Pattern | ai-minions today | Triage |
|---------|------------------|--------|
| Classify-and-act | MODE + permission evaluator | **Partial** |
| Fan-out / fan-in | `flow_mode` multi-agent; worktree per leg | **Explicit gap (contract)** |
| Adversarial verification | `review_record`, `doubt_review_*` | **Implemented** |
| Generate-and-filter | Governance deny; no generated-script execution | **Partial** |
| Tournament / consensus | Not implemented | **Explicit gap (contract)** |
| Loop until converged | Task `max_iterations` | **Partial** |
| Budget-aware orchestration | Budget guard, TUI `budget` | **Partial** |
| Resumable workflow state | [session-resume-contract.md](session-resume-contract.md) | **Partial** |

**Rejected:** executing agent-generated JS/shell as workflow bytecode; hundreds of parallel subagents; auto-run without approval; product equivalence claims.

---

## Benchmarks that cannot validate this harness

Explicitly **reject** as primary harness quality signals when they **cannot** observe:

- Policy-driven approval skips (`approval_skipped`, grant/deny)
- Permission evaluator denials before side effects
- `review_record` and `doubt_review_*` shape
- Trace graph integrity and `failure_semantics` codes
- Worktree lifecycle and run workdir binding

SWE-bench-style **final-patch-only** scoring falls in this bucket for **harness-first** goals.

---

## Operator checklist

- [ ] Before any external pilot: `cd orchestrator && npm test` + `npm run test:e2e:strict:all` green.
- [ ] Extend `tool-eval-fixtures.v1.json` when adding tools.
- [ ] Document pilot scope and success criteria before wiring CI to an external benchmark.
- [ ] Confirm pilot measures harness behavior, not model vanity.
