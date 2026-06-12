# Contracts module

Bounded context stub for `modules/contracts/`. Design-first validators and contract drift anchors. Root shims preserve legacy `require()` paths.

## Ownership

**Owns:** Handoff/MODE/output validation helpers, design-first validators (`*-design.js`), contract drift test anchors.

**Must not own:** Spawning agents; writing traces; MCP transport; gate decisions.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`contracts`**:

- None — contracts validators are leaf nodes; other modules import contracts, not the reverse.

## Forbidden

- Upward imports into `run-control`, `gates`, `permissions`, `trace`, or `operator`
- Runtime side effects during validation

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — contracts row
- [handoff-contract.md](../../../docs/orchestrator/handoff-contract.md)
- [architecture-coherence-audit.md](../../../docs/orchestrator/architecture-coherence-audit.md)

## Canonical imports

```javascript
const { validateValueReviewTraceLine } = require("./modules/contracts/bv-reviewer-design");
const contracts = require("./modules/contracts");
const { validateContextDisclosureTraceLine } =
  require("./modules/contracts/progressive-disclosure-design");
```

`modules/contracts/index.js` exports contracts-owned validators only. Progressive disclosure is classified as **disclosure** — import via direct path or root shim, not the contracts barrel.
