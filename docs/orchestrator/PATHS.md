# Paths and convention (user-agnostic)

Nothing in this documentation depends on a specific user (`/home/...`). Use **`REPO_ROOT`** = the folder where you cloned **this** repository (skills + docs + rule).

## Recommended convention

| Option | `REPO_ROOT` | Skills |
|--------|-------------|--------|
| **Recommended** | `~/.claude` | `REPO_ROOT/skills/` matches the main README installation guide |
| **Other location** | e.g. `~/src/ai-minions`, `C:\Users\you\ai-minions` | Adjust the path where Cursor/Warp loads skills (depending on your setup) |

On **Linux/macOS**, `~` is your home directory. On **Windows** (PowerShell): `$HOME` or `%USERPROFILE%`.

## Orchestrator files (always relative to the repo)

| What | Path from `REPO_ROOT` |
|-----|-------------------------|
| Agent contract | `docs/orchestrator/agent-contract.md` |
| MCP / subagent examples | `docs/orchestrator/mcp-task-examples.md` |
| Cursor rule | `.cursor/rules/orchestrator.mdc` |
| Script to install rule in another repo | `scripts/install-orchestrator-rule.sh` |
| State store MCP (`orchestrator-state`) | `mcp-servers/orchestrator-state/server.py` + `README.md` |

## Cursor: workspace = this repo

- Open **`REPO_ROOT`** as the project folder.
- In the chat use **`@docs/orchestrator/agent-contract.md`** (path relative to the workspace).
- The `.mdc` rule points to **`docs/orchestrator/agent-contract.md`** with no fixed user.

## Cursor: another project (app, infra, etc.)

1. Copy the rule to that repo:
   ```bash
   REPO_ROOT=/path/to/this/repo   # your clone
   mkdir -p /path/to/other/.cursor/rules
   cp "$REPO_ROOT/.cursor/rules/orchestrator.mdc" /path/to/other/.cursor/rules/
   ```
2. Edit the `.mdc` in that repo: replace the contract line with the **absolute path** to your clone, for example:
   - `**Canonical contract:** /your/path/to/repo/docs/orchestrator/agent-contract.md`
   
   Or duplicate `docs/orchestrator/` inside the other project and use a local relative path.

## User Rules (paste in Cursor Settings)

You can paste the same text from the `.mdc`. Replace the contract reference with the **absolute path on your machine** to the `agent-contract.md` file in your clone, or keep a single line: *"Contract: see file at `<YOUR_REPO_ROOT>/docs/orchestrator/agent-contract.md`"* and replace `<YOUR_REPO_ROOT>` when pasting.

---

See also: [CURSOR_RULE_SETUP.md](CURSOR_RULE_SETUP.md)
