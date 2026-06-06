# Local model discovery

Detect **local** model backends and list installed models **without running inference**.

## Module

`orchestrator/local-model-discovery.js` — `discoverLocalModels(options)`.

## Initial backend

**Ollama** — `GET /api/tags` at `OLLAMA_HOST` / `OLLAMA_PORT` (defaults `localhost:11434`).

Respects the same network permission gate as `checkOllama()` unless `ORCH_SKIP_NETWORK_PERMISSION_GATE=1`.

## Result shape

```javascript
{
  backends: [{
    backend_id: "ollama",
    available: true,
    host: "localhost",
    port: 11434,
    reason: null,
  }],
  models: [{
    name: "qwen2.5-coder:7b",
    backend: "ollama",
    family: "qwen2",
    size_bytes: 4683087332,
    context_length: null,
  }],
  missing_local_backend: null,
}
```

When Ollama is unreachable or denied, `models` is empty and `missing_local_backend` describes the failure (no inference attempted).

## Testing

- Unit tests: `orchestrator/tests/localModelDiscovery.test.js` with fixture `tests/fixtures/ollama-tags-sample.json` and mocked `fetchTags`.
- Optional live probe: set `ORCH_INTEGRATION_OLLAMA=1` on a self-hosted runner with Ollama (skipped by default on GHA hosted).

## Related

- Hardware sizing (guidance only): [local-inference-sizing.md](local-inference-sizing.md)

## Out of scope (follow-on)

- Auto-selection → [local-model-selection.md](local-model-selection.md)
- vLLM / llama.cpp backends
- Inference or benchmarking
