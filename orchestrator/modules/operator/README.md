# Operator module

Bounded context stub for `modules/operator/`. Read-mostly CLI/TUI surfaces. Root shims preserve `node <script>.js` entry behavior.

## Ownership

**Owns:** CLI/TUI, explain-run, operator trace summary, scenario metrics export, runner preflight/launcher/trace/budget views, console dashboard, control-plane TUI, project template CLI, operator help.

**Must not own:** Domain policy; gate bypass; permission matrix; trace schema authoring.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`operator`**:

- `run-control` — start/invoke orchestrator runs
- `contracts` — read validators / shapes
- `trace` — read traces for viewers/export
- `budget` — budget view rollups
- `worktree` — worktree status/contract surfaces

## Forbidden

- Mutating gate state without trace + human path
- Owning model routing (canonical: `modules/model-runtime/runner-model-routing.js`; root shim retained)
- Permission policy tables

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — operator row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `tests/operator/`

## Canonical imports

```javascript
const { printOperatorCliHelp } = require("./modules/operator");
const { buildDashboardText } = require("./modules/operator/console-dashboard");
const { buildOperatorTraceSummary } = require("./modules/operator/operator-trace-summary");
const { runTraceViewer } = require("./modules/operator/runner-trace-viewer");
```

**Model-runtime routing:** `modules/model-runtime/runner-model-routing.js` (root shim: `runner-model-routing.js`).
