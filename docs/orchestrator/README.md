# Project Orchestrator — documentation

All paths are **from the repo root** (`REPO_ROOT`). No fixed user paths: [PATHS.md](PATHS.md).

The **Node runner and tests** live under **`orchestrator/`** (product path).

| File | Purpose |
|------|---------|
| [PATHS.md](PATHS.md) | **`REPO_ROOT` convention, Cursor in another project, User Rules** |
| [agent-contract.md](agent-contract.md) | MODE, handoffs, § Skills and MCP |
| [capability-flow-contract.md](capability-flow-contract.md) | Task / run / step, capability matrix, handoffs — maps to `capability-matrix.v1`, plan validation |
| [agent-registry-layout.md](agent-registry-layout.md) | ROLE-REGISTRY-2: canonical `agents.js` facade vs `agents/` internals |
| [adding-a-new-role.md](adding-a-new-role.md) | ROL-GOV-1: checklist for new roles + parity expectations |
| [minions-project-contract.md](minions-project-contract.md) | OC-MINIONS-1: optional root `minions.md` JSON contract |
| [alpha-release-checklist.md](alpha-release-checklist.md) | SHIP-1: alpha readiness checklist |
| [security-posture.md](security-posture.md) | Public security posture + threat model (honest) |
| [harness-engineering-positioning.md](harness-engineering-positioning.md) | Harness framing, orchestration model, external cross-checks (not authority) |
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
| [role-agent-registry.md](role-agent-registry.md) | Future roles: minimal registry schema (design-time; no runtime wiring) |

**Cursor rule:** `.cursor/rules/orchestrator.mdc` — `scripts/install-orchestrator-rule.sh` to copy it to another repo.
