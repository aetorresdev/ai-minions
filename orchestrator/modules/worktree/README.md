# Worktree module

Bounded context: git worktree isolation, run workdir contract, workspace lifecycle trace events, result promotion, and cleanup safety validation.

**Physical slice:** moved from orchestrator root. Root shims preserve existing `require()` paths.

**Canonical imports (preferred in new code):**

```javascript
const { createIsolatedWorktree, planWorktree } = require("./modules/worktree");
const { readRunWorkdirContract } = require("./modules/worktree/run-workdir-contract");
```

See `docs/orchestrator/module-boundaries.md` and worktree contracts under `docs/orchestrator/`.
