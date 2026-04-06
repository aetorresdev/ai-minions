---
name: audit-patterns
description: Analyze Claude Code session history to detect recurring patterns and recommend automations (skills, hooks, CLAUDE.md additions).
argument-hint: "[--quick] [--since 7d|30d|3m] [--project NAME] [--deep] [--full] [--artifacts] [--interactive] [--diff]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash(bash:*)
  - Bash(jq:*)
  - Bash(date:*)
  - Bash(wc:*)
  - Bash(mkdir:*)
  - Bash(cat:*)
  - Bash(ls:*)
  - Bash(head:*)
  - Bash(tail:*)
  - Bash(xclip:*)
---

# Audit Patterns Skill

Analyze historical Claude Code session data to detect recurring patterns and recommend automations.

## When to Use

- Periodically review your Claude Code usage for optimization opportunities
- After accumulating 20+ sessions to find patterns worth automating
- When considering what skills, hooks, or CLAUDE.md rules to create
- To understand your work rhythms and model usage

## Invocation

```
/audit-patterns                         # Default: --quick mode
/audit-patterns --quick                 # Tier 0+1: metadata + history analysis
/audit-patterns --since 7d              # Only sessions from last 7 days
/audit-patterns --since 2026-01-15      # Since specific date
/audit-patterns --project construct     # Filter to matching project name
/audit-patterns --quick --since 30d --project myapp
```

### Future Flags (Not Yet Implemented)

These flags are recognized but will inform the user they require a future tier:

```
/audit-patterns --deep          # Tier 2: transcript parsing (future)
/audit-patterns --full          # Tier 3: full analysis (future)
/audit-patterns --artifacts     # Generate skill/hook scaffolds (future)
/audit-patterns --interactive   # Interactive exploration mode (future)
/audit-patterns --diff          # Compare against previous audit (future)
```

## Workflow (Quick Mode)

Follow these steps in order:

### Step 1: Parse Arguments

Extract flags from the user's invocation:
- `--since VALUE` → date filter (relative: 7d, 30d, 1w, 3m, 1y; or ISO date)
- `--project NAME` → project name filter (substring match)
- `--quick` → explicit quick mode (also the default)
- `--deep`, `--full`, `--artifacts`, `--interactive`, `--diff` → inform user these are not yet available, then proceed with `--quick`

If no arguments provided, default to `--quick` with no filters (all time, all projects).

### Step 2: Initialize Cache

```bash
bash SKILL_DIR/scripts/setup-cache.sh init
```

This creates `~/.claude/audit-cache/` with subdirectories and a manifest.

### Step 3: Collect Tier 0 Metadata

```bash
bash SKILL_DIR/scripts/collect-metadata.sh [--since VALUE] [--project NAME]
```

Capture the JSON output. This contains:
- `sessions.perProject[]` — per-project session counts, date ranges, branches
- `sessions.perSession[]` — individual session metadata (firstPrompt, messageCount, etc.)
- `stats` — daily activity, model tokens, hour counts, model usage breakdown

### Step 4: Collect Tier 1 History

```bash
bash SKILL_DIR/scripts/collect-history.sh [--since VALUE] [--project NAME]
```

Capture the JSON output. This contains:
- `history.commands[]` — command frequency, cross-session/project counts
- `sessionNames` — naming patterns, prefix distribution, coverage

### Step 5: Analyze Patterns

Read the reference doc:
```
SKILL_DIR/references/pattern-detection-quick.md
```

Using the collected data from Steps 3-4, apply the pattern detection heuristics:

1. **Summarize scope** — total sessions, projects, date range
2. **Classify projects** — primary (>10 sessions) vs exploratory (<3)
3. **Profile sessions** — distribute across archetypes (micro/focused/deep/marathon)
4. **Extract work patterns** — peak hours, model preferences, daily rhythm
5. **Analyze commands** — top commands, reuse candidates, skill adoption rate
6. **Cluster work intents** — group firstPrompts by keyword similarity
7. **Identify recommendations** — automation opportunities with confidence levels

### Step 6: Generate Report

Write the report to `~/.claude/audit-cache/reports/audit-YYYYMMDD-HHMM.md`.

Also display the report directly in the conversation.

Use this report template:

```markdown
# Claude Code Usage Audit
**Generated:** [timestamp]
**Period:** [date range or "all time"]
**Filters:** [project filter or "none"]

---

## Overview

| Metric | Value |
|--------|-------|
| Total sessions | N |
| Total projects | N |
| Total messages | N |
| Date range | YYYY-MM-DD to YYYY-MM-DD |
| Unique commands | N |
| Named sessions | N / total (%) |

## Project Activity

| Project | Sessions | Messages (avg) | Branches | Last Active |
|---------|----------|----------------|----------|-------------|
| name    | N        | N              | N        | date        |

## Session Distribution

| Archetype | Count | % | Avg Messages |
|-----------|-------|---|--------------|
| Micro (<5 msgs) | N | % | N |
| Focused (5-30) | N | % | N |
| Deep (30-100) | N | % | N |
| Marathon (100+) | N | % | N |

## Model Usage

| Model | Input Tokens | Output Tokens | Cache Reads | Est. Share |
|-------|-------------|---------------|-------------|------------|
| name  | N           | N             | N           | %          |

## Activity Patterns

- **Peak hours:** [hours]
- **Daily trend:** [description]
- **Busiest day:** [date, metrics]

## Top Commands

| # | Command | Uses | Sessions | Projects | Type |
|---|---------|------|----------|----------|------|
| 1 | cmd     | N    | N        | N        | skill/prompt |

## Findings

### [Finding Title]
- **Pattern:** [what was observed]
- **Evidence:** [specific numbers]
- **Confidence:** LOW/MEDIUM
- **Actionability:** HIGH/MEDIUM/LOW
- **Recommendation:** [specific next step]

[Repeat for each finding, ordered by actionability]

## Data Gaps

- [What data is missing or limited]
- [What would unlock deeper analysis (Tier 2+)]

---
*Generated by /audit-patterns --quick | Tier 0+1 analysis*
*For deeper analysis, try --deep (coming soon)*
```

### Step 7: Update Cache

```bash
bash SKILL_DIR/scripts/setup-cache.sh update --tier 1 --sessions-count N
```

Where N is the total sessions analyzed.

## Error Handling

| Condition | Action |
|-----------|--------|
| `jq` not installed | Inform user: `brew install jq` |
| No sessions-index.json found | Report "No session data found" with path checked |
| No history.jsonl found | Proceed with Tier 0 only, note Tier 1 data unavailable |
| Empty filter results | Report "No sessions match filters" with filter values |
| stats-cache.json missing | Proceed without stats, note in Data Gaps section |
| Script exits non-zero | Show error output, suggest running script directly for debugging |

## SKILL_DIR Resolution

Replace `SKILL_DIR` in all script paths with the actual directory containing this SKILL.md file. The scripts are at relative paths:
- `scripts/setup-cache.sh`
- `scripts/collect-metadata.sh`
- `scripts/collect-history.sh`
- `references/pattern-detection-quick.md`

To find SKILL_DIR, use the directory of this file (the one you're reading now).
