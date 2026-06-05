# Tool ergonomics guidelines

Harness evaluation for agent tools (`security/tool-eval.js`, fixtures in `security/tool-eval-fixtures.v1.json`). This doc is **not** a model benchmark — it validates classification, permission decisions, and trace shape.

## Goals

- Agents pick the **right tool** with **unambiguous** manifest metadata.
- Permission denials reflect **policy**, not misclassification.
- Tool responses stay within **context/cost** bounds via progressive disclosure.

## Naming and manifest metadata

When adding a tool to `tool-action-manifest.v1.json`:

1. **`id`** must match the manifest key.
2. **`aliases`** — lowercase executable names; avoid collisions with other tools.
3. **`capabilities`** — stable dotted ids (`infra.plan`, `k8s.read`); used for docs and future registry checks.
4. **`rules`** — prefer explicit `argv_prefix` rules for high-risk subcommands before delegating to adapters.
5. **`adapter`** — only when `delegate_unmatched_to_adapter: true` or no rules; document why adapter heuristics are needed.
6. **Every new tool** must add at least one row to `tool-eval-fixtures.v1.json` before merge (CERBERUS can block otherwise). The unit test `every manifest tool has fixture coverage` fails if any `tool_id` is missing.

Run readiness check:

```javascript
const { validateToolManifestEntry } = require("./security/tool-eval");
validateToolManifestEntry(draftEntry, "my_tool");
```

## Failure diagnosis (two axes)

| Symptom | Diagnosis | Typical fix |
|---------|-----------|-------------|
| Wrong executable, unknown binary, bad argv, ambiguous metadata | **tool_selection** | Manifest rules, tool descriptions, agent prompt |
| Classification correct, `decision: deny` | **permission_policy** | Profile/policy, role capability matrix, approval gates |

Do not collapse these into a single “failed” bucket in reports or UI.

## Large tool responses

Use `estimateTokenFootprint(text)` and `largeResponseRecommendation(charCount)` from `security/tool-eval.js`.

When response size exceeds **8000 characters** (~2000 approximate tokens):

- Prefer **summaries** or **paged** results.
- Expose **compact** fields in tool schema.
- Apply **progressive disclosure** through compact summaries, pagination, or scoped result fields.

## Running the eval suite

```bash
cd orchestrator && node --test tests/toolEval.test.js
```

Full suite includes `toolEval.test.js` via `npm test`.

## Fixture scaffold (new manifest tools)

When adding tools to `tool-action-manifest.v1.json`, generate **reviewable placeholders** — do not infer final `expected` from the classifier (self-confirming eval is invalid).

```bash
cd orchestrator
npm run scaffold:tool-eval-fixtures -- --dry-run
npm run scaffold:tool-eval-fixtures
```

| Step | Action |
|------|--------|
| 1 | Run scaffold — writes `security/tool-eval-fixtures.scaffold.pending.json` (or stdout with `--dry-run`) |
| 2 | Human replaces `TODO_EXPECTED_ACTION_CLASS`, `TODO_EXPECTED_DOMAIN`, `TODO_EXPECTED_DECISION` |
| 3 | Merge reviewed scenarios into `security/tool-eval-fixtures.v1.json` |
| 4 | `npm test` — coverage guard + fixtures must pass |

Scaffold copies **argv** and manifest **target_class** hints only. **Golden** rows (ambiguous, destructive, regression-sensitive) stay hand-authored.

`--tool-id` must match a `tool_id` in `tool-action-manifest.v1.json`. Unknown ids fail closed (exit **1**, `unknown manifest tool_id(s): …`) — typos must not produce an empty success.

## Matrix maintenance

Fixtures encode: `tool → scenario → expected classification → expected permission decision`.

Required families in fixtures: **filesystem**, **git**, **terraform**, **kubectl**, **unknown** tool.

Intent tags: `correct_tool_and_argv`, `permission_policy`, `wrong_tool`, `bad_parameters`, `incomplete_metadata`.

## Related contracts

- `security/tool-action-manifest.v1.json`
- `security/classified-invocation-permission-gate.js`
- `docs/orchestrator/permission-check-trace.md`
- `docs/orchestrator/runtime-permission-contract.md`
