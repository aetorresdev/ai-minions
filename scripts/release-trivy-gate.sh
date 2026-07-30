#!/usr/bin/env bash
# Local pre-tag gate — same scope as CI workflow security-trivy-scan (aquasecurity/trivy-action).
#
# Machine-readable contract (stdout, always the last line before exit):
#   status=PASS     — scanner ran, published scope clean. Exit 0.
#   status=BLOCKED  — prerequisite / operational failure (scanner missing, not a real
#                     Trivy binary, uv lock failure, scanner error other than findings).
#                     Gate did not produce PASS/FAIL scan evidence. Exit 2.
#   status=FAIL     — real Trivy ran and reported HIGH/CRITICAL fixed vulns or secrets
#                     via its reserved findings exit code (1). Exit 1.
#   status=SKIPPED  — explicit documented operator opt-out via RELEASE_TRIVY_GATE_SKIP_REASON
#                     (non-empty after trim). Exit 0. NOT used for a missing scanner by default.
#
# A missing or fake scanner is BLOCKED, never SKIPPED-by-accident and never PASS. SKIPPED only
# fires when the operator sets RELEASE_TRIVY_GATE_SKIP_REASON to a non-empty (after trim) reason
# string, which is echoed back into release evidence for CERBERUS/operator audit.
#
# Env overrides:
#   TRIVY_BIN                     — path/name of the trivy binary (default: "trivy"). Lets
#                                    callers (tests, alt installs) point at a specific binary
#                                    without mutating PATH. Must respond to --version with
#                                    output matching "trivy" (case-insensitive); otherwise BLOCKED.
#   RELEASE_TRIVY_GATE_SKIP_REASON — non-empty (after trim) string to explicitly skip a missing
#                                    scanner. Documented operator override only; not a CI default.
#
# Exit-code contract for the scanner itself:
#   0 — clean (PASS)
#   1 — findings (FAIL) — reserved; only a validated Trivy binary may produce this gate status
#   other — operational error → BLOCKED (never FAIL)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TRIVY_BIN="${TRIVY_BIN:-trivy}"
# Trim surrounding whitespace; whitespace-only reasons are not SKIPPED.
SKIP_REASON="$(printf '%s' "${RELEASE_TRIVY_GATE_SKIP_REASON:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

emit_blocked() {
  local msg="$1"
  echo "release-trivy-gate: BLOCKED — $msg" >&2
  remediation
  echo "status=BLOCKED"
  exit 2
}

remediation() {
  cat >&2 <<'EOF'
release-trivy-gate: remediation
  Install Trivy locally (official docs): https://trivy.dev/docs/latest/getting-started/installation/
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
  emit_blocked "trivy ('$TRIVY_BIN') not found on PATH; prerequisite missing, gate did not run"
fi

# Reject arbitrary executables masquerading as Trivy (/bin/true → fake PASS, /bin/false → fake FAIL).
version_out=""
version_rc=0
version_out="$("$TRIVY_BIN" --version 2>&1)" || version_rc=$?
if [[ "$version_rc" -ne 0 ]] || ! printf '%s' "$version_out" | grep -qi 'trivy'; then
  emit_blocked "TRIVY_BIN ('$TRIVY_BIN') is not a usable Trivy binary (--version must succeed and mention trivy)"
fi
echo "release-trivy-gate: using $(printf '%s\n' "$version_out" | head -n1)" >&2

if command -v uv >/dev/null 2>&1; then
  for dir in mcp-servers/compact-handoff mcp-servers/orchestrator-state; do
    if [[ -f "$dir/pyproject.toml" ]]; then
      if ! (cd "$dir" && uv lock --quiet); then
        emit_blocked "uv lock failed in $dir (operational prerequisite; gate did not scan)"
      fi
    fi
  done
fi

scan_rc=0
"$TRIVY_BIN" fs --config .trivy.yaml --scanners vuln,secret --ignore-unfixed --exit-code 1 . || scan_rc=$?

case "$scan_rc" in
  0)
    echo "release-trivy-gate: OK (HIGH/CRITICAL fixed vulns + secrets clean in published scope)"
    echo "status=PASS"
    exit 0
    ;;
  1)
    echo "release-trivy-gate: FAIL — HIGH/CRITICAL fixed vulns or secrets found in published scope" >&2
    echo "status=FAIL"
    exit 1
    ;;
  *)
    emit_blocked "trivy exited $scan_rc (operational/scanner error; not treated as findings)"
    ;;
esac
