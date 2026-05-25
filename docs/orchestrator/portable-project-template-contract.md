# Portable project template contract

**Export/import** of project-level ai-minions configuration under a consumer repo (`--cwd`). Produces a **scrubbed JSON bundle**; import is **dry-run only** in v0.1.x (no file writes, no runtime default changes).

## CLI

From `orchestrator/`:

```bash
npm run project-template -- export --cwd /path/to/app --out /tmp/ai-minions-project.json
npm run project-template -- import --dry-run --cwd /path/to/other-app --file /tmp/ai-minions-project.json
```

## Bundle format (`portable_project_template_version` **0.1**)

| Field | Purpose |
|-------|---------|
| `harness_refs` | Read-only references to built-in roles, capability matrix version/path, routing policy doc, `models.json` profile names |
| `project_files` | Scrubbed copies of project files (relative paths only) |
| `doc_pointers` | Labels + relative paths from optional `.ai-minions/doc-pointers.json` |
| `scrub` | Redaction tally; export fails if secret-shaped values remain |

### Project files collected

| Relative path | Required |
|---------------|----------|
| `minions.md` | Optional |
| `.ai-minions/permissions.yaml` | Optional |
| `.ai-minions/doc-pointers.json` | Optional |

Optional `doc-pointers.json` schema:

```json
{
  "doc_pointers_version": "0.1",
  "entries": [
    { "label": "Usage guide", "relative_path": "docs/how-to/usage-smoke-guide.md" }
  ]
}
```

## Secret scrubbing

- Reuses trace redaction patterns (`Bearer`, `sk-`, AWS keys, GitHub PAT, Slack tokens, URL creds).
- YAML/JSON keys whose names contain `secret`, `password`, `token`, `api_key` / `apiKey`, `credential`, `private_key`, or `auth` (any casing; camelCase included) have values replaced with `[REDACTED:sensitive_key]`.
- Export **aborts** if any secret-shaped plaintext remains after scrub.
- `doc-pointers.json` entries must use **relative** paths (no `..`, no absolute paths).

## Import dry-run

| Outcome | Meaning |
|---------|---------|
| `create` | Target path absent; would be created on apply (not implemented) |
| `unchanged` | Target exists with identical content |
| `conflict` | Target exists with different content |
| `BLOCKED` | Errors or conflicts; exit code **2** |

**No apply path** in this slice — operators copy files manually or a future ticket adds `--apply`.

## Limits (explicit)

- No marketplace, cloud sync, UI, or multi-tenant sharing.
- Does not export harness internals (`capability-matrix.v1.json` body, `models.json` overrides) — only **references**.
- Does not read orchestrator state, traces, or credentials from env.
- Does not change `run-orchestrator.js` defaults when the CLI is not invoked.

## Validation

- Unit tests: `orchestrator/tests/portableProjectTemplate.test.js`
- Fixture: `orchestrator/tests/fixtures/portable-project-template-v0.1.example.json`

## Related

- [minions-project-contract.md](minions-project-contract.md)
- [runtime-permission-contract.md](runtime-permission-contract.md)
- [memory-store-decision.md](memory-store-decision.md)
