# Shared / legacy module

Bounded context for `modules/shared/`. **Partial physical slice** — agents facade, decision engine, repo-root helper, and minions project config are canonical here; root compat shims remain. **`agents/` subtree** still at legacy paths (E17-5 deferred). **Not** architecture complete.

## Ownership

**Owns:** Public agents facade (`agents.js`), orchestrator decide/plan control-plane rules (`decision-engine.js`), repository root resolution (`repo-root.js`), optional `minions.md` project contract loader (`minions-config.js`).

**Must not own:** Agent registry/runtime implementation (`agents/` tree); trace schema; gate policy.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`shared/legacy`**:

- `agents/` subtree — registry, runtime, prompts, validate-output
- `model-runtime` — local model policy and tier gates (agents facade)
- `trace` — model selection trace payloads
- `security` — outbound text scanning
- Root compat shims for model-runtime paths where not yet internalized

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
