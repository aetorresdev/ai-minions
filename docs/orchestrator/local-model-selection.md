# Local model selection policy

Select a local model with explicit precedence and deterministic non-TTY behavior.

## Precedence

1. CLI `--model`
2. `ORCH_LOCAL_MODEL`
3. `OLLAMA_MODEL` (legacy env)
4. `.ai-minions/model-policy.yaml` → `default_model`
5. Auto-detect via `discoverLocalModels()` + deterministic ranking
6. Interactive TTY prompt (when stdin/stdout are TTY and not CI)

## Model policy file

Path: `.ai-minions/model-policy.yaml`

```yaml
model_policy_version: 1
default_model: qwen2.5-coder:14b
prefer_families:
  - qwen2
max_size_bytes: 12000000000
```

## Non-interactive / CI

Set `ORCH_NON_INTERACTIVE=1` or rely on `CI=true` — selection never blocks on stdin. With multiple discovered models, the highest-ranked candidate is chosen deterministically.

## Trace fields (`session_start` when local-only)

- `discovered_models` — model names from discovery (auto/TYY paths)
- `selected_model`
- `override_source` — `cli`, `env_orchestr_local_model`, `env_ollama_model`, `model_policy_yaml`, `auto_detect`, `tty_prompt`
- `selection_reason` — human-readable rationale

## Module

`orchestrator/local-model-selection.js` — `selectLocalModel(options)`

Integrated via `validateLocalOnlyRunPrerequisites()` in `local-model-policy.js` (cached for the run).

## Tests

`orchestrator/tests/localModelSelection.test.js` — precedence matrix, ranking, non-interactive safety, TTY mock.
