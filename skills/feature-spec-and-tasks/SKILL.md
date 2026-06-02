---
name: feature-spec-and-tasks
description: "Generate a feature/initiative spec document with requirements (EARS), design, and discrete tasks (epic + tickets). Use when user asks to design a spec for an initiative, apply X to a repo, create epic and tickets, plan implementation with tasks, or get a Kiro-style spec (requirements + design + task breakdown) before executing."
---

# Feature Spec and Tasks (Kiro-style)

Turn a natural-language goal (e.g. "add observability to this repo", "migrate to X", "adopt automated detection and runbooks") into a **spec document**: structured **requirements** (EARS), **design** (architecture/constraints), and **discrete tasks** (tickets) with prerequisites and steps — so you know **what to do before executing**. For very large initiatives or when the user uses Kiro, output can be **multi-file** (requirements.md, design.md, tasks.md). Inspired by [Kiro's spec-driven development](https://kiro.dev/docs/specs/).

In agentic workflows the bottleneck shifts from "how do humans collaborate to build" to **what to build and validating it works**. The spec encodes **intent**; acceptance criteria should support **validation** (did we get the desired outcome?) not only verification (did we follow the steps?). Unclear requirements lead to endless iterations—specs must be explicit and testable.

## What this skill produces

- **Epic-level doc**: Goal, scope, prerequisites; optional **Context (read first)** for legacy or domain-heavy systems.
- **Glossary** (recommended for domain-heavy initiatives): Key terms and entities (e.g. Run_ID, Data_Contract, Collector) so requirements and tasks use the same vocabulary; use **THE &lt;term&gt;** in EARS when a glossary exists.
- **Requirements**: In EARS notation (When/Where/What); **numbered acceptance criteria** (1., 2., …) per requirement for traceability; optional **User story** per requirement.
- **Design**: Architecture, constraints, key decisions (optional but recommended).
- **Tasks (tickets)**: Discrete tasks, ordered by dependencies, each with:
  - **Skill / Agent**, **Deliverables**, **Satisfies** (requirement IDs, and when useful criterion IDs e.g. REQ-001.1, REQ-001.2).
  - Prerequisites, steps/checklist, and **verifiable** acceptance.
  - Optional **subtasks** (TASK-002.1, TASK-002.2) for large specs; optional **(optional)** marking for tasks deferrable for MVP; optional **Checkpoint** tasks (gate before next phase).
- **Deployment order** (for larger specs): Numbered list of phases. **Directory structure** (optional): ASCII tree of artifact paths.
- **Documentation**: Every deliverable must be documented — explicit documentation tasks (Skill: `infra-documenter`) or a Documentation subsection; note which tasks are **(optional)** for MVP.
- **Before executing**: What must be in place before running any task; reference Deployment order when present.

## Prerequisites

- **Read access** to the repo or codebase the user refers to (so you can propose design and tasks that match the project).
- No mandatory CLI or MCP; optional: `infra-documenter` for ADRs if the initiative has major design decisions.

### Context / AI-readiness (when the initiative touches legacy or complex systems)

When the initiative touches legacy systems, many moving parts, or domain-heavy codebases, the spec can include a **Context** note: key existing assets (ADRs, runbooks, glossary, or critical files) the implementer—human or agent—should read first. That makes the system "AI-ready" and reduces misinterpretation. List them in Overview or in a short "Context (read first)" subsection.

## Input

The user provides one or more of:

- A goal and a repo (e.g. "design the spec for adding observability to repo my-org/my-app").
- A goal only (e.g. "plan to add observability"; you infer or ask for the repo/area).
- A request for "epic and tickets", "implementation plan", "tasks with dependencies", or "what to do before executing".

## Workflow

```
1. Understand goal and scope (repo, area, constraints)
       ↓
2. spec-writer → produce full spec document
       ↓
   - Overview (epic), Glossary (if domain-heavy)
   - Requirements (EARS, numbered criteria, optional user stories)
   - Design (architecture, constraints)
   - Tasks (Skill/Agent, Deliverables, Satisfies REQ-X.Y, optional subtasks, checkpoints, optional marking)
   - Deployment order, Directory structure (if large spec)
   - Documentation (doc tasks or subsection)
   - Before executing
       ↓
3. User (or agent) can later implement task-by-task using this spec
```

### Step 1: Clarify

- Identify the **initiative** (e.g. observability adoption, migration, automated detection).
- Identify **scope**: repo name, path, or "this repo".
- **Budget and cost controls (critical)**: If the initiative can incur cloud, SaaS, or third-party costs (e.g. AWS, GCP, Datadog, CI minutes), always ask: **What is the approved budget or spend cap? Are billing alerts or AWS Budgets (or equivalent) required?** Uncontrolled spend can lead to very large surprise bills; the spec must capture budget constraints and cost-control tasks so they are implemented from day one.
- If unclear on scope, ask: which repo? which part of the codebase? any other constraints (stack, no new services)?

### Step 2: Produce spec (spec-writer)

Run **spec-writer** to generate the full document:

- Read or infer repo structure (files, existing patterns) when possible.
- **Enrich by initiative type** (see below): if the goal matches a known initiative type, include that type’s design and task checklist in the spec **so the spec is complete before implementation** and implementation does not drift.
- When the initiative is **domain-heavy**, add a **Glossary** (key terms and entities) and use **THE &lt;term&gt;** in requirements.
- Write **requirements** in EARS with **numbered acceptance criteria** (1., 2., …) per requirement; optional **User story** per requirement (see `references/ears_and_format.md`).
- Add **design** (high-level architecture, constraints, decisions).
- List **tasks** as tickets: ID, title, **Skill/Agent**, **Deliverables**, **Satisfies** (REQ-XXX or REQ-XXX.Y), prerequisites, steps/checklist, acceptance, optional estimate. Use **subtasks** (TASK-002.1, TASK-002.2) when the spec is large; mark **optional** tasks (deferrable for MVP); add **Checkpoint** tasks to gate phases. Order by dependencies.
- For **larger specs**, add **Deployment order** (numbered phases) and optionally **Directory structure** (ASCII tree).
- Add **documentation** tasks (Skill: `infra-documenter`) or a Documentation subsection; note "(optional)" tasks that can be deferred.
- State explicitly what must be done **before executing** (env, credentials, branch, tools); reference Deployment order when present.
- **Multi-file output**: When the user uses **Kiro** or the initiative is **large** (e.g. 15+ requirements, 20+ tasks), produce the multi-file layout per `references/kiro_spec_format.md` instead of a single document.

#### Initiative-type checklists (pre-implementation)

Use these **only when the user’s goal clearly matches** the initiative type. They are not global; they avoid drift by making the spec complete up front.

- **Central reusable-workflows / CI repo** (e.g. a repo that only stores versioned, callable workflows for other repos to `uses:`):
  - **Design**: Include `.github/actions/` (composite actions) and list which ones (validate-inputs, install-deps, run-script, lint/scan, etc.) and their inputs/outputs; state that workflows use them to minimize inline scripts and third-party actions.
  - **Design**: Include a **validation workflow** (e.g. runs on PR when `.github/**` changes; runs a workflow/action linter so changes are validated before merge).
  - **Design**: Define **release/versioning**: manual tag + CHANGELOG vs automated (e.g. semantic-release on push to main); if automated, a non-reusable release workflow.
  - **Design**: Require an **invocation example** in each reusable workflow file: a top-of-file comment block with “Example in consumer repo” (trigger + job with `uses:` and typical inputs).
  - **Design**: If the org restricts “no curl” or “no third-party actions” for some tools, state that those tools are installed via **clone-at-version + install script or build**; add a task or acceptance for it.
  - **Design**: If workflows must post to PRs, state **PR comment behavior**: single create/update comment per run, identified by a marker; use only official actions (e.g. `actions/github-script`).
  - **Tasks**: Add explicit tasks for composite actions, validation workflow, release workflow (if automated), and “invocation example in each workflow file”; add acceptance criteria that match the design.

- **Compliance / regulatory-driven** (e.g. "implement 2026 fee revision", "meet new regulation X"):
  - **Requirements**: Trace each requirement to its source (e.g. "REQ-XXX: per [regulation/spec ref], section Y").
  - **Design or Requirements**: Add a subsection **Points open to interpretation** listing items where the regulation or policy is ambiguous and human judgment is required; this avoids agents making assumptions on grey areas.

- **Cloud / infrastructure / paid services** (e.g. new AWS components, observability stack, SaaS integrations, CI runners, any resource that incurs recurring or usage-based cost):
  - **Requirements**: Add an explicit **Budget and cost control** requirement (e.g. "REQ-BUDGET: Approved budget or spend cap is X; billing alerts must fire at Y% of budget; cost allocation tags must be applied so spend is attributable by project/env.").
  - **Design**: Include a **Cost controls** subsection: who owns cost visibility (Cost Explorer, billing dashboard), whether AWS Budgets (or equivalent) are required for this initiative, at what thresholds alerts fire, and how cost allocation tags (e.g. `environment`, `application`, `costbucket`) are applied.
  - **Tasks**: Add at least one task for cost controls: e.g. "Define and create AWS Budget(s) and alerts for this component/project" or "Ensure all resources have cost allocation tags; document budget and alert thresholds." Acceptance: budget/alert exists and is documented, or explicit decision that no budget is needed (with owner sign-off).
  - **Rationale**: Uncontrolled cloud or SaaS spend can result in very large surprise bills; making budget and alerts part of the spec ensures they are implemented before or alongside the feature, not after the fact.

### Step 3: Output location

- Write to `docs/specs/<initiative_slug>.md` or path given by user.
- If the user only asked for the content, output the spec in the reply and suggest saving to a file.
- **If the user uses Kiro**, wants specs in `.kiro/specs/<name>/`, or the initiative is **large** (e.g. 15+ requirements, 20+ tasks): produce the **multi-file** layout (`requirements.md`, `design.md`, `tasks.md`, optional `.config.kiro`) as described in `references/kiro_spec_format.md`; write each file to the spec directory.

## Agents

This skill uses 1 agent + 1 shared agent (optional).

### 1. `spec-writer` (green)
**Tools**: Read, Grep, Glob, Write
**Responsibility**: Produce the full spec document (overview, requirements, design, tasks, before executing)

| Action | Details |
|--------|--------|
| Overview | Initiative name, goal, scope, prerequisites; when relevant, **Context** (key assets to read first for AI-readiness) |
| Glossary | When domain-heavy: key terms and entities; use THE &lt;term&gt; in requirements |
| Requirements | EARS statements; **numbered acceptance criteria** (1., 2., …) per requirement; optional User story; group by theme; IDs REQ-001, … |
| Design | Architecture, constraints, key decisions |
| Tasks | TASK-001, … (and subtasks TASK-002.1, … when large); **Skill/Agent**, **Deliverables**, **Satisfies** (REQ-X.Y); optional **(optional)** and **Checkpoint** tasks; prerequisites, steps, acceptance, estimate |
| Order | Tasks in dependency order; **Deployment order** and **Directory structure** for larger specs |
| Documentation | Doc tasks (Skill: infra-documenter) or subsection; note optional tasks for MVP |
| Before executing | Environment, credentials, branch, tools, config; reference Deployment order when present |
| Budget/cost (when applicable) | If initiative touches paid services: budget cap, billing alerts, cost allocation; at least one cost-control task with clear acceptance |

### 2. `infra-documenter` (orange) — shared, optional
**When**: Initiative has major architectural or tooling decisions worth an ADR.
**Action**: Add or link an ADR in `docs/adr/` and reference it from the spec.

## Output format

Follow the structure in `references/ears_and_format.md`. Summary:

```
# Spec: <initiative name>

## Overview
- Initiative, goal, scope, prerequisites; optional Context (read first)

## Glossary (when domain-heavy)
- Term_One: definition. Term_Two: definition. (Use THE <term> in requirements.)

## Requirements (EARS)
- REQ-001: statement. User story (optional). Acceptance criteria: 1. ... 2. ...
- REQ-002: ...

## Design
- Architecture, constraints, decisions

## Tasks (Tickets)
### TASK-001: <title>
- Skill / Agent: creating-terraform | configuring-observability | infra-documenter | ...
- Deliverables: <path or artifact>
- Satisfies: REQ-001.1, REQ-001.2, REQ-002
- Prerequisites: ...
- Steps: 1. ... 2. ...
- Acceptance: ...
- Estimate: S/M/L

### TASK-002: ... (optional subtasks TASK-002.1, TASK-002.2 when large)
### TASK-003: Checkpoint — <condition> (optional gate task)
### TASK-00N (optional): <title> (deferrable for MVP)
(ordered by dependencies; include documentation tasks with Skill: infra-documenter)

## Deployment order (when larger spec)
1. Phase one. 2. Phase two. 3. Checkpoint. ...

## Directory structure (optional)
<ASCII tree of artifact paths>

## Documentation
- Doc tasks above and/or: ADRs, runbooks, changelog; note which tasks are (optional) for MVP

## Before executing
- What must be in place; reference Deployment order when present
```

## Rules

- All spec content (requirements, design, tasks) in **English**.
- Tasks must be **discrete** and **implementable**; each with clear, **verifiable** acceptance (automated check, checklist, or explicit sign-off—not vague success criteria).
- Every task must have **Skill / Agent** and **Deliverables** so Terraform, observability, and other skills can implement with minimal human intervention.
- **Documentation is required**: include documentation tasks (Skill: `infra-documenter`) or a Documentation subsection so every deliverable is documented (ADRs, runbooks, changelog, diagrams).
- Prerequisites and "Before executing" must answer **what to do before execution** explicitly.
- If the user mentions a repo, try to reflect its structure and stack in design and tasks; if you cannot read the repo, say so and produce a generic spec.
- Do not execute tasks or run destructive commands — only produce the spec document.
- **Budget and cost controls**: When the initiative can incur cloud, SaaS, or third-party costs, the spec **must** include: (1) a stated budget or spend cap, (2) a requirement or task for billing alerts / AWS Budgets (or equivalent), and (3) cost allocation (tags or equivalent) so spend is visible and attributable. Do not leave cost controls implicit or "for later"—surprise bills are a real risk and must be prevented in the spec.
- **Post-implementation**: If the user asks to align the spec with an existing implementation (e.g. detect drift), add a **Drift and alignment** section: a short table (spec vs implemented) and bullets to update the spec so it stays the source of truth. Treat the spec as a **living contract**—update it when implementation or intent changes. Initiative-specific patterns belong in that spec or in separate reference docs, not in this skill.
