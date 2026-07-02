# Skill capability boundary

**Design-first contract (ST-1)** — defines what a **skill** may be versus what the **harness** must govern. No runtime skill router in this slice.

**Related:** [skill-registry-contract.md](skill-registry-contract.md) · [workflow-skill-contract.md](workflow-skill-contract.md) · [skill-security-threatmodel.md](skill-security-threatmodel.md) · [agent-contract.md](agent-contract.md) § Skills and MCP

---

## Core rule (locked)

> A skill may describe *when* execution is needed, *what* tool/MCP should be requested, and *how* to interpret results. A skill must **not** be execution authority, permission policy, or implicit trust.

The skill may guide the model to *request* a tool; the harness decides **exposure**, **approval**, **sandbox**, and **trace**.

---

## Layer model

| Layer | Role | Examples |
|-------|------|----------|
| **Skill** | Procedure, criteria, artifact templates | Review checklist · doc generation steps |
| **Tool / local adapter** | Governed execution | `terraform validate` · filesystem write |
| **MCP / connector** | Standard interface + external integration | GitHub MCP · remote state read |
| **Harness** | Allowlist, policy, trace, budget, approval | PreToolUse registry · permission evaluator |
| **Gate / CERBERUS** | Contract validation | Plan allowed? · merge safe? |

**Connector note:** Connector = concrete integration (often MCP-powered). MCP = protocol. **Skill ≠ connector.**

---

## What a skill may include

| Allowed in skill folder | Harness still owns |
|-------------------------|-------------------|
| Instructions, examples, templates | Permission to run tools |
| Resources (references, schemas) | MCP registration and exposure profiles |
| Executable helpers invoked by harness | Sandbox boundaries and trace emission |
| Checklists and rubrics | Approval gates and budget stops |

Executable helpers inside a skill directory are **governed runtime capabilities**, not automatic trust because they live next to `SKILL.md`.

---

## Capability types (classification preview)

Full ST-2 table ships in a follow-on slice. Minimum taxonomy for reviews:

| Type | Meaning | Default risk |
|------|---------|--------------|
| `guidance_only` | Criteria and interpretation only | Low |
| `artifact_generation` | Produces files (docx, pdf, slides) | Medium |
| `external_execution_guidance` | May request governed tools/MCP | Medium–high |
| `forbidden` | Must not be loaded for privileged contexts | Blocked |

---

## Context exposure

Skills must not instruct the model to treat **raw chat history**, **full trace JSONL**, or **cache hits** as authoritative ground truth. Review-oriented skills should align with [context-package-contract.md](context-package-contract.md) `fresh_review_package` — bounded artifacts and handoffs only.

---

## Not claimed

- Skill sandbox isolation
- Automatic skill routing by intent
- Connector marketplace or turnkey integrations
- Skills as permission policy SoT

---

## Related follow-ons

- ST-2: per-skill classification in repo inventory
- ST-5: context budget caps per skill type
- [MCP exposure profiles](shared-dependencies.md) — runtime profiles deferred to admission-gate work
