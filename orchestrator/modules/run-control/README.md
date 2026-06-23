# Run-control module

Bounded context for `modules/run-control/`. **Partial physical slice** — in-memory run snapshot (`run-state`) is canonical here; `run-phases/`, `run-loop-helpers.js`, and `orchestrator.js` remain at legacy paths. **Not** architecture complete.

## Ownership

**Owns:** In-memory run snapshot and step lifecycle helpers (`run-state`).

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
```

**Root compat shim (deprecated):** `run-state.js` re-export.
