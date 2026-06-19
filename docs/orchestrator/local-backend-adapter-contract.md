# Local backend adapter contract

Contract for install-time local model backend discovery and normalized install reports.
Ollama is the **only** fully supported backend in v0.14; other backends are registry extension points only.

**Implementation:** `orchestrator/local-backend-adapter.js` · `orchestrator/local-model-discovery.js`  
**Consumer:** `scripts/install-ai-minions.mjs` (model discovery phase)

## Support status enum

| Value | Meaning |
|-------|---------|
| `supported` | Discovery implemented and validated (Ollama only in v0.14) |
| `experimental` | Registry/schema entry only; no functional discovery |
| `unsupported` | Reserved slot; not available in this release |

## Backend registry (v0.14)

| `backend_id` | `support_status` | `discovery_method` |
|--------------|------------------|-------------------|
| `ollama` | `supported` | `http_tags` |
| `openai_compatible_local` | `experimental` | — |
| `llama_cpp_server` | `unsupported` | — |
| `vllm` | `unsupported` | — |

## Inputs

| Input | Source |
|-------|--------|
| `host`, `port` | `OLLAMA_HOST`, `OLLAMA_PORT`, or defaults (`localhost`, `11434`) |
| `cwd` | install repo root |
| `model_policy` | `--model-policy local_only \| remote_ok` |

## Outputs (install report `discovery` block)

```json
{
  "backends": [
    {
      "backend_id": "ollama",
      "support_status": "supported",
      "available": true,
      "host": "localhost",
      "port": 11434,
      "reason": null,
      "discovery_method": "http_tags"
    }
  ],
  "models": [
    {
      "name": "qwen2.5-coder:7b",
      "backend_id": "ollama",
      "family": "qwen2",
      "size_bytes": 4683087332,
      "context_length": null
    }
  ],
  "missing_local_backend": null
}
```

## Failure reason codes (install discovery phase)

| Code | When |
|------|------|
| `INSTALL_OLLAMA_UNREACHABLE` | Ollama endpoint unreachable or invalid payload |
| `INSTALL_LOCAL_MODELS_EMPTY` | Ollama reachable but zero models |
| `INSTALL_MODEL_DISCOVERY_DENIED` | Network egress gate denied discovery |

Policy behavior:

- `local_only`: unreachable or empty models → **fail**
- `remote_ok`: unreachable or empty models → **warn** (install may still pass)

## Unsupported behavior

- Functional discovery for `openai_compatible_local`, `llama_cpp_server`, or `vllm`
- Claiming multi-backend parity in v0.14 docs or install output
- Writing `.ai-minions` config (later installer phase)

## Docker / Mac Ollama reachability

See [`docs/how-to/install-ollama-docker-paths.md`](../how-to/install-ollama-docker-paths.md).

## Tests

- `orchestrator/tests/localBackendAdapter.test.js` — registry and normalization
- `tests/install-ai-minions.test.mjs` — discovery phase and reason codes
