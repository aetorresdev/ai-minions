# Install evidence and claim audit

**v0.14 release criterion:** prove the **Mac/Docker install path** works with Ollama reachability documented in [install-ollama-docker-paths.md](install-ollama-docker-paths.md), and pass a **deterministic claim audit** (no global installer or production-ready overclaims).

**Related:** [Install Ollama paths](install-ollama-docker-paths.md) · [Fresh-clone evidence](fresh-clone-evidence.md) · [Model config ownership](../orchestrator/model-config-ownership.md)

---

## What counts as evidence (v0.14)

| Class | What it proves | How to run |
|-------|----------------|------------|
| **CI claim audit** *(default in PRs)* | Operator docs have no inflated install claims | `node scripts/run-install-evidence.mjs --skip-live` |
| **Mac/Docker live** | Install writes `.ai-minions` config + operator chain passes | `node scripts/run-install-evidence.mjs --json` on Mac host or Docker with `OLLAMA_HOST` set |
| **Live + unit** | Above + orchestrator unit gate | `node scripts/run-install-evidence.mjs --with-npm-test --json` |

**Rule:** CI does **not** require live Ollama. Mac/Docker attestation is **manual** (record SHA + JSON in release notes or checklist).

---

## Quick commands

**From repo root** (canonical paths under `scripts/`):

```bash
cd ai-minions
node scripts/run-install-evidence.mjs --skip-live
```

**Live Mac host** (Ollama on `localhost:11434`):

```bash
node scripts/run-install-evidence.mjs --json
```

**Docker Desktop Mac** (Ollama on host):

```bash
export OLLAMA_HOST=host.docker.internal
export OLLAMA_PORT=11434
node scripts/run-install-evidence.mjs --json
```

**Include unit tests** (after live install chain):

```bash
node scripts/run-install-evidence.mjs --with-npm-test --json
```

**Claim audit only:**

```bash
node scripts/audit-product-claims.mjs
```

---

## Step breakdown (live path)

| Step | Script | Stable codes |
|------|--------|--------------|
| Install | `install-ai-minions.mjs --install` | `INSTALL_*` |
| Operator chain | `operator-preflight.mjs --install` | `PREFLIGHT_*`, `RUNTIME_PREFLIGHT_*`, `OPERATOR_*` |
| Claim audit | `audit-product-claims.mjs` | `CLAIM_*` |
| Unit gate *(optional)* | `cd orchestrator && npm test` | test harness |

---

## Reason codes (`run-install-evidence.mjs`)

| Code | Meaning |
|------|---------|
| `INSTALL_EVIDENCE_OK` | Step passed |
| `INSTALL_EVIDENCE_INSTALL_FAIL` | Install chain blocked |
| `INSTALL_EVIDENCE_OPERATOR_FAIL` | Operator preflight blocked |
| `INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL` | Claim audit blocked |
| `INSTALL_EVIDENCE_NPM_TEST_FAIL` | `npm test` failed when `--with-npm-test` |

Claim audit uses `CLAIM_*` codes (e.g. `CLAIM_FORBIDDEN_PHRASE`, `CLAIM_OK`) from `audit-product-claims.mjs`.

Exit codes: **0** = all required steps pass · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

---

## CI wiring

| Workflow | When | Command |
|----------|------|---------|
| **Docs usage verify** | PR touching install/docs | `node scripts/run-install-evidence.mjs --skip-live` |

---

## Running from `orchestrator/`

After `cd orchestrator && npm test`, bare `node scripts/…` resolves under **`orchestrator/scripts/`**. Either:

| Context | Command |
|---------|---------|
| Repo root | `node scripts/run-install-evidence.mjs --json` |
| `orchestrator/` (shim) | `node scripts/run-install-evidence.mjs --json` |
| `orchestrator/` (npm) | `npm run evidence:install -- --json` |
| Claim audit from `orchestrator/` | `npm run evidence:claims` or shim `node scripts/audit-product-claims.mjs` |

Shims delegate to repo-root `scripts/` with `cwd` at the clone root. Do **not** expect a second copy of repo-root scripts under `orchestrator/scripts/` except these delegates.
