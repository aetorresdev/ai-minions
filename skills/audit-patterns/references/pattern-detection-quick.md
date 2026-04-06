# Pattern Detection: Quick Mode (Tier 0+1)

Reference checklist for Claude when analyzing Tier 0 (metadata) + Tier 1 (history/names) data.

## Detectable Patterns

### From Tier 0: Session Metadata

| Pattern | Signal | Heuristic | Confidence |
|---------|--------|-----------|------------|
| **Project activity profiles** | `perProject[].sessionCount` | Projects with >10 sessions are "primary"; <3 are "exploratory" | MEDIUM |
| **Session archetypes** | `perSession[].messageCount` | Cluster: micro (<5 msgs), focused (5-30), deep (30-100), marathon (100+) | MEDIUM |
| **Work intent clustering** | `perSession[].firstPrompt` | Group firstPrompts by keyword overlap (fix/bug, add/feature, refactor, review) | LOW-MEDIUM |
| **Activity rhythms** | `stats.hourCounts`, `dailyActivity` | Peak hours, weekend vs weekday, burst vs steady patterns | MEDIUM |
| **Model usage patterns** | `stats.modelUsage`, `dailyModelTokens` | Model preferences, cost distribution, switching patterns | MEDIUM |
| **Branch patterns** | `perProject[].branches` | Feature branch conventions, branch churn, main-only vs branching | LOW |
| **Session duration trends** | `dailyActivity[].sessionCount` vs `messageCount` | Avg messages/session trending up/down | MEDIUM |
| **Longest session outliers** | `stats.longestSession` | Marathon sessions may indicate missing automation | LOW |

### From Tier 1: History & Names

| Pattern | Signal | Heuristic | Confidence |
|---------|--------|-----------|------------|
| **Command vocabulary** | `history.commands[].command` | Unique commands used; skill invocations vs raw prompts | MEDIUM |
| **Command reuse** | `commands[].count`, `.sessions` | Commands used in >3 sessions = candidates for automation | MEDIUM |
| **Cross-project commands** | `commands[].projects` | Commands spanning multiple projects = global skill candidates | MEDIUM |
| **Slash command adoption** | Commands starting with `/` | Ratio of skill invocations to total commands | MEDIUM |
| **Naming consistency** | `sessionNames.byPrefix` | Consistent `project:topic` format vs ad-hoc names | LOW |
| **Naming coverage** | `sessionNames.totalNames` vs `sessions.totalSessions` | % of sessions with meaningful names | LOW |
| **Project specialization** | `history.perProject[]` | Projects with distinct command profiles | LOW |

## Analysis Workflow

1. **Summarize scope**: total sessions, projects, date range, data completeness
2. **Classify projects**: primary vs exploratory based on session counts
3. **Profile sessions**: distribution across archetypes (micro/focused/deep/marathon)
4. **Extract work patterns**: peak hours, model preferences, daily rhythm
5. **Analyze commands**: top commands, reuse candidates, skill adoption rate
6. **Identify recommendations**: automation opportunities, naming improvements, workflow optimizations
7. **Assess confidence**: each finding gets LOW/MEDIUM based on signal strength

## What Quick Mode Cannot Detect

These require Tier 2+ (transcript parsing):

- Tool call sequences and chains (e.g., always Glob → Read → Edit)
- Recurring file access patterns (same files across sessions)
- Boilerplate/template generation frequency
- Error-fix cycles and retry patterns
- Subagent delegation patterns
- Actual code changes and their nature
- Search patterns and what users look for repeatedly

**Confidence ceiling**: MEDIUM for statistical patterns, LOW for keyword-based clustering.

## Recommendation Types

When generating findings, categorize into:

| Type | Description | Example |
|------|-------------|---------|
| **Skill candidate** | Repeated command/workflow worth packaging | "You run `/commit` in 80% of sessions — consider adding pre-commit hooks" |
| **Hook candidate** | Repetitive action that could be automated | "Sessions averaging 200+ messages suggest missing auto-save" |
| **CLAUDE.md addition** | Pattern that should be documented | "You work on 3 primary projects — add project-specific instructions" |
| **Workflow insight** | Behavioral observation | "Peak productivity 9-11am; deep sessions cluster on Tuesdays" |
| **Data gap** | Missing data that limits analysis | "Only 30% of sessions have names — adopt naming convention" |

## Scoring Findings

Each finding should include:
- **Pattern**: What was observed
- **Evidence**: Specific numbers from the data
- **Confidence**: LOW or MEDIUM
- **Actionability**: HIGH (can act now), MEDIUM (needs investigation), LOW (informational)
- **Recommendation**: Specific next step
