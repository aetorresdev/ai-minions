# Install evidence and claim audit

**v0.20 release criterion:** prove the **installed product CLI** (`ai-minions` on PATH) works from outside the clone root on Mac/Docker with Ollama reachability documented in [install-ollama-docker-paths.md](install-ollama-docker-paths.md), plus a **deterministic claim audit** (no global installer or production-ready overclaims).

**Related:** [Install Ollama paths](install-ollama-docker-paths.md) · [Fresh-clone evidence](fresh-clone-evidence.md) · [Human-ready rehearsal](human-ready-rehearsal-evidence.md) · [Model config ownership](../orchestrator/model-config-ownership.md)

---

## What counts as evidence (v0.20)

| Class | What it proves | How to run |
|-------|----------------|------------|
| **CI claim audit** *(default in PRs)* | Operator docs have no inflated install claims | `node scripts/run-install-evidence.mjs --skip-live` |
| **Installed CLI CI** *(v0.20 PR gate)* | Product install + `ai-minions --help` from outside repo (doctor skipped) | `node scripts/run-install-evidence.mjs --installed-cli-ci --json` |
| **Mac/Docker live (CI)** | Installed CLI shim + doctor inside Docker on self-hosted runner | `.github/workflows/installed-cli-docker-live.yml` |
| **Mac/Docker live (host)** | Same command on Mac host (optional attestation) | `node scripts/run-install-evidence.mjs --json` on Mac with Ollama |
| **Live + unit** | Above + orchestrator unit gate | `node scripts/run-install-evidence.mjs --with-npm-test --json` |

**Rule:** Hosted `ubuntu-latest` does **not** run live Ollama. **Docker live** attestation runs on the **self-hosted** runner (`self-hosted` + `ollama` labels) via GHA — counts as Docker attestation for v0.20. Mac host attestation remains optional unless the runner executes the non-container path.

**Merge gate (E20-4):** PRs must pass **installed CLI CI** (`--installed-cli-ci` on `docs-usage-verify`) **and** **Docker live** (`installed-cli-docker-live` on self-hosted). Fork PRs skip the self-hosted job (same-repo only).

**Legacy:** v0.14 used `operator-preflight.mjs` as the live install chain. v0.20 live path uses **installed `ai-minions`** (`product_cli_install` + `installed_help` + `installed_doctor`).

---

## Quick commands

**From repo root** (canonical paths under `scripts/`):

```bash
cd ai-minions
node scripts/run-install-evidence.mjs --skip-live
node scripts/run-install-evidence.mjs --installed-cli-ci --json
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

**Skip doctor** (shim + help only — same as CI installed gate):

```bash
node scripts/run-install-evidence.mjs --skip-installed-doctor --json
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

## Step breakdown (live path — v0.20)

| Step | What runs | Stable codes |
|------|-----------|--------------|
| Product CLI install | `install-ai-minions.mjs` (CLI shim to `~/.local/bin` or blocked remediation) | `INSTALL_*`, `INSTALLED_CLI_*` |
| Installed help | `ai-minions --help` from `$TMP` / outside clone | `INSTALLED_CLI_HELP_FAIL` |
| Installed doctor | `ai-minions doctor --model-policy local_only` via shim | `INSTALLED_CLI_DOCTOR_FAIL` |
| Claim audit | `audit-product-claims.mjs` | `CLAIM_*` |
| Unit gate *(optional)* | `cd orchestrator && npm test` | test harness |

---

## Reason codes (`run-install-evidence.mjs`)

| Code | Meaning |
|------|---------|
| `INSTALL_EVIDENCE_OK` | Step passed |
| `INSTALL_EVIDENCE_INSTALL_FAIL` | Product install chain blocked |
| `INSTALL_EVIDENCE_INSTALLED_CLI_FAIL` | Summary umbrella on installed CLI substeps (`evidence_reason_code` when `status: fail`) |
| `INSTALLED_CLI_PRODUCT_FAIL` | Product shim install blocked |
| `INSTALLED_CLI_HELP_FAIL` | `ai-minions --help` failed from outside repo |
| `INSTALLED_CLI_DOCTOR_FAIL` | `ai-minions doctor` blocked (live Mac/Docker needs Ollama) |
| `INSTALLED_CLI_SKIPPED` | Substep skipped (e.g. doctor in `--installed-cli-ci`) |
| `INSTALL_EVIDENCE_OPERATOR_FAIL` | Legacy operator-preflight blocked *(v0.14 only; skipped in v0.20 live)* |
| `INSTALL_EVIDENCE_CLAIM_AUDIT_FAIL` | Claim audit blocked |
| `INSTALL_EVIDENCE_NPM_TEST_FAIL` | `npm test` failed when `--with-npm-test` |

Claim audit uses `CLAIM_*` codes (e.g. `CLAIM_FORBIDDEN_PHRASE`, `CLAIM_OK`) from `audit-product-claims.mjs`.

Exit codes: **0** = all required steps pass · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

Evidence classes: `ci_claim_audit` · `installed_cli_ci` · `mac_docker_live_installed_cli` · `mac_docker_live_installed_cli_plus_unit`.

---

## CI wiring

| Workflow | When | Command |
|----------|------|---------|
| **Docs usage verify** | PR touching install/docs | `node scripts/run-install-evidence.mjs --skip-live` |
| **Docs usage verify** | PR touching install/docs | `node scripts/run-install-evidence.mjs --installed-cli-ci --json` |
| **Installed CLI Docker live** | Same-repo PR + self-hosted runner | `node scripts/run-install-evidence.mjs --json` inside Docker (`installed-cli-docker-live.yml`) |

**Docker live JSON contract** (asserted in CI):

| Field / step | Expected |
|--------------|----------|
| `evidence_class` | `mac_docker_live_installed_cli` |
| `installed_cli_product_cli_install` | `pass` |
| `installed_cli_installed_help` | `pass` |
| `installed_cli_installed_doctor` | `pass` |
| `operator_preflight` | `skip` |

Validator: `node scripts/assert-docker-live-install-evidence.mjs --file report.json`

**Container setup (workflow):** `node:22-bookworm` with `--network=host` installs `ruff`, `uv`, runs `npm ci`, `uv sync` for MCP servers, `install-ai-minions.mjs --install`, then `run-install-evidence.mjs --json`.

**Security:** Docker live runs only when `github.repository == 'aetorresdev/ai-minions'` and the PR head is same-repo (not a fork).

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
