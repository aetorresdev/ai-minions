# Gates module

Bounded context stub for `modules/gates/`. Root shims preserve legacy `require()` paths.

## Ownership

**Owns:** Human approval, policy gates, governance pre-checks, PR-boundary governance, doubt-review hooks, durable `review_record` emission.

**Must not own:** Permission matrix source of truth; model routing; run loop scheduling.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`gates`**:

- `contracts` — validators / schema helpers
- `permissions` — capability reads for gate context
- `trace` — emit gate outcomes (`approval_*`, `review_record`, …)

## Forbidden

- Deciding permission matrix entries
- Operator/CLI surfaces
- Trace schema authoring

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — gates row
- Governance / approval / doubt-review docs under `docs/orchestrator/`

## Canonical imports

```javascript
const gates = require("./modules/gates");
const { evaluatePrBoundaryGovernance } = require("./modules/gates/merge-governance");
const { buildReviewRecord } = require("./modules/gates/review-record");
```
