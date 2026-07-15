# Post-beta product direction — operator UX, model routing, and semantic specifications

**Status:** Product-direction reference. **Not runtime**, **not a beta promotion gate**, and **not a claim that the features below are shipped**.

**Entry condition:** Begin implementation only after the beta path is stable enough that first-run, smoke, run inspection, recovery, evidence export, and CERBERUS review are understandable without maintainer translation.

**Related:** [harness-engineering-positioning.md](harness-engineering-positioning.md) · [market-validation-notes.md](market-validation-notes.md) · [control-plane-tui-contract.md](control-plane-tui-contract.md) · [runner-tui-contract.md](runner-tui-contract.md) · [model-selection-trace-contract.md](model-selection-trace-contract.md) · [eval-benchmark-triage.md](eval-benchmark-triage.md).

---

## Decision

After a solid beta, ai-minions should develop three reinforcing product tracks:

1. **Operator experience:** evolve the current stdout/read-only evidence surfaces into an interactive TUI, followed by an optional GUI only after the read model and mutation boundaries are stable.
2. **Policy-driven model routing:** route local and external models per role or agent using explicit policy, capability, privacy, inventory, latency, and cost constraints.
3. **Semantic specifications:** introduce a constrained semantic model, and only then a small DSL where it removes repeated ambiguity and can be validated deterministically.

The product thesis is the combination, not any individual feature:

> A usable control plane for bounded agent work, with heterogeneous model routing and executable governance contracts.

This remains a **control-first harness**. It is not a new IDE, a generic workflow canvas, or an autonomous agent marketplace.

---

## Why this belongs after beta

A DSL or GUI built before the operating contracts stabilize would freeze immature assumptions into a more expensive interface. Beta must first reveal:

- which operator fields are actually required;
- which recovery actions are understandable;
- which model-selection decisions need explanation;
- which contracts repeat often enough to deserve a semantic abstraction;
- which trace fields are stable enough to support multiple presentation layers.

The first specification is a hypothesis, not a finished blueprint. Small, reviewable implementation loops must continue to refine the domain vocabulary before it becomes a language or UI contract.

---

## Track A — interactive TUI, then optional GUI

### Product value

The current `status`, `explain`, `report`, `tui`, `attach`, control-plane TUI, and runner TUI surfaces prove that the underlying evidence can be rendered. The next market-facing step is to make that evidence easier to navigate without weakening the gates.

### Required architecture

```text
trace + canonical run read model
              |
      operator service/API
       /             \
interactive TUI     optional GUI
```

### Rules

- The TUI and GUI must consume the **same canonical read model** as CLI/report surfaces.
- No UI-specific source of truth.
- Read-only inspection ships before mutation.
- Approvals, retries, policy edits, or resume actions require explicit policy gates, trace events, and clear confirmation.
- Missing fields remain `unavailable` / `not_aggregated`; presentation layers must not infer values.
- A GUI must not imply hosted, multi-user, authenticated, or production-ready operation unless those controls exist and are validated.

### Initial TUI scope

- Run list and run selection.
- Outcome, phase timeline, step graph, blockers, and next safe action.
- Evidence paths and attach/export status.
- Per-role model selection and routing provenance.
- Cost, tokens, latency, retries, and accepted-result status with honest availability labels.

### GUI entry gate

Do not start a GUI until:

- the TUI/read model survives real beta use without frequent schema churn;
- action boundaries are defined as read-only versus gated mutation;
- local single-user versus hosted/multi-user scope is explicit;
- privacy, redaction, authentication, and authorization requirements are resolved for the chosen deployment mode.

---

## Track B — local and external model routing by role or agent

### Product value

Routing is both a capability and an economic control. Different roles need different reasoning depth, context windows, tool-use reliability, privacy boundaries, and latency profiles. A single global model wastes money or weakens quality.

### Decision inputs

- role / agent contract;
- required capability and modality;
- local inventory and endpoint health;
- provider and endpoint policy;
- privacy / data-boundary requirements;
- latency and availability;
- budget and historical task outcome;
- explicit operator override.

### Required outputs

Every selection must be observable:

- provider and model;
- tier and route source;
- local / external endpoint scope without secrets;
- fallback or escalation reason;
- usage-accounting availability;
- policy decision and rejection reason when blocked.

### Validation rules

- No silent cross-tier escalation.
- No silent local-to-remote fallback.
- Unknown inventory, provider, authority, or endpoint classification fails closed.
- Operator overrides remain policy-checked and traceable.
- Reports compare **cost per accepted result**, not nominal token price alone.
- Cost analysis includes retries, tools, latency, fallbacks, human review, and rework when evidence exists.

---

## Track C — semantic model and constrained DSL

### External design reference

Unmesh Joshi's *DSLs Enable Reliable Use of LLMs* (Martin Fowler, 14 July 2026) argues that abstractions and small DSLs reduce the space of valid generation, provide deterministic validation, and allow the durable artifact to become the semantic program rather than the original prompt:

- <https://martinfowler.com/articles/llm-and-dsls.html>

This source is design input, not project authority.

### ai-minions interpretation

The prompt must not become the system of record. The intended flow is:

```text
natural-language intent
        |
canonical semantic specification / IR
        |
syntax + schema validation
        |
semantic invariants
        |
policy and CERBERUS gates
        |
execution
        |
trace + evidence
```

JSON or YAML may carry the specification, but carrier syntax must not accidentally define execution semantics.

### First candidate: evaluation-scenario specification

Begin with a narrow, repetitive, deterministic domain rather than a general workflow language.

Candidate scenarios:

- context-authority decisions;
- tool and MCP failure modes;
- model-routing policy and fallback rejection;
- prompt-injection / red-team cases;
- output-contract violations.

The specification should compile or generate:

- fixtures;
- assertions;
- expected trace events;
- expected reason codes;
- CERBERUS review inputs;
- operator-readable failure explanations.

### Validation layers

1. **Syntax:** the artifact parses.
2. **Schema:** required fields and types exist.
3. **Semantics:** combinations are internally valid.
4. **Policy:** execution is authorized.
5. **Evidence:** the observed trace matches the declared expectation.
6. **CERBERUS:** unsupported claims or unsafe transitions are rejected.

### Example invariants

- `accepted` requires evidence of validation and CERBERUS pass when policy requires it.
- `unknown` cannot become `allow` implicitly.
- `local_only` cannot resolve to an external endpoint.
- an agent cannot approve its own output where independent review is required.
- a repair loop cannot change the original goal or relax policy merely to make validation pass.

### Rejected scope

Do not begin with:

- a general-purpose orchestration language;
- a second configuration authority beside existing contracts;
- prompt templates relabeled as a DSL;
- a language without deterministic validators;
- automatic repair that can silently alter intent, authority, or safety constraints.

---

## Recommended sequence

| Phase | Scope | Exit evidence |
|-------|-------|---------------|
| **0. Solid beta** | Stable operator path and accepted-result evidence | Cohort friction shows users can run, inspect, recover, and export without maintainer translation |
| **1. Routing coherence** | Complete per-role local/external selection, trace honesty, and fail-closed fallback policy | Selection and accounting fields are reliable across CLI/report/TUI |
| **2. Interactive TUI** | Read-only navigation over the canonical run model | Real-run usability evidence; no second source of truth |
| **3. Eval semantic-spec spike** | One narrow scenario family compiled into fixtures/assertions/traces | Equal or better coverage with less duplication and no ambiguity |
| **4. Gated TUI actions** | Explicit approvals/retry/resume where contracts permit | Policy checks and trace evidence for every mutation |
| **5. Optional GUI** | Local control-plane presentation first; hosted scope only by separate decision | Auth/privacy/deployment contracts complete for the selected mode |
| **6. Broader DSL evaluation** | Expand only where vocabulary and invariants have stabilized | Measured reduction in invalid outputs, repair loops, and review effort |

Tracks 2 and 3 may proceed in parallel after Phase 1, but neither may redefine routing, trace, or governance authority.

---

## Market hypothesis

The visible market value is not “we have a TUI” or “we route models.” Those features are easy to copy badly.

The defensible combination is:

- **legibility:** operators can understand what happened and what is safe next;
- **economics:** each role uses an appropriate local or external model, measured by accepted outcomes;
- **reliability:** intent is represented in constrained, validated artifacts rather than recovered from chat history;
- **governance:** every decision remains attributable, rejectable, and trace-backed.

This should improve adoption without weakening the core positioning: **legible before approval, not prettier prompts**.

---

## Failure scenarios to guard against

- The GUI becomes a second implementation of business logic and drifts from CLI behavior.
- Interactive controls bypass the same gates enforced by the runner.
- Routing optimizes token price while increasing retries, latency, or human rework.
- A DSL grows until it is another general-purpose programming language with worse tooling.
- Generated specifications validate structurally but contradict business intent.
- Automatic repair changes constraints to satisfy the validator.
- Product messaging claims multi-user control plane, autonomous execution, or production readiness before evidence exists.
