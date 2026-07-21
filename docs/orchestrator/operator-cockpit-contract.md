# Operator cockpit contract (`ai-minions tui`)

Interactive **cockpit MVP** for the product CLI. Reuses existing operator modules; does not replace CLI verbs.

## Entrypoint

```bash
ai-minions tui
```

Requires a TTY (stdin and stdout). Non-TTY exits non-zero with equivalent CLI verb guidance (no hang, no readline).

## First screen

Shows product status (version, model policy, PATH activation, credential **status labels only** — never secret values) and numbered actions.

## Actions → existing contracts

| Action | Module / command contract |
|--------|---------------------------|
| smoke / new run | `runSmoke` (`ai-minions smoke`) |
| runs | `runOperatorRuns` (`ai-minions runs`) |
| select run / status pane | `runOperatorRunSelector` — newest-first list + compact status pane |
| status | prompts `--run-id` (defaults to last selected) → `runOperatorStatus` |
| attach | prompts `--run-id` (defaults to last selected) → `runAttach` |
| doctor / config readiness | `runOperatorDoctor` |
| quit | exit `0`, no operator side effects |

## Run selector + status pane

Cockpit action **`s` / select**:

- Lists runs **newest-first** via the same discovery as `ai-minions runs`.
- Selection by **index**, **run id**, or **keyboard nav** (`n`/`j` next, `p`/`k` prev, Enter selects cursor).
- Selected run shows a compact **status pane**: run id / trace basename · outcome/status · reason code · next safe action · attach/bundle hint.
- Invalid traces stay visible as `RUN_TRACE_INVALID` with **no inferred** outcome/state.
- Selector commands resolve **trace basenames** safely (same quoting rules as `runs`).
- **No** trace or gate mutation.

Module: `orchestrator/modules/operator/operator-run-selector-tui.js`.

## Evidence path (unchanged selectors)

```bash
ai-minions tui --run-id <id>
ai-minions tui --latest
ai-minions tui --file <trace.jsonl> [--json]
```

Read-only stdout evidence panels (`operator-evidence-tui`). `--json` applies only to this path (ANSI-free). Cockpit itself does not emit JSON shareables.

## Color / ANSI

Human cockpit text follows `terminal-style` / `NO_COLOR` / `--color`. JSON, Markdown, and attach bundles remain ANSI-free via existing writers (`useColor: false` on shareable paths).

## Not claimed

- Production TUI or Web UI
- Fullscreen / navigable multi-pane shell
- Durable resume
- Auto-executing unsafe wizard steps
- New model routing behavior
- Replacing existing CLI verbs

## See also

- [operator-visibility-guide.md](../how-to/operator-visibility-guide.md)
- [runner-tui-contract.md](runner-tui-contract.md) — legacy `runner:tui` launcher
