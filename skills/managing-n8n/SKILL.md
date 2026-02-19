---
name: managing-n8n
description: Create, validate, document, and optimize n8n workflows. Use when user asks to create, review, audit, optimize, document, or troubleshoot n8n workflows, nodes, connections, or automation flows.
---

# n8n Workflow Management

Guided creation, validation, documentation, and optimization of n8n workflows using parallel agents and structured JSON manipulation.

## Prerequisites

### CLI Tools

| Tool | Purpose | Install |
|---|---|---|
| `jq` | JSON validation and manipulation | Pre-installed on most systems |
| `curl` | API calls to n8n instance | Pre-installed on most systems |
| `n8n` | CLI for import/export/execute (optional) | `npm install -g n8n` |

### Environment Variables

Required for API operations. Store in `~/.config/n8n/credentials` (chmod 600), source from `~/.zshrc`:

| Variable | Purpose |
|---|---|
| `N8N_API_URL` | n8n instance API base URL (e.g., `https://n8n.example.com/api/v1`) |
| `N8N_API_TOKEN` | API key for authentication |

See `references/api_reference.md` for full API documentation.

### Cursor Command Allowlist

Add to allowlist for auto-run: `jq`, `curl`, `n8n`, `node`, `ls`, `cat`, `grep`, `diff`

## Input

The user provides one or more of:
- A description of an automation to build (e.g., "webhook que reciba un payload y lo envíe a Slack")
- An existing workflow JSON file to review/optimize
- A directory containing multiple workflow JSON files
- A specific integration requirement (e.g., "conectar GitHub con Jira")
- A workflow ID from the running n8n instance to fetch and review
- A request to list, activate, deactivate, or manage remote workflows

## Workflow

```
1. Understand requirements + check API connectivity
       ↓
2. n8n-workflow-builder → generates workflow JSON (+ optional push to instance)
       ↓
3. n8n-workflow-validator → validates structure, connections, error handling
       ↓
4. n8n-workflow-optimizer → performance, patterns, complexity reduction
       ↓
5. n8n-workflow-documenter → markdown docs + flow diagram
       ↓
6. User reviews and deploys (or activates via API)
```

### Step 0: API Preflight (automatic)

Before any operation, check if the n8n API is available:

```bash
if [ -n "$N8N_API_TOKEN" ] && [ -n "$N8N_API_URL" ]; then
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -H "X-N8N-API-KEY: $N8N_API_TOKEN" "$N8N_API_URL/workflows?limit=1")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "API: connected"
  fi
fi
```

If API is unavailable, fall back to local-only mode silently. Never block on API failure.

### Step 1: Understand Requirements

Before generating any workflow:
- Identify the trigger type (webhook, cron, manual, event)
- Determine integrations needed (services, APIs, databases)
- If API is available, list existing credentials via `GET /credentials` to use correct names
- Clarify error handling expectations (retry, notify, dead letter)
- Determine if the workflow should be active on import

### Step 2: Build Workflow

Run `n8n-workflow-builder` to create the workflow JSON:
- Read `references/node_patterns.md` for standard node configurations
- Read `references/workflow_templates.md` for common flow patterns
- Generate valid n8n workflow JSON with proper node connections
- Position nodes in a readable left-to-right layout

### Step 3: Validate

Run `n8n-workflow-validator` to check:
- JSON structure matches n8n schema
- All nodes have valid types and required parameters
- Connections reference existing node names
- Error handling paths exist for critical nodes
- No orphan nodes (disconnected from the flow)
- Credential references are consistent

### Step 4: Optimize

Run `n8n-workflow-optimizer` to suggest:
- Batch processing for bulk operations
- Pagination handling for API calls
- Split In Batches for large datasets
- Unnecessary node removal
- Expression simplification
- Sub-workflow extraction for complex flows (>15 nodes)

### Step 5: Document

Run `n8n-workflow-documenter` to generate:
- Markdown documentation of the workflow
- Flow diagram (via `awslabs.aws-diagram-mcp-server`)
- Integration map (services and credentials)
- Trigger and schedule description

### Step 6: Sync with Instance (optional)

If API is available (`N8N_API_URL` + `N8N_API_TOKEN` set), the agents can:

| Operation | Command | When |
|---|---|---|
| Push new workflow | `POST /workflows` | After building and validating locally |
| Update existing | `PUT /workflows/<id>` | After optimizing a fetched workflow. **Body must omit read-only fields** `id` and `active` (use `jq 'del(.id, .active)'`). Deactivate before PUT. |
| Fetch remote workflow | `GET /workflows/<id>` | To review/optimize a running workflow |
| List all workflows | `GET /workflows` | To browse instance inventory |
| Activate | `POST /workflows/<id>/activate` | After user confirms |
| Deactivate | `POST /workflows/<id>/deactivate` | Before updating a live workflow |
| Check executions | `GET /executions?workflowId=<id>` | To diagnose failures |
| List credentials | `GET /credentials` | To verify credential names during build |

See `references/api_reference.md` for full endpoint documentation.

**Safety rules for API operations**:
- Never activate without explicit user confirmation
- Always deactivate before updating a live workflow
- Save a local backup (`workflow_<id>_backup.json`) before any `PUT` operation
- Never delete workflows or credentials without user confirmation
- Never log or echo `$N8N_API_TOKEN`

## Agents

This skill uses 4 agents + 2 shared agents. All 4 primary agents can run in parallel when reviewing an existing workflow.

### 1. `n8n-workflow-builder` (green)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Create workflow JSON from requirements + push to instance

| Action | Details |
|---|---|
| API preflight | Check connectivity, list credentials if available |
| Read node patterns | `references/node_patterns.md` for standard configs |
| Read templates | `references/workflow_templates.md` for common flows |
| Generate trigger node | Webhook, Cron, Manual Trigger, or event-based |
| Generate processing nodes | HTTP Request, Code, Set, IF, Switch, Merge |
| Generate integration nodes | Slack, GitHub, AWS, database, email, etc. |
| Wire connections | Proper main and error output connections |
| Position nodes | Left-to-right, 250px horizontal spacing, grouped vertically |
| Validate JSON | `jq . <workflow.json>` syntax check |
| Push to instance | `POST /workflows` if API available and user confirms |
| Update on instance | Deactivate → `jq 'del(.id, .active)'` → `PUT /workflows/<id>`; see `references/api_reference.md` § Update Workflow |

### 2. `n8n-workflow-validator` (blue)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Validate workflow structure, connections, and error handling

| Action | Details |
|---|---|
| Fetch or read | `GET /workflows/<id>` if remote, or read local JSON |
| Schema validation | Required fields: name, nodes, connections |
| Node type validation | All `type` values are valid n8n node identifiers |
| Connection integrity | All connection targets exist as node names |
| Orphan detection | Every node is reachable from the trigger |
| Error path check | Critical nodes (HTTP, Code, DB) have error outputs |
| Credential validation | Cross-check names against `GET /credentials` if API available |
| Expression validation | `{{ }}` expressions use valid syntax |
| Parameter completeness | Required node parameters are set |
| Execution health | Check recent executions for error patterns via API |

### 3. `n8n-workflow-optimizer` (yellow)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Performance optimization and pattern improvement

| Action | Details |
|---|---|
| Fetch or read | `GET /workflows/<id>` if remote, or read local JSON |
| Execution analysis | Check `GET /executions` for error/slow patterns if API available |
| Batch processing | Add Split In Batches for large dataset operations |
| Pagination | Ensure API calls handle paginated responses |
| Retry logic | Add retry on failure for external API calls |
| Node reduction | Merge redundant Set/Code nodes |
| Expression optimization | Simplify complex expressions |
| Sub-workflow extraction | Split workflows >15 nodes into sub-workflows |
| Memory management | Flag nodes that load full datasets into memory |
| Rate limiting | Add Wait nodes before rate-limited APIs |

### 4. `n8n-workflow-documenter` (purple)
**Tools**: Read, Glob, Shell, awslabs.aws-diagram-mcp-server
**Responsibility**: Generate documentation and flow diagrams

| Action | Details |
|---|---|
| Fetch or read | `GET /workflows/<id>` if remote, or read local JSON |
| Generate markdown doc | Purpose, trigger, nodes, integrations, error handling |
| Generate flow diagram | Visual representation using diagrams package |
| Map integrations | List all external services and credential types |
| Document expressions | Complex expressions with explanation |
| Document environment vars | All `$env.` references used in the workflow |
| Execution summary | Recent execution stats from API if available |
| Generate runbook | How to deploy, test, monitor, and troubleshoot |

### 5. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Validate workflow against compliance requirements

| Action | Details |
|---|---|
| Credential handling | No hardcoded secrets in workflow JSON |
| Data exposure | No PII/PHI logged in Code nodes |
| Webhook security | Authentication configured on webhook triggers |
| Audit trail | Workflow logs sensitive operations |

### 6. `infra-documenter` (orange) — shared agent, optional
**Tools**: Read, Glob, Shell, awslabs.aws-diagram-mcp-server
**Responsibility**: Persist documentation for workflow decisions

| Action | Details |
|---|---|
| Write ADR | When choosing between integration patterns |
| Update changelog | What workflow was created/modified and why |
| Write runbook | Deploy, test, monitor, troubleshoot procedures |

## Output Format

### Creation Output

```
## Created: <workflow_name>

### Trigger
<trigger_type> — <description>

### Nodes (<count>)
- <node_name> (<node_type>) — <purpose>
- <node_name> (<node_type>) — <purpose>

### Integrations
- <service>: <credential_name> (<operation>)

### Error Handling
- <node_name>: <error_strategy>

### Files
- `<path>/workflow.json` — Workflow definition
- `<path>/README.md` — Documentation

### Validation
🟢 jq — valid JSON
🟢 Schema — all required fields present
🟢 Connections — all nodes connected
🟢 Error paths — critical nodes covered
```

### Review Output

```
## Review: <workflow_name>

### 🔴 Critical (must fix)
🔴 Issue description
    Node: `<node_name>`
    Fix: How to fix

### 🟠 Warnings (should fix)
🟠 Issue description
    Fix: How to fix

### 🔵 Optimizations (suggested)
🔵 Optimization description
    Current: <current pattern>
    Suggested: <improved pattern>
    Why: <benefit>

### 🟢 Passed
🟢 What's done correctly

---
Summary: 🔴 X critical, 🟠 Y warnings, 🔵 Z optimizations, 🟢 W passed
```

## Conventions

### Workflow Naming

- Snake case: `sync_github_issues_to_jira`
- Prefix by category: `notify_`, `sync_`, `process_`, `monitor_`, `deploy_`

### Node Naming

- Descriptive, action-based: "Fetch GitHub PRs", "Filter Open Issues", "Send Slack Alert"
- No default names like "HTTP Request", "IF", "Code" — always rename

### File Organization

```
n8n-workflows/
├── workflows/
│   ├── sync_github_issues_to_jira.json
│   ├── notify_deploy_status.json
│   └── process_webhook_events.json
├── docs/
│   ├── sync_github_issues_to_jira.md
│   ├── notify_deploy_status.md
│   └── diagrams/
│       └── sync_github_issues_to_jira.png
└── README.md
```

### Credential References

- Use descriptive credential names: `github_org_token`, `slack_devops_bot`, `aws_prod_role`
- Never hardcode tokens, API keys, or passwords in workflow JSON
- Reference credentials by name — the n8n instance resolves them

## Rules

- Always validate JSON with `jq` after generating or modifying
- Every workflow must have exactly one trigger node
- Every HTTP Request, Code, and database node must have error handling
- Never hardcode secrets — use n8n credentials or environment variables
- Node names must be descriptive — no default names
- Position nodes left-to-right with consistent spacing
- Workflows >15 nodes should be evaluated for sub-workflow extraction
- Do NOT activate workflows without explicit user confirmation
- If reviewing an existing workflow, run validator and optimizer in parallel
- Read `references/node_patterns.md` before generating any node configuration

### API Safety Rules

- Run API preflight before any remote operation
- If API is unavailable, fall back to local-only mode — never block
- Never log, echo, or write `$N8N_API_TOKEN` to any file
- Always `deactivate` before `PUT` on a live workflow
- Save local backup before any `PUT` (update) operation
- Never `DELETE` workflows or credentials without explicit user confirmation
- Use `curl -s` (silent) to suppress progress output
- Read `references/api_reference.md` before making API calls
