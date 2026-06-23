# Run-control module

Bounded context for `modules/run-control/`. **Partial physical slice** — `run-state`, `run-phases/`, `run-loop-helpers.js`, `qa-spec-flow.js`, and `context-utils.js` are canonical here; `orchestrator.js` remains at legacy path. **Not** architecture complete.

## Ownership

**Owns:** In-memory run snapshot (`run-state`), run phase graph (`run-phases/`), run-loop helpers, QA spec flow, and context shaping utilities.

**Must not own:** Permission matrix SoT; trace schema authoring; gate policy tables.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`run-control`**:

- `gates` — step gate evaluation
- `permissions` — capability checks
- `trace` — append lifecycle rows
- `worktree` — workdir binding
- `model-runtime` — agent spawn routing
- `tools` — MCP transport API (`./modules/tools`)

## Forbidden

- Importing `operator` for CLI formatting
- Owning permission or trace schema SoT
- Claiming run-control hub migration complete while `orchestrator.js` remains at root

## Related contracts

- [agent-contract.md](../../../docs/orchestrator/agent-contract.md) — authoritative state vs run snapshot
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — run-control row

## Canonical imports

```javascript
const { createRunState, getRunStatePublicView } = require("./modules/run-control/run-state");
const { executeSessionStartPhase } = require("./modules/run-control/run-phases/session-start");
const { detectBlockers } = require("./modules/run-control/run-loop-helpers");
```

**Root compat shims (deprecated):** `run-state.js`, `run-phases/*.js`, `run-loop-helpers.js`, `qa-spec-flow.js`, `context-utils.js`.
