# SCM secret-scan contract

**Contract version:** `scm_secret_scan_version: 1`
**Gate:** `scripts/scm-secret-scan.mjs`
**Scanner (adapter v1):** [Gitleaks](https://github.com/gitleaks/gitleaks) **8.30.1**, pinned with a SHA-256 checksum in
`.github/workflows/scm-secret-scan.yml`. The adapter accepts Gitleaks major version 8 only.

This gate looks for committed credentials in **Git history**: every commit in scope, including ones whose
secret was later deleted. The checked-out tree alone is not enough, because a secret removed from `master`
can still be reachable from tags, branches and PR commits.

The scanner is an adapter detail. Consumers such as a release gate or a security-control registry read the
normalized evidence below, never Gitleaks output. Replacing the scanner means writing a new adapter that
emits the same evidence and passes the same fixtures.

## Scopes

| Scope | Command | Commits scanned |
| --- | --- | --- |
| `pr` | `node scripts/scm-secret-scan.mjs --scope pr --base <rev> --head <rev>` | every commit in `base..head`, so a secret added and then deleted inside the PR still fails |
| `release` | `node scripts/scm-secret-scan.mjs --scope release --ref <candidate> [--ref <rev> ...]` | all history reachable from each listed ref |

**Release ref policy.** The release candidate is the tag commit, or the release-prep head before tagging.
Its reachable history includes the default branch history merged into it. Any extra refs that are
intentionally part of a release, such as a maintenance branch, are passed as additional `--ref` values and
recorded in `source.refs`.

**CI** (`scm-secret-scan` workflow, full-history checkout):

- Pull requests run the `pr` scope over the PR's base and head SHAs, plus the `release` scope over the PR
  head.
- Pushes to `master` and `v*` tags run the `release` scope over the pushed commit.
- `workflow_dispatch` accepts an explicit candidate ref.

## Status semantics

The last line on stdout is always `status=<VALUE>`. Status words and exit codes match
`scripts/release-trivy-gate.sh`.

| Status | Meaning | Exit |
| --- | --- | --- |
| `PASS` | A verified Gitleaks scanned every commit in scope and found nothing that the baseline does not suppress, and no suppression has expired. | `0` |
| `FAIL` | Findings remain after the baseline is applied (`secrets_detected`), or the baseline contains an expired suppression that needs review (`expired_suppression`). | `1` |
| `BLOCKED` | No scan evidence was produced. The `reason_code` says why. A missing scanner is `BLOCKED` unless the operator skips. | `2` |
| `SKIPPED` | Explicit operator opt-out: `SCM_SECRET_SCAN_SKIP_REASON` was non-empty after trimming while the scanner was missing. The reason is recorded in the evidence and printed. The run has **no** history-scan evidence. | `0` |

`BLOCKED` reason codes:

| Reason code | Cause |
| --- | --- |
| `invalid_arguments` | Bad or missing arguments, or `SCM_SECRET_SCAN_NOW` is not a date. |
| `not_a_git_repository` | The target is not a Git repository. |
| `shallow_history` | The clone is shallow; fetch full history first (CI uses `fetch-depth: 0`). |
| `ref_unresolvable` | A ref does not resolve to a commit. |
| `empty_scope` | The range has no commits. |
| `scanner_missing` | No scanner, and no skip reason was given. |
| `scanner_invalid` | The executable does not report a version or does not identify as gitleaks. |
| `scanner_unsupported_version` | The scanner's major version is not supported by this adapter. |
| `config_missing` | The scanner config is missing. |
| `baseline_missing` | The suppression baseline is missing. |
| `baseline_invalid` | The baseline is unreadable or fails validation. |
| `scanner_error` | The scanner exited with something other than 0 or 1. |
| `scanner_output_invalid` | The report is missing or malformed, or disagrees with the scanner's exit code. |
| `internal_error` | Unexpected error inside the gate. |

## Evidence (normalized)

Write it with `--out <file>`. Check any evidence file with
`node scripts/scm-secret-scan.mjs --validate <file>`, which prints `evidence=VALID` or `evidence=INVALID`.

```yaml
scm_secret_scan_version: 1
scope: pr | release
scanner: { name: gitleaks, adapter_version: 1, version, config_path, config_sha256 }
source: { repo, base_ref, head_ref, refs: [{ ref, commit }], commit_hash, log_range, commits_scanned }
baseline: { path, sha256, entries, expired: [fingerprint] }
result:
  status: PASS | FAIL | BLOCKED | SKIPPED
  reason_code:            # clean | clean_with_suppressions | secrets_detected | expired_suppression | BLOCKED codes | operator_skip
  findings_total:
  rules_triggered: { <rule_id>: count }
  suppressed_total:
  skip_reason:            # SKIPPED only
findings: [{ rule_id, commit, file, line, fingerprint }]
scanner_report_sha256:    # hash of the raw (redacted) scanner report
generated_at:
evidence_hash:            # sha256 of this document without evidence_hash
```

The validator rejects:

- `PASS` or `FAIL` without a scanner version, a 40-hex commit, `commits_scanned > 0`, and config and report
  hashes;
- `PASS` that carries findings;
- `SKIPPED` without a reason;
- findings with fields other than the five listed;
- a mismatched `evidence_hash`.

## Privacy of findings

- The scanner always runs with full redaction (`--redact`).
- The adapter keeps only rule id, commit, file, line and Gitleaks' fingerprint (`commit:file:rule:line`).
  Matched text, the source line, entropy and author data are dropped before evidence or logs are written.
- Console output, the CI job summary and the evidence artifact contain locations only. A reviewer can find a
  value with `git show <commit>:<file>` locally, without it appearing in CI.
- Fixtures are synthetic. The contract tests generate them at runtime from a fixed-seed PRNG and assemble
  them from fragments, so the repository holds no secret-shaped literal.

## Baseline and suppressions

The baseline is `.scm-secret-scan-baseline.json`, versioned and reviewed like code. Suppression is
possible **only** through this file:

- Inline `gitleaks:allow` comments are ignored (`--ignore-gitleaks-allow`).
- `.gitleaksignore` files are ignored, because the gate points `--gitleaks-ignore-path` at an empty
  directory.
- `.gitleaks.toml` carries rules only, not allowlists.

```json
{
  "scm_secret_scan_baseline_version": 1,
  "suppressions": [
    {
      "rule_id": "github-pat",
      "finding_fingerprint": "<40-hex commit>:<file>:<rule_id>:<line>",
      "justification": "why this is not a live credential (>= 10 chars)",
      "owner": "team or person accountable",
      "created_at": "YYYY-MM-DD",
      "expires_at": "YYYY-MM-DD or null",
      "scope": ["pr", "release"]
    }
  ]
}
```

- The fingerprint pins one commit, file, rule and line. Wildcards, unknown keys (so no raw value can be
  stored) and duplicates make the baseline `BLOCKED` with reason `baseline_invalid`.
- A new commit carrying the same file produces a new fingerprint, so it cannot inherit an old suppression.
- A suppression applies only to the scopes it lists, and only when its `rule_id` matches the finding.
- An entry with `expires_at` before today never suppresses, and its presence makes the run `FAIL`
  (`expired_suppression`) until it is reviewed: renewed with a new date, or removed.

## Scanner configuration

`.gitleaks.toml` extends the Gitleaks default ruleset. It adds one rule, `dotenv-secret-assignment`, for
secret-named assignments in `.env` files. Without it, the default `generic-api-key` rule drops some
high-entropy values through its stopword filter, and the contract tests reproduced such a miss.

Fixture classes the contract tests prove, using the expected rule ids:

| Class | Rule |
| --- | --- |
| AWS access key | `aws-access-token` |
| GitHub token | `github-pat` |
| OpenAI key | `openai-api-key` |
| Anthropic key | `anthropic-api-key` |
| Bearer token (curl header) | `curl-auth-header` |
| Private key material | `private-key` |
| `.env` assignment | `dotenv-secret-assignment` |

## What this gate does not cover

- It does not cover untracked local files, process environments, caches, CI secrets or external services. A
  clean history scan is not evidence that running agents are isolated from credentials.
- It does not rewrite history or rotate credentials. Remediation of a real leak is rotation by a human
  owner, plus history cleanup where policy requires it.
- It does not replace runtime privacy scanning (`SensitiveDataScanner`), trace redaction, the credential
  broker, or the Trivy gate. Those remain separate authorities.
- The Trivy `secret` scanner in `security-trivy-scan` reads the current tree only, so its `PASS` is not a
  repository-history secret scan `PASS` and must not be cited as one. The changelog release-section
  validator enforces this. It rejects a release section that claims a secret-scan `PASS` without citing
  `scm-secret-scan`, with error `forbidden:secret_scan_pass_without_history_evidence`.
- Detection is pattern-based. Formats outside the ruleset are false negatives.

## Tests

```sh
GITLEAKS_BIN=/path/to/gitleaks SCM_SECRET_SCAN_REQUIRE_SCANNER=1 node --test tests/scm-secret-scan.test.mjs
```

Without a scanner, the scanner-backed suites are reported as skipped. With
`SCM_SECRET_SCAN_REQUIRE_SCANNER=1`, which CI sets, they run and fail if the scanner is missing.
