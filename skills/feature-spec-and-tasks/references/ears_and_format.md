# EARS Notation and Spec Document Format

Reference for writing **feature/initiative specs** (Kiro-style): turn a natural-language goal into structured requirements, design, and discrete tasks (epic + tickets). Use when the user wants a **spec document** for an initiative (e.g. "apply AIOps to this repo", "add observability", "migrate to X") — not an API contract (OpenAPI).

## EARS (Easy Approach to Requirements Syntax)

Use EARS to write clear, testable requirements. Each requirement is one of these patterns:

| Type | Pattern | Example |
|------|--------|--------|
| **Ubiquitous** | The &lt;system&gt; SHALL &lt;action&gt; | The system SHALL log all API requests. |
| **Event-driven** | WHEN &lt;trigger&gt; the &lt;system&gt; SHALL &lt;action&gt; | WHEN a deployment fails, the system SHALL notify the team. |
| **Unwanted** | IF &lt;condition&gt; the &lt;system&gt; SHALL NOT &lt;action&gt; | IF credentials are missing, the system SHALL NOT start. |
| **State-driven** | WHILE &lt;state&gt; the &lt;system&gt; SHALL &lt;action&gt; | WHILE in maintenance mode, the system SHALL return 503. |
| **Complex** | WHERE &lt;context&gt;, WHEN &lt;trigger&gt;, the &lt;system&gt; SHALL &lt;action&gt; | WHERE in production, WHEN error rate > 5%, the system SHALL alert. |

- Use **SHALL** for mandatory; **SHOULD** for recommended.
- One requirement per statement; avoid "and" in a single requirement.
- Add **acceptance criteria** (Given/When/Then or checklist) under each requirement when useful.

## Spec Document Structure (Epic + Tickets)

The output is a **single spec document** (e.g. `docs/specs/<initiative>.md` or user-chosen path) with three main sections.

### 1. Overview (Epic-level)

- **Initiative**: Short name (e.g. "AIOps adoption for devops-jenkins-automation").
- **Goal**: One or two sentences on what success looks like.
- **Scope**: In scope / out of scope; repo or area of codebase.
- **Prerequisites**: What must be true before starting (access, tools, decisions).

### 2. Requirements (EARS)

- Numbered list of requirements in EARS form.
- Group by theme (e.g. Observability, Automation, Security) if many.
- Each requirement: ID (e.g. REQ-001), statement, optional acceptance criteria.

### 3. Design (Optional but recommended)

- **Architecture / approach**: High-level (components, integrations, data flow).
- **Constraints**: Tech stack, existing patterns, non-functional (e.g. no new cloud account).
- **Decisions**: Key choices (e.g. "Use Datadog for metrics; keep logs in CloudWatch").

### 4. Tasks (Tickets)

- **Discrete tasks**, each with:
  - **ID**: TASK-001, TASK-002, …
  - **Title**: Short, action-oriented.
  - **Skill / Agent**: Which skill or agent implements this task (see list below). Enables handoff to the right capability with minimal human intervention.
  - **Deliverables**: Concrete artifacts (paths, filenames, or outputs). E.g. `terraform component at infra/foo`, `OTEL config at config/otel.yaml`, `Grafana dashboard pipeline_health`.
  - **Description**: What to do; links to requirements (e.g. satisfies REQ-001, REQ-002).
  - **Prerequisites**: What must be done before this task (other tasks or external).
  - **Steps / checklist**: Ordered steps or checklist so the user (or an agent) knows what to do before/during execution.
  - **Acceptance**: How to verify the task is done (testable; e.g. "terraform validate passes", "dashboard shows metric X").
  - **Estimate** (optional): S/M/L or hours.

- **Order**: List tasks in dependency order. If dependencies are complex, add a short "Suggested order" or dependency note (e.g. "TASK-002 after TASK-001").

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
| **Manual / security review** | Run security scan; review and apply only approved patches. Use when: (1) you have [Claude Code Security](https://www.anthropic.com/news/claude-code-security) (claude.com, Enterprise/Team) — run scan there and create tickets from validated findings; (2) otherwise use `compliance-checker` (Checkov/Trivy) + `reviewing-terraform` / `reviewing-docker` + manual review. Document findings and remediation status. |
| **Manual / review** | Human-only decision, sign-off, or cross-cutting review (non-security). |

### 5. Documentation (required)

- **Every initiative must plan documentation.** Include one of:
  - **Documentation tasks** in the task list: e.g. "TASK-00N: Write ADR for metric backend choice" (Skill: `infra-documenter`), "TASK-00M: Update runbook for pipeline X" (Skill: `infra-documenter`), "TASK-00K: Add changelog entry for AIOps rollout" (Skill: `infra-documenter`).
  - Or a **Documentation** subsection listing: ADRs to write, runbooks to create/update, changelog entries, diagrams — and reference which implementation tasks they cover.
- **Per deliverable**: When a task produces infra, config, or code, the same or a follow-up task must ensure it is documented (README, inline comments, runbook, or ADR as needed). Prefer explicit doc tasks with Skill: `infra-documenter` so nothing is left undocumented.

### 6. What to do before executing

- Short section: "Before executing" — environment, credentials, branch, config, or tools that must be in place before running any task. This answers "what should be done before execution" explicitly.

### Security (when the initiative touches code or infra)

- For initiatives that add or change code, config, or infrastructure, include at least one **security review** task (Skill: **Manual / security review**).
- **If you have access**: [Claude Code Security](https://www.anthropic.com/news/claude-code-security) (claude.com, Enterprise/Team) runs deep, human-like vulnerability scanning and suggests patches; use its dashboard to triage and create follow-up tasks. Cursor does not call it automatically — run the scan in Claude Code on the web and document findings.
- **Otherwise**: Use existing skills (`compliance-checker` with Checkov/Trivy, `reviewing-terraform`, `reviewing-docker`) and manual review; document findings and remediation in the spec or in a dedicated doc.

## When to use this format

- **This format (feature-spec-and-tasks)**: Initiatives, epics, "apply X to repo Y", "plan for adopting Z", bugfix plans (current/expected/unchanged behavior → tasks). Output: one document with requirements + design + tasks (epic + tickets) + documentation plan.

## Example (condensed)

```markdown
# Spec: AIOps adoption for devops-jenkins-automation

## Overview
- **Initiative**: AIOps adoption for devops-jenkins-automation
- **Goal**: Add observability, automated detection, and runbook automation to the Jenkins automation repo.
- **Scope**: Repo devops-jenkins-automation; pipelines and configs in scope; out of scope: other repos.

## Requirements (EARS)
- REQ-001: WHEN a pipeline fails, the system SHALL record the failure and emit a metric.
- REQ-002: The system SHALL expose pipeline duration and success rate as metrics.
- REQ-003: WHEN success rate drops below 95%, the system SHALL create an alert.
...

## Design
- Use existing Prometheus/Jenkins plugin for metrics; add Grafana dashboard. Logs: keep in current backend, add structured fields.
...

## Tasks (Tickets)

### TASK-001: Add metrics export to Jenkins
- **Skill / Agent**: configuring-observability (or manual if Jenkins plugin config only)
- **Deliverables**: Jenkins plugin config; scrape endpoint or exporter config.
- **Satisfies**: REQ-001, REQ-002
- **Prerequisites**: Jenkins admin access; Prometheus reachable.
- **Steps**: 1. Install plugin X. 2. Configure scrape. 3. Verify in Prometheus.
- **Acceptance**: Metrics visible in Prometheus for job X.
- **Estimate**: M

### TASK-002: Create Grafana dashboard for pipeline health
- **Skill / Agent**: configuring-observability
- **Deliverables**: Grafana dashboard JSON `docs/dashboards/pipeline_health.json` (or path in repo).
- **Satisfies**: REQ-002
- **Prerequisites**: TASK-001 done.
- **Steps**: ...
...

### TASK-00N: Document metric backend choice and runbook
- **Skill / Agent**: infra-documenter
- **Deliverables**: ADR in `docs/adr/`; runbook update for pipeline alerts.
- **Satisfies**: (documentation for REQ-001..REQ-003)
- **Prerequisites**: TASK-001, TASK-002 done.
- **Steps**: 1. Write ADR. 2. Update runbook with alert response steps.
- **Acceptance**: ADR and runbook exist and are linked from README or spec.
- **Estimate**: S

## Documentation
- TASK-00N (above) covers ADR and runbook. Ensure README or spec links to `docs/adr/` and runbook.

## Before executing
- Ensure Jenkins URL and credentials are available. Run from branch `feature/aiops`. Have Grafana/Prometheus URLs and write access.
```

All content (requirements, design, tasks, "before executing") in **English** in the spec.
