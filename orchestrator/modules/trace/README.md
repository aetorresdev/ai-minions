# Trace module

Bounded context: JSONL trace schema, writers, redaction, lifecycle/hygiene signals, run outcome summary, OTel GenAI mapper (derived export only).

**Physical slice:** moved from orchestrator root. Root shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const { validateTraceLine, traceEvent } = require("./modules/trace");
const { buildRunOutcomeSummary } = require("./modules/trace/run-outcome-summary");
```

**Boundary:** trace consumes recovery/worktree/budget rows; `run-outcome-summary` reads `review-record` via grandfathered allowlist (`trace-not-policy`) — consumption only, not gate decisions.

See `docs/orchestrator/module-boundaries.md` and trace contracts under `docs/orchestrator/`.
