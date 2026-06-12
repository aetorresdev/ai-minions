# Release workflow (human / operator)

**Alpha discipline only.** Documents the **human-owned** steps to cut an alpha tag. **Not** full release automation — agents do not create protected releases, push tags, or publish GitHub releases by default.

**Governance record:** [release-governance-contract.md](release-governance-contract.md) · **Checklist:** [alpha-release-checklist.md](alpha-release-checklist.md)

---

## Roles

| Actor | Responsibility |
|-------|----------------|
| **Operator (human)** | Merge release-prep PR · run pre-tag gates · create tag · publish pre-release · sync `release` branch |
| **CERBERUS** | Pre-merge review on release-prep and lane PRs |
| **CI** | `lint-and-unit` · `security-trivy-scan` · `orchestrator-e2e` — must be green before tag |
| **Agent** | May open PRs and draft changelog text — **must not** treat merge as tag or release publish |

---

## Phases (pre-tag vs post-tag)

Checklist items and governance fields are **phase-bound**. Do not mark post-tag items complete before the artifact exists.

### Phase A — Release prep (pre-tag, on `master`)

**Goal:** All evidence that the tree is releasable **before** `git tag`.

| Step | Artifact / evidence | Checklist rule |
|------|----------------------|----------------|
| A1 | Lane PRs merged; `master` at intended commit | Must-have bundle rows checked with merge SHAs |
| A2 | `cd orchestrator && npm test` green on release-prep tree | Workspace validation log row |
| A3 | CI green: unit · trivy · e2e on **release-prep head**, **or** inherited from lane tip when release-prep is **doc-only** (`CHANGELOG.md` / `docs/**` only vs lane merge SHA) and path-filtered workflows did not re-run | Link to Actions run URLs on prep head **or** lane merge SHA with checklist note |
| A4 | `bash scripts/release-trivy-gate.sh` OK locally (optional duplicate of CI trivy) | Vulnerability gate row |
| A5 | Root `CHANGELOG.md` section drafted for target version | Changelog section id recorded — **draft OK pre-tag** |
| A6 | `alpha-release-checklist.md` version section: must-haves + forbidden claims | No `[x]` on tag / URL / branch until Phase B |
| A7 | CERBERUS **Approve** on release-prep PR | Verdict recorded in PR thread |
| A8 | Release-prep PR merged to `master` | `tag_commit` candidate = merge SHA |

**Forbidden before Phase A complete:** creating the git tag · publishing GitHub pre-release · claiming “released” in docs.

### Phase B — Tag and publish (post-tag, operator only)

**Goal:** External release artifacts exist; governance record can reach `evidence_status: complete`.

| Step | Artifact / evidence | Checklist rule |
|------|----------------------|----------------|
| B1 | Annotated tag on `tag_commit`: `git tag -a <version>` | Tag name matches governance `tag` |
| B2 | Push tag: `git push origin <version>` | Tag visible on remote |
| B3 | GitHub **pre-release** published at tag | `pre_release_url` — full HTTPS URL |
| B4 | `release` branch fast-forwarded to tag commit and pushed | `release_branch_commit` matches `tag_commit` |
| B5 | Governance record validated — see contract | `validateReleaseGovernanceRecord` → `ok: true` |
| B6 | Checklist execution plan: tag · URL · branch rows marked `[x]` | Only after B1–B4 verified |

**Changelog timing:** Section body is finalized in **Phase A** (release-prep PR). Tag date in the header may be adjusted at publish time; version string must match tag.

**Release branch timing:** Update `release` **after** tag exists — never before.

---

## Release-prep PR contents (template)

1. `CHANGELOG.md` — new version section (highlights, limitations, no forbidden claims).
2. `docs/orchestrator/alpha-release-checklist.md` — version block: scope, must-have SHAs, validation log placeholders, execution plan **targets** (worded as operator steps until Phase B).
3. No tag · no GitHub release · no force-push to `release` in the PR itself.

---

## Forbidden release claims

Do **not** state or imply in versioned docs or changelog:

- production-ready · production SLA · fully automated release pipeline
- agent-owned tags/releases by default · agent-as-maintainer for protected branches
- architecture refactor complete · full modular monolith enforced repo-wide
- unknown permissions or policy treated as safe

Alpha cuts remain **non-production** per [harness-engineering-positioning.md](harness-engineering-positioning.md).

---

## What this document is not

- Not a GitHub Actions workflow for tag publish
- Not branch-protection or ruleset configuration
- Not a substitute for [merge-governance-contract.md](merge-governance-contract.md) on PR boundaries

---

## Related

- [release-governance-contract.md](release-governance-contract.md) — evidence record + fail-closed validator
- [merge-governance-contract.md](merge-governance-contract.md) — PR-boundary gate
- `scripts/release-trivy-gate.sh` — local pre-tag vulnerability scan
