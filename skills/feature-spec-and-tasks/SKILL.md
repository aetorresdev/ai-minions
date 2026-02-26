---
name: feature-spec-and-tasks
description: "Generate a feature/initiative spec document with requirements (EARS), design, and discrete tasks (epic + tickets). Use when user asks to design a spec for an initiative, apply X to a repo, create epic and tickets, plan implementation with tasks, or get a Kiro-style spec (requirements + design + task breakdown) before executing."
---

# Feature Spec and Tasks (Kiro-style)

Turn a natural-language goal (e.g. "apply AIOps to devops-jenkins-automation", "add observability to this repo") into a **single spec document**: structured **requirements** (EARS), **design** (architecture/constraints), and **discrete tasks** (tickets) with prerequisites and steps — so you know **what to do before executing**. Inspired by [Kiro's spec-driven development](https://kiro.dev/docs/).

In agentic workflows the bottleneck shifts from "how do humans collaborate to build" to **what to build and validating it works**. The spec encodes **intent**; acceptance criteria should support **validation** (did we get the desired outcome?) not only verification (did we follow the steps?). Unclear requirements lead to endless iterations—specs must be explicit and testable.

## What this skill produces

- **Epic-level doc**: Goal, scope, prerequisites.
- **Requirements**: In EARS notation (When/Where/What); testable and explicit.
- **Design**: Architecture, constraints, key decisions (optional but recommended).
- **Tasks (tickets)**: Discrete tasks, ordered by dependencies, each with:
  - **Skill / Agent**: Which skill implements the task (e.g. `creating-terraform`, `configuring-observability`, `infra-documenter`) for minimal human intervention.
  - **Deliverables**: Concrete artifacts (paths, filenames) so the implementing agent knows what to produce.
  - Description, prerequisites, steps/checklist, and testable acceptance.
- **Documentation**: Every deliverable must be documented — explicit documentation tasks (Skill: `infra-documenter`) or a Documentation subsection (ADRs, runbooks, changelog, diagrams).
- **Before executing**: What must be in place before running any task.

## Prerequisites

- **Read access** to the repo or codebase the user refers to (so you can propose design and tasks that match the project).
- No mandatory CLI or MCP; optional: `infra-documenter` for ADRs if the initiative has major design decisions.

### Context / AI-readiness (when the initiative touches legacy or complex systems)

When the initiative touches legacy systems, many moving parts, or domain-heavy codebases, the spec can include a **Context** note: key existing assets (ADRs, runbooks, glossary, or critical files) the implementer—human or agent—should read first. That makes the system "AI-ready" and reduces misinterpretation. List them in Overview or in a short "Context (read first)" subsection.

## Input

The user provides one or more of:

- A goal and a repo (e.g. "diseña el spec para aplicar AIOps al repo devops-jenkins-automation").
- A goal only (e.g. "plan to add observability"; you infer or ask for the repo/area).
- A request for "epic and tickets", "implementation plan", "tasks with dependencies", or "what to do before executing".

## Workflow

```
1. Understand goal and scope (repo, area, constraints)
       ↓
2. spec-writer → produce full spec document
       ↓
   - Overview (epic)
   - Requirements (EARS)
   - Design (architecture, constraints)
   - Tasks (tickets with Skill/Agent, Deliverables, prerequisites, steps)
   - Documentation (doc tasks or subsection)
   - Before executing
       ↓
3. User (or agent) can later implement task-by-task using this spec
```

### Step 1: Clarify

- Identify the **initiative** (e.g. AIOps adoption, observability, migration).
- Identify **scope**: repo name, path, or "this repo".
- If unclear, ask: which repo? which part of the codebase? any constraints (stack, budget, no new services)?

### Step 2: Produce spec (spec-writer)

Run **spec-writer** to generate the full document:

- Read or infer repo structure (files, existing patterns) when possible.
- **Enrich by initiative type** (see below): if the goal matches a known initiative type, include that type’s design and task checklist in the spec **so the spec is complete before implementation** and implementation does not drift.
- Write **requirements** in EARS (see `references/ears_and_format.md`).
- Add **design** (high-level architecture, constraints, decisions).
- List **tasks** as tickets: ID, title, **Skill/Agent**, **Deliverables**, description, prerequisites, steps/checklist, acceptance, optional estimate. Order by dependencies.
- Add **documentation** tasks (Skill: `infra-documenter`) or a Documentation subsection so every deliverable is documented.
- State explicitly what must be done **before executing** (env, credentials, branch, tools).

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

Other initiative types may have their own checklists (e.g. in `docs/specs/` or references); when the goal matches, incorporate that checklist into the spec.

### Step 3: Output location

- Write to `docs/specs/<initiative_slug>.md` or path given by user.
- If the user only asked for the content, output the spec in the reply and suggest saving to a file.

## Agents

This skill uses 1 agent + 1 shared agent (optional).

### 1. `spec-writer` (green)
**Tools**: Read, Grep, Glob, Write
**Responsibility**: Produce the full spec document (overview, requirements, design, tasks, before executing)

| Action | Details |
|--------|--------|
| Overview | Initiative name, goal, scope, prerequisites; when relevant, **Context** (key assets to read first for AI-readiness) |
| Requirements | EARS statements; group by theme; IDs REQ-001, … |
| Design | Architecture, constraints, key decisions |
| Tasks | TASK-001, …; title, **Skill/Agent**, **Deliverables**, description, prerequisites, steps, acceptance, estimate |
| Order | Tasks in dependency order; note "TASK-Y after TASK-X" when needed |
| Documentation | Doc tasks (Skill: infra-documenter) or subsection; every deliverable covered |
| Before executing | Environment, credentials, branch, tools, config to have in place |

### 2. `infra-documenter` (orange) — shared, optional
**When**: Initiative has major architectural or tooling decisions worth an ADR.
**Action**: Add or link an ADR in `docs/adr/` and reference it from the spec.

## Output format

Follow the structure in `references/ears_and_format.md`. Summary:

```
# Spec: <initiative name>

## Overview
- Initiative, goal, scope, prerequisites

## Requirements (EARS)
- REQ-001: ...
- REQ-002: ...

## Design
- Architecture, constraints, decisions

## Tasks (Tickets)
### TASK-001: <title>
- Skill / Agent: creating-terraform | configuring-observability | infra-documenter | ...
- Deliverables: <path or artifact>
- Satisfies: REQ-xxx
- Prerequisites: ...
- Steps: 1. ... 2. ...
- Acceptance: ...
- Estimate: S/M/L

### TASK-002: ...
(ordered by dependencies; include documentation tasks with Skill: infra-documenter)

## Documentation
- Doc tasks above and/or: ADRs, runbooks, changelog, diagrams (and which tasks they cover)

## Before executing
- What must be in place before running any task
```

## Rules

- All spec content (requirements, design, tasks) in **English**.
- Tasks must be **discrete** and **implementable**; each with clear, **verifiable** acceptance (automated check, checklist, or explicit sign-off—not vague success criteria).
- Every task must have **Skill / Agent** and **Deliverables** so Terraform, observability, and other skills can implement with minimal human intervention.
- **Documentation is required**: include documentation tasks (Skill: `infra-documenter`) or a Documentation subsection so every deliverable is documented (ADRs, runbooks, changelog, diagrams).
- Prerequisites and "Before executing" must answer **what to do before execution** explicitly.
- If the user mentions a repo, try to reflect its structure and stack in design and tasks; if you cannot read the repo, say so and produce a generic spec.
- Do not execute tasks or run destructive commands — only produce the spec document.
- **Post-implementation**: If the user asks to align the spec with an existing implementation (e.g. detect drift), add a **Drift and alignment** section: a short table (spec vs implemented) and bullets to update the spec so it stays the source of truth. Treat the spec as a **living contract**—update it when implementation or intent changes. Initiative-specific patterns belong in that spec or in separate reference docs, not in this skill.
