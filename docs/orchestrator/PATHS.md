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
| Orchestrator **runtime** (product) | `orchestrator/` at repo root. The former `examples/orchestrator/` path was **removed** from this repository. |
| MODE agents (Node) | **`orchestrator/agents.js`** — canonical `require("./agents")` facade. **`orchestrator/agents/`** — internal modules (e.g. `routing/model-routing.js`, `permissions.js`); not the same as repo-root **`agents/`** (subagent markdown for skills). |

### Legacy string `examples/orchestrator`

- **Product code and CI** do not use that directory or any workflow path filter on `examples/orchestrator/**`.
- The string may still appear in **local backlog / archive prose** when describing the migration — not as a runnable path.
- **Workflow file** `.github/workflows/orchestrator-unit-tests.yml` runs lint + unit tests from `orchestrator/`; display `name` in GitHub Actions: **`orchestrator-unit-tests`**. If you use required status checks, update branch protection when this filename changes.

## Repository root detection (`REPO_ROOT` / `ORCH_REPO_ROOT`)

Tools under `orchestrator/` must not assume a fixed depth (e.g. `../../mcp-servers`). They resolve the clone root by walking **upward** from the orchestrator package until **both** paths exist:

- `mcp-servers/orchestrator-state/`
- `scripts/hooks/`

**Implementation:** `orchestrator/repo-root.js` (Node), `orchestrator/mcp-direct.py` (same markers at import time), and `orchestrator/scripts/ci-check-harness-scope.sh` (invokes Node to print the root). **`npm run lint:py`** runs `node scripts/lint-py.js`, which calls `ruff check` on `scripts/hooks` and `mcp-servers` under that root.

**Optional override:** set **`REPO_ROOT`** or **`ORCH_REPO_ROOT`** to an absolute path; it is accepted only if the same markers exist there (otherwise the tool fails fast).

**Shared assets vs runtime:** see **[`shared-dependencies.md`](./shared-dependencies.md)** (which trees the orchestrator uses, when they are mandatory, and how failures surface).

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
