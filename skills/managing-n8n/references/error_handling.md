# n8n Error Handling Patterns

Standard patterns for handling errors in n8n workflows.

## Node-Level Error Settings

Every node that calls external services must have error handling configured:

```json
{
  "name": "HTTP Request Node",
  "onError": "continueErrorOutput",
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 5000
}
```

### `onError` Options

| Value | Behavior | When to use |
|---|---|---|
| `stopWorkflow` | Stops execution on error (default) | Non-critical workflows where partial execution is useless |
| `continueRegularOutput` | Swallows error, continues on main output | When errors are expected and handled downstream |
| `continueErrorOutput` | Routes to error output branch | **Recommended** — allows explicit error handling |

## Error Output Pattern

Route errors to a dedicated error handler:

```json
{
  "connections": {
    "Fetch Data": {
      "main": [
        [{ "node": "Process Data", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

The error output is implicit when `onError: "continueErrorOutput"` is set. n8n routes failed items to the error output automatically.

## Pattern 1: Notify on Error

For non-critical operations where the team should know about failures:

```
[Trigger] → [Operation] → [Success Path]
                  ↓ (error)
            [Format Error] → [Send Slack Notification]
```

Error formatting node (Set):
```json
{
  "name": "Format Error",
  "type": "n8n-nodes-base.set",
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "name": "error_message",
          "value": "={{ $json.error.message || 'Unknown error' }}",
          "type": "string"
        },
        {
          "name": "node_name",
          "value": "={{ $json.error.node || 'Unknown' }}",
          "type": "string"
        },
        {
          "name": "workflow",
          "value": "={{ $workflow.name }}",
          "type": "string"
        },
        {
          "name": "execution_id",
          "value": "={{ $execution.id }}",
          "type": "string"
        }
      ]
    }
  }
}
```

## Pattern 2: Retry with Backoff

For transient failures (API rate limits, temporary outages):

```json
{
  "name": "Call External API",
  "type": "n8n-nodes-base.httpRequest",
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 5000
}
```

n8n uses fixed intervals between retries. For exponential backoff, use a Code node:

```javascript
const maxRetries = 3;
const attempt = $json.retryCount || 0;

if (attempt >= maxRetries) {
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

const delay = Math.pow(2, attempt) * 1000;
await new Promise(resolve => setTimeout(resolve, delay));

return [{ json: { ...item.json, retryCount: attempt + 1 } }];
```

## Pattern 3: Dead Letter Queue

For critical operations where failed items must be preserved:

```
[Trigger] → [Split In Batches] → [Process Item] → [Success Aggregator]
                                       ↓ (error)
                                 [Save to Dead Letter] → [Continue Batch]
```

Dead letter storage options:
- **S3 bucket**: `n8n-dead-letters/<workflow>/<date>/<execution_id>.json`
- **Database table**: `dead_letter_queue` with columns: workflow, node, payload, error, timestamp
- **File system**: `/data/n8n/dead-letters/` (for self-hosted)

## Pattern 4: Compensating Action (Rollback)

For multi-step operations where partial completion is dangerous:

```
[Trigger] → [Step 1: Create Resource] → [Step 2: Configure] → [Step 3: Activate]
                                              ↓ (error)
                                        [Rollback: Delete Resource]
```

Track created resources through the flow:

```javascript
const createdResources = [];
createdResources.push({ type: 'resource', id: $json.resourceId });
return [{ json: { ...item.json, _createdResources: createdResources } }];
```

## Pattern 5: Circuit Breaker

For protecting against cascading failures when calling unreliable services:

```
[Trigger] → [Check Circuit State] → [OPEN: Return Cached/Default]
                  ↓ (closed)
            [Call Service] → [Update Success Count] → [Continue]
                  ↓ (error)
            [Update Failure Count] → [Check Threshold] → [Open Circuit / Notify]
```

Implement with a global variable or external state (Redis, database):

```javascript
const circuitKey = 'circuit_' + $workflow.name;
const state = $env[circuitKey] || 'closed';
const failureCount = parseInt($env[circuitKey + '_failures'] || '0');
const threshold = 5;

if (state === 'open') {
  return [{ json: { circuitOpen: true, cachedResponse: true } }];
}

if (failureCount >= threshold) {
  // Open the circuit — requires external state management
  return [{ json: { circuitOpen: true, reason: 'threshold exceeded' } }];
}
```

## Pattern 6: Webhook Response with Error

For webhook-triggered workflows that must return meaningful error responses:

```
[Webhook] → [Process] → [Respond 200 OK]
                ↓ (error)
          [Respond 500 Error]
```

Error response node:
```json
{
  "name": "Respond 500 Error",
  "type": "n8n-nodes-base.respondToWebhook",
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ JSON.stringify({ error: true, message: $json.error?.message || 'Internal error', executionId: $execution.id }) }}",
    "options": {
      "responseCode": 500
    }
  }
}
```

## Error Handling Matrix

| Node Type | onError | Retry | Error Output | Notification |
|---|---|---|---|---|
| Webhook Trigger | N/A | N/A | N/A | N/A |
| HTTP Request | `continueErrorOutput` | Yes (3x) | Required | Yes |
| Code | `continueErrorOutput` | No | Required | Yes |
| Database | `continueErrorOutput` | Yes (2x) | Required | Yes |
| Slack/Email | `continueErrorOutput` | Yes (2x) | Optional | No (avoid loops) |
| IF/Switch | `stopWorkflow` | No | No | No |
| Set/Edit Fields | `stopWorkflow` | No | No | No |
| Merge | `stopWorkflow` | No | No | No |

## Workflow-Level Error Handling

n8n supports a workflow-level error trigger:

```json
{
  "name": "Error Trigger",
  "type": "n8n-nodes-base.errorTrigger",
  "typeVersion": 1,
  "position": [0, 300],
  "parameters": {}
}
```

This fires when any node in the workflow fails without being caught by a node-level error handler. Use it as a catch-all:

```
[Error Trigger] → [Format Error Details] → [Send Alert] → [Log to Dead Letter]
```

Place the Error Trigger node below the main flow, visually separated.
