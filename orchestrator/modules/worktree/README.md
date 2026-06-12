# Worktree module

Bounded context stub for `modules/worktree/`. Git worktree isolation and workspace lifecycle trace. Root shims preserve legacy `require()` paths.

## Ownership

**Owns:** Worktree isolation, run workdir contract, workspace lifecycle trace events, result promotion, cleanup safety validation.

**Must not own:** Permission checks; agent prompts; gate policy; trace schema authoring.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`worktree`**:

- `contracts` — contract validators
- `trace` — append workspace lifecycle events / read rows

## Forbidden

- Permission matrix or capability decisions
- Bypassing operator approval on promotion
- Owning run loop phase graph

## Related contracts

- Worktree contracts under `docs/orchestrator/` (isolation, promotion, workdir)
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — worktree row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `tests/worktree/`

## Canonical imports

```javascript
const { createIsolatedWorktree, planWorktree } = require("./modules/worktree");
const { readRunWorkdirContract } = require("./modules/worktree/run-workdir-contract");
```
