# Release governance contract

Explicit evidence bundle for **alpha tag cuts** after merge governance. **Fail-closed:** missing or unknown evidence blocks treating a release as complete. **Not** full automation — human operator attests and publishes.

**Workflow:** [release-workflow.md](release-workflow.md) · **Checklist:** [alpha-release-checklist.md](alpha-release-checklist.md)

---

## Role

| Layer | Owner |
|-------|-------|
| PR merge / code on `master` | Human (+ agent as contributor) |
| Tag · pre-release · `release` branch | **Human operator only** |
| Evidence validation | `orchestrator/scripts/lib/release-governance-record.js` |
| CERBERUS | Pre-merge review on release-prep |

---

## Release governance record

Operator-filled object (JSON or checklist table) after Phase B of the release workflow.

| Field | Type | Phase | Notes |
|-------|------|-------|-------|
| `version` | string | pre-tag | Semver tag name, e.g. `v0.8.0-alpha.1` |
| `tag` | string | post-tag | Must equal `version` |
| `tag_commit` | string | pre-tag | Full or short SHA on `master` when tagged |
| `changelog_section` | string | pre-tag | Header line in root `CHANGELOG.md`, e.g. `[0.8.0-alpha.1] - 2026-06-12` |
| `pre_release_url` | string | post-tag | HTTPS GitHub release URL for this tag |
| `release_branch_commit` | string | post-tag | SHA of `release` branch tip — must match `tag_commit` |
| `evidence_status` | `"complete"` \| `"incomplete"` | post-tag | Only `complete` passes validation |
| `operator` | string (optional) | post-tag | Who published / attested |

**Unknown state:** omitting `evidence_status` or using any value other than `complete` / `incomplete` is treated as **unknown** → **block**.

---

## Validator (fail-closed)

```javascript
const { validateReleaseGovernanceRecord } = require("./scripts/lib/release-governance-record");

const result = validateReleaseGovernanceRecord({
  version: "v0.8.0-alpha.1",
  tag: "v0.8.0-alpha.1",
  tag_commit: "89a10d8",
  changelog_section: "[0.8.0-alpha.1] - 2026-06-12",
  pre_release_url: "https://github.com/org/repo/releases/tag/v0.8.0-alpha.1",
  release_branch_commit: "89a10d8",
  evidence_status: "complete",
});
// result.ok === true → allow_tag_publish
// result.ok === false → block (errors list missing/invalid fields)
```

| `decision` | Meaning |
|------------|---------|
| `allow_tag_publish` | All required fields present · `evidence_status === "complete"` · URL scheme valid |
| `block` | Missing field · incomplete evidence · unknown status · invalid URL |

**Invariant:** Unknown or partial evidence is **never** upgraded to safe. Operators must not mark checklist tag/URL/branch rows `[x]` until the validator passes with a post-tag record.

---

## Checklist integration

In [alpha-release-checklist.md](alpha-release-checklist.md) per-version sections:

1. **Pre-tag block** — must-have merges, CI URLs, changelog section id, CERBERUS verdict. **No** `[x]` on tag, pre-release URL, or `release` branch until post-tag.
2. **Release execution plan** — wording: *targets and operator steps*, not claims that tag/release/branch already exist.
3. **Post-tag** — fill governance record · run validator · then check execution plan items.

---

## Out of scope

- GitHub API automation for releases
- Agent-owned protected tag push
- Replacing human approval for publish
- Production SLA or production-ready claims

---

## CERBERUS checks

- Reject release-prep PR that marks post-tag items complete without artifacts
- Reject docs claiming full release automation
- Reject `evidence_status: complete` without matching `pre_release_url` and branch SHA

---

## Related

- [release-workflow.md](release-workflow.md)
- [merge-governance-contract.md](merge-governance-contract.md)
- `orchestrator/tests/releaseGovernanceContract.test.js`
