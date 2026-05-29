# Local model selection policy

Select a local model with explicit precedence and deterministic non-TTY behavior.

## Precedence

1. CLI `--model`
2. `ORCH_LOCAL_MODEL`
3. `OLLAMA_MODEL` (legacy env)
4. `.ai-minions/model-policy.yaml` → `default_model`
5. Auto-detect: `discoverLocalModels()` + deterministic ranking — if exactly one candidate remains, or the session is non-interactive, the top-ranked model is selected (`override_source: auto_detect`)
6. Optional TTY prompt when multiple ranked candidates remain **and** the session is interactive (stdin/stdout TTY, not CI) — operator picks from the ranked list (`override_source: tty_prompt`)

Steps 5 and 6 are not competing precedence tiers: discovery/ranking always runs before an optional prompt. Non-interactive mode never waits for stdin.

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

- `discovered_models` — model names from discovery (auto/TTY paths)
- `selected_model`
- `override_source` — `cli`, `env_orchestr_local_model`, `env_ollama_model`, `model_policy_yaml`, `auto_detect`, `tty_prompt`
- `selection_reason` — human-readable rationale

## Module

`orchestrator/local-model-selection.js` — `selectLocalModel(options)`

Integrated via `validateLocalOnlyRunPrerequisites()` in `local-model-policy.js` (cached for the run).

## Tests

`orchestrator/tests/localModelSelection.test.js` — precedence matrix, ranking, non-interactive safety, TTY mock.
