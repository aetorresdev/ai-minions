# Modular monolith boundaries — design map

**Location:** `docs/orchestrator/module-boundaries.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Design map + partial physical migration** — `modules/gates/`, `modules/contracts/`, `modules/recovery/`, `modules/trace/`, `modules/budget/`, `modules/worktree/`, `modules/operator/`, and partial `modules/model-runtime/` ship with compat shims at legacy paths. **CI import guard** via `lint:module-boundaries`. **Modular refactor not complete.**

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
| **trace** | JSONL schema, append/sanitize/redact, lifecycle events, outcome summary, OTel **mapper** (derived) | Policy decisions (what is allowed to run); recovery/resume eligibility |
| **recovery** | Stranded run/step detection, session checkpoint eligibility, resume gating explanations | Gate policy tables; live run loop mutation without operator path |
| **budget** | Token/cost accounting dimensions, budget views, cost rollups | Enforcing spend limits in production SLA sense |
| **worktree** | Worktree isolation, workdir contract, cleanup safety, result promotion | Permission checks; agent prompts |
| **operator** | CLI/TUI, explain-run, export, preflight, help surfaces | Domain policy; direct gate bypass |
| **disclosure** *(planned promotion)* | Progressive disclosure policy, context package rules, skill visibility metadata | Runtime prompt filtering (not shipped) |

**Shared / legacy bucket:** `repo-root.js`, `minions-config.js`, `decision-engine.js` (cross-cutting helpers) — classify changes explicitly in PR briefs until split.

---

## Allowed / forbidden dependencies (design)

Rows = **may import / call** (runtime or `require`). Empty = no direct dependency.

| From ↓ / To → | run-control | contracts | gates | permissions | tools | model-runtime | trace | recovery | budget | worktree | operator |
|---------------|:-----------:|:---------:|:-----:|:-------------:|:-----:|:-------------:|:-----:|:--------:|:------:|:--------:|:--------:|
| **run-control** | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **contracts** | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **gates** | ✗ | ✓ | — | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **permissions** | ✗ | ✓ | ✗ | — | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **tools** | ✗ | ✓ | ✗ | ✓ | — | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **model-runtime** | ✗ | ✓ | ✗ | ✓ | ✓ | — | ✓ | ✗ | ✓ | ✗ | ✗ |
| **trace** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | — | ✓ | ✓ | ✓ | ✗ |
| **recovery** | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | — | ✗ | ✗ | ✗ |
| **budget** | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | — | ✗ | ✗ |
| **worktree** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | — | ✗ |
| **operator** | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | — |

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
| **contracts** | `modules/contracts/` (`*-design.js` validators) · shims: `bv-reviewer-design.js`, `progressive-disclosure-design.js`, `self-improvement-loop-design.js` · `validate-output.js` (via agents) · `tests/*Contract.test.js`, `tests/handoffContract.test.js`, `tests/sandboxCredentialIsolationDesign.test.js`, `tests/moduleBoundariesContract.test.js` |
| **gates** | `modules/gates/` (`governance-gate.js`, `merge-governance/`, `approval-policy-gate.js`, `doubt-review.js`, `review-record.js`) · shims: `governance-gate.js`, `merge-governance/`, `approval-policy-gate.js`, `doubt-review.js`, `review-record.js` |
| **permissions** | `agents/permissions.js`, `agents/capability-matrix.js`, `credential-broker.js`, `environment-parser.js` |
| **tools** | `security/tool-eval.js`, `security/skill-registry.js`, `security/untrusted-context-eval.js`, `mcp-client.js` |
| **model-runtime** | `modules/model-runtime/` (`model-policy-config.js`, `model-tier-gate.js`) · `agents/runtime/*`, `agents/routing/model-routing.js`, `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` |
| **trace** | `modules/trace/` (`trace-*.js`, `run-outcome-summary.js`, `otel-genai-trace-map.js`, `context-hygiene-signals.js`) · shims at legacy root paths |
| **recovery** | `modules/recovery/` (`recovery-sweep.js`, `session-resume.js`) · shims: `recovery-sweep.js`, `session-resume.js` |
| **budget** | `modules/budget/` (`token-usage-summary.js`, `token-trace-report.js`, `cost-accounting-dimensions.js`) · shims at legacy root paths |
| **worktree** | `modules/worktree/` (`worktree-isolation.js`, `worktree-result-promotion.js`, `worktree-cleanup-safety.js`, `run-workdir-contract.js`, `trace-workspace-lifecycle.js`) · shims at legacy root paths |
| **operator** | `modules/operator/` (`console-dashboard.js`, `control-plane-tui.js`, `explain-run.js`, `operator-cli-help.js`, `project-template-cli.js`, `runner-budget-view.js`, `runner-launcher.js`, `runner-preflight.js`, `runner-trace-viewer.js`, `runner-tui-cli.js`, `scenario-metrics-export.js`) · shims at legacy root paths · `runner-model-routing.js` stays root (model-runtime) |
| **disclosure** | `modules/contracts/progressive-disclosure-design.js` (shim at root; classified **disclosure** before generic `contracts` patterns in `module-boundary-rules.js`), `security/skill-registry.js` (metadata only); runtime filter **planned** |
| **shared/legacy** | `repo-root.js`, `minions-config.js`, `decision-engine.js`, `agents.js` (facade) |

Every new top-level file should declare target module in PR description. New cross-boundary imports fail CI unless added to the allowlist with explicit review justification.

---

## Known import / layering violations (honest inventory)

| Observation | Risk | Remediation lane |
|-------------|------|------------------|
| Design validators at repo root (`*-design.js`) | Shims only — canonical under `modules/contracts/` | New validators land in `modules/contracts/` |
| `orchestrator.js` imports across gates, trace, permissions, worktree | God-module pressure | Slice run-control facades per phase — deferred |
| `mcp-client.js` used from run loop and operator paths | Tool transport bleeds into operator | Keep MCP behind tools module API — tools slice deferred |
| `recovery` / `trace` gate reader imports | Grandfathered hard-rule allowlist | Follow-on allowlist shrink with evidence |

**None of the above block alpha** — they guide deferred slices (run-control, permissions, tools) and v0.10 allowlist shrink.

---

## Trace responsibilities per module

| Module | Emits (examples) | Consumes |
|--------|------------------|----------|
| run-control | `session_*`, `iteration_done`, step graph | gate outcomes |
| gates | `review_record`, `doubt_review_*`, `approval_*`, `production_boundary_check` | contract validation |
| permissions | `permission_check` | capability matrix |
| tools | `skill_registry_check`, tool eval fixtures | registry JSON |
| trace | writer lifecycle, redaction | all modules (append API); may call **recovery** for outcome summaries (not gate policy) |
| recovery | `recovery_*`, `session_resume_*` eligibility | trace rows (read); **gates** / **permissions** readers for blockers |
| worktree | `workspace_*`, promotion events | run workdir contract |
| budget | cost dimensions in summaries | trace JSONL |

---

## Enforcement (A2.2 — implemented)

| Mechanism | Path | Behavior |
|-----------|------|----------|
| **`lint:module-boundaries`** | `orchestrator/scripts/check-module-boundaries.js` | Adjacency matrix + **root import guard** (`root-import-allowlist.json` freezes `orchestrator/*.js`; shims require compat header) |
| **Allowlist** | `orchestrator/module-boundary-allowlist.json` | Grandfathered legacy violations only — new keys require review |
| **CI** | `npm test` / `orchestrator-unit-tests.yml` | Fails on unlisted violations |

**Still planned:** ESLint `import/no-restricted-paths` zones (optional); run-control, permissions, tools physical slices; allowlist shrink (v0.10 coherence closeout).

**v0.8 physical slices shipped:** contracts · recovery · gates · trace · budget · worktree · operator · partial model-runtime — see [architecture-coherence-audit.md](architecture-coherence-audit.md) slice status table.

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
| 2026-06-07 | Initial design map; cross-links to handoff/sandbox design contracts |
| 2026-06-08 | `modules/gates/` — `governance-gate`, `merge-governance`; root shims |
| 2026-06-08 | Import boundary CI — `check-module-boundaries`, allowlist, `moduleBoundaryGuard.test.js` in `npm test` |
| 2026-06-09 | `modules/contracts/` design validators; root shims |
| 2026-06-09 | `modules/recovery/`; recovery row/column in dependency matrix |
| 2026-06-09 | `modules/gates/` — `approval-policy-gate`, `doubt-review`, `review-record` |
| 2026-06-11 | `modules/trace/` |
| 2026-06-12 | `modules/budget/`; `runner-budget-view.js` remains at orchestrator root |
| 2026-06-12 | `modules/worktree/` |
| 2026-06-12 | Physical layout regression — `tests/modulesPhysicalLayout.test.js` |
| 2026-06-12 | `modules/operator/` |
| 2026-06-12 | `modules/model-runtime/` partial — policy config + tier gate (v0.9) |
| 2026-06-12 | Post-v0.8/v0.9 doc align — status + known violations updated |
| 2026-06-12 | Per-module `README.md` stubs under each physical `modules/<context>/` (v0.10 coherence closeout) |

Update when module map or known violations change.
