# Project Orchestrator — documentation

All paths are **from the repo root** (`REPO_ROOT`). No fixed user paths: [PATHS.md](PATHS.md).

The **Node runner and tests** live under **`orchestrator/`** (product path).

| File | Purpose |
|------|---------|
| [PATHS.md](PATHS.md) | **`REPO_ROOT` convention, Cursor in another project, User Rules** |
| [agent-contract.md](agent-contract.md) | MODE, handoffs, § Skills and MCP |
| [capability-flow-contract.md](capability-flow-contract.md) | Task / run / step, capability matrix, handoffs — maps to `capability-matrix.v1`, plan validation |
| [agent-registry-layout.md](agent-registry-layout.md) | Canonical `agents.js` facade vs `agents/` internals |
| [adding-a-new-role.md](adding-a-new-role.md) | Checklist for new roles + parity expectations |
| [minions-project-contract.md](minions-project-contract.md) | Optional root `minions.md` JSON contract |
| [alpha-release-checklist.md](alpha-release-checklist.md) | Alpha release readiness checklist |
| [governance-gates-contract.md](governance-gates-contract.md) | Human approval gate — trace schema + helpers + MCP `requires_approval` emit; grant/deny UI + resume path pending |
| [approval-policy-gates-contract.md](approval-policy-gates-contract.md) | Policy-driven PO/ARCH/DEV gates — `validation: always`, `human_approval: policy-driven`, trace `approval_skipped`, DEV pre-check |
| [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) | CERBERUS adversarial doubt cycle — trace `doubt_review_*`, claim matrix, pre-merge brief alignment |
| [openspec-sdd-cross-check.md](openspec-sdd-cross-check.md) | OpenSpec SDD comparison (reference) — mapping table, no runtime dependency |
| [market-validation-notes.md](market-validation-notes.md) | Control-first positioning research — allowed/forbidden claims, pain themes (doc-only) |
| [security-posture.md](security-posture.md) | Public security posture + threat model (honest) |
| [production-boundary-guard.md](production-boundary-guard.md) | Production Boundary Guard — `agent_as_contributor`, privileged-op boundary, `production_boundary_check` trace contract |
| [merge-governance-contract.md](merge-governance-contract.md) | PR-boundary governance — dry-run gate, config fallback, `production_boundary_check` emission library |
| [harness-engineering-positioning.md](harness-engineering-positioning.md) | Harness framing, orchestration model, external references (not authority) |
| [agent-harness.md](agent-harness.md) | Harness layers: context, memory/state, control, validation, observability |
| [system-architecture-diagram.md](system-architecture-diagram.md) | Full operational Mermaid (skills, hooks, MCPs, disk, Ollama) |
| [mcp-task-examples.md](mcp-task-examples.md) | Subagent / `mcp_task` |
| [CURSOR_RULE_SETUP.md](CURSOR_RULE_SETUP.md) | User Rules vs project rules |
| [shared-dependencies.md](shared-dependencies.md) | `mcp-servers/`, `scripts/hooks/`, `skills/`, `agents/` — required vs optional, access, failure modes |
| [hooks-claude-code-metrics-validation.md](hooks-claude-code-metrics-validation.md) | Compact read policy, snapshot scope, metric trust, end-of-run validation footer for Claude Code hooks |
| [graph-validation.md](graph-validation.md) | Run-level JSONL step graph: `validateTraceRunGraph`, violation types, CI fixtures |
| [run-outcome-consumption.md](run-outcome-consumption.md) | **`run_outcome_summary`** schema — interpreting traces without raw JSONL (`explain-run`, export, dashboard) |
| [failure-semantics-contract.md](failure-semantics-contract.md) | **`iteration_done`** failure taxonomy — `reason_code`, `failure_type`, `failure_axis` (writer/reader contract, links to strict-mode and tests) |
| [trace-privacy-contract.md](trace-privacy-contract.md) | Secret-shaped redaction — writer **`_sanitize`**, read **`sanitizeTraceRowsForRead`**, env flags, test anchors |
| [token-hygiene-guide.md](token-hygiene-guide.md) | Operator habits: new run vs continue, handoffs, scope splits, reading token reports (no runtime enforcement) |
| [context-hygiene-signals.md](context-hygiene-signals.md) | Trace `context_hygiene_signal` events — observability only |
| [review-record-contract.md](review-record-contract.md) | Durable QA/CERBERUS `review_record` trace events + export consumption |
| [model-selection-trace-contract.md](model-selection-trace-contract.md) | Observable `model_selection` trace — tier and provenance (not auto-routing) |
| [bv-reviewer-contract.md](bv-reviewer-contract.md) | Business value / outcome gate — `value_review` trace shape (design-first; no runtime gate) |
| [self-improvement-loop-contract.md](self-improvement-loop-contract.md) | Governed harness improvement loop — `improvement_proposal` + human approval gate (design-first; no auto-apply) |
| [module-boundaries.md](module-boundaries.md) | Modular monolith bounded contexts — module map, `modules/gates/` slice, CI `lint:module-boundaries` |
| [architecture-coherence-audit.md](architecture-coherence-audit.md) | v0.8 system coherence matrix + physical refactor movement plan (audit only) |
| [module-ownership-map.md](module-ownership-map.md) | Bounded-context ownership — current vs target paths |
| [root-file-inventory.md](root-file-inventory.md) | `orchestrator/` root file classification |
| [progressive-disclosure-contract.md](progressive-disclosure-contract.md) | Tools/skills/context progressive disclosure — gap assessment + `context_disclosure` trace (design-first) |
| [handoff-contract.md](handoff-contract.md) | Delegated ownership handoff envelope — bounded invocation vs ownership transfer (design-only) |
| [sandbox-credential-isolation-design.md](sandbox-credential-isolation-design.md) | Sandbox + credential isolation trust boundaries (design-only) |
| [skill-registry-contract.md](skill-registry-contract.md) | Local skill allowlist (`skill-registry.v1.json`) + opt-in hook enforcement |
| [skill-router-design.md](skill-router-design.md) | Lifecycle intent → MODE/skills policy (design only; no runtime router) |
| [recovery-sweep-contract.md](recovery-sweep-contract.md) | Stranded run/step detection (`recovery_*` events); detect/explain only |
| [session-resume-contract.md](session-resume-contract.md) | Session checkpoint + resume eligibility (`session_*` events); explicit operator resume only |
| [memory-store-decision.md](memory-store-decision.md) | Local storage categories, matrix, go/no-go (design-first; trace SoT) |
| [context-package-contract.md](context-package-contract.md) | Context package inclusion policy — required / optional / excluded / rejected (design-first) |
| [control-plane-tui-contract.md](control-plane-tui-contract.md) | Read-only run inspect CLI (`control-plane:tui`); stdout panel over run_outcome_summary |
| [portable-project-template-contract.md](portable-project-template-contract.md) | Export/import scrubbed project config bundle; import dry-run only |
| [skill-security-threatmodel.md](skill-security-threatmodel.md) | Workflow skills threat model — threat → control → gap (no skill sandbox claim) |
| [workflow-skill-contract.md](workflow-skill-contract.md) | Local `SKILL.md` template, conformance checklist, role ↔ skill loading (doc only) |
| [local-inference-sizing.md](local-inference-sizing.md) | RAM/VRAM sizing for local inference — single vs multi-agent, context, quant (guidance only) |
| [local-model-policy.md](local-model-policy.md) | Local-only run policy (`ORCH_MODEL_MODE=local_only`) |
| [local-model-discovery.md](local-model-discovery.md) | List local backends/models without inference |
| [local-model-selection.md](local-model-selection.md) | Model override precedence and trace fields |
| [worktree-isolation-contract.md](worktree-isolation-contract.md) | Git worktree per run — binding, workdir contract, lifecycle trace, cleanup safety (v0.3 alpha) |
| [worktree-result-promotion-contract.md](worktree-result-promotion-contract.md) | Explicit promotion path for worktree outputs — operator approve, trace, separate from cleanup |
| [dynamic-workflow-contract.md](dynamic-workflow-contract.md) | Dynamic workflow proposal vs executable plan — limits, preview, approval (design-first; no runtime) |
| [eval-benchmark-triage.md](eval-benchmark-triage.md) | External harness benchmark triage — core matrix, appendices A–F, pilot/defer/reject (doc-only) |
| [credential-broker-contract.md](credential-broker-contract.md) | Brokered credentials outside model context — read/write enforcement, `credential_broker_used` trace |
| [doc-runtime-drift-check.md](doc-runtime-drift-check.md) | Deterministic forbidden overclaim scan for security/runtime docs (`lint:docs-claims`) |
| [runner-tui-contract.md](runner-tui-contract.md) | Runner TUI CLI — preflight, run, trace, budget, worktree |
| [role-agent-registry.md](role-agent-registry.md) | Future roles: minimal registry schema (design-time; no runtime wiring) |

**Cursor rule:** `.cursor/rules/orchestrator.mdc` — `scripts/install-orchestrator-rule.sh` to copy it to another repo.
