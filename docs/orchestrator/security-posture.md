# Security posture and threat model (honest)

This document is the **canonical public narrative** for security in ai-minions.
It does not replace the contracts below; if anything disagrees, **the contracts
and code win**.

**Related contracts (normative detail):**

- [`runtime-permission-contract.md`](runtime-permission-contract.md)
- [`trace-privacy-contract.md`](trace-privacy-contract.md)
- [`strict-mode.md`](strict-mode.md)
- [`failure-semantics-contract.md`](failure-semantics-contract.md)
- [`agent-contract.md`](agent-contract.md)

**Related positioning (non-normative):**
[harness-engineering-positioning.md](harness-engineering-positioning.md) — harness
framing and orchestration vocabulary; contracts above remain authoritative for
behavior.

## What this document is not

- Not a claim of **"secure by design"** or production hardening.
- Not a substitute for **your** threat model on a concrete deployment.
- Not a promise of **sandbox isolation** or **credential vaulting** in the core
  runner today.

---

## Assets to protect

| Asset | Why it matters |
|-------|----------------|
| **Repository and workspace files** | Agents read/write paths allowed by policy. |
| **Secrets and tokens** | Session material must not leak into traces. |
| **Network egress** | HTTP/shell can exfiltrate or hit untrusted hosts. |
| **Operator intent (`GOAL`)** | Injection can steer work away from intent. |
| **Run budget and iteration state** | Limits abuse and runaway spend. |
| **Review integrity** | QA/CERBERUS must reflect real artifacts. |

---

## Trust boundaries (high level)

```text
Human operator  -->  Hooks / Claude session  -->  Orchestrator (Node)
       |                        |                         |
       |                        +---- MCP servers ------+
       |                        +---- Claude CLI --------
       +------------------------ trace files on disk ---+
```

The orchestrator **records** decisions and failures. It does **not** magically
contain a compromised host, malicious operator, or misconfigured cloud account.

---

## Three different layers (do not conflate)

### Permission enforcement (shipped in gated paths)

- Classifies actions, evaluates policy, **denies before execute** on gated paths
  (MCP, shell, network, classified spawn).
- Does **not** VM-sandbox tool code or prove absence of side channels.

### Sandbox isolation (aspirational)

- **Not shipped** as a kernel/container boundary in the core runner.
- Not interchangeable with "allowed by YAML".

### Credential broker (aspirational)

- Session modes and env wiring limit **how roles may use** creds; some categories
  can be blocked.
- Does **not** guarantee that every path avoids **reading raw secret material**
  when a credential is permitted for use; brokered vaulting is future work.

**Rule:** "Allowed to call an API" is **not** the same as "safe from exfiltration
under a malicious goal."

---

## Mitigations that exist today (with evidence pointers)

### Tool/action classification + manifest

- **Code / data:** `orchestrator/security/tool-action-manifest.v1.json`, classifiers.
- **Tests:** `orchestrator/tests/permissionConfig.test.js`.

### Permission evaluator + reason codes

- **Code:** `orchestrator/security/evaluate-permission.js`,
  `orchestrator/security/trace-security-decision.js`.
- **Tests:** `orchestrator/tests/evaluatePermission.test.js`.

### MCP gate + traces

- **Code:** `orchestrator/security/mcp-permission-gate.js`.
- **Tests:** `orchestrator/tests/mcpPermissionGate.test.js`.

### Network (Ollama HTTP) gate

- **Code:** `orchestrator/security/network-permission-gate.js`.
- **Tests:** `orchestrator/tests/networkPermissionGate.test.js`.

### Classified shell / spawn gate

- **Code:** `orchestrator/agents/runtime/run-classified-shell.js` (`spawnClassifiedSync`)
  plus manifest integration (see runtime permission contract).
- **Tests:** `orchestrator/tests/classifiedInvocationPermissionGate.test.js`.

### Role / capability matrix precheck

- **Data:** `orchestrator/agents/capability-matrix.v1.json`.
- **Tests:** `orchestrator/tests/rolePermissionMatrix.test.js`,
  `orchestrator/tests/traceRoleCapability.test.js`.

### Trace schema and `permission_check` events

- **Schema / docs:** `schemas/trace-v2-line.schema.json`, permission trace doc.
- **Tests:** `orchestrator/tests/traceSchema.test.js`.

### Trace read/write redaction

- **Contract:** `trace-privacy-contract.md` and sanitizer paths in code.
- **Tests:** hygiene tests under `orchestrator/tests/` (see contract for names).

### Output contracts (`validateOutput`)

- **Code:** `orchestrator/agents/validate-output.js`.
- **Tests:** broad coverage under `orchestrator/tests/`.

### CERBERUS semantic floor (format + anchors)

- **Docs / code:** `agent-contract.md`, `orchestrator/agents.js`.
- **Tests:** `orchestrator/tests/askAgent.test.js` (and related).

### Cost and iteration guards

- **Docs / code:** `orchestrator/README.md`, `orchestrator/orchestrator.js`.
- **Tests:** `orchestrator/tests/guardrails.test.js`.

### Failure taxonomy on `iteration_done`

- **Contract:** `failure-semantics-contract.md`.
- **Tests:** `orchestrator/tests/iterationDoneEmitterContract.test.js`.

---

## Threats (initial model)

### Prompt injection

- **Helps:** contracts, `validateOutput`, human owns `GOAL`.
- **Gaps:** no universal injection detector; malicious goals can still read as
  valid text.

### Malicious or mistaken tool call

- **Helps:** classification, evaluator, **deny before execute** on gated paths.
- **Gaps:** broad allow rules or `--skip-gates` removes protection.

### Trace secret leakage

- **Helps:** writer `_sanitize`, read-time `sanitizeTraceRowsForRead`.
- **Gaps:** wrong `ORCH_TRACE_*` flags; operator mishandles exported traces.

### Runaway token cost

- **Helps:** budget hard-stop, warnings, trace events.
- **Gaps:** wrong USD rates or missing limits still spend before stop.

### Unsafe shell or network access

- **Helps:** gates on orchestrator paths; still needs host policy.
- **Gaps:** user shells outside gated paths are not a full OS hardening story.

### Incentive conflict (system vs user goal)

- **Helps:** CERBERUS lane; deeper eval work lives in planning backlog.
- **Gaps:** not modeled as automated policy everywhere.

### Invalid handoff — ownership mismatch

- **Helps:** handoff rules in `agent-contract.md`; state MCP when enabled.
- **Gaps:** delegation bugs or manual file edits can desync state.

### Invalid handoff — stale handoff contract

- **Helps:** gates and alignment checks when MCPs are enabled.
- **Gaps:** skipped gates weaken enforcement.

### Invalid handoff — filtered-history omission

- **Helps:** trace plus explicit blockers in artifacts.
- **Gaps:** aggressive context compression can drop nuance.

### Compromised or oversized tool surface

- **Helps:** capability matrix; progressive disclosure still planned.
- **Gaps:** too many tools or MCPs enabled expands blast radius.

### Credential material in agent runtime

- **Helps:** session mode ceiling, role permissions.
- **Gaps:** not a vault broker; secrets in env remain an operator concern.

### Resumability and long-run state

- **Helps:** traces and compact handoff artifacts.
- **Gaps:** durable session semantics are planned, not completeness-guaranteed here.

---

## Gaps (explicit)

Planned or post-alpha unless code says otherwise:

- Durable session log / resumability — **contract + export** in [session-resume-contract.md](session-resume-contract.md); harness emit path optional follow-up.
- Sandbox boundary for arbitrary code separate from policy text only.
- Credential isolation via vault or proxy patterns.
- Tool misuse evaluations beyond static classification.
- Progressive disclosure of tool/MCP surface by role and step.
- Multi-tenant auth and hosted isolation (out of scope for alpha harness).

---

## How to use this doc

1. Read the **contracts** linked at the top for exact behavior.
2. Run with **gates on** when stakes are not toy-level.
3. Treat **degraded mode** as visible risk acceptance, not a silent downgrade.
4. Add deployment assets, data classes, and trust zones **on top** of this baseline.

---

## Revision

Update when shipped controls or major gaps change. Prefer **small factual diffs**
over marketing language.
