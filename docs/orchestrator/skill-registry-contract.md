# Skill registry contract

**Status:** MVP runtime — versioned allowlist + validator + opt-in hook enforcement.

**Source of truth:** `orchestrator/security/skill-registry.v1.json` loaded by `orchestrator/security/skill-registry.js`.

**Related:** [workflow-skill-contract.md](workflow-skill-contract.md) · [skill-security-threatmodel.md](skill-security-threatmodel.md) · [progressive-disclosure-contract.md](progressive-disclosure-contract.md) · [skill-router-design.md](skill-router-design.md)

---

## Policy

| Rule | Behavior |
|------|----------|
| `default_policy` | `deny_unlisted` — skills not in registry are rejected by evaluator/hook |
| Paths | Repo-relative `skills/<id>/SKILL.md` must exist at validation time |
| Roles | `allowed_roles` ⊆ orchestrator MODE roles |
| Disclosure | `index` \| `full` \| `hidden` — metadata for progressive disclosure (runtime filter pending) |
| Conformant | `conformant: true` only when skill meets [workflow-skill-contract.md](workflow-skill-contract.md) checklist |

**Not claimed:** marketplace sync, external skill import, automatic skill router, full progressive-disclosure runtime filter.

---

## Trace event `skill_registry_check`

| Field | Notes |
|-------|-------|
| `event` | `skill_registry_check` |
| `skill_id` | Registry key |
| `role` | Active MODE role |
| `decision` | `allow` \| `deny` |
| `reason_code` | `skill_registry_allowed`, `skill_not_registered`, `role_not_allowed_for_skill`, … |
| `disclosure` | From registry entry when allow |
| `conformant` | Boolean — true for conformant entries only |

---

## Hook enforcement (opt-in)

`scripts/hooks/skill-registry-enforcer.py` — **PreToolUse** on `Skill` when:

```bash
export ORCH_SKILL_REGISTRY_ENFORCE=1
```

Without the env var, hook exits 0 (IDE discovery unchanged). Wire in `settings.json.example` under `PreToolUse` → `Skill`.

---

## Validation

```bash
cd orchestrator && node --test tests/skillRegistry.test.js
```

Registry must list every `skills/*/SKILL.md` under repo root (coverage test fails on drift).

---

## Conformant reference entry

`orchestrator-token-report` — `conformant: true` in registry; see workflow skill contract § Reference skill.
