# External harness benchmark triage

**Ticket:** `EVAL-BENCHMAP-1` · **Status:** design deliverable (doc-only)  
**SoT:** Single versioned triage for external agent/harness benchmarks and frozen external reference appendices. **Does not** replace [`market-validation-notes.md`](market-validation-notes.md) (positioning research) or [`dynamic-workflow-contract.md`](dynamic-workflow-contract.md) § Pattern cross-check (contract minimum — extended here as Appendix F).

**Claims:** *Cross-checked against* external benchmarks and reference projects. **Not** “benchmark leader,” “12-factor compliant,” “Claude Code equivalent,” or production eval certification.

---

## Purpose

Map **external** agent and harness benchmarks to **observable** ai-minions behaviors (gates, traces, tools, permissions, MCP, cost, resume) without optimizing for public leaderboards or importing heavy suites prematurely.

**Anthropic eval framing (harness + model):** Public agent evals often measure **model + harness together**. Suites that score only final code correctness weakly observe permission denials, approval skips, trace shape, or policy-driven gates — the primary validation surface for this repo.

---

## Internal minimum (before external suites)

| Eval | Mechanism | Decision |
|------|-----------|----------|
| **Tool ergonomics / misuse** | [`tool-ergonomics-guidelines.md`](tool-ergonomics-guidelines.md), `security/tool-eval.js`, `tool-eval-fixtures.v1.json` (`TOOL-EVAL-1`) | **Run and extend first** — add fixtures when tools change; CERBERUS can block merges without fixture rows |
| **Strict E2E** | `npm run test:e2e:strict:all` | Regression for handoffs, MCP chain, transitions |
| **Graph / failure taxonomy** | [`graph-validation.md`](graph-validation.md), [`failure-semantics-contract.md`](failure-semantics-contract.md) | Harness path integrity |

**Go/no-go:** No external benchmark becomes a **dependency** without a follow-up implementation ticket. External pilot runs are **operator-opt-in** after internal gates stay green.

---

## Core benchmark matrix

| Benchmark | Primary signal | Harness behavior | Model quality | Permission / gates | Traceability | MCP / tools | Cost overhead | Classification | Required harness support (if adopted) | Cost / risk | **Decision** |
|-----------|----------------|------------------|---------------|-------------------|--------------|-------------|---------------|----------------|--------------------------------------|-------------|--------------|
| [SWE-bench Verified](https://www.swebench.com/) | Patch correctness on real issues | Low | **High** | Low | Low (task outcome) | Medium (env tools) | High ($, infra) | **Defer** | Sandboxed repo runner, unrelated to MODE gates | Leaderboard vanity; weak gate/trace signal | **Reject** as harness-primary pilot |
| [MCP-Bench](https://github.com/Accenture/mcp-bench) | MCP server/tool reliability (agent tool-use via MCP) | Medium | Medium | Medium | Medium | **High** | Medium | **Defer → pilot candidate** | Stable MCP transport (`ORCH_MCP_TRANSPORT`), permission evaluator, trace refs for tool calls | Suite maintenance; not all tasks map to multi-role flow | **Pilot when** P2-A broker + readonly E2E slice mature |
| [MCPBench](https://github.com/modelscope/MCPBench) | MCP server evaluation (latency, accuracy, tokens) | Medium | Medium | Low–Medium | Medium | **High** | Medium | **Defer** | Same as MCP-Bench + manifest alignment | Overlap with MCP-Bench; pick one pilot only | **Defer** (do not dual-pilot) |
| [OSWorld-MCP](https://github.com/xlang-ai/OSWorld) | Desktop + MCP tool use | Medium | Medium | Medium | Medium | High | **High** (VM) | **Defer** | GUI/desktop sandbox out of alpha scope | Infra heavy; security posture immature | **Reject** for now |
| [τ²-bench (tau2-bench)](https://github.com/sierra-research/tau2-bench) | Multi-turn tool use in domains | Medium | Medium | Medium | Medium | Medium | Medium | **Defer** | Domain env adapters; trace export | Less MCP-specific than MCP-Bench | **Defer** |
| [Terminal-Bench](https://www.tbench.ai/) / Harbor | Shell/coding in terminal | Medium–High | High | Medium (spawn class) | Medium | Medium (shell) | High | **Defer** | [`subprocess-classification.md`](subprocess-classification.md), classified spawns only | Align after `ENV-READONLY-WRITE-BLOCK-E2E-1` | **Defer** |

### Pilot recommendation (max one external)

| Choice | Verdict |
|--------|---------|
| **Now** | **None** — expand `TOOL-EVAL-1` fixtures and strict E2E |
| **Next external pilot (when ready)** | **MCP-Bench** ([Accenture/mcp-bench](https://github.com/Accenture/mcp-bench)) — best overlap with MCP + tool paths ai-minions already exercises |
| **Explicitly not piloting** | SWE-bench Verified (model leaderboard), OSWorld-MCP (desktop VM), dual MCP-Bench + MCPBench |

---

## Appendix A — Mission Control / Aegis

**Source:** [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) (deferred ref — operator archive `docs/archive/backlog-external-cross-checks.md` § Mission Control; **not** versioned in public tree).  
**Scope:** Compare **Aegis sign-off / skills scanner** ideas to **CERBERUS + harness contracts** — **no** dashboard adoption, external agent registry, or UI roadmap inflation.

| Aegis / Mission Control idea | ai-minions mechanism | Triage |
|------------------------------|----------------------|--------|
| Agent registry + heartbeat | `task_registered`, state store, runner TUI | **Already covered** |
| Cost panels | `COST-BUDGET-VIEW-TUI-1`, budget guard, token traces | **Already covered** |
| Aegis review gate on skills | `SKILL-SECURITY-THREATMODEL-1`, workflow skill contract | **Partial** — local skills only; no marketplace scanner |
| MCP audit trail | Trace JSONL, permission-check trace | **Partial** — audit via traces, not separate MCP audit product |
| Dashboard / multi-project UI | `CONTROL-PLANE-TUI-1` (read-only CLI); `CONTROL-PLANE-UI-0` **P4** | **Rejected** — no web control plane from this ref |
| Trust score / opaque agent scoring | CERBERUS `review_record` + `doubt_review_*` | **Already covered** (different shape; no trust score claim) |
| External agent registration | Supervisor-owned roles only | **Rejected** |
| Skills hub import | Allowlisted local `SKILL.md` only | **Rejected** — no external skill marketplace |

**Derived tickets from Appendix A:** **0** (batch absorbed here; reinforces existing Resolved tickets only).

---

## Appendix B — Picrew awesome-agent-harness

**Source:** [Picrew/awesome-agent-harness](https://github.com/Picrew/awesome-agent-harness) (curated list — **evidence radar**, not authority).  
Map categories → existing tickets; **reject** adoption by popularity.

| Category (list framing) | ai-minions anchor | Triage |
|-------------------------|-------------------|--------|
| Orchestration / multi-agent | MODE protocol, `harness-engineering-positioning.md` execution modes | **Already covered** |
| Context / state / memory | `CTX-HYGIENE-SIGNALS-1`, `memory-store-decision.md`, compact handoff | **Already covered** |
| Sandbox / credential isolation | `security-posture.md`; post-alpha `ENV-CREDENTIAL-BROKER-1` | **Explicit gap** (broker not shipped) → existing ticket in operator backlog `docs/backlog-open-specs.md` § post-alpha (**not** versioned in public tree) |
| Protocols (MCP, A2A, etc.) | MCP direct transport, tool manifest | **Partial** — MCP yes; A2A not in scope |
| Evals / benchmarks | This doc + `TOOL-EVAL-1` | **Covered by this deliverable** |
| Observability | Traces, `run-outcome-consumption.md`, control-plane TUI | **Already covered** |
| Governance / approval | `governance-gates-contract.md`, `approval-policy-gates-contract.md` | **Already covered** |

**Derived candidate tickets (max 3 from B+C — count: 2, both pre-existing gaps):**

| Candidate | Type | Notes |
|-----------|------|-------|
| `ENV-CREDENTIAL-BROKER-1` | **Existing ticket** (not new) | Picrew sandbox category → brokered credentials |
| `DOC-RUNTIME-DRIFT-CHECK-1` | **Existing ticket** (not new) | List-heavy ecosystem → doc/runtime alignment checks |

**Rejected:** `EXT-HARNESS-CATALOG-1`, per-repo tickets from the awesome list, framework import.

---

## Appendix C — Swarm patterns (Kimi vs Claude Agent Teams)

**Sources:** Kimi K2.6 Agent Swarm (product/docs); Claude Code Agent Teams (official docs). **Deferred ref** — operator archive `docs/archive/backlog-external-cross-checks.md` § Kimi Swarm (**not** versioned in public tree).

| Pattern | Description | ai-minions stance | Triage |
|---------|-------------|-------------------|--------|
| Coordinator-centric swarm | Central planner dispatches workers | Closest: **supervisor-owned** multi-role (`flow_mode`); not coordinator marketplace | **Compare only** — [`harness-engineering-positioning.md`](harness-engineering-positioning.md) forbids swarm/decentralized claims |
| Peer-to-peer agent teams | Agents message laterally | Not implemented | **Rejected** without `SWARM-EPIC` RFC |
| Fan-out / synthesis | Parallel subagents + merge | Design in [`dynamic-workflow-contract.md`](dynamic-workflow-contract.md); **no runtime** | **Explicit gap** (contract only) → future `WORKFLOW-RUNTIME-1` scope |
| Auto-run without approval | Product marketing default | `approval_policy`, `validation: always` | **Rejected** |
| Fake parallelism | Duplicate work, hidden serial | Budget + trace refs; no synthesis engine | **Explicit gap** — detection = future RFC, not new ticket here |

**`SWARM-EPIC`:** Observations stay in RFC/deferred ref — **no** `PARALLEL-WORKER-CONTRACT-1`, `FAKE-PARALLELISM-DETECTION-1`, or `SYNTHESIS-CONTRACT-1` until RFC accepted.

**Derived tickets from Appendix C:** **0 new** (gaps reference existing deferred RFC / runtime tickets).

---

## Appendix D — awesome-agent-orchestrators landscape

**Source:** [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) — curated **coding-agent orchestration tools**, not a single framework contract.  
**Merged from:** `EXT-AGENT-ORCHESTRATORS-CHECK-1` scope (no second permanent matrix). Claims below are **unverified** unless validated from each project's own docs.

| Repo (list id) | Execution | Isolation | Coordination | Validation | Persistence | Observability | Security (claimed) | ai-minions relevance |
|----------------|-----------|-----------|--------------|------------|-------------|---------------|-------------------|----------------------|
| bernstein | CLI / agent loop | unclear | manager-owned | tests (claimed) | git | logs | BYOK (unverified) | **Compare** — loop ownership vs harness |
| sortie | TUI / sessions | worktree (claimed) | manager-owned | unclear | sessions | trace (claimed) | unclear | **Compare** — worktree parity → shipped W1–W4 |
| tutti | multi-agent CLI | unclear | swarm-ish | unclear | unclear | unclear | unclear | **Ignore** — swarm aesthetic |
| agentsmesh | mesh / MCP | unclear | peer-style | unclear | unclear | unclear | unclear | **Ignore** — no mesh runtime |
| scion | orchestration | container (claimed) | manager | gates (claimed) | unclear | telemetry (claimed) | sandbox (unverified) | **Compare** — gates only |
| swarm-protocol | protocol / workers | unclear | swarm | unclear | unclear | unclear | unclear | **Ignore** |
| wit | parallel workers | worktree / locks (claimed) | claim-work | reviewer | git | unclear | unclear | **Compare** → future `CODE-CONFLICT-GUARD-1` (P4) |
| Dex | desktop / IDE | unclear | autonomous loop | unclear | local | unclear | unclear | **Ignore** |
| kodo | GHA / CI | CI sandbox | pipeline | tests | git | GHA logs | token in CI | **Compare** — CI patterns only |
| orc | orchestrator | unclear | manager | unclear | unclear | unclear | unclear | **Ignore** |
| ORCH | harness name collision | unclear | unclear | unclear | unclear | unclear | unclear | **Ignore** — naming only |
| shire | multi-agent | unclear | coordinator | unclear | unclear | unclear | unclear | **Ignore** |

**Map external patterns → ai-minions (no adoption):**

| External pattern | Anchor |
|------------------|--------|
| Worktree isolation | `worktree-isolation-contract.md` (**shipped**) |
| Typed artifacts / handoffs | `agent-contract.md`, QA_SPEC, `validateHandoffStructure` |
| Claim / heartbeat / handoff | `session-resume-contract.md`, control-plane TUI |
| Symbol-level conflict (wit) | `CODE-CONFLICT-GUARD-1` (**P4** — not promoted here) |
| Kanban / parallel runners | **Do not copy** — product is contract-driven harness, not Kanban board |

**Do not copy:** zero-human company framing; swarm-first architecture; auto-commit without policy; Kanban-as-contract; “secure/autonomous” marketing without trace evidence.

---

## Appendix E — 12-Factor Agents cross-check

**Source:** [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) — engineering patterns, **not** a compliance badge.

| Principle (summary) | ai-minions mechanism | Status |
|---------------------|----------------------|--------|
| Own your prompts | Role contracts, `agents/`, MODE blocks | **Implemented** |
| Own your context window | `CTX-HYGIENE-SIGNALS-1`, `CTX-COST-1`, compact handoff MCP | **Implemented** |
| Tools as structured outputs | Tool manifest, `TOOL-EVAL-1`, permission evaluator | **Implemented** |
| Own your control flow | Manager-owned orchestrator loop (no hidden framework scheduler) | **Implemented** |
| Launch / pause / resume | `session-resume-contract.md` | **Implemented** (operator-triggered resume) |
| Contact humans with tool calls | `governance-gates-contract.md`, `approval-policy-gates-contract.md` | **Implemented** |
| Small, focused agents | Fixed role set; new roles need contract/policy/trace delta | **Implemented** (discipline by policy) |
| Stateless reducer / replay | Trace JSONL + run state; workflow checkpoint **partial** | **Partial** — full workflow replay = dynamic workflow runtime gap |
| Unify execution and business state | State store + trace envelope | **Partial** |
| Compact errors into context | Failure semantics, sanitized traces | **Partial** |
| Trigger from anywhere | CLI, hooks, MCP — not all entrypoints parity-tested | **Partial** |
| Natural language → tool calls | Model + tool routing; not a separate NLU layer | **Covered by existing tickets** (no new work) |

**Forbidden claim:** “12-factor compliant.” Allowed: *cross-checked against 12-Factor Agents principles* with gaps explicit above.

---

## Appendix F — Dynamic workflow patterns (extended)

**Source:** Claude Code Dynamic Workflows (research preview, May 2026) — **no** compatibility claim. Contract minimum: [`dynamic-workflow-contract.md`](dynamic-workflow-contract.md) § Pattern cross-check. This appendix is the **evaluation-benchmark** extension for planning only.

| Pattern | ai-minions today | Triage |
|---------|------------------|--------|
| Classify-and-act | MODE + permission evaluator | **Partial** — plan `intent` typing in validator |
| Fan-out / fan-in | `flow_mode` multi-agent; worktree per leg | **Explicit gap (contract)** — fan-in merge + `trace_refs` |
| Adversarial verification | CERBERUS, `review_record`, `doubt_review_*` | **Implemented** |
| Generate-and-filter | Governance deny; no generated-script execution | **Partial** |
| Tournament / consensus | Not implemented | **Explicit gap (contract)** — `stop_condition.type: consensus` design only |
| Loop until converged | Task `max_iterations` | **Partial** — workflow-level loop needs runner wiring |
| Budget-aware orchestration | Budget guard, TUI `budget` | **Partial** — workflow `limits.max_tokens` integration |
| Resumable workflow state | `session-resume-contract.md` | **Partial** — workflow vs session checkpoint |

**Rejected:** executing agent-generated JS/shell as workflow bytecode; hundreds of parallel subagents; auto-run without approval; Claude Code equivalence.

---

## Benchmarks that cannot validate this harness

Explicitly **reject** as primary harness quality signals when they **cannot** observe:

- Policy-driven approval skips (`approval_skipped`, grant/deny)
- Permission evaluator denials before side effects
- CERBERUS / QA `review_record` and `doubt_review_*` shape
- Trace graph integrity and `failure_semantics` codes
- Worktree lifecycle and run workdir binding

SWE-bench-style **final-patch-only** scoring falls in this bucket for **harness-first** goals.

---

## Related documents

| Doc | Relationship |
|-----|----------------|
| [`harness-engineering-positioning.md`](harness-engineering-positioning.md) | Public claims matrix — do not inflate from benchmarks |
| [`market-validation-notes.md`](market-validation-notes.md) | Market pain / competitor framing — not benchmark execution |
| [`dynamic-workflow-contract.md`](dynamic-workflow-contract.md) | Runtime-blocked workflow design; Appendix F superset |
| [`tool-ergonomics-guidelines.md`](tool-ergonomics-guidelines.md) | Internal eval minimum |
| Operator archive `docs/archive/backlog-external-cross-checks.md` | Frozen deferred references (Mission Control, Picrew, swarm) — local backlog, not in public tree |

---

## Operator checklist

- [ ] Before any external pilot: `cd orchestrator && npm test` + `npm run test:e2e:strict:all` green.
- [ ] Extend `tool-eval-fixtures.v1.json` when adding tools.
- [ ] File a **new ticket** before wiring CI to an external benchmark.
- [ ] CERBERUS review: confirm pilot measures harness behavior, not model vanity.
