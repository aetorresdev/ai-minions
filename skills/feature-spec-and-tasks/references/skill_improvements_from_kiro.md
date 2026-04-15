# Skill Improvements: Learnings from Kiro Spec Format

Analysis of what the Kiro-generated spec format does well and what can be optimized in the `feature-spec-and-tasks` skill. Use this when iterating on the skill or when deciding whether to adopt Kiro-style structure in single-doc output.

---

## What Kiro Format Does Well (Worth Adopting)

### 1. **Glossary up front**
- **Kiro**: requirements.md starts with a **Glossary** (e.g. Collector, Run_ID, Data_Contract, Alarm) before any requirement.
- **Benefit**: Shared vocabulary for agents and humans; reduces ambiguity when tasks reference "THE &lt;Entity&gt;" or "Run_ID". Critical in domain-heavy specs (observability, infra, automated detection).
- **Skill today**: No explicit Glossary in the template; "Context (read first)" exists but is about assets (ADRs, runbooks), not term definitions.
- **Recommendation**: Add **Glossary** as a first-class subsection in Overview (or right after it). Instruct: "For initiatives with domain or acronym-heavy language, add a Glossary listing key terms and entities (e.g. Run_ID, Data_Contract, Collector) so requirements and tasks use the same names."

### 2. **Acceptance criteria as numbered list per requirement**
- **Kiro**: Each requirement has acceptance criteria as a **numbered list** (1., 2., 3.). Tasks then reference at **criterion level** (_Requirements: 4.1, 4.2, 9.6_).
- **Benefit**: Traceability is granular: a task can "satisfy 4.1 and 4.2" instead of only "REQ-004". Easier to verify coverage and to split tasks without losing traceability.
- **Skill today**: "Each requirement: ID (e.g. REQ-001), statement, **optional** acceptance criteria" — no rule that criteria are numbered, and tasks use "Satisfies: REQ-001, REQ-002" only at requirement level.
- **Recommendation**: In `ears_and_format.md`, require **numbered acceptance criteria** (1., 2., …) under each requirement when there is more than one criterion. In tasks, allow **Satisfies: REQ-001 (criteria 1,2), REQ-002** or **REQ-001.1, REQ-001.2** so subtasks can point to specific criteria.

### 3. **Hierarchical tasks with subtasks**
- **Kiro**: tasks.md has top-level tasks (1., 2., 3.) and **indented subtasks** (2.1, 2.2, 2.3) with checkboxes. Each subtask has its own _Requirements:_ line.
- **Benefit**: One TASK can be broken into implementable chunks without exploding the task list; dependencies stay clear (e.g. "2.2 after 2.1").
- **Skill today**: Flat list TASK-001, TASK-002; "Steps / checklist" inside a task but no formal subtask as first-class item with its own ID and requirement ref.
- **Recommendation**: Allow **optional subtasks** with IDs like TASK-002.1, TASK-002.2, each with Deliverables / Satisfies / Steps / Acceptance. Keep flat list as default for small specs; use hierarchy when the initiative is large (e.g. 10+ tasks).

### 4. **Explicit "optional" vs "required" tasks**
- **Kiro**: Tasks marked with `*` (e.g. "3.10\* Write unit tests") are **optional** (e.g. for faster MVP). Notes section states "Tasks marked with \* are optional testing tasks."
- **Benefit**: Clear what can be skipped for MVP or first release; avoids "do we have to do every single task?" ambiguity.
- **Skill today**: No optional/required distinction; every task is implicitly required.
- **Recommendation**: Add **Optional (can skip for MVP)** to the task template. When generating, allow marking tasks (e.g. "TASK-00N (optional): property tests") and add one line in Documentation or Notes: "Tasks marked optional can be deferred for MVP."

### 5. **Deployment order and directory structure in one place**
- **Kiro**: tasks.md ends with **Deployment order** (numbered list: 1. Create module, 2. Implement core components, …) and **Directory structure** (ASCII tree). Notes include implementation language, checkpoint strategy.
- **Benefit**: Single place to see "in what order do I run things" and "where do artifacts live"; reduces back-and-forth between design and tasks.
- **Skill today**: "Order: list tasks in dependency order" and "TASK-Y after TASK-X" — but no explicit "Deployment order" summary or directory tree.
- **Recommendation**: For larger specs, add a short **Deployment order** subsection (numbered list of phases or milestones) and an optional **Directory structure** (tree of paths). Reference from "Before executing" (e.g. "Follow deployment order in Tasks; ensure directory structure exists").

### 6. **User story per requirement**
- **Kiro**: Each requirement has a **User Story** line: "Como [rol], quiero [objetivo], para que [beneficio]."
- **Benefit**: Connects technical EARS to intent; helps prioritization and communication with non-technical stakeholders.
- **Skill today**: EARS only; no user story in the template.
- **Recommendation**: Make **User story** an optional line under each requirement ("As a [role], I want [goal] so that [benefit]"). Use when the initiative has multiple personas or when the spec is shared with product/ops.

---

## What Could Be Optimized in the Current Skill

### A. **Single doc vs multi-file**
- **Current**: One big markdown; good for small initiatives, harder to navigate when spec is 500+ lines.
- **Optimization**: Treat **multi-file (requirements / design / tasks)** as a first-class option when (1) user mentions Kiro, or (2) initiative is large (e.g. 15+ requirements, 20+ tasks). Document in skill: "If spec exceeds N sections or user requests split, offer to output requirements.md, design.md, tasks.md per `kiro_spec_format.md`."

### B. **Requirement entity naming**
- **Kiro**: Uses **THE &lt;Entity&gt;** consistently (e.g. THE Function, THE Terraform_Module, THE Data_Contract). Entities match glossary.
- **Current**: "The system SHALL" is standard EARS; no rule to use domain entities from a glossary.
- **Optimization**: In EARS reference, add: "When a Glossary exists, use **THE &lt;Glossary_term&gt;** in requirements so entities are consistent and traceable to the glossary."

### C. **Checkpoints / milestones**
- **Kiro**: tasks.md has explicit "Checkpoint" tasks (e.g. "13. Checkpoint - Ensure all components and infrastructure are deployed") and "18. Checkpoint - Ensure all tests pass."
- **Current**: Prerequisites and order exist but no explicit "checkpoint" or "milestone" task type.
- **Optimization**: Allow **Checkpoint** as a task type (or tag): "TASK-0XX: Checkpoint — [condition]. No deliverable; gate before next phase." Helps break execution into phases and avoid running ahead without validation.

### D. **Property tests / validation tasks**
- **Kiro**: Some tasks are property-based tests ("Property 10: Correlation Completeness"); they validate invariants across requirements.
- **Current**: Acceptance is per task; no explicit "property test" or "cross-requirement validation" concept.
- **Optimization**: For initiatives with many requirements, add optional **Validation / property test** tasks that state which requirements they cross-check (e.g. "Validates: REQ-4.2, 4.3, 4.4"). Keeps traceability for QA and regression.

---

## Summary: Quick Wins vs Larger Changes

| Change | Effort | Impact |
|--------|--------|--------|
| Add **Glossary** to Overview | Low | High (clarity, consistency) |
| **Numbered acceptance criteria** + Satisfies REQ-X.Y | Low | High (traceability) |
| **Optional** task marking | Low | Medium (MVP clarity) |
| **User story** per requirement (optional) | Low | Medium (intent) |
| **Deployment order** + **Directory structure** subsection | Low | Medium (execution) |
| **Subtasks** (TASK-002.1, 002.2) | Medium | High for large specs |
| **Checkpoint** tasks | Low | Medium (phasing) |
| **THE &lt;Entity&gt;** from glossary in EARS | Low | Medium (consistency) |
| Multi-file as first-class for large specs | Medium | High for Kiro users |

These improvements have been incorporated into the skill and `ears_and_format.md`: Glossary, numbered acceptance criteria, optional tasks, deployment order, directory structure, THE Entity from glossary, user story, subtasks, checkpoints, validation/property test tasks, and multi-file as first-class for large specs or Kiro users. The doc remains as a reference for the rationale behind each change. Keep examples and references **generic** (no specific org, repo, or product names) so the skill repo stays suitable for public use.
