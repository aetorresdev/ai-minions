# Permissions module

Bounded context for `modules/permissions/`. **Partial physical slice** — credential broker and environment parser are canonical here; `agents/permissions.js` and `agents/capability-matrix.js` remain at legacy paths. **Not** architecture complete.

## Ownership

**Owns:** Brokered credential resolution (`credential-broker`), ENVIRONMENT block parsing (`environment-parser`).

**Must not own:** Gate verdict parsing; trace schema; shell execution; capability matrix SoT (still under `agents/`).

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`permissions`**:

- `contracts` — schema/contract validators
- `tools` — manifest metadata reads
- `trace` — append broker audit rows (no secret values)
- `shared` — legacy agent credential resolution helpers

## Forbidden

- Owning trace redaction policy (consume trace helpers only)
- Bypassing capability matrix for credential ceiling
- Importing `operator` or `run-control` for scheduling

## Related contracts

- [credential-broker-contract.md](../../../docs/orchestrator/credential-broker-contract.md)
- [environment-access.md](../../../docs/orchestrator/environment-access.md)
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — permissions row

## Canonical imports

```javascript
const { requestCredentialUse } = require("./modules/permissions/credential-broker");
const { parseEnvironment } = require("./modules/permissions/environment-parser");
```

**Root compat shims (deprecated):** `credential-broker.js`, `environment-parser.js` re-export canonical modules. **Legacy paths:** `agents/permissions.js`, `agents/capability-matrix.js`.
