# Budget module

Bounded context: token usage summaries, trace JSONL read/report (`tokens:report`), and run-level cost accounting dimensions.

**Physical slice:** moved from orchestrator root. Root shims preserve existing `require()` paths and CLI entry (`node token-trace-report.js`).

**Canonical imports (preferred in new code):**

```javascript
const { buildReport, parseJsonl } = require("./modules/budget");
const { buildTokenUsageSummary } = require("./modules/budget/token-usage-summary");
```

**Deferred:** `runner-budget-view.js` stays at root until operator slice.

See `docs/orchestrator/module-boundaries.md`.
