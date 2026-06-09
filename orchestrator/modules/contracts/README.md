# Contracts module

Bounded context: design-first validators, handoff/MODE contract helpers, contract drift test anchors.

**Physical slice:** `*-design.js` validators moved from orchestrator root. Root-level shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const {
  validateValueReviewTraceLine,
} = require("./modules/contracts/bv-reviewer-design");
const contracts = require("./modules/contracts");
```

See `docs/orchestrator/module-boundaries.md` and `docs/orchestrator/architecture-coherence-audit.md`.
