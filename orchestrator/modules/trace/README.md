# Trace module

Bounded context stub for `modules/trace/`. JSONL trace SoT — schema, writers, redaction, lifecycle signals, derived export mappers. Root shims preserve legacy `require()` paths.

## Ownership

**Owns:** JSONL schema, append/sanitize/redact, lifecycle events, run outcome summary (aggregation), OTel GenAI mapper (derived only), context hygiene signals.

**Must not own:** Policy decisions (what may run); gate verdict parsing; recovery eligibility rules.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`trace`**:

- `contracts` — schema validators
- `recovery` — read rows for summaries (consumption)
- `budget` — cost/token rollups from rows
- `worktree` — workspace lifecycle consumption

Grandfathered allowlist may permit narrow reads (e.g. `review-record` for outcome summary) — consumption only.

## Forbidden

- Owning permission or approval policy
- Operator CLI formatting
- Gate decisions embedded in trace writers

## Related contracts

- Trace contracts under `docs/orchestrator/` (schema, privacy, strict-mode)
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — trace row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `tests/trace/`

## Canonical imports

```javascript
const { validateTraceLine, traceEvent } = require("./modules/trace");
const { buildRunOutcomeSummary } = require("./modules/trace/run-outcome-summary");
```
