# Budget module

Bounded context stub for `modules/budget/`. Token/cost accounting from trace rows — not production spend enforcement. Root shims preserve CLI entry (`node token-trace-report.js`).

## Ownership

**Owns:** Token usage summaries, trace JSONL read/report (`tokens:report`), run-level cost accounting dimensions, budget view rollups.

**Must not own:** Production spend SLA enforcement; trace schema authoring; model routing.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`budget`**:

- `contracts` — validators
- `model-runtime` — usage field helpers
- `trace` — read trace rows / schema helpers

## Forbidden

- Enforcing spend limits as production policy
- Mutating gate or permission state
- Operator-owned CLI policy

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — budget row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `tests/budget/`

## Canonical imports

```javascript
const { buildReport, parseJsonl } = require("./modules/budget");
const { buildTokenUsageSummary } = require("./modules/budget/token-usage-summary");
```
