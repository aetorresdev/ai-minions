# Shell and kernel execution boundary — threat model (honest)

This document maps **where the harness gates shell-like execution** and what remains
**outside** those gates at the OS/kernel level. It extends
[security-posture.md](security-posture.md) with shell-specific detail.

**Normative behavior** still lives in contracts and code. If this doc disagrees with
runtime, **code and contracts win**.

**Related:**

- [security-posture.md](security-posture.md) — canonical security narrative
- [runtime-permission-contract.md](runtime-permission-contract.md) — permission evaluator
- [operator-visibility-guide.md](../how-to/operator-visibility-guide.md) — harness fields on `status`/`explain`
- Code: `modules/model-runtime/run-classified-shell.js`, `security/mcp-permission-gate.js`,
  `modules/model-runtime/run-claude.js`, `modules/tools/context-authority-runtime-gate.js`

## What this document is not

- **Not** a claim that kernel/container sandbox isolation is shipped.
- **Not** proof that every subprocess on the host is policy-gated.
- **Not** a substitute for host hardening, network segmentation, or operator access control.

---

## Assets and blast radius

| Asset | Shell/kernel relevance |
|-------|------------------------|
| **Repository workspace** | Shell and classified spawn can read/write paths allowed by policy and host permissions. |
| **Operator credentials in env** | Child processes inherit the operator session environment unless externally isolated. |
| **Network egress** | Ungated or broadly allowed shell/network can reach arbitrary hosts. |
| **Trace integrity** | `permission_check` and `context_authority_check` events support audit; missing trace must surface as `unavailable`, not fabricated. |
| **Operator intent** | Untrusted context must not become sovereign instructions for tool/shell actions. |

**Blast radius class:** comparable to a **privileged developer workstation** or CI agent
with secrets nearby — see admin console framing in [security-posture.md](security-posture.md).

---

## Threat actors

| Actor | Goal | Relevant path |
|-------|------|----------------|
| **Malicious prompt / untrusted context** | Steer tool or shell invocation via injected instructions | Context authority gate on gated paths when `derived_from_untrusted` |
| **Over-broad policy** | Execute destructive shell/MCP actions that policy allows | Permission evaluator + manifest classification |
| **Compromised MCP server** | Invoke tools with operator-adjacent privileges | MCP permission gate |
| **Operator misconfiguration** | Disable gates via `ORCH_SKIP_*` or expose services | Environment and deployment — not prevented by runner alone |
| **Host-level attacker** | Escape any user-space gate | **Out of scope** — no kernel boundary shipped |

---

## Gated execution paths (implemented)

These paths **classify → evaluate policy → deny before execute** (or fail closed on
unknown authority), and emit trace events when the orchestrator graph is loaded.

### 1. Classified shell — `spawnClassifiedSync`

**Code:** `orchestrator/modules/model-runtime/run-classified-shell.js`

**Flow:**

```text
spawnClassifiedSync(executable, args, options)
  → [optional] context authority gate (if derived_from_untrusted)
  → classified invocation permission gate (manifest → evaluatePermission)
  → child_process.spawnSync (only if allowed)
```

**Deny codes (examples):** `CLASSIFIED_SHELL_DENIED`, `CONTEXT_AUTHORITY_DENIED`.

**Scope:** Orchestrator-owned **external CLI subprocesses** routed through this helper
(e.g. manifest-classified tools). **Does not** retrofit every `spawnSync` in the repo.

### 2. MCP tool invocation

**Code:** `orchestrator/security/mcp-permission-gate.js`

**Flow:** MCP call → classify action → permission evaluator → deny or allow → audit trace.

**Context authority:** When `context_authority.derived_from_untrusted === true`, the
runtime gate runs before permission evaluation; injected variants fail closed with
`injection_not_sovereign:<action>` (e.g. `invoke_shell`).

### 3. Claude CLI shell transport

**Code:** `orchestrator/modules/model-runtime/run-claude.js`

**Flow:** Claude CLI invocation with shell permission gate unless
`ORCH_SKIP_SHELL_PERMISSION_GATE=1` (test/emergency only).

**Scope:** The **Claude CLI transport** boundary — not a general OS shell wrapper.

### 4. Context authority runtime gate

**Code:** `orchestrator/modules/tools/context-authority-runtime-gate.js`

**Applies when:** `context_authority.derived_from_untrusted === true` on MCP or classified shell paths.

**Decisions:** `not_applicable` (skipped) · benign accept · `block_unclassified` ·
`injection_not_sovereign` deny.

**v0.22 closure — `invoke_shell`:** Fixture `fetched_web_injected_invoke_shell` in
`untrusted-context-fixtures.v1.json` documents that untrusted-derived metadata attempting
`invoke_shell` is denied with `injection_not_sovereign:invoke_shell`. This is **harness
evidence**, not proof of kernel isolation.

### 5. Network (Ollama HTTP) gate

**Code:** `orchestrator/security/network-permission-gate.js`

Related to model HTTP egress — not general shell, but part of the same permission story.

---

## Gate path summary

| `gate_path` (conceptual) | Entry | Trace event | Typical deny |
|--------------------------|-------|-------------|--------------|
| `classified_shell` | `spawnClassifiedSync` | `permission_check` | `CLASSIFIED_SHELL_DENIED` |
| `mcp` | MCP permission gate | `permission_check` | policy `reason_code` |
| `claude_cli` | Claude CLI shell gate (`claude-cli-shell-gate.js`) | `permission_check` | `CLAUDE_CLI_SHELL_DENIED` |
| `context_authority` | Derived untrusted context | `context_authority_check` | `CONTEXT_AUTHORITY_DENIED`, `injection_not_sovereign:*` |

Operator harness surfaces (`tool_failure_summary`, `context_authority_status`) read trace
rows — missing data → `unavailable`. See [operator-visibility-guide.md](../how-to/operator-visibility-guide.md).

---

## Ungated honest limits (not silently “safe”)

Subprocesses and shells **not** routed through the helpers above are **ungated honest limits**:

| Example | Risk |
|---------|------|
| Raw `child_process.spawnSync` outside `spawnClassifiedSync` | No manifest/evaluator gate on that call site |
| Operator interactive shell outside harness | Full user privileges on host |
| Claude Code / IDE terminal not using orchestrator gates | Host policy only |
| MCP servers started outside audited bridge | Depends on server config and network exposure |

**Policy:** Document and assume **host trust** for ungated paths. Do not infer safety from
YAML allow rules on a different code path.

---

## Test and emergency bypass — `ORCH_SKIP_*` hazard

These environment variables **disable gates** for tests or emergency debugging only.
**Never** use in production or cohort runs.

| Variable | Effect |
|----------|--------|
| `ORCH_SKIP_CLASSIFIED_SHELL_GATE` | Bypass classified shell gate in `spawnClassifiedSync` |
| `ORCH_SKIP_SHELL_PERMISSION_GATE` | Bypass Claude CLI shell gate |
| `ORCH_SKIP_MCP_PERMISSION_GATE` | Bypass MCP permission gate |
| `ORCH_SKIP_CONTEXT_AUTHORITY_GATE` | Bypass context authority runtime gate |
| `ORCH_SKIP_NETWORK_PERMISSION_GATE` | Bypass Ollama HTTP network gate |
| `ORCH_SKIP_ROLE_CAPABILITY_GATE` | Bypass capability-matrix precheck |

The threat model **must** treat any run with these set as **out of band** for security claims.

---

## Threat scenarios (initial)

### T1 — Untrusted web content requests shell

- **Mitigation (gated):** Context authority denies `invoke_shell` when derived from untrusted context with injected variant.
- **Residual:** Ungated shell outside harness; malicious operator goal with allowed policy.

### T2 — Manifest tool misclassified as low risk

- **Mitigation:** Classifier + evaluator; deny/requires_approval before spawn.
- **Residual:** Policy YAML too permissive; `ORCH_SKIP_*` enabled.

### T3 — MCP tool exfiltration

- **Mitigation:** MCP gate + trace; capability matrix precheck.
- **Residual:** Allowed MCP tool used maliciously within policy.

### T4 — Secret leakage via child process env

- **Mitigation:** Trace redaction; session mode ceilings (partial).
- **Residual:** No credential vault broker; env inheritance on spawn.

### T5 — False confidence in “sandbox”

- **Mitigation:** This doc + security posture — explicit **not shipped** sandbox boundary.
- **Residual:** Marketing or operator assumption that policy text equals OS isolation.

---

## Evidence and evals (fixture-only)

Deterministic harness evals support claims about **gate behavior**, not OS hardening:

| Harness | Fixture / test | Trace shape |
|---------|----------------|-------------|
| Untrusted context | `untrusted-context-fixtures.v1.json` | `context_authority_check` |
| Chaos tool failure | `chaos-tool-failure-fixtures.v1.json` | `tool_failure_eval` |
| Classified shell | `classifiedInvocationPermissionGate.test.js` | `permission_check` |
| Context authority + shell | `contextAuthorityRuntimeGate.test.js` | deny before spawn |

Run: `npm run test:eval:harness-resilience` (also in default `npm test`).

**Not claimed:** live shell chaos injection, kernel syscall filtering, container seccomp profiles.

---

## Explicit non-goals (current release)

- Kernel or container sandbox for arbitrary tool code
- Strands Shell or alternate shell runtime adoption
- Continuous automated red-team loop
- `shell_boundary_status` operator field (deferred — future harness slice)
- No claim of hardened production deployment or fully autonomous execution without operator oversight

---

## Operator guidance

1. Run cohort and production-like tests **with all `ORCH_SKIP_*` unset**.
2. Use `ai-minions status` / `explain` / `report` / `tui` for evidence — TUI is a
   **read-only single-run stdout view**, not a navigable control plane.
3. On deny, follow `next_safe_action` from operator surfaces when present; else
   `escalate_to_operator`.
4. For deployment threat modeling, combine this doc with host policy, network controls,
   and [security-posture.md](security-posture.md).

---

## Document maintenance

Update this file when gated paths, skip-env variables, or shell-adjacent contracts change.
Cross-check against `orchestrator/README.md` gate table and
`docs/orchestrator/runtime-permission-contract.md`.
