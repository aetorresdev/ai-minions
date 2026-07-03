# Beta claim and blast-radius discipline

**Scope:** beta-facing docs, onboarding, and operator feedback — **wording only**. This does **not** implement universal rollback or a hardened sandbox.

**Parent lane:** v0.19 human-ready UX · absorbed claim/blast-radius sub-slice (E19-3)

**Related:** [PRIVACY.md](../../PRIVACY.md) · [beta-known-limitations](beta-known-limitations.md) · [security-posture](../orchestrator/security-posture.md) · [runtime-permission-contract](../orchestrator/runtime-permission-contract.md)

---

## Claim discipline (what docs must not say)

Unless backed by tested evidence in this repo, beta-facing text must **not** claim ai-minions is:

| Forbidden claim class | Wording to avoid (examples paraphrased) |
|-----------------------|----------------------------------------|
| Production deployment class | Implies SLA, production support, or enterprise deployment readiness |
| Overstated safety class | Implies zero risk, cannot fail, or guaranteed safety |
| Complete sandbox class | Implies fully sandboxed or no side effects possible |
| Autonomous safety class | Implies trust without human review |
| Secret-proof uploads class | Implies uploads are automatically safe or all leaks are prevented |
| Architecture complete class | Implies all harness gaps are closed |

Use **implemented / planned / not claimed** language instead — [README maturity](../../README.md#maturity-implemented--planned--not-claimed).

Enforced in CI: `node scripts/audit-product-claims.mjs`.

---

## Blast radius — beta-exposed actions

When docs describe an action with side effects, state explicitly:

| Field | Meaning |
|-------|---------|
| `action_type` | What class of operation (read files, git write, shell, network, credentials) |
| `max_impact` | Worst realistic outcome if mis-scoped or mis-run |
| `requires_human` | Whether a human must approve before treating output as shippable |
| `rollback_available` | Whether an automated rollback exists (**usually no** — manual revert) |
| `evidence_ref` | Trace/gate/doc path that bounds the claim |

This table is **documentation honesty**, not a runtime API. The harness may not print these five fields on every command yet; docs must still describe impact plainly.

---

## Reference matrix (alpha/beta operator surface)

| Action / path | `action_type` | `max_impact` | `requires_human` | `rollback_available` | `evidence_ref` |
|---------------|---------------|--------------|------------------|------------------------|----------------|
| `npm run ai-minions -- doctor` | read/check | Misleading “ready” signal if ignored | yes — before `start` | n/a (read-only) | trace N/A · [bootstrap-preflight](bootstrap-preflight.md) |
| `npm run ai-minions -- start` (orchestrated run) | agent execution | File edits, shell commands, network calls per permission profile | **yes** — merge/review gates | **no** universal auto-rollback — use git revert | JSONL trace · [runtime-permission-contract](../orchestrator/runtime-permission-contract.md) |
| `--skip-gates` / degraded mode | agent execution (weakened) | Same as start with **weaker** policy enforcement | **yes** | **no** | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) |
| `collect-run-report.mjs` | read/copy local artifacts | Copies traces/panels into bundle dir on disk | yes — before public upload | delete bundle dir | [privacy-sanitize-gate-contract](../orchestrator/privacy-sanitize-gate-contract.md) |
| Public GitHub issue + attachments | publish | **Public** disclosure of whatever you attach | **yes** — redact first | edit/delete issue manually | [PRIVACY.md](../../PRIVACY.md) |
| MODE header in Claude Code | agent execution | Same class as orchestrated run when hooks launch runner | **yes** | **no** | [agent-contract](../orchestrator/agent-contract.md) |

---

## Operator rules (plain language)

1. **Degraded ≠ safe by default** — `--skip-gates` is for learning, not evidence that strict gates passed.
2. **Permission ≠ sandbox** — allowed git write or shell can damage the repo like a human developer can.
3. **Bundles ≠ redacted by default** — scan helps; you still review before upload ([PRIVACY.md](../../PRIVACY.md)).
4. **Public issues ≠ private support** — assume the world can read what you file.

---

## Not in scope (this doc)

- Universal rollback framework implementation
- Hosted SaaS ToS / DMCA / arbitration
- Tool admission governance or marketplace terms
- Legal compliance certification
