# Orchestrator Rule in Cursor

Paths without fixed user: [PATHS.md](PATHS.md).

## If you only paste the rule in **User Rules** (UI)

| You need | Required? |
|-----------|----------------|
| Rule text (non-negotiables + handoff) | Yes |
| Full contract | **Recommended:** in User Rules, one line with the absolute path to **your** clone: `<YOUR_REPO_ROOT>/docs/orchestrator/agent-contract.md`, or @ that file in the chat when orchestrating |
| Skills | `skills/` directory at the root of this repo (recommended to clone as `~/.claude`) |

**Summary:** short rule in User Rules + **@** the `agent-contract.md` on your machine when the full table is needed.

## Project rules vs User Rules

| Type | Where | Scope |
|------|--------|---------|
| Project | `<any-repo>/.cursor/rules/orchestrator.mdc` | That repo |
| User | Cursor → Settings → Rules | All projects (Agent) |

## Install rule in another project

From the root **of this repo** (`REPO_ROOT`):

```bash
./scripts/install-orchestrator-rule.sh /path/to/other/project
```

If the `.mdc` in the other project should point to the contract, edit the first line of the contract to the absolute path of your clone, or copy `docs/orchestrator/` inside the other repo. Details: [PATHS.md](PATHS.md).

## References

- [agent-contract.md](agent-contract.md)
- [PATHS.md](PATHS.md)
- [Cursor: Rules](https://cursor.com/docs/context/rules)
