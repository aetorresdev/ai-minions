# Recovery module

Bounded context stub for `modules/recovery/`. Detect and explain only — no auto-resume. Root shims preserve legacy `require()` paths.

## Ownership

**Owns:** Stranded run/step detection (`recovery-sweep`), session checkpoint eligibility (`session-resume`), resume gating explanations.

**Must not own:** Gate policy tables; live run loop mutation without operator path; permission matrix SoT.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`recovery`**:

- `contracts` — schema/contract validators
- `gates` — read review/governance state (eligibility only)
- `permissions` — capability reads for resume gating

## Forbidden

- Mutating gate policy
- Auto-resuming runs without operator path
- Owning trace schema

## Related contracts

- [recovery-sweep-contract.md](../../../docs/orchestrator/recovery-sweep-contract.md)
- [session-resume-contract.md](../../../docs/orchestrator/session-resume-contract.md)
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — recovery row

## Canonical imports

```javascript
const { summarizeRecoveryFromRows } = require("./modules/recovery/recovery-sweep");
const { summarizeSessionResumeFromRows } = require("./modules/recovery/session-resume");
```
