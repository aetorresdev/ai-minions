# Model Routing and Handoff Rules

Defines which model each role uses, when local fallback is safe, and what structural keys each MODE must produce in its handoff YAML.

---

## Model routing

Configured in `examples/orchestrator/agents.js` (`MODEL_ROUTING`).

| Role | Primary | Fallback | Local safe? |
|------|---------|----------|-------------|
| `orchestrator` | `$OLLAMA_MODEL` or `claude-haiku` | `claude-haiku-4-5-20251001` | Yes |
| `summarizer` | `$OLLAMA_MODEL` or `claude-haiku` | `claude-haiku-4-5-20251001` | Yes |
| `owner` | `claude-haiku-4-5-20251001` | `$OLLAMA_MODEL` or `claude-haiku` | Yes |
| `dev-backend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-frontend` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `dev-devops` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `architect` | `claude-sonnet-4-6` | — | No |
| `qa` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | No |
| `cerberus` | `claude-sonnet-4-6` | — | No |

**Local safe = true** means a local or cheaper model can substitute. Roles with `false` require strong reasoning (implementation, adversarial review) that weaker models cannot reliably provide.

### Ollama configuration

`orchestrator` and `summarizer` run on Ollama when `OLLAMA_MODEL` is set. If unset or Ollama is unreachable, they fall back to `claude-haiku-4-5-20251001` automatically.

```bash
# Enable Ollama (run `ollama pull <model>` first):
OLLAMA_MODEL=qwen2.5-coder:7b node run-orchestrator.js "goal"

# Supported alternatives:
# OLLAMA_MODEL=llama3.1:8b
# OLLAMA_MODEL=mistral:7b
# OLLAMA_MODEL=deepseek-coder:6.7b

# Custom Ollama host/port (default: localhost:11434):
OLLAMA_HOST=192.168.1.10 OLLAMA_PORT=11434 OLLAMA_MODEL=qwen2.5-coder:7b node run-orchestrator.js "goal"

# Without Ollama — orchestrator/summarizer use claude-haiku:
node run-orchestrator.js "goal"
```

At startup, the runner pings Ollama and logs whether it is available. No silent failures.

### Per-role override

Set `MODEL_OVERRIDE_<ROLE>` environment variable (role uppercased, hyphens → underscores):

```bash
MODEL_OVERRIDE_DEV_BACKEND=claude-haiku-4-5-20251001 node run-orchestrator.js "goal"
MODEL_OVERRIDE_QA=claude-haiku-4-5-20251001 node run-orchestrator.js "goal"
```

---

## Fallback policy

Configured in `examples/orchestrator/agents.js` (`FALLBACK_POLICY`).

When the primary model fails, the runner attempts the fallback model per role. If both fail, behavior depends on the role's `degraded` flag:

| Role | Degraded allowed? | Reason |
|------|------------------|--------|
| `orchestrator` | Yes | JSON plan only — local model acceptable |
| `summarizer` | Yes | Summary only — local model acceptable |
| `owner` | Yes | Scope decisions tolerate lower model quality |
| `dev-backend` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `dev-frontend` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `dev-devops` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `architect` | **No** | Design decisions require strong reasoning — hard fail |
| `qa` | Yes | Haiku fallback acceptable; CERBERUS catches gaps |
| `cerberus` | **No** | Adversarial review must not be degraded — hard fail |

**Hard fail** means the step throws, `gateBlocked: true` is recorded in the artifact, and the iteration stops for that step. `architect` and `cerberus` never degrade silently.

---

## Contract versioning

`CONTRACT_VERSION` in `agents.js` is passed to `register_task` and stored in the task envelope. Bump it when any of the following change:

- Handoff YAML schema (required keys, field names)
- Role permission matrix (`ROLE_PERMISSION`)
- Gate sequence (`advance_mode`, `validate_transition` requirements)
- Fallback policy (`FALLBACK_POLICY`)

Current version: **1.0**

---

## Output token controls

Configured in `examples/orchestrator/agents.js` (`MAX_OUTPUT_TOKENS` + `OUTPUT RULE` in system prompts).

### Hard token caps (`--max-tokens` flag via claude CLI)

Applied only to structured/JSON roles — cutting code agents mid-output breaks their response.

| Role | `max_tokens` | Reason |
|------|-------------|--------|
| `orchestrator` | 400 | JSON plan/decide only |
| `summarizer` | 500 | Structured handoff summary |
| All others | unlimited | Code output must not be truncated |

### Output format enforcement (`OUTPUT RULE` in system prompt)

QA and CERBERUS include an explicit rule:

> "Respond only with the required format. Any text outside this format will cause your output to be rejected."

This is soft enforcement (instruction-level, not validated by code). The goal is to reduce narrative padding in findings lists.

All agents share the global guardrail in `CLAUDE.md`:

> "Respond only with what your role requires. Any text outside the required format will cause your output to be rejected."

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
