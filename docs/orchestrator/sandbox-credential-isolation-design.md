# Sandbox and credential isolation — design

**Status:** Design-only. No kernel/container sandbox shipped in this slice.

**Problem:** ai-minions already **denies** `credential_reveal` / `credential_export` at the permission layer, but credentials may still exist as **material in the agent execution environment** (env vars, process memory, shell inheritance). Evaluator allow/deny is not the same as blast-radius containment.

**Not claimed:** Firecracker/Docker/nsjail implementation, multi-tenant vault, remote HSM, production-ready autonomous execution, or “Zero Trust compliant” posture.

**Related:** [security-posture.md](security-posture.md) · [credential-broker-contract.md](credential-broker-contract.md) · [runtime-permission-contract.md](runtime-permission-contract.md) · [environment-access.md](environment-access.md) · [handoff-contract.md](handoff-contract.md)

---

## Three layers (do not conflate)

| Layer | Role today | This design |
|-------|------------|-------------|
| **Permission evaluator** | Classify + allow/deny/requires_approval before execute | Unchanged — decides *whether* |
| **Credential broker** | Resolve alias → env **outside** model context; trace without secrets | Planned MVP — avoids *material in prompt* |
| **Sandbox** | **Not shipped** | Limits *where* side effects occur when execute is allowed |

SEC-NET policy, sandbox containment, and credential broker are **complementary**. None replaces another.

---

## Trust boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│ LLM / agent prompt context (untrusted retrieved text)       │
└───────────────────────────┬─────────────────────────────────┘
                            │ policy + context authority
┌───────────────────────────▼─────────────────────────────────┐
│ Orchestrator runtime (MODE, gates, trace, handoff envelope)   │
└───────────────────────────┬─────────────────────────────────┘
                            │ classified invocation gate
┌───────────────────────────▼─────────────────────────────────┐
│ Shell / tool execution sandbox (future)                       │
│  - cwd scope, env strip, network namespace (TBD)              │
└───────────────────────────┬─────────────────────────────────┘
                            │ brokered credential use only
┌───────────────────────────▼─────────────────────────────────┐
│ Credential broker / vault proxy (future)                      │
│  - no raw secret in agent process by default                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ scoped tokens / refs
┌───────────────────────────▼─────────────────────────────────┐
│ External services (AWS, K8s, CI, MCP hosts)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Credential modes (design)

| Mode | Agent sees | Runtime behavior |
|------|------------|------------------|
| **configured_reference** | Alias name only | Broker resolves env at invoke time |
| **brokered_use** | Operation request + alias | Broker performs allow/deny; no value returned to model |
| **scoped_token** | Short-lived scoped credential id | Token bound to operation class + target |
| **denied_reveal_export** | Never | `credential_reveal` / `credential_export` always deny |

Today: session `ENVIRONMENT` blocks + broker MVP path — **not** full env stripping in child processes.

---

## Actions requiring sandbox (when implemented)

| Action class | Sandbox intent |
|--------------|----------------|
| `shell_execute` | Strip inherited secrets; optional network off |
| `code_execution` | Separate mount namespace; no host home |
| `filesystem` outside repo | Read-only or deny unless approved path |
| `network_access` | Egress allowlist per profile |
| `external_side_effect` | Combined gate + sandbox before mutate |

Worktree isolation (shipped) addresses **git branch** separation — not kernel sandboxing.

---

## Trace events (future)

| Event | Meaning |
|-------|---------|
| `sandbox_required` | Policy says action needs containment |
| `sandbox_entered` | Runtime entered isolated execution context |
| `sandbox_blocked` | Could not enter sandbox — fail closed |
| `credential_broker_used` | Broker resolved alias (shipped MVP) |
| `credential_material_denied` | Process would have inherited raw secret — blocked |

Existing `permission_check` rows remain authoritative for allow/deny; sandbox events annotate **containment**, not policy outcome.

---

## Threat model (design coverage)

| Threat | Mitigation layer |
|--------|------------------|
| Credential exposure in prompt | Broker + trace redaction (partial today) |
| Credential in child shell env | Sandbox env strip + broker (planned) |
| Sandbox escape | Container/kernel boundary (out of alpha) |
| External side effect from allowed tool | Permission gate + sandbox cwd/network |
| Local repo mutation outside scope | Worktree + path policy |
| Untrusted instruction elevation | Context authority harness (fixtures shipped) |

---

## Alpha vs post-alpha

| In alpha (today) | Post-alpha (requires new tickets) |
|------------------|-----------------------------------|
| Permission evaluator on gated paths | Kernel/container sandbox |
| Credential broker MVP | Remote vault |
| Worktree isolation | Full env isolation for all shell spawns |
| Untrusted-context fixture harness | Runtime context authority wiring |
| This design doc | Verifiable sandbox trace enforcement |

---

## Policy examples

**Example A — dev-local terraform plan**

- Evaluator: `allow` (simulate)
- Sandbox: optional lightweight (repo cwd only)
- Broker: not required

**Example B — CI-safe kubectl apply**

- Evaluator: `deny` or `requires_approval`
- Sandbox: would not run until approval + sandbox entered
- Broker: scoped token if cluster creds needed

**Example C — MCP tool returning injected directive**

- Context authority: `ignore_instruction` (fixture harness)
- Evaluator: unchanged for actual tool invoke
- Sandbox: N/A for text-only injection

---

## dev-local ergonomics

Design **must not** block default local development without explicit opt-in:

- `dev-local` profile may skip heavy sandbox when `sandbox_required` is false
- Fail closed only when policy marks `sandbox_required: true` or credential material would leak
- Document overrides in project policy — no silent bypass

---

## Future implementation slices (not this ticket)

1. Env strip wrapper for `run-classified-shell.js`
2. `sandbox_required` flag in permission profiles
3. Trace schema additions for sandbox_* events
4. Integration tests with fake sandbox backend (no Docker requirement in unit tests)

---

## Limits (explicit)

- No sandbox runtime in orchestrator from this doc alone.
- CERBERUS must confirm no overclaim of kernel/container isolation as shipped.
- Confusing evaluator with sandbox is an explicit anti-pattern — see [security-posture.md](security-posture.md) three layers table.
