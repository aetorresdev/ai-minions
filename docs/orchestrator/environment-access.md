# Environment Access — Agent Credential Contract

Defines how orchestrated agents declare and consume external service credentials, and what operations are permitted per access mode.

---

## Problem

Agents working without runtime access operate blind — they edit files but cannot verify behavior in live systems. Without access to n8n execution logs, a MongoDB connection, or a Terraform plan output, agents cannot detect runtime failures and repeat the same class of error across iterations.

---

## Design principle

- Credentials are **never values** in committed files or the session header — only references to env vars already set in the user's shell.
- **Model prompt/context** receives credential **names**, **types**, **alias→env_var** refs, and **availability** only. Resolved secret values stay **outside** model context (runtime may read `process.env` for future broker/tool paths — not via `buildEnvContext()` text). See § *Prompt/context contract* below.
- The user controls access mode — `read` or `write` — regardless of environment (dev, staging, prod).
- The agent consumes credentials by **name**, not by mechanism. It does not need to know whether auth is an API key, service account, or connection string.
- Multiple credentials of the same type are allowed (e.g. two n8n instances, two MongoDB collections).

---

## Session header — `ENVIRONMENT` block (optional)

```
MODE: ORCHESTRATOR
FLOW: single_agent | multi_agent
GOAL: ...
MAX_ITERATIONS: 3
ENVIRONMENT:
  mode: read | write
  credentials:
    - name: <identifier>
      type: <credential_type>
      vars:
        <key>: <ENV_VAR_NAME>
```

### `mode` values

| Value | Permitted operations |
|-------|---------------------|
| `read` | Query, list, describe, read logs, plan/diff, dry-run |
| `write` | All read operations + execute, apply, insert, update, activate |

The user is responsible for declaring the correct mode. **Prompt-level refusal contract:** the injected ENVIRONMENT block instructs the model to refuse write-class operations when `mode: read`. **Runtime enforcement:** tools must call `requestCredentialUse()` in [`credential-broker.js`](../../orchestrator/credential-broker.js) before using resolved secrets — see [`credential-broker-contract.md`](credential-broker-contract.md). A prompt line alone is not a gate.

---

## Credential types

| `type` | Auth mechanism | Example vars |
|--------|---------------|--------------|
| `api_key` | Single token/key in header or query param | `url`, `key` |
| `connection_string` | URI with embedded credentials | `uri` |
| `service_account` | JSON credentials file path | `credentials_file`, `project` |
| `basic_auth` | Username + password | `url`, `user`, `password` |
| `bearer_token` | OAuth / JWT bearer token | `url`, `token` |
| `kubeconfig` | Kubeconfig file path | `config_file`, `context` |
| `ssh_key` | SSH private key path | `host`, `user`, `key_file` |
| `custom` | Any other mechanism | user-defined keys |

---

## Examples

### n8n behind Cloudflare

```
ENVIRONMENT:
  mode: write
  credentials:
    - name: n8n
      type: api_key
      vars:
        url: N8N_URL
        key: N8N_API_KEY
    - name: cloudflare
      type: api_key
      vars:
        token: CF_API_TOKEN
        zone: CF_ZONE_ID
```

### GCP + MongoDB + n8n (multi-service)

```
ENVIRONMENT:
  mode: write
  credentials:
    - name: gcp
      type: service_account
      vars:
        credentials_file: GOOGLE_APPLICATION_CREDENTIALS
        project: GCP_PROJECT_ID
    - name: mongo
      type: connection_string
      vars:
        uri: MONGO_URI
    - name: n8n
      type: api_key
      vars:
        url: N8N_URL
        key: N8N_API_KEY
```

### Terraform + AWS (read-only audit)

```
ENVIRONMENT:
  mode: read
  credentials:
    - name: aws
      type: custom
      vars:
        profile: AWS_PROFILE
        region: AWS_DEFAULT_REGION
```

### Jenkins + Grafana

```
ENVIRONMENT:
  mode: read
  credentials:
    - name: jenkins
      type: basic_auth
      vars:
        url: JENKINS_URL
        user: JENKINS_USER
        password: JENKINS_TOKEN
    - name: grafana
      type: api_key
      vars:
        url: GRAFANA_URL
        key: GRAFANA_API_KEY
```

---

## Role permission matrix

Each role has a fixed permission level. The session `mode` is the **ceiling** — roles cannot exceed it. A role's own limit may be lower than the ceiling.

| Role | Own limit | Effective when `mode: write` | Effective when `mode: read` |
|------|-----------|-----------------------------|-----------------------------|
| ORCHESTRATOR | none | no credentials used | no credentials used |
| OWNER | none | no credentials used | no credentials used |
| ARCHITECT | read | read | read |
| DEV — backend | write | write | read |
| DEV — frontend | read | read | read |
| DEV — devops | write | write | read |
| QA | read | read | read |
| CERBERUS | read (hardcoded) | read | read |

**Rules:**
- ORCHESTRATOR and OWNER never consume credentials — they operate on goals, specs, and handoffs only.
- ARCHITECT reads to understand the current state (describe, list, plan) — never applies changes.
- DEV backend and devops may write when the session `mode: write` allows it.
- DEV frontend reads APIs and state — never applies infrastructure or data changes.
- QA always reads — it verifies evidence from DEV's writes, does not re-execute writes itself.
- CERBERUS is hardcoded to read regardless of session mode or any other declaration.

---

## Agent behavior rules

### All agents (when ENVIRONMENT is declared)

1. Read the `mode` at session start. Apply the role permission matrix — use the lower of session mode and own role limit.
2. Reference credentials by `name` only — resolve env vars at call time, never log or echo them.
3. If a required env var is not set: surface as a blocker, do not proceed with the operation.

### DEV backend / devops (effective write)

- May execute workflows, apply changes, insert/update data, activate services.
- Must document every write operation in the handoff under `validation_run`.
- Must verify the operation result (execution log, apply output, HTTP status) before declaring success.

### DEV frontend / ARCHITECT (effective read)

- May query, describe, read logs, run dry-runs and plans.
- Must not execute, apply, insert, or activate.

### QA (always read)

- Uses credentials to obtain real evidence: execution logs, query results, plan outputs.
- Verifies behavior by reading logs from prior DEV executions — does not re-execute writes.
- Real runtime evidence is required before passing to CERBERUS when credentials are available.

### CERBERUS (hardcoded read)

- Regardless of declared session `mode`, CERBERUS operates read-only — this cannot be overridden.
- May inspect logs, query state, describe resources.
- Must not execute, apply, or modify anything.

---

## Hard limits (non-negotiable)

1. **Credentials are env var references only.** No literal values in the session header, CLAUDE.md, or any committed file.
2. **CERBERUS is always read-only**, regardless of session `mode`.
3. **Mode cannot change mid-session.** If a different mode is needed, start a new session.
4. **`mode: read` write refusal:** prompt-level contract in `buildEnvContext()` (instruction + blockers text). Not runtime enforcement until broker/tool paths land (post-alpha).

---

## Implementation status

**Current status: implemented** (`orchestrator/agents.js` **facade** + `orchestrator/agents/permissions.js` + split modules under `orchestrator/agents/` + `orchestrator/orchestrator.js`)

The **canonical import** for consumers remains `require("./agents")` / `require("../agents")` → `agents.js`. Implementation is split (`permissions.js`, `validate-output.js`, `registry.js`, `runtime/*`, …); only **export names** on that facade are stable contract for other packages and tests.

| Component | Status | Location |
|---|---|---|
| `parseEnvironment()` | ✅ | `orchestrator.js` — parses ENVIRONMENT block from session header via regex |
| `resolveCredentials()` | ✅ | **`agents.js` facade** — reads env vars at call time, warns on missing (logic lives in facade file) |
| `effectiveMode()` | ✅ | **`agents/permissions.js`** — role matrix vs session ceiling; **re-exported** from `agents.js` |
| `buildEnvContext()` | ✅ | **`agents.js` facade** — prompt-safe ENVIRONMENT block (names + env var refs only; **no** resolved values) |
| `askAgent()` injection | ✅ | **`agents.js` facade** — calls `buildEnvContext` then `runClaude` / `runOllama` from `agents/runtime/*` |
| CERBERUS hardcoded read | ✅ | `effectiveMode()` in `agents/permissions.js` — returns `"read"` for cerberus regardless of session mode |
| Missing env var blocker | ✅ | `resolveCredentials()` — missing vars surfaced in agent context as blockers |

### Prompt/context contract (no credential values in model context)

`buildEnvContext()` may include:

- `mode` metadata (`read` / `write` as exposed to the role)
- credential `name` and `type`
- alias → env var name references (e.g. `key→N8N_API_KEY`)
- availability: `available` | `partial` | `unavailable`
- missing env var **names** only in `BLOCKERS`

It must **not** include resolved tokens, API keys, passwords, bearer tokens, connection strings, or other secret material. Regression tests: `orchestrator/tests/envCredentialPromptLeak.test.js`, `envRunScope.test.js`.

Live credential use for tools is **planned** via broker/wrapper — see [credential-broker-contract.md](credential-broker-contract.md) — not prompt injection.

**Pending:**
- Runtime deny-before-execute for write-class ops under `mode: read` (broker/tool — not prompt text)
- Multi-agent sessions with live credentials under broker contract
- Brokered credential execution (post-alpha)
