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

### n8n-MCP server (recommended for correct node/connection data)

To avoid schema errors when creating or connecting nodes, use the **n8n-MCP** server in Cursor. It provides up-to-date node types, properties, and validation.

- **Docker image**: `ghcr.io/czlonkowski/n8n-mcp:latest` — Cursor runs the container on demand (stdio); no long-lived container to manage.
- **Setup**: See `references/mcp_docker_setup.md` for pull command and Cursor MCP config (documentation-only or with `N8N_API_URL`/`N8N_API_KEY` for workflow management).

### Using the n8n-MCP server

When the **n8n-mcp** MCP server is configured in Cursor, **prefer its tools** for node discovery, schemas, and validation. Fall back to static references (`node_patterns.md`, `workflow_templates.md`) only if the MCP is unavailable.

| MCP tool | Use when |
|---|---|
| `search_nodes` | Finding node types by keyword (e.g. "webhook", "slack", "schedule"); use `includeExamples: true` for config examples. |
| `get_node` | Getting full node schema, required parameters, and operations before configuring a node. |
| `validate_node` | Validating a node config before adding to the workflow: `mode: 'minimal'` for quick checks, `mode: 'full', profile: 'runtime'` before finalizing. |
| `validate_workflow` | Validating the full workflow (nodes + connections + expressions) after building or after changes. |
| Create/update/execute (when `N8N_API_URL` + `N8N_API_KEY` are set) | Prefer the MCP’s workflow management tools over direct `curl` to the n8n API when the MCP has API credentials (passed from env into the container). |

- **Build (Step 2)**: Use `search_nodes` / `get_node` to resolve node types and parameters; use `validate_node` for each non-trivial node; use `validate_workflow` once the workflow JSON is complete.
- **Validate (Step 3)**: Call `validate_workflow` first when MCP is available; then run manual checks (orphans, error paths, credentials, execution health) as needed. If MCP is unavailable, run all checks from this skill and the validator agent.

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
4b. n8n-workflow-metrics-optimizer (optional, API required) → execution metrics, success/error rate, duration, recommendations
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
- **When n8n-mcp MCP is available**: Use `search_nodes` to find node types, `get_node` for schemas and required parameters, `validate_node` for each node config, and `validate_workflow` when the workflow is complete.
- **When MCP is unavailable**: Read `references/node_patterns.md` and `references/workflow_templates.md` for standard configs and patterns.
- Generate valid n8n workflow JSON with proper node connections; position nodes in a readable left-to-right layout.

### Step 3: Validate

Run `n8n-workflow-validator` to check:
- **When n8n-mcp MCP is available**: Call `validate_workflow` first and include its results; then run manual checks below as needed.
- **When MCP is unavailable**: Run all checks from the validator agent and references.
- JSON structure matches n8n schema; all nodes have valid types and required parameters; connections reference existing node names; error handling paths exist for critical nodes; no orphan nodes; credential references consistent.

### Step 4: Optimize

Run `n8n-workflow-optimizer` to suggest:
- Batch processing for bulk operations
- Pagination handling for API calls
- Split In Batches for large datasets
- Unnecessary node removal
- Expression simplification
- Sub-workflow extraction for complex flows (>15 nodes)

The optimizer must report in **concise** form: **(1) Already applied** (short bullets), **(2) Pending** (table or short list of suggested changes only), **(3) Summary** (one sentence). Do not produce long Current/Suggested/Why blocks unless the user asks for detail.

### Step 4b: Metrics (optional, API required)

Run `n8n-workflow-metrics-optimizer` when the n8n API is available and you want data-driven recommendations:
- Fetch recent executions for the workflow (`GET /executions?workflowId=<id>`).
- Compute success/error rate, duration stats, failing nodes, timeouts.
- Suggest improvements (retry, batching, error handling, rate limiting) based on patterns.
- Output in the same concise form: Already applied / Pending / Summary.
- If API is unavailable, skip and note "Metrics step skipped (API required)."

### Step 5: Document

Run `n8n-workflow-documenter` to generate:
- Markdown documentation of the workflow
- Flow diagram (via `awslabs.aws-diagram-mcp-server`)
- Integration map (services and credentials)
- Trigger and schedule description

### Step 6: Sync with Instance (optional)

If API is available (`N8N_API_URL` + `N8N_API_TOKEN` or `N8N_API_KEY` set), the agents can push, update, and manage workflows. **When the n8n-mcp MCP is configured with API credentials** (e.g. `N8N_API_URL` and `N8N_API_KEY` passed from env into the container), prefer the MCP’s create/update/execute tools over direct `curl`; otherwise use the API with curl:

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

This skill uses 5 agents + 2 shared agents. The 4 primary workflow agents (builder, validator, optimizer, documenter) can run in parallel when reviewing an existing workflow; the metrics optimizer runs when API is available and metrics review is requested.

### 1. `n8n-workflow-builder` (green)
**Tools**: Read, Grep, Glob, Shell, **n8n-mcp** (when configured: `search_nodes`, `get_node`, `validate_node`, `validate_workflow`)
**Responsibility**: Create workflow JSON from requirements + push to instance

| Action | Details |
|---|---|
| API preflight | Check connectivity, list credentials if available |
| Node discovery | **MCP**: `search_nodes` + `get_node` for types and params. **Fallback**: `references/node_patterns.md` |
| Templates | **MCP**: use examples from `search_nodes` with `includeExamples: true`. **Fallback**: `references/workflow_templates.md` |
| Generate trigger node | Webhook, Cron, Manual Trigger, or event-based |
| Generate processing nodes | HTTP Request, Code, Set, IF, Switch, Merge |
| Generate integration nodes | Slack, GitHub, AWS, database, email, etc. |
| Wire connections | Proper main and error output connections |
| Position nodes | Left-to-right, 250px horizontal spacing, grouped vertically |
| Validate | **MCP**: `validate_node` per node (minimal/full), then `validate_workflow`. **Always**: `jq . <workflow.json>` syntax check |
| Push to instance | `POST /workflows` if API available and user confirms |
| Update on instance | Deactivate → `jq 'del(.id, .active)'` → `PUT /workflows/<id>`; see `references/api_reference.md` § Update Workflow |

### 2. `n8n-workflow-validator` (blue)
**Tools**: Read, Grep, Glob, Shell, **n8n-mcp** (when configured: `validate_workflow`, optionally `validate_node`)
**Responsibility**: Validate workflow structure, connections, and error handling

| Action | Details |
|---|---|
| Fetch or read | `GET /workflows/<id>` if remote, or read local JSON |
| Schema / nodes / connections | **MCP**: Call `validate_workflow` first, include its output in the report. **Fallback**: Manual checks below |
| Required fields | name, nodes, connections |
| Node type validation | All `type` values valid n8n node identifiers |
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

### 4. `n8n-workflow-metrics-optimizer` (cyan) — optional, API required
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Execution metrics and data-driven recommendations

| Action | Details |
|--------|---------|
| Require API | Skip with clear message if `N8N_API_URL` / `N8N_API_TOKEN` not set |
| Fetch executions | `GET /executions?workflowId=<id>&limit=50`; optionally `status=error` for failures |
| Compute metrics | Success/error rate, duration (min/median/max or p95), failing node frequency |
| Analyze patterns | Same node failing, duration growth, timeouts, failure bursts |
| Suggest improvements | Retry, timeout, batching, error handling, rate limiting based on data |
| Output | Concise: Already applied / Pending / Summary (same format as optimizer) |

### 5. `n8n-workflow-documenter` (purple)
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

### 6. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Validate workflow against compliance requirements

| Action | Details |
|---|---|
| Credential handling | No hardcoded secrets in workflow JSON |
| Data exposure | No PII/PHI logged in Code nodes |
| Webhook security | Authentication configured on webhook triggers |
| Audit trail | Workflow logs sensitive operations |

### 7. `infra-documenter` (orange) — shared agent, optional
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
- When n8n-mcp MCP is available, use its tools (`search_nodes`, `get_node`, `validate_node`, `validate_workflow`) for node discovery and validation; otherwise use `references/node_patterns.md` and manual checks

### API Safety Rules

- Run API preflight before any remote operation
- If API is unavailable, fall back to local-only mode — never block
- Never log, echo, or write `$N8N_API_TOKEN` to any file
- Always `deactivate` before `PUT` on a live workflow
- Save local backup before any `PUT` (update) operation
- Never `DELETE` workflows or credentials without explicit user confirmation
- Use `curl -s` (silent) to suppress progress output
- Read `references/api_reference.md` before making API calls
