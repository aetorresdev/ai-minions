---
name: proposal-refine
description: Apply feedback to a proposal and create a new versioned file (_v2, _v3). Use after review or when you have specific changes to make.
argument-hint: <proposal file path>
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
---

# Proposal Refinement Skill

Applies feedback (from review or user) and creates a new versioned proposal file.

## Invocation
```
/proposal-refine [file path]
> [optional: specific feedback to apply]
```

Or after `/proposal-review`:
```
/proposal-refine
```
(Uses feedback from most recent review)

## Process

### 1. Version Detection
- No suffix → v1 (original)
- `_v2` → v2
- Detect highest existing version in directory

### 2. Feedback Collection
Sources (in priority order):
1. User-provided feedback in current message
2. Most recent `/proposal-review` output
3. Prompt user if no feedback available

### 3. Apply Changes
For each feedback item:
1. Locate the relevant section/lines
2. Apply the fix
3. Track what was changed

### 4. Write New Version
- Create `[filename]_v[N+1].md`
- Never overwrite original or previous versions

### 5. Update CLAUDE.md
Add to "Revision Learnings" section:
- What was changed and why
- Patterns that worked/didn't work

### 6. Output Summary

```markdown
## Created: [filename]_v2.md

### Changes Applied
| Section | Change | Lines |
|---------|--------|-------|
| 2.5 | Reframed from negative to enabling | 129-148 |
| 3.1 | Rewrote AI-sounding bullets | 171-176 |
| 4.x | Restructured as workstreams | 244-313 |
| 4.4 | Added Assumptions section | 314-340 |
...

### CLAUDE.md Updated
- Added revision learnings
- Updated project files table
```

## Versioning Rules

1. **Never overwrite** - always create new version file
2. **Preserve history** - keep all versions
3. **Track changes** - document what changed between versions
4. **Update context** - CLAUDE.md reflects current state

## Integration with Hooks

If proposal versioning hook is active, direct edits to unversioned proposal files will be blocked with guidance to use `/proposal-refine`.
