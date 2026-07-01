# Shared / legacy module

Bounded context for `modules/shared/`. **Partial physical slice** — agents facade, decision engine, repo-root helper, and minions project config are canonical here; root compat shims remain. **`agents/` registry subtree** (registry, permissions, validate-output, capability-matrix, prompts) remains under `orchestrator/agents/`. **Not** architecture complete.

## Ownership

**Owns:** Public agents facade (`agents.js`), orchestrator decide/plan control-plane rules (`decision-engine.js`), repository root resolution (`repo-root.js`), optional `minions.md` project contract loader (`minions-config.js`).

**Must not own:** Agent registry/permissions/validate-output implementation (`agents/` tree except re-exports); trace schema; gate policy.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`shared/legacy`**:

- `agents/` subtree — registry, permissions, validate-output, prompts (not runtime/routing runners)
- `model-runtime` — runners, routing table, local model policy and tier gates (agents facade imports canonical paths)

## Forbidden

- Owning run-loop phase graph or gate verdict tables
- Claiming modular monolith or shared migration complete while `agents/` tree remains at root
- Importing `operator` or `run-control` for scheduling

## Related contracts

- [agent-contract.md](../../../docs/orchestrator/agent-contract.md) — agents facade contract
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — shared/legacy row
- [run-control-hub-decision.md](../../../docs/orchestrator/run-control-hub-decision.md) — hub imports shared agents facade

## Canonical imports

```javascript
const { askAgent, AGENTS } = require("./modules/shared/agents");
const { decideFromOrchestratorDecide } = require("./modules/shared/decision-engine");
const { getRepoRoot } = require("./modules/shared/repo-root");
const { loadMinionsProjectConfig } = require("./modules/shared/minions-config");
```

**Root compat shims (deprecated):** `agents.js`, `decision-engine.js`, `repo-root.js`, `minions-config.js` re-export canonical modules.
