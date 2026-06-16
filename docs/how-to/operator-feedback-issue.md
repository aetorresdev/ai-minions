# Operator feedback — GitHub issue template

Official GitHub issue form for **operator-path feedback** after v0.11 entry + v0.12 operator UX. Use when a report bundle alone is not enough context for maintainers.

**Template file:** [`.github/ISSUE_TEMPLATE/operator-feedback.yml`](../../.github/ISSUE_TEMPLATE/operator-feedback.yml)

**Prerequisites:** [beta known limitations](beta-known-limitations.md) · [beta tester guide](beta-tester-guide.md) (internal dry-run) · [operator guided run](operator-guided-run.md) · [collect run report](collect-run-report.md)

---

## When to use

| Use this template | Use something else |
|-------------------|-------------------|
| Blocked or confused on `runner:tui` guided path | General docs typo → standard issue or PR |
| Inspect/report bundle shows `INSPECT_*` or `BUNDLE_*` failures | Security vulnerability → private disclosure per [security-posture](../orchestrator/security-posture.md) |
| Usability friction on operator scripts | Harness architecture debate → discussion, not operator feedback |

**Not claimed:** production support SLA · external beta program · automatic upload from bundle script.

---

## Recommended flow

1. Reproduce on a clean clone when possible — [bootstrap-preflight](bootstrap-preflight.md).
2. Complete the operator path — [operator-guided-run](operator-guided-run.md).
3. Collect bundle: `node scripts/collect-run-report.mjs <task_id>` from repo root.
4. Open **New issue** → **Operator feedback (runner:tui)** on GitHub.
5. Copy fields from bundle `ATTACH.md` where they match (task id, commit, blockers, severity).
6. Attach redacted bundle files or paste relevant excerpts — **never** raw `.env` or secrets.

---

## Field map (template ↔ bundle)

| GitHub form field | Bundle / script source |
|-------------------|------------------------|
| Task ID | Run output · `manifest.json` · `ATTACH.md` |
| Repo commit | `manifest.json` · `git rev-parse --short HEAD` |
| Operator path | How you entered (guided run, bootstrap, primary smoke) |
| Inspect verdict | `ATTACH.md` PASS/FAIL line · `inspect-report.json` |
| Steps / Expected / Actual | Your reproduction notes |
| Report bundle path | `collect-run-report` output directory |
| Inspect blockers | `ATTACH.md` § Inspect blockers · `INSPECT_*` / `BUNDLE_*` codes |
| Severity | BLOCKER · BUG · USABILITY · DOCS |

Alignment with dynamic `ATTACH.md` file tables is maintained by `collect-run-report.mjs` — field values pre-fill the GitHub issue form.

---

## Severity guide

| Severity | When |
|----------|------|
| **BLOCKER** | Cannot complete preflight → launch → status → result without maintainer chat |
| **BUG** | Wrong exit code, trace missing, script crash — reproducible |
| **USABILITY** | Confusing help, discoverability, error message clarity |
| **DOCS** | Operator how-to wrong or missing — link the doc path |

---

## Out of scope for this template

- Automatic zip upload or GitHub API attachment from `collect-run-report.mjs`
- External tester onboarding (internal dry-run only until beta gate)
- Model governance / architecture refactor requests

---

## Related

- [Beta known limitations](beta-known-limitations.md)
- [Collect run report](collect-run-report.md)
- [Usage smoke guide — Bug report template](usage-smoke-guide.md#bug-report-template) (non-bundle manual report)
