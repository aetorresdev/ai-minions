# Trello ↔ groomed backlog sync (operator)

Local-only sync script; groomed markdown is **not** committed.

## Roles

| Layer | Purpose |
|-------|---------|
| **Trello** | Daily ops: Backlog / Ready / In Progress / Done, focus, PR links, CERBERUS verdict on card |
| **`docs/ai-minions-backlog-groomed.md`** | Full spec (Scope, AC, evidence); local source when grooming |
| **Repo (versioned)** | Contracts, ADRs, changelog, CERBERUS-approved behavior — not the live backlog |

## Active board

- **Use:** [AI-Minions — Backlog Dashboard](https://trello.com/b/gTu2WhfQ/ai-minions-backlog-dashboard) (`gTu2WhfQ`)
- **Ignore:** older duplicate board `ZNtCNQHx` — **closed** (not editable)

## Script

Path: `scripts/sync-trello-backlog.py` (listed in `.gitignore` — local only).

Credentials: `~/.config/secrets/trello.env` (`TRELLO_API_KEY`, `TRELLO_TOKEN`).

### Commands

```bash
# Default: update existing board (most cards wins if name duplicates)
python3 scripts/sync-trello-backlog.py

# Target one board
python3 scripts/sync-trello-backlog.py --board-id <24-char-id>

# Refresh text/checklists only; do not move columns
python3 scripts/sync-trello-backlog.py --no-move

# New board (avoid unless intentional)
python3 scripts/sync-trello-backlog.py --create-board
```

### What sync writes per card

Markdown description sections:

- Scope, Out of scope, Acceptance Criteria, Evidence, CERBERUS verdict

Plus Trello checklist **Acceptance Criteria** (bullets from groomed `### Acceptance criteria`).

### Preserved on re-sync

- **CERBERUS verdict** on the card if already filled manually (not the placeholder `(pending — update after CERBERUS review)`).

### List mapping (from groomed status)

| Groomed | Trello list |
|---------|-------------|
| Resolved / Archived | Done |
| `FOCUS_TICKETS` in script | Ready |
| Blocked | In Progress |
| Open / other | Backlog |

Current focus IDs in script: `RECOVERY-SWEEP-1`, `SKILL-CONTRACT-1` (edit `FOCUS_TICKETS` when priorities change).

## Agent workflow

1. **State / priority** → Trello MCP (`list_boards`, `trello_get_board_cards`, Ready column).
2. **Implementation spec** → groomed `## TICKET-ID` or Trello card body after sync.
3. **After grooming backlog** or resolving tickets in groomed → run sync script.
4. **After merge** → operator (or agent via `update_card` / comment) sets Evidence + CERBERUS verdict on card; optional re-sync with `--no-move`.

## When to run sync

- Backlog groomed updated (new ticket, status → Resolved, AC changed).
- New operator focus tickets (update `FOCUS_TICKETS` in script first).
- After archiving a duplicate Trello board.
