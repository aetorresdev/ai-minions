# Model Routing and Handoff Rules

Defines which model each role uses, when local fallback is safe, and what structural keys each MODE must produce in its handoff YAML.

---

## Model routing

Configured in `examples/orchestrator/agents.js` (`MODEL_ROUTING`).

| Role | Primary | Fallback | Local safe? |
|------|---------|----------|-------------|
| `orchestrator` | `qwen2.5-coder:7b` (Ollama) | — | Yes |
| `summarizer` | `qwen2.5-coder:7b` (Ollama) | — | Yes |
| `owner` | `claude-haiku-4-5-20251001` | `qwen2.5-coder:7b` | Yes |
| `dev-backend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-frontend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-devops` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `architect` | `claude-sonnet-4-6` | — | No |
| `qa` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `cerberus` | `claude-sonnet-4-6` | — | No |

**Local safe = true** means `qwen2.5-coder:7b` (Ollama) can substitute when no API key is available. Roles where this is `false` require strong reasoning (implementation, adversarial review) that small local models cannot reliably provide.

### Per-role override

Set `MODEL_OVERRIDE_<ROLE>` environment variable (role uppercased, hyphens → underscores):

```bash
MODEL_OVERRIDE_DEV_BACKEND=claude-haiku-4-5-20251001 node run-orchestrator.js "goal"
MODEL_OVERRIDE_QA=qwen2.5-coder:7b node run-orchestrator.js "goal"   # local fallback, not recommended
```

---

## Handoff structure rules

After each agent completes, `compact-handoff` MCP produces a YAML handoff. `validateHandoffStructure()` (in `orchestrator.js`) performs a shallow key-presence check before the MCP gates run.

An **empty or unparseable YAML always passes** — compact-handoff may not be registered.

### Required keys per MODE

| MODE | Required keys | Notes |
|------|--------------|-------|
| `DEV` | `files_modified` **or** `validation_run` | At least one must be present |
| `QA` | `verdict` **and** (`findings` **or** `issues`) | Both required together |
| `CERBERUS` | `verdict` **and** no open `blockers` | `blockers` key present with list items = blocked |
| `OWNER`, `ARCHITECT`, `ORCHESTRATOR` | None | No structural check |

### What happens on failure

A structural validation failure sets `gateBlocked: true` on the artifact and skips both the MCP gates and `advance_mode` for that step. It does **not** throw — the loop continues to the next step or iteration.

Output:
```
10:27:44 AM [gate] 🟥 Handoff structure invalid (QA): QA handoff must include verdict
```

### Handoff YAML shape (compact-handoff output)

```yaml
mode_completed: DEV
next_mode: QA
iteration: 1

files_modified:
  - src/api/users.py
  - tests/test_users.py

validation_run: pytest tests/test_users.py — 12 passed

summary: Added input validation to POST /users endpoint. All existing tests pass.
```

```yaml
mode_completed: QA
next_mode: CERBERUS
iteration: 1

verdict: pass

findings:
  - type: improvement
    description: Missing edge case for empty username

issues: []

summary: All acceptance criteria met. One non-blocking improvement noted.
```

```yaml
mode_completed: CERBERUS
next_mode: ORCHESTRATOR
iteration: 1

verdict: pass

blockers: []

improvements:
  - description: Consider rate limiting on the endpoint

summary: No blockers. One improvement logged to backlog.
```
