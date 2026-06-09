# Gates module

Bounded context: human approval, policy gates, governance pre-checks, PR-boundary governance, durable review records.

**Physical home:** `governance-gate.js`, `merge-governance/`, `approval-policy-gate.js`, `doubt-review.js`, `review-record.js`. Root-level shims preserve legacy `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const gates = require("./modules/gates");
const { evaluatePrBoundaryGovernance } = require("./modules/gates/merge-governance");
const { buildReviewRecord } = require("./modules/gates/review-record");
```

See `docs/orchestrator/module-boundaries.md`.
