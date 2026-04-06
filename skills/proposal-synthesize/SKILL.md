---
name: proposal-synthesize
description: Synthesize a consulting proposal from meeting transcripts, requirements docs, and source materials. Use when starting a new proposal from discovery materials.
argument-hint: <directory path>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Task
  - EnterPlanMode
  - ExitPlanMode
  - Bash(ls:*)
---

# Proposal Synthesis Skill

Creates a structured consulting proposal from meeting transcripts, requirements docs, and other source materials.

## Invocation
```
/proposal-synthesize [directory or file path]
```

## Process

### Phase 1: Discovery (Parallel Agents)
Deploy 3 agents simultaneously to analyze source materials:

**Agent 1: Context Extraction**
- Client business model and ecosystem
- Technical landscape (current state)
- Key stakeholders and their roles

**Agent 2: Needs Analysis**
- Initial understanding (pre-meeting assumptions)
- Modified understanding (what was learned)
- Gap between expectation and reality

**Agent 3: Solution Framing**
- How we can help (capabilities match)
- Proposed structure from discussions
- Constraints and concerns raised

### Phase 2: Plan Generation
Enter plan mode and synthesize findings into structured plan:

```markdown
# [Client] Proposal Development Plan

## Context Summary
[From Agent 1]

## Needs Analysis
[From Agent 2]

## Solution Direction
[From Agent 3]

## Proposal Outline
1. Executive Summary
2. Our Understanding
3. Our Approach
4. Our Solution (phases for sequential work; workstreams only if multiple teams in parallel)
5. Assumptions
6. Team Size & Shape
7. Project Duration
8. Success Criteria

## Tasks to Execute
[Specific writing tasks]
```

Exit plan mode for user approval.

### Phase 3: Execution
After plan approval:
1. Create proposal document following plan structure
2. Create/update CLAUDE.md with project context
3. Apply voice/structure guidelines from checklist

### Phase 4: Self-Review
Before presenting to user, run internal review against checklist:
- Voice check (no AI-sounding language)
- Structure check (phases vs workstreams appropriate, assumptions present)
- Scoping check (realistic timelines, bounded POC)
- Attribution check (claims sourced or flagged)

Report any issues found and fix before delivery.

## Output
- `[Client]_Proposal.md` - Main deliverable
- `CLAUDE.md` - Project context file (use [project-info-template.md](project-info-template.md))
- Plan file in `~/.claude/plans/`

## Supporting Files
- [project-info-template.md](project-info-template.md) - Template for creating the project's CLAUDE.md file

## Guidelines

### Voice
- Direct consulting voice, not AI-generated boilerplate
- "In practice:" not "This means:"
- Specific examples over abstract principles

### Structure
- Use "phases" for sequential stages within a single team's process
- Use "workstreams" only when multiple teams execute in parallel
- Future work beyond current engagement = "initiatives"
- Always include Assumptions section
- Success criteria must be achievable within timeline

### Scoping
- 6 weeks is realistic baseline
- 4 weeks requires explicit caveats
- POC = 2-3 items, one platform, not comprehensive
