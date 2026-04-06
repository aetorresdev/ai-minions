---
name: proposal-review
description: Review a consulting proposal against quality checklist (voice, structure, scoping, traceability). Use after creating a proposal draft.
argument-hint: <proposal file path>
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Proposal Review Skill

Analyzes a proposal document against standard quality criteria and produces actionable feedback.

## Invocation
```
/proposal-review [file path]
```

## Process

1. Read the proposal file
2. Evaluate each checklist category
3. Output structured review with:
   - PASS / FAIL / PARTIAL for each item
   - Specific line references for issues
   - Recommended fixes (concrete, not just identification)

## Checklist

### Voice & Tone
- [ ] No AI-sounding constructs ("This means:", "Key takeaways:", abstract bullet lists)
- [ ] Natural consulting voice (direct, specific, concrete)
- [ ] Active voice preferred over passive
- [ ] No unnecessary hedging or qualifiers

### Structure
- [ ] Use "workstreams" only when multiple teams execute in parallel
- [ ] Use "phases" for sequential stages within a single team's process
- [ ] Future work beyond current engagement labeled as "initiatives"
- [ ] Assumptions section present with categories:
  - Technical/Codebase
  - Stakeholder/Resource
  - Scope
  - Process
- [ ] Success criteria achievable within stated timeline
- [ ] No over-engineered process for engagement length

### Scoping
- [ ] Timeline realistic (6 weeks = realistic, 4 weeks = needs caveats)
- [ ] POC scope bounded (2-3 items, one platform)
- [ ] Process overhead matches engagement length
- [ ] Team composition appropriate for scope

### Stakeholder Clarity
- [ ] Success criteria defined per stakeholder
- [ ] Implications of differing priorities addressed
- [ ] Resource commitments explicit with time estimates
- [ ] Decision-makers identified

### Traceability
- [ ] Factual claims attributed to source
- [ ] Assumptions explicitly flagged as assumptions
- [ ] Inferences noted as "to be validated during discovery"

## Output Format

```markdown
## Proposal Review: [filename]

### Summary
- X items PASS
- Y items need attention
- Z critical issues

### Voice & Tone
- [PASS] No AI-sounding language
- [FAIL] Line 47-52: "This means:" followed by abstract bullets
  → Rewrite as "In practice:" with specific examples

### Structure
- [PASS] Assumptions section present
- [PARTIAL] Line 180: Future work called "phases"
  → Change "Phase 3: Full Migration" to "Initiative: Full Migration"

### Scoping
...

### Recommended Actions
1. [Priority] Fix X on line Y
2. [Priority] Fix A on line B
...
```

## Integration

After review completes, offer:
```
Review complete. X issues found.
- Run /proposal-refine to apply fixes and create v2
- Or address specific items manually
```
