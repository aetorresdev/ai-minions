# Modular monolith boundaries — design map

**Location:** `docs/orchestrator/module-boundaries.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Design map + partial physical migration (A2.1) + CI import guard (A2.2).** `orchestrator/modules/gates/` ships with compat shims at legacy paths. **`lint:module-boundaries`** enforces adjacency matrix under `modules/**` and hard rules globally; legacy violations are grandfathered in `module-boundary-allowlist.json`. **No** runtime behavior change. **Modular refactor not complete.**

**Related:** [architecture-coherence-audit.md](architecture-coherence-audit.md) · [module-ownership-map.md](module-ownership-map.md) · [root-file-inventory.md](root-file-inventory.md) · [agent-registry-layout.md](agent-registry-layout.md) · [capability-flow-contract.md](capability-flow-contract.md) · [self-improvement-loop-contract.md](self-improvement-loop-contract.md) · [handoff-contract.md](handoff-contract.md) · [sandbox-credential-isolation-design.md](sandbox-credential-isolation-design.md) · [security-posture.md](security-posture.md)

---

## Purpose

Name **capability boundaries** for the orchestrator modular monolith so refactors, reviews, and CERBERUS can reject layer-mixing **before** code moves. This doc is a **map**, not a claim that boundaries are enforced in production.

**Not claimed:** clean architecture adopted; modular monolith refactor complete; hexagonal repo layout; microservices split.

---

## Architecture decision (SoT)

| Layer | Pattern | Role |
|-------|---------|------|
| **Primary** | Modular monolith + bounded contexts | Split by **capabilities** (permissions, gates, trace, …) — not by technical layer folders alone |
| **Dependency rule** | Clean Architecture (inward only) | Domain/application policy ↛ adapters, CLI, `child_process`, raw `fs`, `process.env` reads in pure cores |
| **Decisions vs effects** | Functional core / imperative shell | Pure outcomes (`allow` \| `deny` \| `needs_approval` \| `invalid_contract`) before I/O |
| **Local hexagonal** | Ports/adapters inside modules | Only where a context owns real external I/O — not a repo-wide `core/ports/adapters` carpet |

**Reject in reviews:** decorative folders without enforcement; capability names that are only “util” or “helpers”; adapters relabeled as domain; mass moves without scoped refactor brief.

---

## Canonical modules (bounded contexts)

| Module | Owns | Must not own |
|--------|------|----------------|
| **run-control** | Run loop, phase orchestration, iteration lifecycle, session start/end coordination | Permission policy tables; trace schema authoring; CLI formatting |
| **contracts** | Handoff/MODE/output validation helpers, design-first validators (`*-design.js`), contract drift tests | Spawning agents; writing traces; MCP transport |
| **gates** | Human approval, policy gates, governance pre-checks, doubt cycle emit hooks | Permission matrix source of truth; model routing |
| **permissions** | Capability matrix, credential ceiling, permission check **decisions** | Executing shell/git; appending trace rows (shell may call trace writer) |
| **tools** | Tool classification, tool eval fixtures, skill registry policy, untrusted-context eval | Gate verdict parsing; run loop scheduling |
| **model-runtime** | Local model policy/discovery/selection, agent runtime adapters (Claude/Ollama) | Approval before DEV; trace redaction policy |
| **trace** | JSONL schema, append/sanitize/redact, lifecycle events, outcome summary, OTel **mapper** (derived) | Policy decisions (what is allowed to run) |
| **budget** | Token/cost accounting dimensions, budget views, cost rollups | Enforcing spend limits in production SLA sense |
| **worktree** | Worktree isolation, workdir contract, cleanup safety, result promotion | Permission checks; agent prompts |
| **operator** | CLI/TUI, explain-run, export, preflight, help surfaces | Domain policy; direct gate bypass |
| **disclosure** *(planned promotion)* | Progressive disclosure policy, context package rules, skill visibility metadata | Runtime prompt filtering (not shipped) |

**Shared / legacy bucket:** `repo-root.js`, `minions-config.js`, `decision-engine.js` (cross-cutting helpers) — classify changes explicitly in PR briefs until split.

---

## Allowed / forbidden dependencies (design)

Rows = **may import / call** (runtime or `require`). Empty = no direct dependency.

| From ↓ / To → | run-control | contracts | gates | permissions | tools | model-runtime | trace | budget | worktree | operator |
|---------------|:-----------:|:---------:|:-----:|:-------------:|:-----:|:-------------:|:-----:|:------:|:--------:|:--------:|
| **run-control** | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **contracts** | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **gates** | ✗ | ✓ | — | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **permissions** | ✗ | ✓ | ✗ | — | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **tools** | ✗ | ✓ | ✗ | ✓ | — | ✗ | ✓ | ✗ | ✗ | ✗ |
| **model-runtime** | ✗ | ✓ | ✗ | ✓ | ✓ | — | ✓ | ✓ | ✗ | ✗ |
| **trace** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | — | ✓ | ✓ | ✗ |
| **budget** | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | — | ✗ | ✗ |
| **worktree** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | — | ✗ |
| **operator** | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | — |

**Global forbidden (any module →):** `agents/prompts/*` content into permission pure functions; trace rows into gate **decisions**; operator CLI mutating gate state without trace + human path.

---

## Functional core / imperative shell (examples)

| Path | Core (pure decision) | Shell (effects) |
|------|----------------------|-----------------|
| Permission check | `evaluatePermission` → allow/deny/needs_approval | MCP gate trace append, subprocess spawn |
| Approval policy gate | `evaluateApprovalPolicy` → skip/grant required | `approval_skipped` / block trace emit |
| Handoff validate | schema/contract validation result | compact handoff MCP write |
| Tool classify | family/target_class from manifest rules | none in classifier itself |
| Budget status | rollup numbers from trace rows | CLI render only |

Policy code should be testable **without** network, git, or live MCP when feasible.

---

## Current-state → module map (principal files)

Paths relative to `orchestrator/`. Tests mirror module under `tests/`.

| Module | Principal files / dirs |
|--------|-------------------------|
| **run-control** | `orchestrator.js`, `run-loop-helpers.js`, `run-phases/*`, `run-state.js`, `qa-spec-flow.js`, `cli.js` (invoke path) |
| **contracts** | `validate-output.js` (via agents), `*-design.js`, `self-improvement-loop-design.js`, `bv-reviewer-design.js`, `progressive-disclosure-design.js`, `tests/*Contract.test.js`, `tests/handoffContract.test.js`, `tests/sandboxCredentialIsolationDesign.test.js`, `tests/moduleBoundariesContract.test.js` |
| **gates** | `modules/gates/governance-gate.js`, `modules/gates/merge-governance/` (A2.1) · shims: `governance-gate.js`, `merge-governance/` · `approval-policy-gate.js`, `doubt-review.js`, `review-record.js` |
| **permissions** | `agents/permissions.js`, `agents/capability-matrix.js`, `credential-broker.js`, `environment-parser.js` |
| **tools** | `security/tool-eval.js`, `security/skill-registry.js`, `security/untrusted-context-eval.js`, `mcp-client.js` |
| **model-runtime** | `agents/runtime/*`, `agents/routing/model-routing.js`, `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` |
| **trace** | `trace-*.js`, `run-outcome-summary.js`, `otel-genai-trace-map.js`, `context-hygiene-signals.js`, `recovery-sweep.js`, `session-resume.js` |
| **budget** | `token-usage-summary.js`, `token-trace-report.js`, `cost-accounting-dimensions.js`, `runner-budget-view.js` |
| **worktree** | `worktree-*.js`, `run-workdir-contract.js`, `trace-workspace-lifecycle.js` |
| **operator** | `explain-run.js`, `control-plane-tui.js`, `runner-*-cli.js`, `operator-cli-help.js`, `project-template-cli.js`, `scenario-metrics-export.js` |
| **disclosure** | `progressive-disclosure-design.js`, `security/skill-registry.js` (metadata only); runtime filter **planned** |
| **shared/legacy** | `repo-root.js`, `minions-config.js`, `decision-engine.js`, `agents.js` (facade) |

Every new top-level file should declare target module in PR description. New cross-boundary imports fail CI unless added to the allowlist with explicit review justification.

---

## Known import / layering violations (honest inventory)

| Observation | Risk | Remediation lane |
|-------------|------|------------------|
| `orchestrator.js` imports across gates, trace, permissions, worktree | God-module pressure | Slice run-control facades per phase (post-v0.6 refactor carril) |
| `agents/permissions.js` ↔ trace writer for gate summaries | Policy + observability coupling | Emit via narrow trace port interface |
| `mcp-client.js` used from run loop and operator paths | Tool transport bleeds into operator | Keep MCP behind tools module API |
| Design validators colocated at repo root (`*-design.js`) | Contracts not in `contracts/` folder | Accept until physical move; enforce via review |
| `otel-genai-trace-map.js` in trace module | Derived export only — OK if no policy | Keep mapper free of gate decisions |

**None of the above block alpha** — they guide refactor ordering for the deferred physical `orchestrator/modules/*` migration (post-v0.6).

---

## Trace responsibilities per module

| Module | Emits (examples) | Consumes |
|--------|------------------|----------|
| run-control | `session_*`, `iteration_done`, step graph | gate outcomes |
| gates | `review_record`, `doubt_review_*`, `approval_*`, `production_boundary_check` | contract validation |
| permissions | `permission_check` | capability matrix |
| tools | `skill_registry_check`, tool eval fixtures | registry JSON |
| trace | writer lifecycle, redaction | all modules (append API) |
| worktree | `workspace_*`, promotion events | run workdir contract |
| budget | cost dimensions in summaries | trace JSONL |

---

## Enforcement (A2.2 — implemented)

| Mechanism | Path | Behavior |
|-----------|------|----------|
| **`lint:module-boundaries`** | `orchestrator/scripts/check-module-boundaries.js` | Adjacency matrix from this doc; hard rules: trace ↛ policy, gates ↛ shell, model-runtime ↛ approval |
| **Allowlist** | `orchestrator/module-boundary-allowlist.json` | Grandfathered legacy violations only — new keys require review |
| **CI** | `npm test` / `orchestrator-unit-tests.yml` | Fails on unlisted violations |

**Still planned:** ESLint `import/no-restricted-paths` zones (optional); further physical tree `orchestrator/modules/<context>/` slices.

**A2.1 shipped:** `modules/gates/` only — bounded first slice. Do **not** mass-move other contexts in the same PR.

---

## CERBERUS review checklist (design PRs)

- [ ] Change declares target module(s)
- [ ] No new cross-boundary import without doc update in **Known violations** or matrix exception
- [ ] No policy decision hidden in trace/operator-only code
- [ ] No claim of completed modular refactor in PR text or versioned docs

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-07 | Initial design map shipped on `master` @ `e8b3ac8`; ticket-free deferred refactor wording; cross-links to handoff/sandbox design contracts |
| 2026-06-08 | A2.1 slice 1 — `modules/gates/` physical migration (`governance-gate`, `merge-governance`); root shims; import guards deferred to A2.2 |
| 2026-06-08 | A2.2 slice 2 — `check-module-boundaries` + allowlist + `moduleBoundaryGuard.test.js`; wired into `npm test` |

Update when module map or known violations change. Physical refactor briefs reference this doc (backlog only — not in CHANGELOG product text).
