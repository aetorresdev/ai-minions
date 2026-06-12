# Operator module

Bounded context: operator-facing CLI/TUI, explain-run, scenario metrics export, runner preflight/launcher/trace/budget views, and CLI help surfaces.

**Physical slice:** moved from orchestrator root. Root shims preserve existing `require()` paths and `node <script>.js` entry behavior.

**Canonical imports (preferred in new code):**

```javascript
const { printOperatorCliHelp } = require("./modules/operator");
const { buildDashboardText } = require("./modules/operator/console-dashboard");
const { runTraceViewer } = require("./modules/operator/runner-trace-viewer");
```

**Stays at root:** `runner-model-routing.js` (model-runtime bounded context).

See `docs/orchestrator/module-boundaries.md`.
