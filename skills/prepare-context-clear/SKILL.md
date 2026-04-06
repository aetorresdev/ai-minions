---
name: prepare-context-clear
description: Save session context and generate a continuation prompt before clearing context. Creates a snapshot in .claude/snapshots/ with topic, session ID, and timestamp.
argument-hint: [--full] [topic]
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash(git status:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(ls:*)
  - Bash(mkdir:*)
  - Bash(date:*)
  - Bash(xclip:*)
  - Bash(pwd:*)
  - Bash(jq:*)
  - Bash(wc:*)
  - Bash(head:*)
  - Bash(tail:*)
  - TaskList
---

# Prepare Context Clear Skill

Captures session state and generates a continuation prompt before clearing context.

## Invocation

```
/prepare-context-clear [topic]           # Standard capture
/prepare-context-clear --full [topic]    # Comprehensive capture
```

If topic is omitted, infer from conversation or ask.

## Process

### 1. Gather Context

**Standard (default) - Tiers 1 & 2:**

From conversation context:
- Primary goal and scope boundaries
- Progress: completed, in-progress, not started
- Key decisions with rationale
- Failed approaches and why they failed
- User preferences explicitly stated
- Open questions and blockers

From git/filesystem:
- Files modified/created (git status)
- File relationships and dependencies
- Testing status

From task list (if present):
- Task statuses and descriptions

**Full (--full flag) - Adds Tier 3:**

All of the above, plus from session JSONL:
- Complete file operations timeline
- All commands with exit codes and output summaries
- Error timeline with resolution details
- Conversation flow with key outcomes per turn
- Retries and corrections made
- Tool usage statistics
- Session duration and metrics

### 2. Generate Output

Create snapshot file at:
```
.claude/snapshots/[YYYYMMDD-HHMM]-[topic]-[session-id].md
```

Example: `.claude/snapshots/20250201-1430-auth-refactor-abc123.md`

### 3. File Structure

The snapshot is organized into three tiers for different use cases:

| Tier | Section | Use Case |
|------|---------|----------|
| 1 | Continuation Prompt | Quick resume - paste and go |
| 2 | Session Details | Deep context - understand the work |
| 3 | Session Forensics | Debug/audit - what exactly happened (--full only) |

```markdown
# Context Snapshot: [Topic]

**Session:** [session-id]
**Date:** [timestamp]
**Project:** [project path]
**Duration:** [approximate session length]

---

# TIER 1: CONTINUATION PROMPT

> Copy from ---BEGIN PROMPT--- to ---END PROMPT--- to resume:

---BEGIN PROMPT---

## Project: [name]
[One line: what this project does and its tech stack]

## Context
- [Key architectural fact]
- [Decision made]: [rationale - why this choice]
- [Constraint]: [source of constraint]

## Current State
- **Completed:** [done items with brief proof - "added X, tests passing"]
- **In progress:** [exact point where work stopped]
- **Blocked on:** [specific blocker, or "nothing"]

## Key Files
- `path/to/file.ts` - [role in current task, current state]
- `path/to/related.ts` - [dependency/relationship to main file]

## What NOT to Do
- Don't [failed approach]: [why it failed]
- Don't revisit [decision]: [it's settled because X]
- Don't modify [file/system]: [reason - frozen, working, out of scope]

## User Preferences
- [Explicit preference stated]: [quote or paraphrase]

## Next Action
[Specific instruction with acceptance criteria]
Example: "Add error handling to submitForm() that displays validation errors below each field. Done when: form shows inline errors, doesn't submit with invalid data, clears errors on valid resubmission."

---END PROMPT---

---

# TIER 2: SESSION DETAILS

## Goal & Scope

**Primary Goal:** [What we set out to accomplish]

**Scope Boundaries:**
- In scope: [what's included]
- Out of scope: [what's explicitly excluded and why]
- Deferred: [what was pushed to later]

## Progress Tracker

### Completed
| Item | Evidence | Notes |
|------|----------|-------|
| [Task] | [How we know it's done - tests pass, verified manually, etc.] | [Any caveats] |

### In Progress
| Item | Status | Remaining |
|------|--------|-----------|
| [Task] | [Where we stopped] | [What's left to do] |

### Not Started
| Item | Blocked By | Priority |
|------|------------|----------|
| [Task] | [Dependency or nothing] | [High/Med/Low] |

## Technical Landscape

### Files Changed
| File | Change Type | Description | Tested? |
|------|-------------|-------------|---------|
| path/to/file | Created/Modified/Deleted | [What changed] | Yes/No/Partial |

### File Relationships
```
[Dependency diagram or description]
Example:
AuthContext.tsx
  └── useAuth.ts (hook that consumes context)
       └── LoginForm.tsx (component using hook)
            └── validateCredentials.ts (utility)
```

### Technical Constraints Discovered
| Constraint | Source | Impact |
|------------|--------|--------|
| [Limitation found] | [How we discovered it] | [What it means for the work] |

### Testing Status
| Area | Status | Notes |
|------|--------|-------|
| Unit tests | [Passing/Failing/None] | [Details] |
| Integration | [Status] | [Details] |
| Manual verification | [Done/Needed] | [What was checked] |

## Decision Log

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| [What was decided] | [Alternatives] | [What we picked] | [Why - specific reasons] |

## Failed Approaches

| Approach | What We Tried | Why It Failed | Lesson |
|----------|---------------|---------------|--------|
| [Name] | [Specific implementation] | [Error, performance, complexity, etc.] | [What to remember] |

## User Preferences & Requirements

| Preference | Source | Priority |
|------------|--------|----------|
| [What user wants] | [Direct quote or paraphrase] | [Must have/Nice to have] |

## Open Questions & Blockers

### Blockers
| Blocker | Impact | Potential Resolution |
|---------|--------|---------------------|
| [What's blocking] | [What can't proceed] | [Ideas to unblock] |

### Open Questions
| Question | Context | Suggested Answer |
|----------|---------|------------------|
| [Unresolved question] | [Why it matters] | [Best guess if any] |

## Context That Would Be Lost

[Anything important that isn't captured above - tribal knowledge, gotchas, warnings]

- [Non-obvious thing 1]
- [Non-obvious thing 2]
```

### 4. Copy to Clipboard

After writing the file, copy the "Continuation Prompt" section to clipboard (Linux: xclip -selection clipboard).

### 5. Confirm & Display

Output the continuation prompt directly in response, then confirm:

```
══════════════════════════════════════════════════════════════
CONTINUATION PROMPT (also copied to clipboard)
══════════════════════════════════════════════════════════════

[Display the full continuation prompt here]

══════════════════════════════════════════════════════════════

✓ Context saved to: .claude/snapshots/[filename].md
✓ Continuation prompt copied to clipboard

Contents:
- Tier 1: Continuation Prompt (ready to paste)
- Tier 2: Session Details (full context)
[- Tier 3: Session Forensics (--full only)]

To resume after /clear:
1. Paste from clipboard (fastest), OR
2. Read the snapshot: .claude/snapshots/[filename].md
```

## Determining Session Info

- **Timestamp**: Current date/time in YYYYMMDD-HHMM format (comes first for chronological sorting)
- **Topic**: From argument, or infer from CLAUDE.md project description, or ask user
- **Session ID**: Use first 6 chars of CLAUDE_SESSION_ID env var, or generate from timestamp

## JSONL Parsing (--full mode)

### Locating the Session File

Session history is stored in `~/.claude/projects/`. The path is based on the project directory:

```bash
# Project path gets encoded into the filename
# e.g., /Users/mario/dev/myproject -> -Users-mario-dev-myproject
~/.claude/projects/[encoded-path]/[session-id].jsonl
```

Use the current working directory and session ID to locate the file.

### Extracting Data

Parse the JSONL file (one JSON object per line) and extract:

**File Operations:**
```
- Tool: Read, Write, Edit, Glob, Grep
- Extract: file paths, operation type
- Group into: files read, files written, files modified
```

**Commands:**
```
- Tool: Bash
- Extract: command, output, exit status
- Note any failures or errors
```

**Errors:**
```
- Look for: error messages in tool outputs, failed commands, retry patterns
- Extract: what failed, what was tried, resolution if any
```

**Conversation Flow:**
```
- User messages: extract key requests/decisions
- Assistant responses: extract summaries of actions taken
```

### JSONL Structure Reference

Each line is a JSON object with structure like:
```json
{
  "type": "user" | "assistant",
  "message": { "content": [...] },
  "toolUseResults": [...],
  ...
}
```

Tool calls appear in assistant messages, results in subsequent entries.

### Output for --full

Add "TIER 3: SESSION FORENSICS" section to the snapshot:

```markdown
---

# TIER 3: SESSION FORENSICS (from JSONL)

## File Operations Timeline

| Time | File | Operation | Context |
|------|------|-----------|---------|
| 14:02 | src/auth.ts | Read | Initial exploration |
| 14:05 | src/auth.ts | Edit | Added middleware function |
| 14:08 | src/auth.ts | Edit | Fixed type error |
| 14:10 | tests/auth.test.ts | Write | Created test file |
| 14:15 | src/types.ts | Read | Checked existing types |

## File Access Summary

| File | Reads | Writes | Edits | Final State |
|------|-------|--------|-------|-------------|
| src/auth.ts | 1 | 0 | 2 | Modified - middleware added |
| src/types.ts | 1 | 0 | 0 | Unchanged |
| tests/auth.test.ts | 0 | 1 | 0 | New file |

## Commands Executed

| # | Command | Exit | Output Summary | Follow-up |
|---|---------|------|----------------|-----------|
| 1 | `npm test` | 1 | 2 tests failed: auth.test.ts | Investigated failures |
| 2 | `npm test -- --grep auth` | 0 | All auth tests pass | Confirmed fix worked |
| 3 | `git status` | 0 | 3 files modified | Prepared for commit |

## Error Timeline

| Time | Error | Source | Resolution | Turns to Fix |
|------|-------|--------|------------|--------------|
| 14:06 | TypeError: undefined is not a function | src/auth.ts:45 | Added null check | 1 |
| 14:12 | Test: expected 401 got 200 | auth.test.ts | Fixed mock setup | 2 |

## Conversation Flow

| # | Actor | Summary | Key Outcome |
|---|-------|---------|-------------|
| 1 | User | "Add auth middleware to protect /api routes" | Goal established |
| 2 | Claude | Read existing auth setup | Found AuthContext pattern |
| 3 | Claude | Proposed middleware approach | User approved |
| 4 | Claude | Implemented middleware | TypeError encountered |
| 5 | Claude | Fixed type error | Code compiles |
| 6 | User | "Add tests" | Scope expanded |
| 7 | Claude | Created test file | Tests initially failed |
| 8 | Claude | Fixed mock setup | All tests passing |

## Retries & Corrections

| Original Action | Problem | Correction |
|-----------------|---------|------------|
| Used `req.user` directly | Could be undefined | Added optional chaining |
| Mock returned wrong status | Didn't match real API | Fixed mock response shape |

## Tool Usage Summary

| Tool | Count | Notes |
|------|-------|-------|
| Read | 5 | Mostly exploring codebase |
| Edit | 3 | All in auth.ts |
| Write | 1 | New test file |
| Bash | 4 | npm test (2), git status (2) |
| Grep | 2 | Finding usage patterns |

## Session Statistics

- **Duration:** ~25 minutes
- **User messages:** 4
- **Tool calls:** 15
- **Errors encountered:** 2
- **Errors resolved:** 2
- **Files touched:** 3
```

## Creating the Directory

If `.claude/snapshots/` doesn't exist, create it. Also add to `.gitignore` if not already present:
```
.claude/
```

## Continuation Prompt Structure

The continuation prompt must be optimized to produce valuable outcomes. Use this structure:

```markdown
## Project: [name]
[One line: what this project does]

## Context
- [Key fact Claude needs to know]
- [Decision already made - state as fact, not option]
- [Constraint or requirement]

## Current State
- **Completed:** [what's done]
- **In progress:** [where we stopped mid-task]
- **Blocked on:** [if applicable]

## Key Files
- `path/to/file.ts` - [its role in current task]
- `path/to/other.ts` - [why it matters]

## What NOT to Do
- [Approach already tried that failed - and why]
- [Decision already made - don't suggest alternatives]
- [Anti-patterns specific to this codebase]

## Next Action
[Specific instruction: not "continue working" but "implement the validation logic in handleSubmit() that rejects empty email fields"]
```

### Why This Structure Works

| Section | Purpose |
|---------|---------|
| **Project** | Orients Claude to the codebase quickly |
| **Context** | Facts and decisions - prevents re-discovery |
| **Current State** | Shows progress, prevents re-work |
| **Key Files** | Primes Claude to read the right things first |
| **What NOT to Do** | Prevents re-treading failed paths, stops re-litigation of decisions |
| **Next Action** | Specific task = immediate productivity vs. vague "continue" |

### Example Continuation Prompt

```markdown
## Project: acme-dashboard
Internal analytics dashboard for tracking user engagement metrics.

## Context
- Using React 18 + TypeScript + Tailwind
- Charts use Recharts library (decided over Chart.js for bundle size)
- Auth is handled by existing AuthContext - don't modify
- Data fetching uses React Query with 5-minute cache

## Current State
- **Completed:** User filter dropdown, date range picker, API endpoints
- **In progress:** Chart component - basic structure done, need to add tooltip customization
- **Blocked on:** Nothing

## Key Files
- `src/components/EngagementChart.tsx` - the component we're building
- `src/hooks/useEngagementData.ts` - React Query hook, already complete
- `src/types/metrics.ts` - TypeScript types for the data

## What NOT to Do
- Don't refactor useEngagementData - it's working and tested
- Don't add Chart.js - we chose Recharts already
- Don't create new API endpoints - backend is frozen this sprint

## Next Action
Add custom tooltip to EngagementChart that shows: date, value, and percent change from previous day. The tooltip should match the design in Figma (dark background, white text, rounded corners).
```

### Anti-Patterns to Avoid

- **Vague next steps:** "Continue working on the feature" → No direction
- **Missing decisions:** Leads to Claude re-suggesting rejected approaches
- **No file pointers:** Claude wastes turns exploring instead of acting
- **Passive framing:** "I was working on..." → Use active "Next action: ..."
