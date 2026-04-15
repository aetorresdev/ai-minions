---
name: context-budget
description: "Audits Claude Code context window consumption across agents, skills, MCP servers, and rules. Identifies bloat, redundant components, and produces prioritized token-savings recommendations. Use when sessions feel sluggish, before adding new components, or when running /context-budget."
---

# Context Budget

Analyze token overhead across every loaded component in a Claude Code session and surface actionable optimizations to reclaim context space.

## When to Use

- Session performance feels sluggish or output quality is degrading
- You've recently added many skills, agents, or MCP servers
- You want to know how much context headroom you actually have
- Planning to add more components and need to know if there's room
- Running `/context-budget` command

## How It Works

### Phase 1: Inventory

Scan all component directories and estimate token consumption. Root is `~/.claude/` (this repo cloned there).

**Agents** (`~/.claude/agents/*.md`)
- Count lines and tokens per file (words × 1.3)
- Extract `description` frontmatter length
- Flag: files >200 lines (heavy), description >30 words (bloated frontmatter)

**Skills** (`~/.claude/skills/*/SKILL.md`)
- Count tokens per SKILL.md + reference files in `references/`
- Flag: SKILL.md >400 lines
- Check for duplicate content between skills

**Rules** (`~/.claude/.cursor/rules/*.mdc`)
- Count tokens per file
- Flag: files >100 lines

**MCP Servers** (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`)
- Count configured servers and total tool count
- Estimate schema overhead at ~500 tokens per tool
- Flag: servers with >20 tools, servers that wrap CLI commands already available

**CLAUDE.md / project context**

- Count tokens in any CLAUDE.md in the project chain
- Flag: combined total >300 lines

**Hooks** (`~/.claude/settings.json`)
- List active hooks (SessionStart, PreToolUse, PostToolUse, Stop)
- Flag hooks that inject large context payloads into the session

### Phase 2: Classify

Sort every component into a bucket:

| Bucket | Criteria | Action |
|--------|----------|--------|
| **Always needed** | Referenced in active workflow, backs an active skill/command, or matches current project type | Keep |
| **Sometimes needed** | Domain-specific (e.g. Terraform skills on a non-infra project) | Consider on-demand activation |
| **Rarely needed** | No command reference, overlapping content, or no obvious project match | Remove or lazy-load |

### Phase 3: Detect Issues

Identify the following problem patterns:

- **Bloated agent descriptions** — description >30 words in frontmatter loads into every Agent tool invocation
- **Heavy agents** — files >200 lines inflate Agent tool context on every spawn
- **Redundant skills** — skills that duplicate agent logic or overlap significantly with each other
- **MCP over-subscription** — >10 servers, or servers wrapping CLI tools available for free (`gh`, `git`, `terraform`, etc.)
- **Heavy hook payloads** — SessionStart hooks that inject large external files into context
- **Orquestador contract size** — `docs/orquestador/agentes-orquestador.md` is loaded by reference; if it grows beyond ~300 lines it becomes a significant overhead per session

### Phase 4: Report

Produce the context budget report:

```
Context Budget Report
═══════════════════════════════════════

Total estimated overhead: ~XX,XXX tokens
Context model: Claude Sonnet 4.6 (200K window)
Effective available context: ~XXX,XXX tokens (XX%)

Component Breakdown:
┌─────────────────────┬────────┬───────────┐
│ Component           │ Count  │ Tokens    │
├─────────────────────┼────────┼───────────┤
│ Agents              │ N      │ ~X,XXX    │
│ Skills (SKILL.md)   │ N      │ ~X,XXX    │
│ Skill references    │ N      │ ~X,XXX    │
│ Rules (.mdc)        │ N      │ ~X,XXX    │
│ MCP tools           │ N      │ ~XX,XXX   │
│ Hooks (context inj) │ N      │ ~X,XXX    │
│ Orquestador contract│ 1      │ ~X,XXX    │
└─────────────────────┴────────┴───────────┘

WARNING: Issues Found (N):
[ranked by token savings]

Top 3 Optimizations:
1. [action] → save ~X,XXX tokens
2. [action] → save ~X,XXX tokens
3. [action] → save ~X,XXX tokens

Potential savings: ~XX,XXX tokens (XX% of current overhead)
```

In verbose mode, additionally output per-file token counts, specific redundant lines between overlapping components, and MCP tool list with per-tool schema size estimates.

## Examples

**Basic audit**

```
User: /context-budget
Skill: Scans setup → 25 agents (~18,000 tokens), 27 skills (~12,000), 6 MCP servers (~15,000 tools tokens),
       orquestador contract (~4,000)
       Flags: 2 heavy agents, MCP terraform servers overlapping (HashiCorp + AWS Labs both loaded)
       Top saving: consolidate MCP terraform servers → -7,500 tokens
```

**Pre-expansion check**

```
User: I want to add 3 more MCP servers, do I have room?
Skill: Current overhead 28% → adding 3 servers (~30 tools) would add ~15,000 tokens → pushes to 35%
       Recommendation: within safe range; monitor after addition
```

**Orquestador contract bloat**

```
User: /context-budget --verbose
Skill: agentes-orquestador.md is 280 lines (~3,600 tokens) — approaching threshold.
       Recommendation: extract Skills y MCP table to separate reference file, load on demand.
```

## Best Practices

- **Token estimation**: use `words × 1.3` for prose, `chars / 4` for code-heavy files
- **MCP is the biggest lever**: each tool schema costs ~500 tokens; a 30-tool server costs more than all your skills combined
- **Agent descriptions are loaded always**: even if the agent is never invoked, its description field is present in every Agent tool context
- **Skill references add up**: each `references/*.md` file in a skill folder is loaded when the skill activates — audit them too
- **Hook context injection**: the SessionStart hook in `settings.json` loads external CLAUDE context files — measure their size
- **Audit after changes**: run after adding any agent, skill, or MCP server to catch creep early
- **Orquestador contract**: keep `agentes-orquestador.md` under 300 lines; extract reference tables when it grows
