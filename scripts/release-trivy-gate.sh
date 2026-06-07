#!/usr/bin/env bash
# Local pre-tag gate — same scope as CI workflow security-trivy-scan (aquasecurity/trivy-action).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v trivy >/dev/null 2>&1; then
  echo "release-trivy-gate: trivy not found on PATH" >&2
  exit 2
fi

if command -v uv >/dev/null 2>&1; then
  for dir in mcp-servers/compact-handoff mcp-servers/orchestrator-state; do
    [[ -f "$dir/pyproject.toml" ]] && (cd "$dir" && uv lock --quiet)
  done
fi

trivy fs --config .trivy.yaml --scanners vuln,secret --ignore-unfixed --exit-code 1 .

echo "release-trivy-gate: OK (HIGH/CRITICAL fixed vulns + secrets clean in published scope)"
