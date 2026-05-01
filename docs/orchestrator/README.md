# Project Orchestrator — documentation

All paths are **from the repo root** (`REPO_ROOT`). No fixed user paths: [PATHS.md](PATHS.md).

The **Node runner and tests** live under **`orchestrator/`** (product path).

| File | Purpose |
|------|---------|
| [PATHS.md](PATHS.md) | **`REPO_ROOT` convention, Cursor in another project, User Rules** |
| [agent-contract.md](agent-contract.md) | MODE, handoffs, § Skills and MCP |
| [agent-harness.md](agent-harness.md) | Harness layers: context, memory/state, control, validation, observability |
| [system-architecture-diagram.md](system-architecture-diagram.md) | Full operational Mermaid (skills, hooks, MCPs, disk, Ollama) |
| [mcp-task-examples.md](mcp-task-examples.md) | Subagent / `mcp_task` |
| [CURSOR_RULE_SETUP.md](CURSOR_RULE_SETUP.md) | User Rules vs project rules |
| [shared-dependencies.md](shared-dependencies.md) | `mcp-servers/`, `scripts/hooks/`, `skills/`, `agents/` — required vs optional, access, failure modes |
| [graph-validation.md](graph-validation.md) | Run-level JSONL step graph: `validateTraceRunGraph`, violation types, CI fixtures |
| [run-outcome-consumption.md](run-outcome-consumption.md) | **`run_outcome_summary`** schema — interpreting traces without raw JSONL (`explain-run`, export, dashboard) |
| [role-agent-registry.md](role-agent-registry.md) | Future roles: minimal registry schema (design-time; no runtime wiring) |

**Cursor rule:** `.cursor/rules/orchestrator.mdc` — `scripts/install-orchestrator-rule.sh` to copy it to another repo.
