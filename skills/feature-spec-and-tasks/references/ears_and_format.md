# EARS Notation and Spec Document Format

Reference for writing **feature/initiative specs** (Kiro-style): turn a natural-language goal into structured requirements, design, and discrete tasks (epic + tickets). Use when the user wants a **spec document** for an initiative (e.g. "add observability to this repo", "migrate to X", "adopt automated detection and runbooks") — not an API contract (OpenAPI).

## EARS (Easy Approach to Requirements Syntax)

Use EARS to write clear, testable requirements. Each requirement is one of these patterns:

| Type | Pattern | Example |
|------|--------|---------|
| **Ubiquitous** | The &lt;system&gt; SHALL &lt;action&gt; | The system SHALL log all API requests. |
| **Event-driven** | WHEN &lt;trigger&gt; the &lt;system&gt; SHALL &lt;action&gt; | WHEN a deployment fails, the system SHALL notify the team. |
| **Unwanted** | IF &lt;condition&gt; the &lt;system&gt; SHALL NOT &lt;action&gt; | IF credentials are missing, the system SHALL NOT start. |
| **State-driven** | WHILE &lt;state&gt; the &lt;system&gt; SHALL &lt;action&gt; | WHILE in maintenance mode, the system SHALL return 503. |
| **Complex** | WHERE &lt;context&gt;, WHEN &lt;trigger&gt;, the &lt;system&gt; SHALL &lt;action&gt; | WHERE in production, WHEN error rate > 5%, the system SHALL alert. |

- Use **SHALL** for mandatory; **SHOULD** for recommended.
- One requirement per statement; avoid "and" in a single requirement.
- When a **Glossary** exists, use **THE &lt;Glossary_term&gt;** in requirements (e.g. THE Data_Contract, THE Collector) so entities are consistent and traceable.
- Under each requirement, add **numbered acceptance criteria** (1., 2., …) when there is more than one criterion; tasks can then reference at criterion level (e.g. Satisfies: REQ-001.1, REQ-001.2).

## Spec Document Structure (Epic + Tickets)

The output is a **single spec document** (e.g. `docs/specs/<initiative>.md` or user-chosen path). For very large initiatives (e.g. 15+ requirements, 20+ tasks) or when the user uses Kiro, prefer the **multi-file** layout (see "When to use this format" and `references/kiro_spec_format.md`).

### 1. Overview (Epic-level)

- **Initiative**: Short name (e.g. "Observability adoption for my-app").
- **Goal**: One or two sentences on what success looks like.
- **Scope**: In scope / out of scope; repo or area of codebase.
- **Prerequisites**: What must be true before starting (access, tools, decisions).
- **Context (read first)** (optional): When the initiative touches legacy or domain-heavy systems, list key assets (ADRs, runbooks, glossary, critical files) the implementer should read first.

### 2. Glossary (recommended for domain-heavy initiatives)

- **When**: Initiatives with domain terms, acronyms, or named components (e.g. pipelines, collectors, data contracts, alarms).
- **Content**: Definitions of key terms and entities (e.g. Run_ID, Data_Contract, Collector, Pipeline). Use the same names in requirements (THE &lt;term&gt;) and in tasks so agents and humans share one vocabulary.
- **Placement**: Right after Overview, before Requirements.

### 3. Requirements (EARS)

- Numbered list of requirements (REQ-001, REQ-002, …).
- **Optional**: Under each requirement, add a **User story** line: "As a [role], I want [goal] so that [benefit]."
- **Acceptance criteria**: For each requirement, list criteria as a **numbered list** (1., 2., 3.). Tasks reference criteria as REQ-XXX.Y (e.g. REQ-001.1, REQ-001.2) for granular traceability.
- Group by theme (e.g. Observability, Automation, Security) if there are many.

### 4. Design (Optional but recommended)

- **Architecture / approach**: High-level (components, integrations, data flow).
- **Constraints**: Tech stack, existing patterns, non-functional (e.g. no new cloud account).
- **Decisions**: Key choices (e.g. "Use vendor X for metrics; keep logs in current backend"). When the initiative relies on domain or tribal knowledge, **explicitly capture** in the spec the decisions and rationale that aren't written elsewhere.

### 5. Tasks (Tickets)

- **Discrete tasks**, each with:
  - **ID**: TASK-001, TASK-002, … (and optionally **subtasks** TASK-002.1, TASK-002.2 for large specs).
  - **Title**: Short, action-oriented.
  - **Optional (MVP)**: Mark tasks that can be deferred for a first release (e.g. "TASK-00N (optional): property tests").
  - **Skill / Agent**: Which skill or agent implements this task (see list below).
  - **Deliverables**: Concrete artifacts (paths, filenames, or outputs). E.g. `terraform component at infra/foo`, `OTEL config at config/otel.yaml`, `Grafana dashboard pipeline_health`.
  - **Satisfies**: Requirement IDs, and when useful criterion IDs (e.g. REQ-001, REQ-002.1, REQ-002.2).
  - **Prerequisites**: What must be done before this task (other tasks or external).
  - **Steps / checklist**: Ordered steps or checklist.
  - **Acceptance**: How to verify the task is done. Must be **verifiable** (automated check, concrete checklist, or explicit sign-off). Prefer **validation** (did we get the desired outcome?) over only **verification** (did we follow the steps?).
  - **Estimate** (optional): S/M/L or hours.

- **Checkpoint tasks** (optional): For phased execution, add tasks like "TASK-0XX: Checkpoint — ensure [condition] before next phase." No deliverable; gate before proceeding. E.g. "Checkpoint: ensure all components deployed and smoke tests pass."
- **Validation / property test tasks** (optional): When the initiative has many requirements, add tasks that state which requirements they cross-check (e.g. "Validates: REQ-4.2, REQ-4.3, REQ-4.4").
- **Order**: List tasks in dependency order. For complex specs, add a **Deployment order** subsection (numbered list of phases) and optionally a **Directory structure** (ASCII tree of where artifacts live).

**Skill / Agent values** (use exactly; one per task):

| Skill / Agent | Use when the task is about |
|---------------|-----------------------------|
| `designing-terraform` | Architecture, design doc, ADR, or component list for Terraform/infra — no code yet. |
| `creating-terraform` | Scaffold or create Terraform components, modules, HCL (use component-scaffolder + resource-builder). |
| `reviewing-terraform` | Review, audit, or validate existing Terraform. |
| `configuring-observability` | OTEL config, Grafana dashboards, alert rules, observability pipeline (otel-config-builder, grafana-dashboard-builder, observability-validator). |
| `infra-documenter` | ADR, runbook, changelog, architecture diagram, or any persistent documentation. |
| `compliance-checker` | Validate against compliance framework (only if project declares one). |
| `network-validator` | Validate or design VPC, subnets, DNS, SGs, peering. |
| `reviewing-docker` | Review or audit Dockerfiles. |
| `managing-n8n` | Create, validate, or optimize n8n workflows. |
| `creating-circleci` / `reviewing-circleci` | Create or review CircleCI config. |
| **Manual / security review** | Run security scan; review and apply only approved patches. Use when: (1) you have [Claude Code Security](https://claude.com/product/claude-security) (claude.com, Enterprise/Team) — run scan there and create tickets from validated findings; (2) otherwise use `compliance-checker` (Checkov/Trivy) + `reviewing-terraform` / `reviewing-docker` + manual review. Document findings and remediation status. |
| **Manual / review** | Human-only decision, sign-off, or cross-cutting review (non-security). |

### 6. Deployment order (for larger specs)

- **When**: Spec has multiple phases or many tasks.
- **Content**: Numbered list of phases or milestones (e.g. "1. Create module structure. 2. Implement core components. 3. Checkpoint. 4. Add integrations. 5. Documentation."). Referenced from "Before executing" so the implementer knows the sequence.

### 7. Directory structure (optional)

- **When**: Artifacts live in many paths or the repo layout is not obvious.
- **Content**: ASCII tree of key directories and files (e.g. `infra/module-name/`, `config/`, `docs/adr/`). Helps implementers and agents find where to create or edit files.

### 8. Documentation (required)

- **Every initiative must plan documentation.** Include one of:
  - **Documentation tasks** in the task list (Skill: `infra-documenter`), e.g. ADR, runbook update, changelog entry.
  - Or a **Documentation** subsection listing: ADRs to write, runbooks to create/update, changelog entries, diagrams — and which implementation tasks they cover.
- **Per deliverable**: When a task produces infra, config, or code, the same or a follow-up task must ensure it is documented. Prefer explicit doc tasks with Skill: `infra-documenter`.
- **Optional tasks**: If any tasks are marked optional (e.g. for MVP), add one line: "Tasks marked **(optional)** can be deferred for MVP or first release."

### 9. What to do before executing

- Short section: "Before executing" — environment, credentials, branch, config, or tools that must be in place before running any task. If there is a **Deployment order**, reference it (e.g. "Follow the Deployment order in Tasks; ensure directory structure exists where applicable").

### Security (when the initiative touches code or infra)

- Include at least one **security review** task (Skill: **Manual / security review**).
- **If you have access**: [Claude Code Security](https://claude.com/product/claude-security) (claude.com, Enterprise/Team) — run scan there and create follow-up tasks from findings.
- **Otherwise**: Use `compliance-checker` (Checkov/Trivy), `reviewing-terraform`, `reviewing-docker`, and manual review; document findings in the spec or a dedicated doc.

## When to use this format

- **This format (feature-spec-and-tasks)**: Initiatives, epics, "apply X to repo Y", "plan for adopting Z", bugfix plans. Output: one document with Overview, Glossary (if domain-heavy), Requirements (EARS + numbered criteria), Design, Tasks (with optional subtasks, checkpoints, optional marking), Deployment order, Directory structure, Documentation, Before executing.

- **Multi-file (Kiro-style)**: Use when (1) the user works with [Kiro](https://kiro.dev/docs/specs/) or wants specs in `.kiro/specs/<name>/`, or (2) the initiative is large (e.g. 15+ requirements, 20+ tasks). Output separate `requirements.md` (glossary + EARS + user stories + numbered criteria), `design.md`, and `tasks.md` with requirement traceability. See `references/kiro_spec_format.md` for the exact structure and how it maps to this single-doc format.

## Example (condensed, generic)

```markdown
# Spec: Observability adoption for my-app

## Overview
- **Initiative**: Observability adoption for my-app
- **Goal**: Add metrics, automated detection, and runbook automation so the team can detect and respond to failures quickly.
- **Scope**: Repo my-org/my-app; CI pipelines and app services in scope; out of scope: other repos.
- **Prerequisites**: Read access to repo; access to metrics backend and dashboards.

## Glossary
- **Run_ID**: Unique identifier for a single pipeline or job run; used to correlate logs, metrics, and traces.
- **Data_Contract**: Document that defines metric names, dimensions, and log fields all components must use.
- **Collector**: Service that receives telemetry from the app and exports it to the metrics/logs backend.

## Requirements (EARS)
- **REQ-001**: WHEN a pipeline fails, the system SHALL record the failure and emit a metric.
  - User story: As a platform engineer, I want failures to be recorded and metrified so that I can alert and analyze.
  - Acceptance criteria:
    1. THE system SHALL emit a metric with dimension result=FAILURE.
    2. THE metric SHALL include Run_ID for correlation.
- **REQ-002**: The system SHALL expose pipeline duration and success rate as metrics.
  - Acceptance criteria:
    1. THE system SHALL expose duration in milliseconds.
    2. THE system SHALL expose success rate as a counter or gauge per pipeline name.
- **REQ-003**: WHEN success rate drops below 95%, the system SHALL create an alert.
...

## Design
- Use existing metrics plugin for the CI system; add Grafana dashboard. Logs: keep in current backend, add structured fields per Data_Contract.
...

## Tasks (Tickets)

### TASK-001: Add metrics export to CI pipeline
- **Skill / Agent**: configuring-observability
- **Deliverables**: Pipeline config; scrape endpoint or exporter config at `config/metrics.yaml`.
- **Satisfies**: REQ-001.1, REQ-001.2, REQ-002.1, REQ-002.2
- **Prerequisites**: CI admin access; metrics backend reachable.
- **Steps**: 1. Enable metrics export. 2. Configure scrape or OTLP. 3. Verify in backend.
- **Acceptance**: Metrics visible in backend for pipeline X.
- **Estimate**: M

### TASK-002: Create Grafana dashboard for pipeline health
- **Skill / Agent**: configuring-observability
- **Deliverables**: Grafana dashboard JSON at `docs/dashboards/pipeline_health.json`.
- **Satisfies**: REQ-002
- **Prerequisites**: TASK-001 done.
- **Steps**: ...
- **Estimate**: M

### TASK-003: Checkpoint — verify metrics and dashboard
- **Skill / Agent**: Manual / review
- **Deliverables**: None (gate).
- **Satisfies**: REQ-001, REQ-002
- **Prerequisites**: TASK-001, TASK-002 done.
- **Acceptance**: Metrics and dashboard verified; no blockers for alerting phase.

### TASK-004 (optional): Add property tests for metric naming
- **Skill / Agent**: configuring-observability or manual
- **Deliverables**: Tests that validate metric names match Data_Contract.
- **Satisfies**: REQ-002 (validation)
- **Prerequisites**: TASK-001 done.
- **Estimate**: S

### TASK-00N: Document metric backend choice and runbook
- **Skill / Agent**: infra-documenter
- **Deliverables**: ADR in `docs/adr/`; runbook update for pipeline alerts.
- **Satisfies**: Documentation for REQ-001..REQ-003
- **Prerequisites**: TASK-001, TASK-002 done.
- **Steps**: 1. Write ADR. 2. Update runbook with alert response steps.
- **Acceptance**: ADR and runbook exist and are linked from README or spec.
- **Estimate**: S

## Deployment order
1. TASK-001 (metrics export). 2. TASK-002 (dashboard). 3. TASK-003 (checkpoint). 4. TASK-004 if not deferred. 5. TASK-00N (documentation).

## Documentation
- TASK-00N covers ADR and runbook. Tasks marked **(optional)** can be deferred for MVP.

## Before executing
- Ensure CI and metrics backend URLs and credentials are available. Run from branch `feature/observability`. Have dashboard write access.
```

All content (requirements, design, tasks, "before executing") in **English** in the spec.

## References / further reading

- **Fujitsu AI-Driven Software Development Platform** (2026): AI-Ready Engineering (preparing assets so agents understand systems), compliance/regulatory tracing, multi-layer quality..
- **InfoQ – Does AI Make the Agile Manifesto Obsolete?** (2026): In agentic SDLCs the bottleneck shifts to "what to build and validate it works"; documentation and intent design become more critical. Verification (did it do what I said?) vs validation (did it do what I wanted?). [InfoQ](https://www.infoq.com/news/2026/02/ai-agile-manifesto-debate/).
- **Agent Factory – Preface (agent-native)**: Spec as living contract; intent before implementation; specs as executable. [Agent Factory](https://agentfactory.panaversity.org/docs/preface-agent-native).
