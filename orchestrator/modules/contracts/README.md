# Contracts module

Bounded context: design-first validators, handoff/MODE contract helpers, contract drift test anchors.

**Physical slice:** `*-design.js` validators moved from orchestrator root. Root-level shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const {
  validateValueReviewTraceLine,
} = require("./modules/contracts/bv-reviewer-design");
const contracts = require("./modules/contracts");
const {
  validateContextDisclosureTraceLine,
} = require("./modules/contracts/progressive-disclosure-design");
```

`modules/contracts/index.js` exports **contracts-owned** validators only. Progressive disclosure is classified as **disclosure** — import it directly (or via root shim), not through the contracts barrel.

See `docs/orchestrator/module-boundaries.md` and `docs/orchestrator/architecture-coherence-audit.md`.
