# Run-control module

Bounded context for `modules/run-control/`. **Partial physical slice** — run-state, run-phases, helper bundle, and **orchestrator hub** are canonical here; root compat shims remain. **Not** architecture complete (`agents/` tree deferred).

## Ownership

**Owns:** In-memory run snapshot (`run-state`), run phase graph (`run-phases/`), run-loop helpers, QA spec flow, context shaping utilities, and run-loop hub (`orchestrator.js`).

**Must not own:** Permission matrix SoT; trace schema authoring; gate policy tables.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`run-control`**:

- `gates` — step gate evaluation
- `permissions` — capability checks
- `trace` — append lifecycle rows
- `worktree` — workdir binding
- `model-runtime` — agent spawn routing
- `tools` — MCP transport API (`../tools`)

## Forbidden

- Importing `operator` for CLI formatting
- Owning permission or trace schema SoT
- Claiming modular monolith or run-control migration complete while `agents/` tree remains at root

## Related contracts

- [run-control-hub-decision.md](../../../docs/orchestrator/run-control-hub-decision.md) — hub role and physical move acceptance
- [agent-contract.md](../../../docs/orchestrator/agent-contract.md) — authoritative state vs run snapshot
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — run-control row

## Canonical imports

```javascript
const { run } = require("./modules/run-control/orchestrator");
const { createRunState, getRunStatePublicView } = require("./modules/run-control/run-state");
const { executeSessionStartPhase } = require("./modules/run-control/run-phases/session-start");
const { detectBlockers } = require("./modules/run-control/run-loop-helpers");
```

**Root compat shims (deprecated):** `orchestrator.js`, `run-state.js`, `run-phases/*.js`, `run-loop-helpers.js`, `qa-spec-flow.js`, `context-utils.js`.
