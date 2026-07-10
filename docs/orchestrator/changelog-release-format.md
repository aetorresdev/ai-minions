# Changelog release section format (alpha)

**Scope:** root [`CHANGELOG.md`](../../CHANGELOG.md) sections for **tagged alpha pre-releases** (`vX.Y.Z-alpha.N`). Release-prep PRs must follow this layout.

**Validator:** `orchestrator/scripts/lib/changelog-release-section.js` · contract tests in `changelogReleaseFormat.test.js`

**Operator version sync:** `orchestrator/modules/operator/product-version.js` (`PRODUCT_VERSION`) must match the latest tagged changelog section — `orchestrator/scripts/lib/product-version-sync.js` · `productVersionSync.test.js` · `scripts/verify-usage-docs.mjs`

**Related:** [release-workflow.md](release-workflow.md) step A5 · [alpha-release-checklist.md](alpha-release-checklist.md)

---

## Profiles

| Profile | Applies to | Enforcement |
|---------|------------|-------------|
| **alpha** | `v0.6.0-alpha.1` and later | Human release-prep follows full layout below; **automated** checks enforce [mandatory markers](#validator-scope-automated) only |
| **legacy** | `v0.1.0-alpha.1` … `v0.5.0-alpha.1` | **Frozen historical archive** — keep as-shipped; validator skips them; **no** retroactive normalization in normal release workflow or this PR |

**Legacy hygiene (out of scope):** normalizing v0.1–v0.5 to the alpha profile requires a **dedicated hygiene-only pass** with **no** release-governance behavior changes — not bundled with format contracts or release cuts.

---

## Validator scope (automated)

`validateChangelogReleaseFormat()` enforces **mandatory alpha markers** (presence + order) and a small set of machine-checkable rules. It does **not** enforce every human guideline in this doc.

| Check | Enforced in CI |
|-------|----------------|
| Header `## [version] - YYYY-MM-DD` | yes |
| Markers in order: `Release claim` → `Prerequisite` → `Since [` → delta table → `Release` → `Evidence` → `Alpha limitations` → `### Added` | yes |
| Summary paragraph (min length) | yes |
| Evidence mentions `npm test` | yes |
| Evidence mentions Trivy (`release-trivy-gate` or `security-trivy-scan`) | yes (alpha profile) |
| No ticket/backlog IDs in section body | yes |
| `PRODUCT_VERSION` matches latest tagged changelog section | yes (`productVersionSync.test.js`, `verify-usage-docs.mjs`) |
| Delta table includes Focus + Unit tests rows | **no** — CERBERUS / operator review |
| Every evidence bullet from [Evidence bullets](#evidence-bullets) | **no** — CERBERUS / operator review |
| Forbidden claim phrases (production-ready, full automation, …) | **no** — CERBERUS / operator review |
| `### Added` has ≥1 bullet | **no** — CERBERUS / operator review |

---

## Alpha profile — mandatory block order (human + CERBERUS)

Sections use [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories at the end. **Do not reorder** the metadata blocks below.

| # | Block | Required | Notes |
|---|--------|----------|-------|
| 1 | `## [version] - YYYY-MM-DD` | yes | ISO date; version must match git tag |
| 2 | Summary paragraph | yes | One paragraph: ordinal + theme + primary deliverables (no ticket IDs) |
| 3 | `**Release claim:**` | yes | What operators get; end with explicit **not** limitations |
| 4 | `**Prerequisite:**` | yes | Prior tag + `@` merge/tag SHA when applicable |
| 5 | `**Since [prev]:**` | yes | Narrative delta vs previous alpha |
| 6 | Delta table | yes | `\| Area \| \`prev\` \| \`current\` (delta) \|` — at least Focus + Unit tests rows |
| 7 | `**Release:**` | yes | Full HTTPS URL; pre-tag: *reserved* wording; post-tag: `pre-release published @ tag \`sha\`` |
| 8 | `**Evidence (operator):**` | yes | Bullet list — see [Evidence bullets](#evidence-bullets) |
| 9 | `**Alpha limitations (not production):**` | yes | Bullet list of **Not** claims |
| 10 | `### Added` | yes | At least one bullet |
| 11 | `### Changed` | if applicable | Omit section entirely when empty |
| 12 | `### Security` | if applicable | Omit when nothing material |
| 13 | `### Notes` | if applicable | Follow-ups, process notes, post-cut reminders |

**Forbidden:** ticket/backlog IDs in product text · production-ready claims · implying full automation for tag/release publish.

---

## Evidence bullets

Minimum set for alpha cuts from **v0.6** onward:

```markdown
**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **PASS/TOTAL** pass (N skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: {comma-separated contract doc filenames or paths}
- Lane/tag: `master` @ `{lane_sha}`; release-prep @ `{prep_sha}`; tag @ `{tag_sha}` (adjust for Phase A vs post-cut)
- CI: {workflow names} — green on {context SHA or PR}
```

Older alphas may list strict E2E or hook counts instead of Trivy when that gate did not exist yet (legacy profile only).

---

## Copy-paste template (release-prep)

Replace `{…}` placeholders. Delete optional sections if unused.

```markdown
## [{version}] - {date}

{Nth} alpha pre-release: **{theme}** — {comma-separated primary deliverables}.

**Release claim:** {what operators get} — **not** {forbidden claim 1}, **not** {forbidden claim 2}.

**Prerequisite:** `{prev_version}` @ `{prev_sha}`.

**Since [{prev_version}]:** {prev focus sentence}. {current} adds {delta sentence}. {explicit out-of-scope reminder}.

| Area | `{prev_version}` | `{version}` (delta) |
|------|------------------|----------------------|
| Focus | {prev focus} | {current focus} |
| {domain row} | {prev} | {current delta} |
| Unit tests (evidence) | {prev count} | {current count} |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/{version}` — *URL reserved on release-prep commit (not live until tag + pre-release)*

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **{pass}/{total}** pass ({skipped} skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `{contract-doc-1}.md`, …
- Lane merged on `master` @ `{lane_sha}`; release-prep on this commit (pending merge)
- CI: lint-and-unit, security-trivy-scan, orchestrator-e2e — green on lane merge @ `{lane_sha}`

**Alpha limitations (not production):**

- **Not** …

### Added

- …

### Security

- …

### Notes

- …
```

Post-cut: update `**Release:**` line to live pre-release wording and evidence lane/tag bullets per [release-workflow.md](release-workflow.md) Phase B.

---

## GitHub pre-release notes

Use a **short** summary (3–5 lines) + link to the CHANGELOG section. Do not duplicate the full delta table in GitHub release body.

---

## CERBERUS checks

- Reject release-prep if **automated markers** are missing or out of order (validator)
- Reject claim drift (changelog fields must match shipped contracts) — human review
- Reject ticket IDs in versioned changelog product text (validator + review)
- Reject missing evidence sub-bullets, weak delta table, or forbidden claims — human review per sections above not in validator scope
