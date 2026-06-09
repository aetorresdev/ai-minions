# Recovery module

Bounded context: stranded run/step detection (`recovery-sweep`), session checkpoint eligibility (`session-resume`). Detect and explain only — no auto-resume.

**Physical slice:** moved from orchestrator root. Root shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const { summarizeRecoveryFromRows } = require("./modules/recovery/recovery-sweep");
const { summarizeSessionResumeFromRows } = require("./modules/recovery/session-resume");
```

May import **gates** and **permissions** readers to derive eligibility — not to decide policy.

See `docs/orchestrator/recovery-sweep-contract.md` and `docs/orchestrator/session-resume-contract.md`.
