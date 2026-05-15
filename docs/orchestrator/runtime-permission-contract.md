# Runtime permission contract (design)

**Status:** design — informs implementation of preflight checks, runtime guards, and trace payloads
before transport-level network policy and governed retrieval work is treated as complete.

**Related:**

- [agent-contract.md](agent-contract.md) — state store, envelope
- [strict-mode.md](strict-mode.md) — trace envelope

Role/session ceiling today: `orchestrator/agents/permissions.js` (`effectiveMode`).

This document **generalizes** that idea into explicit domains and policy results without requiring a
particular storage backend.

---

## 1. Purpose

- Reject or downgrade work **before** token-heavy execution when policy already knows the outcome (“preflight deny”).
- Represent **every** sensitive class of action in one policy model:
  models, shell, filesystem, network, MCP, git, context retrieval.
- Emit **structured** trace evidence (`reason_code`, domain, resource id) so dashboards and audits align with enforcement.

## 2. Non-goals (v0)

- No multi-tenant IAM UI, cloud policy import, or organization-wide RBAC.
- No guarantee that historical traces without these fields are enforceable retroactively.
- **Not** replacing output contracts (`validateOutput`) — permission denial is orthogonal
  (fail closed before or during execution).

### Tool action classification vs enforcement

`orchestrator/security/action-classifiers/classify-action.js` and `tool-action-manifest.v1.json` produce **classification only** (`action_class`, optional `target_class`, `reason_code`). They **do not** authorize execution or network/filesystem access.

Binding classification to **allow / deny / requires_approval** is the job of the **permission evaluator** (runtime guards and structured traces). Unknown tool (`reason_code: unknown_tool`) or unknown action (`unknown_action_class`) must remain **fail-safe** at evaluation time — never treated as implicit allow.

---

## 3. Permission domains

Every guarded action maps to exactly one **domain** for policy and tracing:

| Domain | Typical resources | Notes |
|--------|-------------------|--------|
| `remote_model` | vendor/model id, route | Remote API calls (e.g. Anthropic). |
| `local_model` | local endpoint/model id | Ollama / local inference. |
| `shell` | command pattern / argv class | Spawned subprocesses. |
| `filesystem` | path, operation | Normalized path — see §5. |
| `network` | host:port / URL class | TCP/TLS egress.<br>(HTTP APIs not routed as “model”.) |
| `mcp` | server id, tool name | MCP tools and transports. |
| `git` | read/write/refs | Mutating git operations vs read-only. |
| `context_retrieval` | corpus, query scope | RAG / indexed retrieval — not arbitrary file read (that is `filesystem`). |

**Out of scope for v0:** distinguishing “user laptop” vs CI beyond path/host labels —
implementations may add tags later without breaking domain enums.

---

## 4. Policy envelope (per run / task)

Logical shape (transport-agnostic; may live in `envelope.json`, CLI flags, or runner config):

```yaml
permission_policy_version: "0.1"
domains_allowed:
  remote_model: allow | deny | approval_required
  local_model: allow | deny | approval_required
  shell: deny | approval_required   # typical default: deny or approval
  filesystem:
    default: deny | read_only | read_write
    paths:
      - pattern: "<glob or prefix>"
        access: read | write | deny
  network:
    default: deny | approval_required
    allow_hosts:
      - "api.anthropic.com"
      - "localhost:11434"
  mcp:
    default: deny | approval_required
    allow_tools:
      - server: "<mcp_server_id>"
        tools: ["<tool_name>", "*"]
  git:
    default: read_only | deny | read_write
  context_retrieval:
    default: deny | approval_required | allow
    constraints:
      forbid_full_file: true   # recommended default for alpha
      max_chunks_per_query: <n>
```

Implementations **may** subset fields.

Denial must still produce §7 payloads.

---

## 5. Filesystem path shape

- Operations: **`read`**, **`write`**, **`deny`** (explicit deny wins over inherited allow).
- Paths normalized: workspace-root-relative or explicit allow-list roots.
  **`..`** and symlink escape rejected at policy boundary.
- **Read-only** tree + single writable subtree is a common alpha profile.

---

## 6. Context retrieval request shape

Retrieval is **not** a generic filesystem read. Requests must declare intent and bounds:

```yaml
context_retrieval_request:
  intent_id: "<correlates to step or intent>"
  scopes:
    - type: corpus | path_prefix | ticket_uri
      value: "<opaque scope id>"
  chunk_budget: <positive int>
  allow_full_document: false   # must be false when envelope sets forbid_full_file
  query_text_hash: "<optional sha256 of query for audit>"
```

**Examples the runtime must cover** (every `reason_code` below is exactly one row from §9 — no alias strings):

| Scenario | Expected policy outcome |
|----------|-------------------------|
| Read-only path | `filesystem` **read** OK for prefix;<br>**write** denied → `PERM_PATH_WRITE_FORBIDDEN`. |
| Denied path | Preflight or runtime deny.<br>Typical: read not covered → `PERM_PATH_READ_DENIED`; generic path denial → `PERM_PATH_ACCESS_DENIED` (§9). |
| Chunk retrieval | `allow_full_document: false`, scopes bounded → **allow** if domain allowed. |
| Full-file disguised as retrieval | Deny → `PERM_RETRIEVAL_FULL_FILE_FORBIDDEN` at preflight if constraints violated. |
| Retrieval denied before execution | Preflight emits **permission_result** `denied` without starting LLM step. |

---

## 7. Decision timing

| Phase | When | Must be able to |
|-------|------|-------------------|
| **Preflight** | Before expensive work (LLM, MCP, shell) | Deny or require approval;<br>record once per check key. |
| **Approval** | Human or stored grant | Yield `approval_granted` trace + bounded TTL grant token if implemented. |
| **Runtime** | During step | Deny residual attempts (e.g. tool tries forbidden host); fail closed. |

“Reject a run before token-heavy execution” means at least one **preflight** gate on domain and
resource for the upcoming step.

---

## 8. Trace alignment (proposed)

Reuse **`trace_schema_version`: `"2"`**.

Add or extend lines (exact schema work is implementation; fields here are contractual):

### 8.1 `permission_check` (preflight)

- `event`: `permission_check`
- `domain`, `operation`, `resource` (path/host/tool id as applicable)
- `policy_decision`: `allow` | `deny` | `approval_required`
- `reason_code`: closed enum (§9)

### 8.2 `permission_result` (after approval or runtime verdict)

- `event`: `permission_result`
- `outcome`: `allowed` | `denied` | `deferred`
- `reason_code`, `domain`, optional `approval_id`

### 8.3 Denial without new event type

Existing **`iteration_done`** / stop paths may carry `transition_reason.reason_code` from §9 when the
loop exits due to permission policy.

### 8.4 Orchestrator MCP path + schema

The reference runner (`orchestrator/orchestrator.js`) evaluates **MCP** invocations before execution and,
when the per-run MCP audit task id is active, emits a **`permission_check`** trace line **before** the
corresponding **`mcp_call`**. Payload shape is built by `orchestrator/security/trace-security-decision.js`
(subset of evaluator input/output: `decision`, `reason_code`, `permission_profile`, `domain`, `action_class`,
`target_class`, `requires_approval`, etc.). Evaluator codes for MCP trust use the groomed vocabulary
(e.g. `mcp_trust_allow`, `mcp_ci_configured_allow`, `mcp_trust_warn_deny`) — not necessarily the **`PERM_*`**
prefixes listed in §9; long-term alignment with **`PERM_*`** remains future consolidation.

**Schema validation:** `permission_check` lines are validated at write time against
`orchestrator/schemas/trace-v2-line.schema.json`. Audit guide and examples: [permission-check-trace.md](permission-check-trace.md).

**Orchestrator Claude CLI (shell slice):** spawning the **`claude`** binary for agent calls is gated as **`event: permission_check`** with `tool: claude_cli`, domain **`shell`**, and precheck **`orchestrator_shell_spawn: claude_cli`**; evaluator outcome is driven by **`remote_model`** policy so `shell: approval_required` does not block the default agent path. See `orchestrator/security/claude-cli-shell-gate.js` and orchestrator README.

**Classified external CLI (filesystem / git slice):** orchestrator-owned **`spawnSync`** of user-facing CLIs (not MCP, not the Claude LLM transport) should use **`agents/runtime/run-classified-shell.js`** (`spawnClassifiedSync`): **`classify-action`** (manifest + adapters) supplies **`action_class`** / **`target_class`**; **`git`** maps to domain **`git`**, other manifest tools to **`filesystem`**, then **`evaluatePermission`**. Denied / **`requires_approval`** aborts before spawn. **Only call sites that adopt `spawnClassifiedSync` are governed** — this does not retroactively gate specialized transports (MCP, Claude LLM spawn, Ollama HTTP, or other raw spawns). When MCP audit tracing is active, **`permission_check`** is written **before** the allow/deny outcome (including deny), consistent with **`gateMcpInvocation`**. Bypass (tests / emergency only): **`ORCH_SKIP_CLASSIFIED_SHELL_GATE=1`**.

**Orchestrator Ollama HTTP (network slice):** outbound HTTP to **`OLLAMA_HOST`:`OLLAMA_PORT`** from **`agents/runtime/run-ollama.js`** and the **`checkOllama()`** health probe in **`orchestrator.js`** is gated via domain **`network`** and precheck **`network_hostname` / `network_port`** against **`domains.network.allow_hosts`** (`orchestrator/security/network-permission-gate.js`, `evaluate-permission.js`). Client hostname **`0.0.0.0`** is normalized to **`127.0.0.1`** for allow-list matching only (CI/Docker **`OLLAMA_HOST`** quirk). When MCP audit tracing is active, **`permission_check`** lines use **`tool: ollama_chat`** or **`ollama_health_check`**. Bypass (tests / emergency only): **`ORCH_SKIP_NETWORK_PERMISSION_GATE=1`**.

**Scope boundary (Ollama HTTP gate):** This gate covers **only** orchestrator-owned Ollama HTTP transport (**orchestrator → HTTP → Ollama**). It does **not** grant or deny MCP/tool-internal network egress. Declared documentation retrieval must be authorized through **MCP / `context_retrieval` / `declared_docs_category`**, not through the Ollama **`network.allow_hosts`** policy. **Claude CLI** remains governed by **`shell` / `remote_model`**, not this Ollama network gate. Generic non-Ollama HTTP egress remains **out of scope** until a dedicated slice defines proxy/sandbox/enforcement semantics.

**Context retrieval (policy slice):** domain **`context_retrieval`** is evaluated for **`domains.context_retrieval.default`** (e.g. `allow`, `warn_only`, `deny`) so future docs/RAG call sites can route through the evaluator without falling through to generic deny. Short-circuit **`declared_docs_category`** remains the preferred path for catalog-validated public docs lookup.

### 8.5 Run-level rollup (`session_end.permission_summary`)

The reference runner may attach **`permission_summary`** on **`session_end`**: counts by **`decision`**, top **`reason_code`** buckets, and repeated deny fingerprints (`tool` / `domain` / **`reason_code`** only — no secrets). The rollup window matches **`permission_check`** rows buffered during the same MCP audit span as **`mcp_call`** correlation; **`token-trace-report`** can also recompute a rollup from every **`permission_check`** line in a trace file. Schema when present: **`orchestrator/schemas/trace-v2-line.schema.json`**; narrative: [permission-check-trace.md](permission-check-trace.md).

### 8.6 Role / capability matrix precheck (before evaluator)

Runtime gates (`mcp-permission-gate`, `claude-cli-shell-gate`, `network-permission-gate`, `classified-invocation-permission-gate`) verify the active **`agentId`** (authoritative when supplied) or the MODE **`role`** union against **`agents/capability-matrix.v1.json`** **before** calling **`evaluatePermission`**. Denials use stable **`reason_code`** values such as **`role_capability_domain_denied`** (trace-only; not `PERM_*`). **Claude CLI transport:** matrix declares **`remote_model`** for Claude-using roles while the evaluator still uses domain **`shell`**; the precheck allows if **either** domain is listed for the role. Bypass (tests / emergency): **`ORCH_SKIP_ROLE_CAPABILITY_GATE=1`**.

---

## 9. Reason codes (policy results)

Prefix **`PERM_`** for machine-readable stable IDs (subset; implementations extend with registry in schema):

| Code | Meaning |
|------|---------|
| `PERM_DOMAIN_DISABLED` | Domain not allowed by envelope. |
| `PERM_PATH_READ_DENIED` | Filesystem read not covered by allow rules. |
| `PERM_PATH_WRITE_FORBIDDEN` | Write blocked (read-only profile). |
| `PERM_PATH_ACCESS_DENIED` | Generic path denial.<br>Prefer read/write-specific codes when applicable (§6). |
| `PERM_NETWORK_HOST_DENIED` | Host not in allow_hosts / class denied. |
| `PERM_MCP_TOOL_DENIED` | Tool/server not allowed. |
| `PERM_SHELL_FORBIDDEN` | Shell execution not permitted. |
| `PERM_GIT_WRITE_FORBIDDEN` | Git mutation blocked. |
| `PERM_RETRIEVAL_SCOPE_DENIED` | Scope not permitted or budget exceeded. |
| `PERM_RETRIEVAL_FULL_FILE_FORBIDDEN` | Full document retrieval blocked by policy. |
| `PERM_APPROVAL_REQUIRED` | Paused until approval clears.<br>(Pair with approval trace.) |
| `PERM_APPROVAL_TIMEOUT` | Approval not obtained in time. |

---

## 10. Relation to current role matrix

Today **`effectiveMode`** caps credential **read/write**.

The envelope in §4 **layers on top**: a role might be “write” for Terraform semantics while
**`filesystem.paths`** still denies paths outside the workspace.

Resolution order (recommended):

1. Session / role ceiling (`permissions.js`).
2. Explicit **`permission_policy`** denial or approval requirement.
3. Output contract / gates.

---

## 11. Acceptance mapping (groomed checklist)

| Requirement | Section |
|-------------|---------|
| Reject before token-heavy execution | §7 preflight |
| All domains represented | §3, §4 |
| Read-only / denied / chunk retrieval / pre-exec denial examples | §6 table, §6 narrative |
| Trace + reason payloads | §8–§9 |

---

## 12. Next implementation slices (informative)

Aligns with downstream network slices:

preflight gate → runtime guard → approval prompt contract → reporting

— **after** this document is referenced by PRs and schema updates.

---

## 13. Human governance (adjacent contract)

Policy may return **`requires_approval`**; a separate **human governance** story
(wait / grant / deny, auditable) is specified in
[governance-gates-contract.md](governance-gates-contract.md). That file is partially implemented:
trace schema, helper builders, and MCP **`requires_approval`** → **`approval_required`** emit are shipped.
Product UI, persisted grant/deny writer, and resume-after-grant runner behavior remain out of scope.
