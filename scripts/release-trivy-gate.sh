#!/usr/bin/env bash
# Local pre-tag gate — same scope as CI workflow security-trivy-scan (aquasecurity/trivy-action).
#
# Machine-readable contract (stdout, always the last line before exit):
#   status=PASS     — scanner ran, published scope clean. Exit 0.
#   status=BLOCKED  — prerequisite missing (scanner not found), gate did not run. Exit 2.
#   status=FAIL     — scanner ran, found HIGH/CRITICAL fixed vulns or secrets. Exit 1.
#   status=SKIPPED  — explicit documented operator opt-out via RELEASE_TRIVY_GATE_SKIP_REASON.
#                     Exit 0. NOT used for a missing scanner by default — see below.
#
# A missing scanner is BLOCKED, never SKIPPED-by-accident and never PASS. SKIPPED only
# fires when the operator sets RELEASE_TRIVY_GATE_SKIP_REASON to a non-empty reason string,
# which is echoed back into release evidence for CERBERUS/operator audit.
#
# Env overrides:
#   TRIVY_BIN                     — path/name of the trivy binary (default: "trivy"). Lets
#                                    callers (tests, alt installs) point at a specific binary
#                                    without mutating PATH.
#   RELEASE_TRIVY_GATE_SKIP_REASON — non-empty string to explicitly skip a missing scanner.
#                                    Documented operator override only; not a CI default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TRIVY_BIN="${TRIVY_BIN:-trivy}"
SKIP_REASON="${RELEASE_TRIVY_GATE_SKIP_REASON:-}"

remediation() {
  cat >&2 <<'EOF'
release-trivy-gate: remediation
  Install Trivy locally (official docs): https://aquasecurity.github.io/trivy/latest/getting-started/installation/
    macOS (Homebrew):   brew install aquasecurity/trivy/trivy
    Debian/Ubuntu (apt): see install docs above for the aquasecurity apt repo
    Or download a release binary and put it on PATH / set TRIVY_BIN.
  Supported CI path (no local install required): GitHub Actions workflow
    .github/workflows/security-trivy-scan.yml (uses aquasecurity/trivy-action, pinned version;
    see docs/orchestrator/security-posture.md for the exact pin) provisions Trivy in CI and is
    the authoritative pre-merge scan. Local run is a convenience duplicate, not a substitute
    for CI on the merge SHA.
  Documented opt-out (use sparingly, recorded as SKIPPED — never PASS):
    RELEASE_TRIVY_GATE_SKIP_REASON="<why>" bash scripts/release-trivy-gate.sh
EOF
}

if ! command -v "$TRIVY_BIN" >/dev/null 2>&1; then
  if [[ -n "$SKIP_REASON" ]]; then
    echo "release-trivy-gate: SKIPPED — trivy ('$TRIVY_BIN') not found on PATH; operator override reason: $SKIP_REASON" >&2
    echo "release-trivy-gate: this run has NO vulnerability/secret evidence — CI security-trivy-scan on the merge SHA remains required" >&2
    echo "status=SKIPPED"
    exit 0
  fi
  echo "release-trivy-gate: BLOCKED — trivy ('$TRIVY_BIN') not found on PATH; prerequisite missing, gate did not run" >&2
  remediation
  echo "status=BLOCKED"
  exit 2
fi

echo "release-trivy-gate: using $("$TRIVY_BIN" --version 2>&1 | head -n1)" >&2

if command -v uv >/dev/null 2>&1; then
  for dir in mcp-servers/compact-handoff mcp-servers/orchestrator-state; do
    [[ -f "$dir/pyproject.toml" ]] && (cd "$dir" && uv lock --quiet)
  done
fi

if "$TRIVY_BIN" fs --config .trivy.yaml --scanners vuln,secret --ignore-unfixed --exit-code 1 .; then
  echo "release-trivy-gate: OK (HIGH/CRITICAL fixed vulns + secrets clean in published scope)"
  echo "status=PASS"
  exit 0
else
  echo "release-trivy-gate: FAIL — HIGH/CRITICAL fixed vulns or secrets found in published scope" >&2
  echo "status=FAIL"
  exit 1
fi
