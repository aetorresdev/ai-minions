# Install — Ollama paths (Mac host and Docker)

How to reach Ollama from the ai-minions install script during model discovery.

**Install command:**

```bash
node scripts/install-ai-minions.mjs --install --model-policy local_only --json
```

Discovery uses `discoverLocalModels()` → Ollama `GET /api/tags` (no inference).

## Mac host (native clone)

Default endpoint:

- `OLLAMA_HOST=localhost` (default)
- `OLLAMA_PORT=11434` (default)

Ensure Ollama is running on the Mac before install:

```bash
ollama serve   # if not already running as a service
ollama list    # optional sanity check
```

## Docker on Mac (Docker Desktop)

The install container cannot use `localhost` for the host Ollama daemon. Use:

```bash
export OLLAMA_HOST=host.docker.internal
export OLLAMA_PORT=11434
node scripts/install-ai-minions.mjs --install --model-policy local_only --json
```

Ollama must be running on the **Mac host**, not only inside another container, unless you publish port `11434` explicitly.

## Docker on Linux

When the install runs inside a container and Ollama runs on the same host:

```bash
docker run --network=host ...
export OLLAMA_HOST=127.0.0.1
export OLLAMA_PORT=11434
```

`--network=host` is valid on Linux; Docker Desktop Mac does not provide equivalent host networking — use `host.docker.internal` there.

## `remote_ok` policy note

`--model-policy remote_ok` warns (does not block) when local Ollama is unreachable or has zero models. It does **not** configure remote providers or collect API tokens.

## Out of scope (v0.14)

- LM Studio, LocalAI, llama.cpp, vLLM functional discovery
- Auto-pulling models into Ollama
- Remote provider setup

## Evidence chain

Record install attestation with:

```bash
node scripts/run-install-evidence.mjs --json
```

**Docker live (automated):** same-repo PRs run this inside Docker on the self-hosted runner — see [install-evidence.md](install-evidence.md) and `.github/workflows/installed-cli-docker-live.yml`.

See [install-evidence.md](install-evidence.md) for CI-safe `--skip-live` / `--installed-cli-ci` modes and the `orchestrator/` cwd pitfall for claim audit.
