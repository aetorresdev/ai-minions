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

**Merge commits.** `git log -p` does not show a merge's own changes by default. The gate passes `-m`, which
diffs every merge against each of its parents (`scanner.merge_diffs: each-parent`). That covers a secret
introduced while resolving a merge, including conflict resolutions and octopus merges, even when it is
deleted later.

- `--remerge-diff` was rejected because Git skips it for octopus merges.
- A location reported more than once (once per parent) is deduplicated by fingerprint.
- Diffing against the first parent repeats everything the merged branch brought in. A finding on a merge
  commit is dropped as inherited only when that exact line already exists in the same file in one of the
  merge's parents. It is then reported at the commit that introduced it, when that commit is in scope.
  Lines the merge itself introduced are kept. The count is recorded as `result.merge_inherited_dropped`.
  Line text is compared in memory and never recorded.
- A consequence: in the `pr` scope, a PR that merges its base branch in is not charged for secrets already in
  the base. The `release` scope still reports them.

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
| `config_unpinned` | `.gitleaks.toml` does not match the pinned SHA-256 in the gate (`SCANNER_CONFIG_SHA256`). |
| `config_suppression` | The config carries a location allowlist (`paths`, `commits`) or an `[extend]` table. |
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
scanner: { name: gitleaks, adapter_version: 1, version, config_path, config_sha256, merge_diffs: each-parent, log_opts }
source: { repo, base_ref, head_ref, refs: [{ ref, commit }], commit_hash, log_range, commits_scanned }
baseline: { path, sha256, entries, expired: [fingerprint] }
result:
  status: PASS | FAIL | BLOCKED | SKIPPED
  reason_code:            # clean | clean_with_suppressions | secrets_detected | expired_suppression | BLOCKED codes | operator_skip
  findings_total:
  rules_triggered: { <rule_id>: count }
  suppressed_total:
  merge_inherited_dropped: # merge findings whose line already exists in a parent
  skip_reason:            # SKIPPED only
findings: [{ rule_id, commit, file, line, fingerprint }]
scanner_report_sha256:    # hash of the raw (redacted) scanner report
generated_at:
evidence_hash:            # sha256 of this document without evidence_hash
```

The validator checks every field and the relations between them. Recomputing `evidence_hash` is necessary
but not enough. It rejects:

- Missing or unknown keys at any level, and wrong types.
- `PASS` or `FAIL` without:
  - a scanner version, and the pinned config path and hash;
  - a report hash, the repo, and resolved refs;
  - a log range and `log_opts` consistent with those refs, for the scope;
  - `commits_scanned > 0`, and baseline identity.
- A status that contradicts its reason code or its counts:
  - `PASS` with findings or expired suppressions;
  - `clean_with_suppressions` with nothing suppressed;
  - `secrets_detected` with no findings;
  - `BLOCKED` with a reason code outside the table;
  - `SKIPPED` without a reason, or `skip_reason` set on another status.
- `rules_triggered` that does not match the findings.
- Findings whose fingerprint is not their own `commit:file:rule:line`, or that repeat a fingerprint.
- `merge_diffs` other than `each-parent`.
- A mismatched `evidence_hash`.

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
- The scanner config is fixed to the repository's `.gitleaks.toml`; there is no override variable. It is
  pinned by SHA-256, and it may not contain location allowlists or `[extend]` (see
  [Scanner configuration](#scanner-configuration)).

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

`.gitleaks.toml` is derived from the Gitleaks v8.30.1 default config (`config/gitleaks.toml`, sha256
`e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf`). It keeps all 222 upstream rules,
plus one appended rule. The derivation removes every **location-based allowlist**:

- the global `paths` list, which would otherwise skip `node_modules/`, lockfiles, images, virtualenvs and
  any file named `gitleaks.toml`;
- each rule-level allowlist that contains `paths`, in `generic-api-key`, `github-pat` and
  `github-fine-grained-pat`.

Using `[extend] useDefault = true` would bring those allowlists back, so `[extend]` is rejected.

One upstream rule is rewritten to an equivalent form. The `aws-amazon-bedrock-api-key-short-lived` regex ends
in `[t]` instead of `t`. It matches the same text, but the pattern literal no longer matches the config file
itself, which is scanned like any other file now that the path allowlist that skipped `gitleaks.toml` is
gone.

Upstream **value-shape filters** stay: per-rule `regexes`, `stopwords`, and the global placeholder regexes
such as `${VAR}`, `true` and `null`. They are part of how each rule decides a match is a secret, and they are
pinned with the rest of the file. They are also a known source of false negatives: a real value that looks
like a placeholder or contains a stopword can be missed.

Appended rule: `dotenv-secret-assignment`, for secret-named assignments in `.env` files. Without it, the
default `generic-api-key` rule drops some high-entropy values through its stopword filter, and the contract
tests reproduced such a miss.

Changing the config means editing `.gitleaks.toml` and updating `SCANNER_CONFIG_SHA256` in the gate, in the
same reviewed change. Otherwise the gate is `BLOCKED` (`config_unpinned`).

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
