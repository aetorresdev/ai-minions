# Agent Contract – Project Orchestrator (code and infrastructure)

This document defines the roles and **MODE protocol** to prevent a single agent from mixing responsibilities, self-confirming with different "hats", and degrading QA/Critic quality.

**Location (from the root of this repo):** `docs/orchestrator/agent-contract.md`. Convention and other clones: [PATHS.md](PATHS.md).

---

## Risk: one chat, many roles

Without strict rules, the model tends to:

- Mix implementation with "looks good to me".
- QA that is not demanding or is aligned with what DEV just wrote.
- A Critic that **proposes fixes** in the same response (loses the questioning role).

This contract enforces **explicit MODEs**, **controlled transitions**, and **structured handoffs**. For critical deliverables, use a **subagent or separate chat** for QA/Critic (see below).

---

## Session declaration (ORCHESTRATOR — required in first response)

When starting an orchestrated session, ORCHESTRATOR declares in its first response using the role block format:

```text
---
## ⚫ ROLE: ORCHESTRATOR
STATE: ACTIVE
STEP: 1/N

FLOW: single_agent | multi_agent
GOAL: <one line: what will be achieved>
MAX_ITERATIONS: 3
```

`FLOW` labels the architecture being used in this session — it is the key for metrics comparison. All handoffs in the session inherit this value in `flow_mode`.

---

## Authoritative state (state store) — disk + MCP, not the chat

For **hard gates** (not prompt discipline alone), orchestrated work uses an **authoritative on-disk store** and the **`orchestrator-state` MCP**. The chat transcript is **not** a source of truth for whether a MODE transition happened.

### Authority rules

1. **If no transition is recorded** in the task’s append-only log (`events.jsonl`), **the step did not happen** for protocol purposes.
2. **If a path is not in `approved_artifacts`**, downstream MODEs must **not** treat it as consumable evidence when artifact gating is enabled (`enforce_approved_artifacts`, default **true**).
3. **`session_id`** is optional **metadata** for audit (phase 1). It does **not** prove session isolation until a **dedicated runner** controls the host. Do not treat it as hard isolation by itself.
4. **Units of work:** each task runs from a **registered envelope** (goal, allowed inputs, forbidden context, limits). On hosts without session control, **state store gates** enforce policy; a dedicated runner (new session per task) is the path to full session isolation — design for it, implement the state store first.

### Layout (default)

Under `ORCHESTRATOR_STATE_ROOT` (default `~/.claude/.state/orchestrator/`):

```text
<task_id>/envelope.json    # current envelope snapshot (updated only via MCP tools)
<task_id>/events.jsonl     # append-only events + hash chain
```

See `mcp-servers/orchestrator-state/README.md` for env vars and setup.

### Required tool flow (strict orchestration)

1. **`register_task`** — obtain `task_id`; set `goal`, `flow_mode`, `max_iterations`, optional `approved_artifacts` / `allowed_inputs` / `session_id`.
2. **`record_artifact`** — add every repo path that **QA** / **CERBERUS** may rely on (or pass `approved_artifacts` at registration). Before advancing to **QA** or **CERBERUS** from **DEV** or **ARCHITECT**, every path listed under `files_modified` in the handoff YAML must appear in `approved_artifacts` when enforcement is on.
3. **`compact_handoff`** (MCP `compact-handoff`) — produce handoff YAML from raw MODE output (Ollama compaction).
4. **`validate_goal_alignment`** (MCP **`orchestrator-state`**) — runs the alignment check **and persists** `goal_alignment_status` on the envelope. Prefer this so the store records the outcome. (`compact-handoff`’s `validate_goal_alignment` remains available for flows that do not use the store.)
5. **`validate_transition`** — dry-run: alignment, `max_iterations` (from explicit `iteration` arg or `handoff.iteration` in YAML), approved artifacts vs `files_modified`.
6. **`advance_mode`** — if and only if gates pass, append `mode_advanced` and update `current_mode`. After a successful advance, `goal_alignment_status` resets to `pending` for the next handoff cycle.
7. **`close_task`** when the unit of work ends.

**ORCHESTRATOR** must not authorize the next MODE if `advance_mode` returned an error or `validate_transition` returned `allowed: false`.

### QA / CERBERUS context

**QA** and **CERBERUS** must run from **exported** context: `open_envelope` + handoff YAML + **only** `approved_artifacts` (and `allowed_inputs`), not from unconstrained long implementation history when avoidable. Prefer a **separate thread or subagent** with that package pasted in; state store gates constrain what is **valid to record** — a dedicated runner is needed to **strip** host history automatically.

---

## MODE Protocol (required in orchestrated flow)

### Role block format (mandatory)

Every response MUST open with a role block:

```text
---
## <EMOJI> ROLE: <ROLE_NAME>
STATE: ACTIVE | COMPLETE | BLOCKED
STEP: N/TOTAL
```

| Role | Emoji |
|------|-------|
| ORCHESTRATOR | ⚫ |
| OWNER | 🟣 |
| ARCHITECT | 🟠 |
| DEV | 🟢 |
| QA | 🔵 |
| CERBERUS | 🔴 |

- `STATE: ACTIVE` while working, `COMPLETE` when handing off, `BLOCKED` if cannot proceed.
- Content under the header: lists, tables, or code blocks — no unstructured prose.

### Role transition format (mandatory)

When switching roles, insert an explicit transition block before the next role header:

```text
---
### 🔁 TRANSITION
FROM: <ROLE>
TO: <ROLE>
REASON: <why>

---
## <EMOJI> ROLE: <NEXT_ROLE>
STATE: ACTIVE
STEP: N/TOTAL
```

Inline transition text (`"Advancing to MODE: QA"`) is **forbidden**. The transition block IS the announcement.

The model acts only according to the rules of that MODE until **Orchestrator** (or the user) authorizes the next MODE. **Do not switch MODE on your own initiative** within the same response (except for Orchestrator, which in one turn only plans, and then in the next turn the user says "execute MODE: DEV").

### ALLOW / FORBID table by MODE

| MODE | ALLOW | FORBID |
|------|--------|--------|
| **ORCHESTRATOR** | Decompose goals, assign next MODE, name skills per task, request handoff before closing phase | Implement code, Terraform, workflows; do deep review substituting QA/Critic |
| **OWNER** (or PO) | Scope, priorities, definition of done, what is out of scope | Implement; review implementation in detail |
| **ARCHITECT** (Software or Infra) | Design, trade-offs, conceptual diagrams, component list; **cost controls** in Infra | Application code; complete HCL Terraform (only resource proposal if the flow requires it); reading entire artifact files when only relevant sections are needed |
| **DEV** (Backend / Frontend / DevOps implementing) | Implement per spec; document minimal decisions in handoff | Evaluate "overall quality"; assume QA or Critic role; question requirements unless there is an explicit **blocker** (then handoff to OWNER) |
| **QA** | Test cases, edge cases, try to break the design, acceptance checklist, run validation scripts. For each platform-specific artifact, invoke the relevant skill and apply its validation checklist before passing to CERBERUS — do not approve assumptions about platform behavior without verifying them. When returning to DEV: label each finding as `blocker`, `improvement`, or `nice-to-have` — only `blocker` items block the flow | Write production code or change business logic "to fix it"; approve without evidence; approve platform assumptions without skill verification; return to DEV without classifying the finding |
| **CERBERUS** | Risks, hidden assumptions, alternatives, open questions; **assume there are errors**. Reviews any output already approved by DEV+QA: simplicity, security, design, unconsidered alternatives. Not an additional QA — it is adversarial last-mile review before human validation. | Implement, patches, "I'll fix that for you"; propose a detailed solution **in the same turn** (maximum: "consider option A vs B" in 1–2 lines) |

**Context efficiency (all roles):** Before reading any file, declare which files are relevant:
```
files_read: [only what you need]
```
Then read only those files, only the relevant sections. Summarize what you read — do not reproduce entire files in output. One targeted read per artifact; do not load the same file multiple times.

**Gate (enforced by `validateOutput()` in both single-agent and multi-agent flows):**
- `files_read[]` missing → rejected
- `files_read: []` empty → rejected
- `files_modified` missing in DEV output → rejected (absence bypasses the cross-check gate)
- DEV strict mode: every path in `files_modified` must appear in `files_read` — if not → rejected

**Known limitation:** the gate enforces *consistency* (what you touch, you declared) — not *completeness* (whether you declared enough). An agent that reads `service.js` but misses `config.js` as a dependency will pass the gate. Completeness requires semantic knowledge of the codebase.

**Trade-off:** ARCHITECT is now a critical point in the flow. If ARCHITECT declares an incomplete `files_read`, DEV cannot freely explore to compensate — the gate will block it. This is intentional: incomplete exploration by ARCHITECT is a visible, traceable failure rather than a silent cost overrun.

Roles **PM**, **Software/Infra Architect**, **Backend/Frontend/DevOps** map to the above MODEs when executing (e.g. Infra Architect → **ARCHITECT** infra; DevOps implementing → **DEV**).

---

## Controlled transitions

1. The **next MODE** is defined by **ORCHESTRATOR** (or the user explicitly).
2. **Minimum recommended sequence** for non-trivial changes (features, sensitive infra, workflows):

   `OWNER/ORCHESTRATOR (brief) → ARCHITECT (if applicable) → DEV → QA → CERBERUS → (decision) → DEV or close`

3. After **CERBERUS**, the Orchestrator decides: another DEV round, back to QA, or escalate to OWNER.
4. **Forbidden** in a single assistant message: DEV + QA + CERBERUS mixed. One response = **one MODE** (except ORCHESTRATOR which only lists the plan and **one** next MODE to execute).

---

## Handoff between phases (required when closing ANY MODE)

When finishing **any MODE** (ARCHITECT, DEV, QA, CERBERUS), the agent calls the MCP `compact_handoff` with its full output. The result is the official handoff passed to the next MODE. **Do not write the YAML by hand** — always generate it via MCP to guarantee metrics comparability.

**Enforcement:** A `PreToolUse` hook blocks `advance_mode` if `compact_handoff` was not called first in the same cycle. The hook consumes the flag on success — one handoff per advance. ORCHESTRATOR and OWNER transitions are exempt.

```
mcp__compact-handoff__compact_handoff(
  text="<full output of the MODE>",
  mode_completed="DEV",   # ARCHITECT | DEV | QA | CERBERUS
  next_mode="QA",
  iteration=1,
  max_iterations=3,
  flow_mode="single_agent"  # or "multi_agent" — declared by ORCHESTRATOR at session start
)
```

The MCP produces:

```yaml
handoff:
  goal: "<what was intended>"
  mode_completed: DEV | QA | ARCHITECT | CERBERUS
  flow_mode: single_agent | multi_agent
  iteration: 1                  # DEV increments on each round; QA increments when returning
  max_iterations: 3             # defined in the original ticket by ORCHESTRATOR (default: 3)
  files_modified:
    - path/to/file
  validation_run:
    - "terraform init && terraform validate → pass"
  decisions:
    - "decision X because Y"
  risks:
    - "known gap or edge case"
  pending_for_next_mode:
    - "what QA or CERBERUS must focus on"
  # Only when QA returns to DEV:
  qa_returns:
    - issue: "description"
      severity: blocker         # blocker | improvement | nice-to-have
  # Filled in by ORCHESTRATOR after validate_goal_alignment:
  goal_aligned: true | false
  alignment_notes: "<reason if false>"
```

**DEV** must ensure its output includes `validation_run` with real commands and results before calling `compact_handoff`. The next MODE uses **only** the generated YAML + cited artifacts.

### Output contracts (strict mode — enforced by `validateOutput()`)

Each role has a minimum output contract. If the output does not meet it, the runner throws — no silent retry, no auto-correction.

| Role | Contract |
|------|---------|
| `orchestrator` / plan | Valid JSON `{ steps: [{ agentId, task }] }` — non-empty |
| `orchestrator` / decide | Valid JSON `{ done: bool, summary }` or `{ done: false, corrections: [] }` |
| `dev-*` | Mentions ≥1 file modified **and** ≥1 validation run (lint, test, terraform validate, etc.) |
| `qa` | ≥1 finding classified as `blocker` \| `improvement` \| `nice-to-have` (token presence) |
| `cerberus` | Same tokens as QA **plus**, when all three lines `blocker:` / `improvement:` / `nice-to-have:` are present, **minimal semantic floor** (`validateCerberusSemanticFloor` in `agents.js`): reject all-vacuous lines, known boilerplate phrases, and vacuous blocker without concrete improvement/nice-to-have detail |
| `owner` / `architect` / `summarizer` | Any non-empty output |

**Small local models (Ollama):** prompts for **CERBERUS** require a fixed three-line prefix (`blocker:` / `improvement:` / `nice-to-have:`) so weak coders still satisfy `FINDING_RE` and pass `validateOutput()` — see `AGENTS.cerberus.system` and the CERBERUS review prompt in `orchestrator.js`.

#### CERBERUS / QA — format enforcement vs quality (honest scope)

`validateOutput()` for **`qa`**: classified vocabulary only (`blocker` \| `improvement` \| `nice-to-have`). For **`cerberus`**: same, and when the three-line template is detected, **CERBERUS-SIGNAL fase 2 (minimal)** rejects obvious structured garbage (shared denylist, all-vacuous lines, vacuous blocker without path-ish or length-anchored improvement/nice-to-have). This is still **not** full quality: it does not prove a blocker is true, aligned with the diff, or free of subtle fabrication.

**Still out of scope (later backlog):** model-graded severity, cross-check against `files_modified` / trace, scoring, **E2E-STRICT** under real MCP gates.

**Non–triple-line CERBERUS replies** (e.g. a single `**blocker**: …` paragraph) only pass the token check — same behavior as before the semantic floor.

Implemented in `examples/orchestrator/agents.js` (`validateOutput()`). Called inside `askAgent()` — identical behavior in single-agent and multi-agent flows (only timing differs). The `phase` parameter (`"plan"` / `"decide"`) selects the orchestrator sub-contract.

#### `done` field semantics

| Value | Meaning |
|-------|---------|
| `done: true` | Task completed successfully — all gates passed, no blockers |
| `done: false` | Task did not complete — requires human review. Causes: CERBERUS blockers unresolved at `max_iterations`, or any artifact with `gateBlocked: true` (output contract failure, handoff structure failure, goal misalignment) |

**`done: false` is not an error** — it is the correct signal for "gates fired, human must decide next step." Never treat `done: false` + "Manual review required" as equivalent to a clean completion.

#### Gate-blocked artifact enforcement

Any artifact produced with `gateBlocked: true` is treated as an implicit blocker, regardless of whether CERBERUS explicitly flags it. This covers:

- Output contract failures: missing `files_read[]`, `files_modified`, or `validation_run`
- Handoff structure failures: empty or malformed handoff YAML in strict mode
- Goal alignment failures: `validate_goal_alignment` returned `aligned: false`

**Effect:** if `gateBlocked: true` artifacts exist at completion evaluation, the run returns `done: false` with a summary listing each blocked agent and reason. CERBERUS silence does not clear a gate block.

#### `compact_handoff` failure (Node reference runner)

When the runner invokes `compact_handoff` (via Claude CLI → compact-handoff MCP), failure handling depends on **effective strictness** (`require_handoff`, defaulting from gates: strict when state MCPs are active, degraded when `skipStateMcp` / `--skip-gates`):

| Mode | Behavior |
|------|----------|
| Strict | Hard fail: artifact `gateBlocked: true`, `gateReason` prefixed with `compact_handoff failed:`, trace event `compact_handoff_failed`, completion path does not treat the step as clean |
| Degraded | Explicit fallback: artifact fields `handoff_compression: unavailable`, `handoff_fallback_used: true`, `handoff_error`; trace `compact_handoff_fallback`; run continues; final summary appends a visible note |

Same policy applies to the post-iteration CERBERUS → ORCHESTRATOR advance handoff when gates are active. See `examples/orchestrator/README.md` § `compact_handoff` failure. Strict worker-path behavior is exercised by `examples/orchestrator/tests/compactHandoffStrict.integration.test.js` (no hooks on `run()`).

### Goal alignment validation (ORCHESTRATOR — required before advancing MODE)

After receiving the compacted handoff, ORCHESTRATOR calls:

```
mcp__compact-handoff__validate_goal_alignment(
  handoff_yaml="<handoff yaml>",
  goal="<goal declared at session start>",
  flow_mode="single_agent"  # or "multi_agent"
)
```

Returns `{"aligned": true/false, "confidence": 0-1, "notes": "...", "missing": [...]}`.

- If `aligned: true` → ORCHESTRATOR authorizes the next MODE.
- If `aligned: false` → ORCHESTRATOR **does not advance**: returns to the previous MODE with `alignment_notes` or escalates to OWNER if the gap is a scope issue.

**Anti-loop (required):**

- **QA** can only return to DEV with `blocker` findings. `improvement` and `nice-to-have` go to the backlog — **they do not block the flow**.
- If `iteration >= max_iterations`, QA escalates to ORCHESTRATOR. ORCHESTRATOR decides: close, create a follow-up ticket, or escalate to OWNER.
- ORCHESTRATOR sets `max_iterations` in the original ticket (default: 3). If not set, DEV assumes 3.

---

## Tools by MODE (guideline)

| MODE | Tools / skills (see extended section below) |
|------|------------------------|
| ORCHESTRATOR / OWNER | `feature-spec-and-tasks`, `prepare-context-clear`; proposals: `proposal-*` |
| ARCHITECT | `designing-terraform`, `creating-diagrams`, `contracts-with-llm`; MCP Terraform + diagrams |
| DEV | By role: Terraform/CircleCI/Docker/n8n/backend (extended table); **minimum validation** (see § Validation before handoff) |
| QA | `managing-n8n`, domain reviewers; **avoid** infra MCPs unrelated to the test |
| CERBERUS | `reviewing-*`, `proposal-review`, `audit-patterns`; Read/Grep only unless citing |

*Cursor does not restrict MCP by MODE at the product level. **`orchestrator-state`** adds **recorded gates** (alignment, iterations, approved paths); full tool restriction per MODE still requires a dedicated runner or host support.*

### Validation before handoff (DEV — required when applicable to the stack)

A bare "lint" is not enough: the **DEV** agent must use the tools the repo exposes and, at minimum, what the language/framework requires to verify that the change **compiles/validates and passes local tests**.

| Stack | Minimum recommended (logical order) |
|-------|-----------------------------------|
| **Terraform** | `terraform fmt` (or equivalent), **`terraform init`** in the module/stack directory that was touched, **`terraform validate`**, project linters (**tflint**, **checkov** / **tfsec** if present in CI or Makefile), and if a **module test** exists (terratest, `terraform test`, repo script) — run it and cite the result in the handoff. |
| **Others** (Python, Go, Node, etc.) | Project linter/formatter + **`install`/deps if needed** + **module tests or scoped suite** (`pytest`, `go test ./...`, `npm test`, etc.) as defined in README/CI. |

If the environment does not allow running commands (sandbox, no credentials), **DEV** must note this in `handoff.risks` and list the exact commands that QA/human must run.

**QA** can require evidence in the handoff: commands executed and summarized output (pass/fail).

---

## When to use a subagent or separate chat

If the deliverable is **critical** (production, data, cost, compliance):

- Run **QA** or **CERBERUS** in **another thread** or via **mcp_task / subagent** with the artifact + handoff pasted in, **without** the long implementation history.

This reduces self-confirmation bias. See [mcp-task-examples.md](mcp-task-examples.md).

---

## Metrics (optional, to improve the flow)

| Metric | Purpose |
|---------|----------|
| Tokens or turns per task | Compare strict vs loose flow |
| DEV → QA → CERBERUS iterations until done | Detect loops |
| QA findings vs CERBERUS findings | If CERBERUS never adds anything, suspect bias |
| Human time to acceptance | Real efficiency |

---

## Skills and MCP by role (extended reference)

- **Automatic:** Cursor loads skills when the user's text (or the Orchestrator in the task) matches the skill's **description**. This does not replace **naming the skill in the task** when you want a guarantee.
- **Orchestrator:** in each ticket, indicate **Skill:** `skill-name` and, if applicable, **MCP:** … to reduce omissions.
- Listed skills live in `skills/` at the root of **this** repo (convention: clone the repo at `~/.claude` to align with installation guides). See [PATHS.md](PATHS.md). **n8n-workflow-*** subagents may be available in Cursor as a Task tool depending on your installation.

### By role (typical priority)

| Role | MODE | Skills (`skills/` in repo) | MCP / notes |
|-----|------|----------------------|-------------|
| **Orchestrator** | ORCHESTRATOR | `feature-spec-and-tasks`, `prepare-context-clear` | Specs and context before executing |
| **Owner / PM** | OWNER / plan | `feature-spec-and-tasks`, `proposal-refine`, `proposal-review`, `proposal-synthesize` | Communication / internal proposals |
| **Software Architect** | ARCHITECT | **`creating-diagrams`**, `contracts-with-llm` (APIs + LLM), `audit-patterns` (legacy) | **awslabs.aws-diagram-mcp-server**, **drawio**; C4/flow diagrams in docs |
| **Infra Architect** | ARCHITECT | **`designing-terraform`**, **`creating-diagrams`** | **awslabs.terraform-mcp-server**, **terraform-mcp-server** (HashiCorp); same diagram MCPs |
| **DevOps** | DEV | **`creating-terraform`**, **`reviewing-terraform`**, **`creating-circleci`**, **`reviewing-circleci`**, **`reviewing-docker`**, **`configuring-observability`**, **`git-best-practices`** | Terraform MCPs; OTEL/Grafana observability |
| **Backend** | DEV | **`managing-n8n`** (workflows, webhooks, integrations), **`contracts-with-llm`**, `audit-patterns` | **user-n8n-mcp** if available; API ↔ n8n |
| **Frontend** | DEV | (no fixed skill in this repo's `skills/`) Use Cursor/agents skills from the project: *frontend-design*, *web-artifacts-builder*, etc. | Depends on repo stack |
| **QA** | QA | **`managing-n8n`** (validate/document flows), **`reviewing-terraform`**, **`reviewing-docker`**, **`reviewing-circleci`** per artifact | Subagents **n8n-workflow-validator**, **n8n-workflow-documenter** if available; repo scripts |
| **Cerberus** | CERBERUS | **`reviewing-terraform`**, **`reviewing-docker`**, **`reviewing-circleci`**, **`proposal-review`**, **`audit-patterns`** | Adversarial review only; questions simplicity, security, and design of the artifact already approved by DEV+QA |
| **Documentation** | DEV or ORCHESTRATOR | **`creating-diagrams`**, `proposal-synthesize`, `git-best-practices` | Diagrams in `docs/`; *infra-documenter* skill if available in agents |

### DevOps — quick breakdown

| Task | Skill first |
|-------|----------------|
| Design infra (no code) | `designing-terraform` |
| Create `.tf` component | `creating-terraform` |
| Audit Terraform | `reviewing-terraform` |
| CircleCI pipeline | `creating-circleci` → `reviewing-circleci` |
| Dockerfile | `reviewing-docker` (create/review) |
| OTEL / Grafana | `configuring-observability` |
| Commits / branches | `git-best-practices` |

### Backend + n8n

| Task | Skill |
|-------|--------|
| Create/edit/optimize n8n workflow | `managing-n8n` |
| Validate workflow JSON | `managing-n8n` + validator subagent if available |
| API + LLM contracts | `contracts-with-llm` |

### Architects + diagrams

| Task | Skill | MCP |
|-------|--------|-----|
| AWS/K8s architecture diagram PNG | `creating-diagrams` | aws-diagram-mcp-server |
| Editable diagram | `creating-diagrams` | drawio |

---

## 1. Orchestrator

- **MODE:** `ORCHESTRATOR`.
- **Responsibility**: Decompose, assign next MODE, manage dependencies, name skills per task; require handoff between phases.
- **When it intervenes**: Every phase transition; owns the flow.

---

## 2. Project Owner

- **MODE:** `OWNER`.
- **Responsibility**: Scope, priorities, done, exclusions.
- **When it intervenes**: Kick-off, scope changes; Orchestrator consults when in doubt.

---

## 3. Project Manager (optional)

- **MODE:** under `ORCHESTRATOR` or `OWNER` in complex projects.
- **Responsibility**: Detailed plan, dependencies, tracking.

---

## 4. Software Architect

- **MODE:** `ARCHITECT` (application).
- **Responsibility**: Components, APIs, patterns, stack.
- **Skills / MCP:** `creating-diagrams`, `contracts-with-llm`, `audit-patterns`; diagram MCPs for architecture docs.

---

## 5. Infrastructure Architect

- **MODE:** `ARCHITECT` (infra).
- **Responsibility**: Network, environments, cloud, security, **cost controls**.
- **Skills / MCP:** `designing-terraform`, `creating-diagrams`; Terraform MCP (AWS + HashiCorp).

---

## 6. DevOps (implementation)

- **MODE:** `DEV` when coding pipelines/IaC.
- **Responsibility**: CI/CD, Terraform, deployment, observability.
- **Skills:** `creating-terraform`, `reviewing-terraform`, `creating-circleci`, `reviewing-circleci`, `reviewing-docker`, `configuring-observability`, `git-best-practices`.

---

## 7. Backend

- **MODE:** `DEV`.
- **Responsibility**: APIs, data, integrations, orchestration toward n8n if applicable.
- **Skills:** `managing-n8n`, `contracts-with-llm`, `audit-patterns`; n8n MCP if configured.

---

## 8. Frontend

- **MODE:** `DEV`.
- **Responsibility**: UI/UX per spec; handoff on close.
- **Skills:** **frontend** skills are usually in Cursor agents (*frontend-design*, etc.); name them in the task if the repo does not have its own skill.

---

## 9. QA

- **MODE:** `QA`.
- **Responsibility**: Break things, edge cases, evidence; **no** production code. For each platform-specific artifact, invoke the relevant skill and apply its validation checklist before passing to CERBERUS — do not approve assumptions about platform behavior without verifying them.
- **Skills:** `managing-n8n` (flows), `reviewing-terraform` / `reviewing-docker` / `reviewing-circleci` per deliverable; n8n validators as subagent if available.

---

## 10. Critic

- **MODE:** `CERBERUS`.
- **Responsibility**: Adversarial last-mile review of the output already approved by DEV+QA. Questions simplicity (is there a simpler way?), security (are there unconsidered attack vectors?), design (are there architectural flaws DEV and QA overlooked?). **Not** an additional QA — operates after the DEV→QA flow has closed. **Do not** implement or patch in the same turn.
- **Skills:** same **review** skills as the artifact's domain (`reviewing-terraform`, `reviewing-circleci`, `proposal-review`, …).

---

## Summary flow (with protocol)

1. **ORCHESTRATOR** + **OWNER**: brief, done, tasks.
2. **ARCHITECT** (if applicable) → handoff → optional **CERBERUS** on design (read/question only).
3. **DEV** implements → **required handoff**.
4. **QA** validates → **required handoff**.
5. **CERBERUS** on artifact + handoffs → Orchestrator decides next MODE.
6. **Close**: Owner if applicable.

---

## What happens outside the harness

This table clarifies what the system guarantees depending on which components are active.

| Component | Active | Guarantee |
|-----------|--------|-----------|
| `CLAUDE.md` only | Always (Cursor loads it) | Best-effort consistency — the model *tends* to follow the rules, but nothing enforces them mechanically |
| Hooks (`scripts/hooks/`) | When Cursor hook events fire | Gate events logged; `advance_mode` blocked if `compact_handoff` not called; mode/QA/handoff violations surfaced |
| `validateOutput()` (Node runner) | When `askAgent()` is called in code | Hard contract enforcement — throws on missing `files_read`, empty output, missing validation run |
| `orchestrator-state` MCP | When explicitly called by the agent | Append-only event log, hash chain, artifact gating, iteration cap |
| All of the above | Full orchestrated session | Full enforcement: gates, state store, artifact approval, alignment validation |

**Key implications:**

- **Without the runner** (`askAgent()`): `validateOutput()` never runs. Role output contracts are not enforced. An agent can self-QA silently.
- **Without hooks**: `compact_handoff` can be skipped. `advance_mode` is not gated. Mode transitions are unverified.
- **Without the MCP state store**: There is no append-only record. `approved_artifacts` gating is inactive. `max_iterations` is not enforced.
- **`CLAUDE.md` alone** is not a security boundary — it is a consistency aid. Do not rely on it as the sole enforcement mechanism for critical flows.

For production or compliance-sensitive work, run the full harness (hooks + runner + MCP state store).

---

## References

- [mcp-task-examples.md](mcp-task-examples.md)
- [environment-access.md](environment-access.md) — agent credential contract, read vs write mode, per-service examples
- Cursor rule: `.cursor/rules/orchestrator.mdc` (from `REPO_ROOT`). User Rules / other projects: [CURSOR_RULE_SETUP.md](CURSOR_RULE_SETUP.md), [PATHS.md](PATHS.md)
