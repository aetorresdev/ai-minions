# n8n Node Patterns

Standard configurations for commonly used n8n nodes. Reference this before generating any node.

## Trigger Nodes

### Webhook

```json
{
  "name": "Webhook Trigger",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "position": [0, 0],
  "webhookId": "unique-uuid-here",
  "parameters": {
    "path": "my-webhook-path",
    "httpMethod": "POST",
    "authentication": "headerAuth",
    "responseMode": "responseNode",
    "options": {}
  }
}
```

Authentication options: `none`, `basicAuth`, `headerAuth`, `jwtAuth`
Response modes: `onReceived` (immediate 200), `responseNode` (custom response via Respond to Webhook node), `lastNode` (return last node output)

### Schedule Trigger (Cron)

```json
{
  "name": "Schedule Trigger",
  "type": "n8n-nodes-base.scheduleTrigger",
  "typeVersion": 1.2,
  "position": [0, 0],
  "parameters": {
    "rule": {
      "interval": [
        {
          "field": "cronExpression",
          "expression": "0 */6 * * *"
        }
      ]
    }
  }
}
```

### Manual Trigger

```json
{
  "name": "Manual Trigger",
  "type": "n8n-nodes-base.manualTrigger",
  "typeVersion": 1,
  "position": [0, 0],
  "parameters": {}
}
```

## HTTP & API Nodes

### HTTP Request

```json
{
  "name": "Fetch Data",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [250, 0],
  "parameters": {
    "method": "GET",
    "url": "https://api.example.com/resource",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "httpHeaderAuth",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [
        {
          "name": "Accept",
          "value": "application/json"
        }
      ]
    },
    "options": {
      "timeout": 30000,
      "batching": {
        "batch": {
          "batchSize": 10,
          "batchInterval": 1000
        }
      },
      "response": {
        "response": {
          "responseFormat": "autodetect"
        }
      }
    }
  },
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 5000
}
```

### GraphQL Request

```json
{
  "name": "GraphQL Query",
  "type": "n8n-nodes-base.graphql",
  "typeVersion": 1,
  "position": [250, 0],
  "parameters": {
    "endpoint": "https://api.example.com/graphql",
    "requestMethod": "POST",
    "query": "query { items { id name } }",
    "responseFormat": "json"
  }
}
```

## Logic Nodes

### IF

```json
{
  "name": "Check Status",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "position": [500, 0],
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "strict"
      },
      "conditions": [
        {
          "id": "uuid-here",
          "leftValue": "={{ $json.status }}",
          "rightValue": "success",
          "operator": {
            "type": "string",
            "operation": "equals"
          }
        }
      ],
      "combinator": "and"
    },
    "options": {}
  }
}
```

### Switch

```json
{
  "name": "Route by Type",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "position": [500, 0],
  "parameters": {
    "rules": {
      "values": [
        {
          "outputKey": "issue",
          "conditions": {
            "conditions": [
              {
                "leftValue": "={{ $json.type }}",
                "rightValue": "issue",
                "operator": { "type": "string", "operation": "equals" }
              }
            ]
          }
        },
        {
          "outputKey": "pr",
          "conditions": {
            "conditions": [
              {
                "leftValue": "={{ $json.type }}",
                "rightValue": "pull_request",
                "operator": { "type": "string", "operation": "equals" }
              }
            ]
          }
        }
      ]
    },
    "options": {
      "fallbackOutput": "extra"
    }
  }
}
```

### Merge

```json
{
  "name": "Combine Results",
  "type": "n8n-nodes-base.merge",
  "typeVersion": 3,
  "position": [750, 0],
  "parameters": {
    "mode": "combine",
    "mergeByFields": {
      "values": [
        {
          "field1": "id",
          "field2": "id"
        }
      ]
    },
    "joinMode": "enrichInput1",
    "options": {}
  }
}
```

Modes: `append` (concatenate), `combine` (join by field), `chooseBranch` (pick one input), `multiplex` (cross join)

## Data Transformation Nodes

### Set / Edit Fields

```json
{
  "name": "Format Output",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "position": [500, 0],
  "parameters": {
    "mode": "manual",
    "duplicateItem": false,
    "assignments": {
      "assignments": [
        {
          "id": "uuid-here",
          "name": "title",
          "value": "={{ $json.name }}",
          "type": "string"
        },
        {
          "id": "uuid-here",
          "name": "timestamp",
          "value": "={{ $now.toISO() }}",
          "type": "string"
        }
      ]
    },
    "options": {
      "includeBinary": false
    }
  }
}
```

### Code (JavaScript)

```json
{
  "name": "Transform Data",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [500, 0],
  "parameters": {
    "jsCode": "const items = $input.all();\n\nreturn items.map(item => {\n  return {\n    json: {\n      ...item.json,\n      processed: true,\n      processedAt: new Date().toISOString()\n    }\n  };\n});",
    "mode": "runOnceForAllItems"
  }
}
```

Modes: `runOnceForAllItems` (access all items), `runOnceForEachItem` (per-item execution)

### Split In Batches

```json
{
  "name": "Process In Batches",
  "type": "n8n-nodes-base.splitInBatches",
  "typeVersion": 3,
  "position": [500, 0],
  "parameters": {
    "batchSize": 10,
    "options": {
      "reset": false
    }
  }
}
```

## Integration Nodes

### Slack — Send Message

```json
{
  "name": "Send Slack Alert",
  "type": "n8n-nodes-base.slack",
  "typeVersion": 2.2,
  "position": [750, 0],
  "parameters": {
    "resource": "message",
    "operation": "send",
    "channel": {
      "__rl": true,
      "value": "#alerts",
      "mode": "name"
    },
    "text": "={{ $json.message }}",
    "otherOptions": {
      "includeLinkToWorkflow": true
    }
  },
  "credentials": {
    "slackApi": {
      "id": "credential-id",
      "name": "slack_devops_bot"
    }
  }
}
```

### AWS S3 — Upload

```json
{
  "name": "Upload to S3",
  "type": "n8n-nodes-base.awsS3",
  "typeVersion": 1,
  "position": [750, 0],
  "parameters": {
    "operation": "upload",
    "bucketName": "={{ $env.S3_BUCKET }}",
    "fileName": "={{ $json.filename }}",
    "body": "={{ $json.content }}",
    "additionalFields": {
      "storageClass": "STANDARD",
      "serverSideEncryption": "AES256"
    }
  },
  "credentials": {
    "aws": {
      "id": "credential-id",
      "name": "aws_prod_role"
    }
  }
}
```

### GitHub — Create Issue

```json
{
  "name": "Create GitHub Issue",
  "type": "n8n-nodes-base.github",
  "typeVersion": 1,
  "position": [750, 0],
  "parameters": {
    "owner": "={{ $env.GITHUB_ORG }}",
    "repository": "={{ $json.repo }}",
    "resource": "issue",
    "operation": "create",
    "title": "={{ $json.title }}",
    "body": "={{ $json.body }}",
    "labels": {
      "label": ["bug", "automated"]
    }
  },
  "credentials": {
    "githubApi": {
      "id": "credential-id",
      "name": "github_org_token"
    }
  }
}
```

## Utility Nodes

### Respond to Webhook

```json
{
  "name": "Send Response",
  "type": "n8n-nodes-base.respondToWebhook",
  "typeVersion": 1.1,
  "position": [1000, 0],
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ JSON.stringify({ status: 'ok', id: $json.id }) }}",
    "options": {
      "responseCode": 200,
      "responseHeaders": {
        "entries": [
          {
            "name": "Content-Type",
            "value": "application/json"
          }
        ]
      }
    }
  }
}
```

### Wait

```json
{
  "name": "Rate Limit Delay",
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [500, 0],
  "parameters": {
    "amount": 1,
    "unit": "seconds"
  }
}
```

### No Operation (passthrough)

```json
{
  "name": "No Op",
  "type": "n8n-nodes-base.noOp",
  "typeVersion": 1,
  "position": [500, 0],
  "parameters": {}
}
```

## Connection Format

Connections map source nodes to destination nodes:

```json
{
  "connections": {
    "Webhook Trigger": {
      "main": [
        [
          {
            "node": "Check Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Check Status": {
      "main": [
        [
          {
            "node": "Send Slack Alert",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Log Failure",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

- `main[0]` = first output (true branch for IF)
- `main[1]` = second output (false branch for IF)
- Error outputs use the `onError` property on the node, not connections

## Node Positioning

- **Horizontal spacing**: 250px between sequential nodes
- **Vertical spacing**: 150px between parallel branches
- **Trigger**: always at `[0, 0]`
- **Flow direction**: left to right
- **Branching**: offset vertically from the main path

Example layout for a branching workflow:

```
Trigger [0,0] → Check [250,0] → True path [500, -75]
                                → False path [500, 75]
```

## Expression Reference

Common expressions used in node parameters:

| Expression | Description |
|---|---|
| `{{ $json.field }}` | Access current item field |
| `{{ $json["nested"]["field"] }}` | Access nested field |
| `{{ $('Node Name').item.json.field }}` | Access output of specific node |
| `{{ $env.VARIABLE }}` | Access environment variable |
| `{{ $now.toISO() }}` | Current timestamp ISO format |
| `{{ $now.toFormat('yyyy-MM-dd') }}` | Formatted date |
| `{{ $execution.id }}` | Current execution ID |
| `{{ $workflow.name }}` | Current workflow name |
| `{{ $input.all() }}` | All items from input (in Code node) |
| `{{ $input.first().json }}` | First item from input |
| `{{ $itemIndex }}` | Current item index in loop |
