# Merge governance contract (PR-boundary enforcement)

**Location:** `docs/orchestrator/merge-governance-contract.md`. See [PATHS.md](PATHS.md).

**Security model SoT:** [production-boundary-guard.md](production-boundary-guard.md) (`agent_as_contributor`, privileged-op boundary).

**Implementation status:** **Shipped (library + dry-run gate).** Durable `review_record` rows wire into `production_boundary_check.review_evidence` when `review_records` is supplied. Runner auto-invocation on every git/PR tool call is **not** wired yet.

---

## Role

ai-minions is a **PR producer + evidence reporter + approval requester**, not a merge/release actor by default.

| Layer | Owner |
|-------|-------|
| Branch protection / rulesets | GitHub (or host) |
| Limited PAT | GitHub auth |
| **PR-boundary gate** | `orchestrator/modules/gates/merge-governance/` (shim: `orchestrator/merge-governance/`) |
| CERBERUS | Review lane |
| Human | Merge · tag · release |

---

## Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Config loader | `load-merge-governance-config.js` | Read explicit `.ai-minions/merge-governance.yaml` or `ORCH_MERGE_GOVERNANCE_CONFIG` — **never invents policy** |
| Branch policy discovery | `branch-policy-discovery.js` | Merge GitHub discovery (when provided) + explicit config; fail closed when unknown |
| Actor capability check | `actor-capability-check.js` | Tri-state capability flags from config |
| PR-boundary gate | `pr-boundary-governance-gate.js` | `evaluatePrBoundaryGovernance` — decision + trace payload |
| Review evidence | `assess-review-evidence.js` | Summarize `review_record` rows; block `pr_ready` on CERBERUS blockers/pending changes |
| Trace builder | `build-production-boundary-check.js` | `production_boundary_check` row body |

Public API: `require("./modules/gates/merge-governance")` (preferred) or compat shim `require("./merge-governance")`.

---

## Operator config (explicit fallback)

Path: **`.ai-minions/merge-governance.yaml`** at repo root, or **`ORCH_MERGE_GOVERNANCE_CONFIG`** pointing to a YAML file.

```yaml
merge_governance:
  mode: agent_as_contributor
  default_branch: main
  protected_branches: [main, master, dev]
  production_branches: [main]
  release_branches: ["release/*"]
  tag_sources: [main, "release/*"]
  agent_permissions:
    allow_direct_merge: false
    allow_direct_push_protected: false
    allow_production_tag_create: false
    allow_release_publish: false
    allow_bypass_checks: false
    allow_bypass_reviews: false
```

Without config **and** without injectable GitHub discovery → `permission_visibility: unknown` → `decision: requires_manual_policy_input`.

Fixture: `orchestrator/tests/fixtures/merge-governance/config-fallback.yaml`.

---

## Dry-run gate

```javascript
const { evaluatePrBoundaryGovernance, loadMergeGovernanceConfig } = require("./merge-governance");

const { config } = loadMergeGovernanceConfig(repoRoot);
const result = evaluatePrBoundaryGovernance({
  repository: "owner/repo",
  pr_number: 42,
  source_branch: "feat/x",
  target_branch: "main",
  actor_class: "agent_pat",
  attempted_action: "pr_ready", // or prohibited: direct_merge, push_protected, ...
  explicit_config: config,
  github_discovery: null, // or injected discovery object when API access exists
  evidence_refs: ["https://github.com/owner/repo/pull/42"],
  review_records: [], // optional trace rows — when supplied, durable review_record verdicts gate pr_ready
});
// result.decision → ready_for_human_review | blocked | requires_manual_policy_input
// result.trace_payload → production_boundary_check body
```

**Gate id:** `pr_boundary_governance`. **Trace event:** `production_boundary_check` (schema in `orchestrator/schemas/trace-v2-line.schema.json`).

---

## Decisions and prohibited actions

| `attempted_action` (sample) | Default outcome |
|-----------------------------|-----------------|
| `pr_ready`, `attach_evidence` | `ready_for_human_review` when policy visible |
| `direct_merge`, `push_protected`, `create_production_tag`, `publish_production_release`, `bypass_*` | `blocked` · `AGENT_PRIVILEGED_OP_DENIED` |
| `claim_merge_safe` | `blocked` · `MERGE_SAFETY_CLAIM_DENIED` |
| *(no config/discovery)* | `requires_manual_policy_input` · `POLICY_VISIBILITY_UNKNOWN` |
| `pr_ready` + CERBERUS `review_record` blockers | `blocked` · `REVIEW_RECORD_BLOCKERS` |
| `pr_ready` + CERBERUS `request_changes` | `blocked` · `REVIEW_CHANGES_PENDING` |
| `pr_ready` + empty `review_records` on release-sensitive target | `requires_manual_policy_input` · `REVIEW_EVIDENCE_MISSING` |

`ready_for_human_review` means **human may review** — not agent merge authority.

When `review_records` is **omitted**, review-evidence rules are skipped (backward-compatible dry-run). When supplied (including `[]` on governed targets), verdicts and blockers are persisted in `production_boundary_check.review_evidence` — not chat-only.

---

## GitHub discovery (injectable)

When callers supply **complete** `github_discovery` (future: GitHub API adapter), branch policy uses `permission_visibility: full`. Partial discovery (missing rulesets/checks/reviews visibility or protected-branch proof) → `unknown` + fail-closed. Shape (illustrative):

```json
{
  "default_branch": "main",
  "protected_branches": ["main"],
  "target_is_protected": true,
  "rulesets_visible": true,
  "required_checks_visible": true,
  "required_reviews_visible": true
}
```

Fixture: `orchestrator/tests/fixtures/merge-governance/github-discovery-main-protected.json`.

---

## Tests

- `orchestrator/tests/merge-governance.test.js` — config, discovery, gate decisions, trace schema validation.

---

## Out of scope (this slice)

- Automatic hook on every `git` / `gh` shell invocation.
- Replacing GitHub branch protection.
- Agent direct merge as alpha default.
- Release tag governance (groomed backlog; not versioned here).

---

## Related

- [production-boundary-guard.md](production-boundary-guard.md)
- [governance-gates-contract.md](governance-gates-contract.md)
- [review-record-contract.md](review-record-contract.md)
