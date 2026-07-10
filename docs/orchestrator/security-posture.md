# Security posture and threat model (honest)

This document is the **canonical public narrative** for security in ai-minions.
It does not replace the contracts below; if anything disagrees, **the contracts
and code win**.

**Related contracts (normative detail):**

- [`runtime-permission-contract.md`](runtime-permission-contract.md)
- [`trace-privacy-contract.md`](trace-privacy-contract.md)
- [`strict-mode.md`](strict-mode.md)
- [`failure-semantics-contract.md`](failure-semantics-contract.md)
- [`production-boundary-guard.md`](production-boundary-guard.md)
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

## Admin console threat model (self-hosted framing)

ai-minions is an **operator-controlled admin console** for AI-assisted engineering
work — not a casual public web app.

| Property | Implication |
|----------|-------------|
| **Tools + shell + MCP + local models** | Same blast radius class as a privileged dev workstation or CI agent with secrets nearby. |
| **Filesystem and network** | Gated paths deny before execute; host policy and egress still matter outside those paths. |
| **Self-hosted default** | You choose exposure. Binding a runner UI, MCP port, or Ollama endpoint to `0.0.0.0` without auth is **misconfiguration**, not a supported “multi-user SaaS” mode. |
| **Human approval** | Policy-driven gates reduce risk; they do not remove operator responsibility for `GOAL` and credentials. |

**Do not expose** the harness stack (runner TUI, trace dirs, MCP servers, hook
logs, local inference) to untrusted networks without your own access controls,
TLS, network segmentation, and secret handling. Treat exported traces like
semi-trusted logs — redaction helps; mishandling still leaks.

**Not claimed:** secure-by-default public deployment, multi-tenant isolation,
hosted control plane, or “safe for anonymous internet users.”

---

## Control layers — implemented / partial / planned / not claimed

| Control | Status | Evidence / follow-up |
|---------|--------|----------------------|
| **Permission evaluator** (classify + deny before execute on gated paths) | **Implemented** | `evaluate-permission.js`, MCP/shell/network/classified gates; tests under `orchestrator/tests/` |
| **Trace redaction** (secret-shaped fields) | **Implemented** | [trace-privacy-contract.md](trace-privacy-contract.md) |
| **Role / capability matrix precheck** | **Implemented** | `capability-matrix.v1.json`, trace role capability tests |
| **Production Boundary Guard** (`agent_as_contributor`) | **Partial** | [production-boundary-guard.md](production-boundary-guard.md) + [merge-governance-contract.md](merge-governance-contract.md) — model + dry-run gate; runner auto-wire pending |
| **Human approval / governance gates** | **Partial** | Policy gates + trace; grant/deny UI paths still evolving |
| **Skill registry allowlist** | **Partial** | [skill-registry-contract.md](skill-registry-contract.md); hook opt-in; router runtime pending |
| **Progressive disclosure** (hide tool/skill surface in context) | **Partial** | [progressive-disclosure-contract.md](progressive-disclosure-contract.md); skill-side runtime filter pending |
| **Credential broker** (vault/proxy; no raw secret in model context) | **Planned** | [credential-broker-contract.md](credential-broker-contract.md); session modes today are not vaulting |
| **Sandbox isolation** (kernel/container boundary for tool code) | **Planned** | Design-first only; not shipped in core runner |
| **Egress control** (beyond Ollama HTTP gate) | **Planned** | See [runtime-permission-contract.md](runtime-permission-contract.md) gaps |
| **Tool misuse evals** (untrusted context fixtures + runtime authority gate) | **Wired** | `modules/tools/untrusted-context-eval.js`, `context-authority-runtime-gate.js`, fixtures, `tests/untrustedContextEval.test.js`, `tests/contextAuthorityRuntimeGate.test.js`; MCP/shell gate when `derived_from_untrusted` |
| **Tool/MCP failure chaos evals** (deterministic fixture harness) | **Wired** | `modules/tools/chaos-tool-failure-eval.js` + fixtures + `tests/chaosToolFailureEval.test.js`; no live network |
| **Harness resilience operator visibility** (`status`/`explain`) | **Wired** | `tool_failure_summary` · `context_authority_status` from trace; missing → `unavailable` — see [operator visibility guide](../how-to/operator-visibility-guide.md) |
| **Handoff ownership envelope** | **Partial** | [handoff-contract.md](handoff-contract.md) design-only |
| **Sandbox + credential isolation** | **Partial** | [sandbox-credential-isolation-design.md](sandbox-credential-isolation-design.md) design-only |
| **Budget hard-stop v2** | **Planned** | Multi-dimensional limits exist; richer policy still evolving |
| **Production-ready / fully sandboxed / safe autonomous execution** | **Not claimed** | This doc + [doc-runtime-drift-check.md](doc-runtime-drift-check.md) |

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

- **Code:** `orchestrator/modules/model-runtime/run-classified-shell.js` (`spawnClassifiedSync`)
  plus manifest integration (see runtime permission contract).
- **Context authority:** when `context_authority.derived_from_untrusted === true`, MCP and classified shell paths emit `context_authority_check` and fail closed on unknown/injected variants (`modules/tools/context-authority-runtime-gate.js`).
- **Tests:** `orchestrator/tests/classifiedInvocationPermissionGate.test.js`, `orchestrator/tests/contextAuthorityRuntimeGate.test.js`.

### Deterministic harness resilience evals (fixture-only)

- **Chaos tool failure:** `modules/tools/chaos-tool-failure-eval.js` + `chaos-tool-failure-fixtures.v1.json` → `tool_failure_eval` trace shape.
- **Untrusted context / authority:** `modules/tools/untrusted-context-eval.js` + fixtures → `context_authority_check` trace shape.
- **Tests:** `npm run test:eval:harness-resilience` (also in default `npm test` / CI unit job).
- **Operator surfaces:** `ai-minions status` / `explain` read latest harness trace rows — see operator visibility guide.

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

- **Helps:** CERBERUS lane; deeper eval work is planned, not shipped everywhere.
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

- Unified local memory DB — **decision doc** [memory-store-decision.md](memory-store-decision.md): **no-go** for merged store in v0.1.x; trace JSONL stays SoT; optional future index only (not approved for implementation in design PR).
- Context package assembly — **contract** [context-package-contract.md](context-package-contract.md): design-only; no runtime builder in v0.1.x.
- Workflow skills — **threat model** [skill-security-threatmodel.md](skill-security-threatmodel.md): no sandbox; registry/scan future.
- Read-only run inspect — **CLI** [control-plane-tui-contract.md](control-plane-tui-contract.md): `npm run control-plane:tui`.
- Sandbox boundary for arbitrary code separate from policy text only.
- Credential isolation via vault or proxy patterns.
- Continuous red-team automation or LLM-as-judge prompt regression (fixture harness only today).
- Progressive disclosure **runtime** filter (design contract exists; enforcement pending skill registry).
- Multi-tenant auth and hosted isolation (out of scope for alpha harness).

---

## How to use this doc

1. Read the **contracts** linked at the top for exact behavior.
2. Run with **gates on** when stakes are not toy-level.
3. Treat **degraded mode** as visible risk acceptance, not a silent downgrade.
4. Add deployment assets, data classes, and trust zones **on top** of this baseline.

---

## Release vulnerability scan (operator gate)

Before cutting an alpha/pre-release tag, run the **published dependency scope**
scan. Scope is defined in root **`.trivy.yaml`**.

**CI:** GitHub Actions workflow **`security-trivy-scan`** uses
[`aquasecurity/trivy-action`](https://github.com/aquasecurity/trivy-action) —
job summary + `trivy-security-report` artifact (txt/json/sarif) for CERBERUS.

**Local (operator):**

```bash
bash scripts/release-trivy-gate.sh
```

Equivalent:

```bash
trivy fs --config .trivy.yaml --scanners vuln,secret --ignore-unfixed --exit-code 1 .
```

**In scope (must be clean):**

| Path | Role |
|------|------|
| `orchestrator/package-lock.json` | Node orchestrator runtime |
| `mcp-servers/*/uv.lock` | MCP Python transitive pins (`uv sync` reproducibility) |
| `scripts/hooks/` | Python hook sources (secret scanner) |

**Out of scope — reference-only / local cache (excluded via `--skip-dirs`):**

| Path | Rationale |
|------|-----------|
| `plugins/` | Claude Code **local marketplace cache** — gitignored, not shipped in `git clone`. Third-party `bun.lock` trees under `external_plugins/` are operator-installed samples; ai-minions does not publish or support those runtimes as release artifacts. Operators who enable channel plugins must patch upstream locks or accept vendor risk separately. |
| `projects/`, `metrics/`, session trees | Host runtime data — not repository content |

**Remediation when gate fails:**

1. MCP locks: `cd mcp-servers/<server> && uv lock --upgrade-package <pkg>` then re-run the gate.
2. Orchestrator npm: `cd orchestrator && npm audit fix` (or explicit dependency bump) when `package-lock.json` reports HIGH/CRITICAL **fixed** issues.
3. Do **not** silence HIGH/CRITICAL in published scope without OWNER rationale recorded in release notes.

---

## Revision

Update when shipped controls or major gaps change. Prefer **small factual diffs**
over marketing language.
