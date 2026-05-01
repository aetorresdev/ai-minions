# Runtime permission contract (design)

**Status:** design — informs implementation of preflight checks, runtime guards, and trace payloads
before SEC-NET and governed retrieval work is treated as complete.

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

**Examples the runtime must cover:**

| Scenario | Expected policy outcome |
|----------|-------------------------|
| Read-only path | `filesystem` **read** OK for prefix;<br>**write** denied → `PERM_PATH_WRITE_FORBIDDEN`. |
| Denied path | Preflight or runtime deny.<br>Use `PERM_PATH_ACCESS_DENIED` or more specific `PERM_*` codes. |
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
