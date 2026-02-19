# n8n API v1 Reference

API operations for interacting with a running n8n instance. Requires `N8N_API_URL` and `N8N_API_TOKEN` environment variables.

## Authentication

All requests use the `X-N8N-API-KEY` header:

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" "$N8N_API_URL/endpoint"
```

### Preflight Check

Before any API operation, verify connectivity:

```bash
curl -sf -o /dev/null -w "%{http_code}" -H "X-N8N-API-KEY: $N8N_API_TOKEN" "$N8N_API_URL/workflows?limit=1"
```

- `200` = connected and authenticated
- `401` = invalid token
- `000` or timeout = instance unreachable

## Workflows

### List Workflows

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows?limit=100&cursor=" | jq .
```

Response:
```json
{
  "data": [
    {
      "id": "abc123",
      "name": "workflow_name",
      "active": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-15T00:00:00.000Z",
      "tags": [{ "id": "1", "name": "production" }]
    }
  ],
  "nextCursor": "eyJsaW1pdCI6..."
}
```

Pagination: use `nextCursor` value in `cursor` param for next page.

### Get Workflow by ID

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows/<ID>" | jq .
```

Returns full workflow JSON including nodes, connections, and settings.

### Create Workflow

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @workflow.json \
  "$N8N_API_URL/workflows" | jq .
```

The JSON body must include: `name`, `nodes`, `connections`, `settings`.
Returns the created workflow with assigned `id`.

### Update Workflow

The API accepts a full workflow definition but treats **`id`** and **`active`** as read-only. The request body must **omit** these fields or the server returns `400`.

**Procedure (always use this when updating from local JSON):**

1. **Deactivate** the workflow first (required before updating a live workflow).
2. **Strip read-only fields** from the local JSON with `jq`.
3. **PUT** the resulting body.

```bash
# 1. Deactivate (required before updating)
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows/<ID>/deactivate" | jq .

# 2. Update: payload must NOT include id or active
jq 'del(.id, .active)' workflow.json > /tmp/workflow_payload.json
curl -s -X PUT -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/workflow_payload.json \
  "$N8N_API_URL/workflows/<ID>" | jq .
```

Replaces the entire workflow definition. The workflow remains **inactive** after update; activate only with explicit user confirmation.

### Delete Workflow

```bash
curl -s -X DELETE -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows/<ID>" | jq .
```

### Activate Workflow

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows/<ID>/activate" | jq .
```

### Deactivate Workflow

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/workflows/<ID>/deactivate" | jq .
```

### Transfer Workflow (between projects)

```bash
curl -s -X PUT -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destinationProjectId": "<PROJECT_ID>"}' \
  "$N8N_API_URL/workflows/<ID>/transfer" | jq .
```

## Executions

### List Executions

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/executions?workflowId=<ID>&status=error&limit=20" | jq .
```

Filter parameters:
- `workflowId` — filter by workflow
- `status` — `error`, `success`, `waiting`
- `limit` — max results (default 20)
- `cursor` — pagination cursor

### Get Execution Details

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/executions/<EXEC_ID>?includeData=true" | jq .
```

Set `includeData=true` to get input/output data for each node.

### Delete Execution

```bash
curl -s -X DELETE -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/executions/<EXEC_ID>" | jq .
```

## Credentials

### List Credentials (metadata only)

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/credentials" | jq .
```

Returns credential names, types, and IDs. **Never returns secret values.**

Response:
```json
{
  "data": [
    {
      "id": "1",
      "name": "slack_devops_bot",
      "type": "slackApi",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-15T00:00:00.000Z"
    }
  ]
}
```

### Create Credential

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "credential_name",
    "type": "credentialType",
    "data": { "key": "value" }
  }' \
  "$N8N_API_URL/credentials" | jq .
```

### Delete Credential

```bash
curl -s -X DELETE -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/credentials/<ID>" | jq .
```

## Tags

### List Tags

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/tags?limit=100" | jq .
```

### Create Tag

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "tag_name"}' \
  "$N8N_API_URL/tags" | jq .
```

## Variables

### List Variables

```bash
curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  "$N8N_API_URL/variables" | jq .
```

### Create Variable

```bash
curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "VAR_NAME", "value": "var_value"}' \
  "$N8N_API_URL/variables" | jq .
```

## Helper Functions

### Fetch workflow and save locally

```bash
n8n_export() {
  local id="$1" output="${2:-workflow_${1}.json}"
  curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
    "$N8N_API_URL/workflows/$id" | jq '.' > "$output"
  echo "Exported workflow $id → $output"
}
```

### Push local JSON to instance

```bash
n8n_import() {
  local file="$1"
  curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @"$file" \
    "$N8N_API_URL/workflows" | jq '{id: .id, name: .name, active: .active}'
}
```

### Update existing workflow from local JSON

Deactivates the workflow, strips read-only fields (`id`, `active`) from the local file, then PUTs. Workflow stays inactive after update.

```bash
n8n_update() {
  local id="$1" file="$2"
  # Deactivate first (required before updating)
  curl -s -X POST -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
    "$N8N_API_URL/workflows/$id/deactivate" > /dev/null
  # PUT with payload that omits id and active (read-only)
  jq 'del(.id, .active)' "$file" | curl -s -X PUT \
    -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @- \
    "$N8N_API_URL/workflows/$id" | jq '(if .data then .data else . end) | {id, name, active}'
}
```

Usage: `n8n_update <WORKFLOW_ID> <path/to/workflow.json>`

### List failed executions for a workflow

```bash
n8n_failures() {
  local id="$1" limit="${2:-10}"
  curl -s -H "X-N8N-API-KEY: $N8N_API_TOKEN" \
    "$N8N_API_URL/executions?workflowId=$id&status=error&limit=$limit" | \
    jq '.data[] | {id: .id, startedAt: .startedAt, stoppedAt: .stoppedAt}'
}
```

## Error Responses

| HTTP Code | Meaning | Action |
|---|---|---|
| 200 | Success | — |
| 201 | Created | — |
| 400 | Bad request (invalid JSON or missing fields) | Check request body |
| 401 | Unauthorized (bad token) | Verify `N8N_API_TOKEN` |
| 404 | Resource not found | Check workflow/execution ID |
| 409 | Conflict (e.g., duplicate name) | Rename or update instead |
| 500 | Server error | Check n8n instance logs |

## Security Notes

- `N8N_API_TOKEN` grants full access to the instance — treat it like a root password
- Never log, echo, or write the token to files in any git repo
- Use `curl -s` (silent) to avoid progress output leaking in logs
- Credential secret values are never returned by the API — only metadata
- Use `jq` to filter responses and avoid accidentally displaying sensitive execution data
