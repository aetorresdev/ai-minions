# Local-only model policy (MVP)

Enforces **local-only** model execution for orchestrator CLI runs: remote providers (Claude CLI) are blocked when the policy is active. This is **not** a hardcoded model name — operators must supply an explicit local model.

## Enable local-only

Either:

- `ORCH_MODEL_MODE=local_only`
- `ORCH_ALLOW_REMOTE_MODELS=0` (also accepts `false`, `no`)

## Explicit model override (MVP)

Precedence:

1. CLI `--model <name>` (via `run-orchestrator.js`)
2. `ORCH_LOCAL_MODEL`
3. `OLLAMA_MODEL`

If local-only is enabled and none of the above is set, the run fails before agents execute.

If a model is configured but Ollama is unreachable, the run fails — **no silent fallback to Claude**.

In local-only mode, `summarizeHandoff` uses the same resolved override chain (`--model` > `ORCH_LOCAL_MODEL` > `OLLAMA_MODEL`); `AI_TEAM_SUMMARY_MODEL` does not override it.

## Capability matrix alignment (local-only routing)

When `ORCH_MODEL_MODE=local_only`, `askAgent()` routes **all** roles through Ollama HTTP (`runOllama`). Review roles **qa** and **cerberus** must declare **`local_model`** and **`network`** in `capability-matrix.v1.json` or the network permission gate returns `role_capability_domain_denied` before inference runs.

Ollama egress remains constrained by the active permission profile (`network.allow_hosts`, typically localhost:11434). Adding matrix domains does not grant arbitrary HTTP egress.

**Owner** and **architect** are not aligned in this slice — multi-agent plans that include those steps under local-only may still fail until a follow-on expands their matrix rows.

## Trace events

| Event | When |
|---|---|
| `session_start.local_only_mode` | `true` when policy active |
| `session_start.selected_model` | Resolved model name |
| `session_start.override_source` | `cli`, `env_orchestr_local_model`, or `env_ollama_model` |
| `model_policy_block` | Remote provider blocked (`gate_id: model_policy_block`) |

## Operator examples

```bash
export ORCH_MODEL_MODE=local_only
export ORCH_LOCAL_MODEL=qwen2.5-coder:14b
node run-orchestrator.js --skip-gates --iterations 1 "Smoke task"

# Or single flag:
node run-orchestrator.js --model qwen2.5-coder:14b --skip-gates "Smoke task"
```

## Out of scope (follow-on tickets)

- Model discovery / listing
- Full precedence chain (`.ai-minions/model-policy.yaml`, auto-select, TTY prompt)
- Replacing remote support globally outside local-only mode

## Tests

CI uses mocks/fixtures only — no real Ollama on hosted runners. See `orchestrator/tests/localModelPolicy.test.js`.
