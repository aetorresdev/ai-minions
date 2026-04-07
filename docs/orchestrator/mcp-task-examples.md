# mcp_task examples for orchestrator (Option B – real subagents)

**Location:** `docs/orchestrator/mcp-task-examples.md` (repo root). [PATHS.md](PATHS.md)

You use `mcp_task` with `subagent_type="generalPurpose"` and in the **prompt** you define the role + context + deliverable. The Orchestrator (you or the chat) launches the task and receives the result.

Contract (MODE, handoffs, CRITICAL without implementing): [agent-contract.md](agent-contract.md). For **QA** or **CRITICAL** subagents, paste the `handoff:` block from the previous DEV/QA + relevant paths or diff.

---

## 1. Infra Architect

**When**: Initial infra design or infra architecture decision.

**Example call** (the chat/orchestrator invokes something like this):

```
Launch subagent: Infra Architect.

description: "Infra Architect: infra design for API + S3 bucket"

prompt: "
You are the Infrastructure Architect. Do not generate code yet.

Project context:
- Goal: Python REST API that reads/writes to an S3 bucket.
- Environment: AWS, single environment for now.
- Constraints: no sensitive data in S3, access only from the API.

Expected deliverable (in markdown):
1. Network/VPC schema if applicable.
2. AWS services to use (e.g. Lambda + API Gateway + S3, or ECS + ALB + S3).
3. Security considerations (IAM, encryption, access).
4. Cost controls: budget/alerts and cost allocation tags.
5. Short list of Terraform resources that would be needed (no code).

Respond only with the design in markdown, without implementing.
"
subagent_type: generalPurpose
```

---

## 2. Critic (design or code review)

**When**: After another agent delivers a design or a block of code/pipeline.

**Example call**:

```
Launch subagent: Critic.

description: "Critic: review of the previous infra design"

prompt: "
You are the Critic agent. Your role is to question decisions, not to implement.

Review the following design/code and deliver in markdown:
1. Risks or unexplained assumptions.
2. Alternatives worth considering.
3. Open questions the team should resolve before implementing.
4. A single paragraph: do you recommend proceeding with this design as-is, with minor changes, or rethinking it? Justify in 1–2 lines.

Design to review:
---
[PASTE THE INFRA ARCHITECT OUTPUT OR THE CODE TO REVIEW HERE]
---
Respond only with the review in markdown.
"
subagent_type: generalPurpose
```

---

## 3. State store flow (orchestrator-state MCP — strict orchestration)

**When**: Any orchestrated session where the on-disk store is the authority (not the chat).

**Full ORCHESTRATOR flow:**

```
# ── Session start ──────────────────────────────────────────────────────────
mcp__orchestrator-state__register_task(
  goal="add billing module",
  task_id="billing-v1",
  flow_mode="single_agent",
  max_iterations=3,
  approved_artifacts='["src/billing.py", "tests/test_billing.py"]'
)
# → { "ok": true, "task_id": "billing-v1", "state_dir": "..." }

# ── ORCHESTRATOR → DEV (no gates: first transition) ───────────────────────
mcp__orchestrator-state__advance_mode(
  task_id="billing-v1",
  to_mode="DEV",
  from_mode="ORCHESTRATOR",
  handoff_yaml="",
  iteration=-1
)

# ── DEV done → compact + validate + advance to QA ─────────────────────────
# 2a. If new files were not declared at registration:
mcp__orchestrator-state__record_artifact(task_id="billing-v1", path="src/billing.py")

# 2b. Compact DEV output
mcp__compact-handoff__compact_handoff(
  text="<full DEV output>",
  mode_completed="DEV",
  next_mode="QA",
  iteration=1,
  max_iterations=3,
  flow_mode="single_agent"
)
# → handoff_yaml (YAML string)

# 2c. Validate goal alignment (persists on envelope)
mcp__orchestrator-state__validate_goal_alignment(
  task_id="billing-v1",
  handoff_yaml="<handoff_yaml>"
)
# → { "ok": true, "aligned": true, ... }  — if false: do not advance

# 2d. Dry-run gates
mcp__orchestrator-state__validate_transition(
  task_id="billing-v1",
  from_mode="DEV",
  to_mode="QA",
  handoff_yaml="<handoff_yaml>",
  iteration=1
)
# → { "ok": true, "allowed": true, "errors": [] }

# 2e. Advance (only if allowed: true)
mcp__orchestrator-state__advance_mode(
  task_id="billing-v1",
  to_mode="QA",
  from_mode="DEV",
  handoff_yaml="<handoff_yaml>",
  iteration=1
)

# ── QA / CERBERUS: read clean context ─────────────────────────────────────
mcp__orchestrator-state__open_envelope(task_id="billing-v1", tail_events=20)
# → envelope + events_tail  (source of truth for the subagent)

# ── Close ──────────────────────────────────────────────────────────────────
mcp__orchestrator-state__close_task(task_id="billing-v1", reason="accepted by CERBERUS")
```

**Rules:**
- If `advance_mode` returns `ok: false` → ORCHESTRATOR **must not authorize** the next MODE.
- If `validate_goal_alignment` returns `aligned: false` → return to the previous MODE or escalate to OWNER.
- `open_envelope` is the context package for QA/CERBERUS in a subagent or separate thread.

---

## 4. How to use this in practice (Cursor)

1. **Option A**: Rule `orchestrator.mdc` + [agent-contract.md](agent-contract.md); in the same chat ask "follow the agent flow" and the model switches roles.
2. **Option B**: In the chat: use the prompts in this file via @mcp-task-examples or the path under `docs/orchestrator/`.
