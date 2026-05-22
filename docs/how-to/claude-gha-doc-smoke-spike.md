# Claude GitHub Action — operator docs smoke (spike)

**Status:** experimental spike (manual GitHub Actions only). **Not** a merge gate and **not** a substitute for [deterministic usage doc verification](../../.github/workflows/docs-usage-verify.yml) or the [TUI manual checklist](tui-manual-smoke-checklist.md).

## Purpose

Evaluate whether [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) (`workflow_dispatch`) can review README + usage how-to and return structured PASS/WARN/BLOCK findings without modifying the repository.

## Prerequisites

| Item | Notes |
|------|--------|
| Repository secret `ANTHROPIC_API_KEY` | Required for the LLM step; never commit keys |
| Admin on repo | To add secrets and run workflows |
| Cost awareness | Each dispatch consumes API tokens + Actions minutes |

## How to run

1. Ensure `docs-usage-verify` is green on `master` (or run locally: `node scripts/verify-usage-docs.mjs`).
2. In GitHub: **Actions** → **Claude doc smoke (spike)** → **Run workflow**.
3. Keep default `max_turns` (3) unless you have a reason to raise it.
4. Open the job log for the **LLM doc coherence review** step; copy the JSON object from the agent output.

## Expected output schema

```json
{
  "verdict": "PASS",
  "findings": [
    {
      "id": "invocation-cli-tui",
      "severity": "PASS",
      "file": "docs/how-to/usage-smoke-guide.md",
      "summary": "CLI and TUI paths are clearly separated."
    }
  ],
  "notes": "optional free text"
}
```

Severity per finding: `PASS`, `WARN`, or `BLOCK`. Top-level `verdict` is the worst severity across findings.

## Workflow file

`.github/workflows/claude-doc-smoke.yml`

- `permissions: contents: read`
- Tools limited via `--allowedTools Read,Grep,Glob`
- Runs deterministic `verify-usage-docs.mjs` first, then the Action step
- **No** `push` / `pull_request` triggers

## Decision (spike outcome)

| Option | When |
|--------|------|
| **Keep as manual spike** | Useful ad-hoc review; cost/latency too high for every PR |
| **Promote to product ticket** | Stable JSON artifact upload + schema validation in CI |
| **Discard** | Findings duplicate deterministic verify with no added value |

**Record the decision here after the first manual run** (date, workflow run URL, verdict, 1–2 sentences).

### Template (fill after first run)

```markdown
- **Date:**
- **Workflow run:**
- **Top-level verdict:**
- **Decision:** keep spike | promote | discard
- **Rationale:**
```

## Out of scope (explicit)

- Automatic PR creation or file edits from the Action
- Replacing `npm test` or orchestrator E2E
- TUI behavior validation (IDE-only)
- Secret isolation in agent `ENVIRONMENT ACCESS` blocks (runtime pre-existing; see environment-access.md)

## Related

- [Usage smoke guide](usage-smoke-guide.md)
- [Environment access contract](../orchestrator/environment-access.md)
