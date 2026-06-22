# Model-runtime module

Bounded context for `modules/model-runtime/`. **Partial physical slice** — discovery, selection, policy, runner routing, and hook bridge are canonical under this module; `agents/runtime/*` and `agents/routing/` remain at legacy paths. **Not** architecture complete.

## Ownership

**Owns:** Local model policy config, model tier gate, and (at root) discovery/selection, agent runtime adapters, hook bridge, runner model routing.

**Must not own:** Approval before DEV; trace redaction policy; gate verdict parsing.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`model-runtime`**:

- `contracts` — schema/contract validators (read-only)
- `permissions` — capability ceiling reads
- `tools` — manifest / tool metadata
- `trace` — append usage/selection rows
- `budget` — token/cost field helpers

## Forbidden

- Importing `operator` or `run-control` for scheduling decisions
- Owning trace schema or redaction policy
- Bypassing permissions for model invocation

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — model-runtime row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `model-runtime` owner

## Canonical imports

```javascript
const { loadModelPolicyConfig } = require("./modules/model-runtime/model-policy-config");
const { evaluateModelTierGate } = require("./modules/model-runtime/model-tier-gate");
const { discoverLocalModels } = require("./modules/model-runtime/local-model-discovery");
```

**Root compat shims (deprecated):** `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` re-export canonical modules. **Legacy paths:** `agents/runtime/*`, `agents/routing/`.
