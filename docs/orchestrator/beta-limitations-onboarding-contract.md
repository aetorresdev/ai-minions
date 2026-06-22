# Beta limitations and onboarding (contract)

Operator how-to: [beta-known-limitations.md](../how-to/beta-known-limitations.md) · [beta-tester-guide.md](../how-to/beta-tester-guide.md).

## Purpose

Define honest **limitations** and the **onboarding doc chain** for internal beta dry-run (v0.15 gate hardening). Prepares operators for future external cohort without opening external beta or claiming production SLA.

## Onboarding chain (read order)

1. [beta-known-limitations.md](../how-to/beta-known-limitations.md) — shipped surface, not-claimed table, prohibited wording.
2. [beta-degraded-mode-policy.md](../how-to/beta-degraded-mode-policy.md) — when runs disqualify beta success.
3. [beta-smoke-matrix.md](../how-to/beta-smoke-matrix.md) — minimum gate cells (maintainer evidence; not automatic CI merge gate).
4. [beta-tester-guide.md](../how-to/beta-tester-guide.md) — end-to-end dry-run runbook.
5. [beta-dry-run-checklist.md](../how-to/beta-dry-run-checklist.md) — scorable checklist + exit bar.
6. [operator-feedback-issue.md](../how-to/operator-feedback-issue.md) — GitHub issue form after bundle.

**Prerequisite depth:** [trace-privacy-contract.md](./trace-privacy-contract.md) · [privacy-sanitize-gate-contract.md](./privacy-sanitize-gate-contract.md) before attaching artifacts.

## Honest boundaries (required statements)

Docs in this bundle must state:

- **Alpha** — no production SLA, no support promise, no hosted control plane.
- **Internal dry-run only** — external usability beta not open until **v0.20.0-beta.1** (after **v0.16.0-alpha.1** runtime boundary completion, **v0.17.0-alpha.1** modular closeout, **v0.18.0-alpha.1** standard operator UX, and **v0.19.0-alpha.1** human-ready rehearsal).
- **Manual clone** — no global installer or curl one-liner.
- **`runner:tui` is CLI MVP** — not a production TUI or web UI.
- **Degraded runs** — `--skip-gates` and related paths are diagnostic; disqualifying degraded runs cannot back smoke-matrix PASS.

## Redaction policy (explicit)

Before any GitHub issue, paste, or upload:

| Never attach | Action |
|--------------|--------|
| `.env`, credential files, API keys, PATs, bearer tokens | Remove file; redact string values |
| Raw secrets in trace excerpts | Use bundle after review; strip unmatched secret shapes |
| Full home-directory paths with usernames | Prefer repo-relative paths in issues |

**Contracts:** writer/read redaction ([trace-privacy-contract.md](./trace-privacy-contract.md)); outbound scan on remote paths ([privacy-sanitize-gate-contract.md](./privacy-sanitize-gate-contract.md) · `PRIVACY_*` codes).

**Bundle workflow:** `collect-run-report.mjs` produces local `ATTACH.md` — operator copies manually; no automatic GitHub upload.

## Unsupported behavior

- Announcing external beta open or GA / SLA support promises from this doc bundle.
- Treating dry-run PASS as external-beta gate satisfaction without smoke-matrix + degraded-mode review (`disqualifies_beta_success` must be reviewed).
- Attaching unredacted bundles to public issues.

## Out of scope (this slice)

- External tester cohort launch (→ later beta release).
- README-wide verify/claim wiring (→ follow-on verify slice).
- Runtime behavior changes.
