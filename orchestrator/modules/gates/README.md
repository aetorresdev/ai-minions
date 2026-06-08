# Gates module

Bounded context: human approval, policy gates, governance pre-checks, PR-boundary governance.

**Slice 1 (A2.1):** `governance-gate.js` and `merge-governance/` live here. Root-level shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const gates = require("./modules/gates");
const { evaluatePrBoundaryGovernance } = require("./modules/gates/merge-governance");
const { buildApprovalGrantedPayload } = require("./modules/gates/governance-gate");
```

See `docs/orchestrator/module-boundaries.md`.
