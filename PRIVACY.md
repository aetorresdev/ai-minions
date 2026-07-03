# Beta privacy notice — feedback, traces, and evidence bundles

**Audience:** operators, internal dry-run testers, and future external beta testers submitting feedback to the ai-minions project.

**This is not legal advice.** It describes project practices for alpha/beta feedback. It is **not** a hosted SaaS Terms of Service, DMCA policy, or compliance certification.

**Related:** [beta claim and blast radius](docs/how-to/beta-claim-blast-radius.md) · [trace privacy contract](docs/orchestrator/trace-privacy-contract.md) · [privacy sanitize gate](docs/orchestrator/privacy-sanitize-gate-contract.md) · [security posture](docs/orchestrator/security-posture.md)

---

## Two different things

| Layer | What it does | What it does **not** do |
|-------|--------------|-------------------------|
| **Runtime privacy scan** (`PRIVACY_*` gate) | Regex-based scan/redaction on **some** outbound remote prompts and bundle `shareable/` artifacts | Catch every secret shape, every file type, or every paste you make manually |
| **This notice** | Tells you what may be submitted, what to avoid, and what happens when you file public GitHub issues | Replace your judgment or your org's policies |

Do **not** read runtime scanning as “upload anything — we guarantee it is safe.” The scanner does not guarantee complete protection.

---

## What you may submit during beta feedback

When filing operator feedback or attaching evidence, you may include:

- `task_id`, repo commit SHA, command sequence, exit codes
- Redacted trace excerpts, inspect reports, runner panel captures
- Reason codes (`PREFLIGHT_*`, `OPERATOR_*`, `INSPECT_*`, `BUNDLE_*`, gate codes)
- Bundle files from `collect-run-report.mjs` **after you review them**

Prefer the bundle's `shareable/` directory when present — it reflects privacy-scan output on text artifacts. **Still review before upload.**

---

## What ai-minions does not intentionally collect

The project does **not** operate a centralized telemetry SaaS for alpha/beta. Maintainers do **not** intentionally solicit:

- Passwords, API keys, tokens, connection strings, or `.env` file contents
- Private customer data unrelated to reproducing a harness issue
- Full home-directory paths when repo-relative paths suffice

Local traces and bundles stay on **your machine** until **you** choose to share them.

---

## What traces and bundles can contain

Even when you run locally, artifacts may include:

| Artifact | May contain |
|----------|-------------|
| Trace JSONL (`~/.claude/metrics/traces/` by default) | Goals, task text, tool summaries, permission decisions, token usage metadata |
| Bundle `trace/*.jsonl` | Copy of the above |
| `artifacts/*.txt` panels | CLI stdout/stderr from status/trace/budget/explain |
| `ATTACH.md` / `manifest.json` | Structured fields for GitHub issue pre-fill |
| `privacy-scan.json` | Scan status and redaction **counts** — not secret values |

Goals and prompts you typed may appear in traces. Treat bundles as **sensitive until redacted**.

---

## Secrets — do not upload

Do not upload secrets. **Never** attach or paste into GitHub issues:

- `.env`, `.env.local`, credential JSON, kubeconfig, SSH keys
- Live API keys (`sk-…`, `ghp_…`, `AKIA…`, Bearer tokens)
- Passwords or connection strings with embedded credentials
- Raw chat logs from unrelated sessions

If you are unsure whether a field is safe, **omit it** and describe the symptom with reason codes instead.

---

## Runtime sanitization (honest limits)

When enabled, the privacy sanitize gate:

- Scans **some** outbound remote paths and bundle text artifacts with regex heuristics
- May redact email/phone-shaped PII and common secret patterns into `shareable/`
- May **block** remote send with `PRIVACY_SCAN_FAILED_BLOCKED` when scan fails
- Does **not** guarantee zero leakage — novel encodings, binary files, screenshots, or manual paste can bypass scanning

Details: [privacy-sanitize-gate-contract.md](docs/orchestrator/privacy-sanitize-gate-contract.md).

---

## GitHub issues are public

The [operator feedback issue template](.github/ISSUE_TEMPLATE/operator-feedback.yml) creates **public** GitHub issues unless you use a different channel your org provides.

| Channel | Visibility |
|---------|------------|
| GitHub issue (default beta feedback path) | **Public** — search engines, forks, mirrors |
| Security vulnerabilities | Follow [security-posture.md](docs/orchestrator/security-posture.md) — **do not** file secrets in public issues |

There is no project-operated private support queue for alpha/beta.

---

## Retention and deletion

| Data | Typical retention |
|------|-------------------|
| Local traces/bundles on your machine | Until **you** delete them |
| GitHub issues you file | Until you or maintainers close/delete per GitHub policy |
| Maintainer copies of attachments | Best-effort review only — no SLA |

To request removal of content **you** posted in a public issue, edit or ask maintainers to redact the issue on GitHub. The project cannot delete data you kept locally.

**Contact:** open a GitHub issue (redacted) or use your org's security contact for vulnerability disclosure — not for production support.

---

## Third-party and model providers

When you run with remote models or external APIs:

- Their terms apply to data sent to **their** services
- ai-minions permission gates reduce scope but do **not** replace provider contracts
- You are responsible for whether a given run may send data off-machine

---

## Before you attach a bundle

1. Read [beta-known-limitations § Redaction](docs/how-to/beta-known-limitations.md#redaction-policy-before-upload).
2. Run `collect-run-report.mjs` and inspect `privacy-scan.json` + `shareable/`.
3. Remove paths, tokens, and customer data manually.
4. File feedback: [operator-feedback-issue.md](docs/how-to/operator-feedback-issue.md).

Side-effect honesty for beta-exposed actions: [beta-claim-blast-radius.md](docs/how-to/beta-claim-blast-radius.md).

---

## Not claimed

- Full legal compliance coverage for your jurisdiction
- Guaranteed secret prevention in all attachments
- Private-by-default feedback storage
- Production support SLA or data processing agreement
