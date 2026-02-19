# n8n Workflow Templates

Skeleton templates for common automation patterns. Replace placeholders with real values.

## Template 1: Webhook → Process → Respond

Synchronous request/response pattern.

```json
{
  "name": "webhook_process_respond",
  "nodes": [
    {
      "name": "Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "webhookId": "GENERATE_UUID",
      "parameters": {
        "path": "WEBHOOK_PATH",
        "httpMethod": "POST",
        "authentication": "headerAuth",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "name": "Process Data",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [250, 0],
      "parameters": {
        "jsCode": "// PROCESSING_LOGIC\nreturn $input.all();",
        "mode": "runOnceForAllItems"
      },
      "onError": "continueErrorOutput"
    },
    {
      "name": "Send Success Response",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [500, -75],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ status: 'ok', data: $json }) }}",
        "options": { "responseCode": 200 }
      }
    },
    {
      "name": "Send Error Response",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [500, 75],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ error: true, message: $json.error?.message }) }}",
        "options": { "responseCode": 500 }
      }
    }
  ],
  "connections": {
    "Webhook Trigger": {
      "main": [[{ "node": "Process Data", "type": "main", "index": 0 }]]
    },
    "Process Data": {
      "main": [
        [{ "node": "Send Success Response", "type": "main", "index": 0 }],
        [{ "node": "Send Error Response", "type": "main", "index": 0 }]
      ]
    }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

## Template 2: Schedule → Fetch → Transform → Deliver

Polling pattern for scheduled data synchronization.

```json
{
  "name": "schedule_fetch_transform_deliver",
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0],
      "parameters": {
        "rule": {
          "interval": [{ "field": "cronExpression", "expression": "CRON_EXPRESSION" }]
        }
      }
    },
    {
      "name": "Fetch Data",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 0],
      "parameters": {
        "method": "GET",
        "url": "API_ENDPOINT",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "CREDENTIAL_TYPE",
        "options": { "timeout": 30000 }
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Transform",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 0],
      "parameters": {
        "jsCode": "// TRANSFORM_LOGIC\nreturn $input.all();",
        "mode": "runOnceForAllItems"
      },
      "onError": "continueErrorOutput"
    },
    {
      "name": "Deliver Results",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [750, 0],
      "parameters": {
        "method": "POST",
        "url": "DESTINATION_ENDPOINT",
        "sendBody": true,
        "bodyParameters": {
          "parameters": []
        }
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Handle Error",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [750, 200],
      "parameters": {
        "resource": "message",
        "operation": "send",
        "channel": { "__rl": true, "value": "#alerts", "mode": "name" },
        "text": "=Workflow *{{ $workflow.name }}* failed at node *{{ $json.error?.node }}*:\n{{ $json.error?.message }}"
      },
      "credentials": {
        "slackApi": { "id": "CREDENTIAL_ID", "name": "SLACK_CREDENTIAL" }
      }
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [[{ "node": "Fetch Data", "type": "main", "index": 0 }]]
    },
    "Fetch Data": {
      "main": [
        [{ "node": "Transform", "type": "main", "index": 0 }],
        [{ "node": "Handle Error", "type": "main", "index": 0 }]
      ]
    },
    "Transform": {
      "main": [
        [{ "node": "Deliver Results", "type": "main", "index": 0 }],
        [{ "node": "Handle Error", "type": "main", "index": 0 }]
      ]
    },
    "Deliver Results": {
      "main": [
        [],
        [{ "node": "Handle Error", "type": "main", "index": 0 }]
      ]
    }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

## Template 3: Event Router

Fan-out pattern: single trigger, multiple destinations based on event type.

```json
{
  "name": "event_router",
  "nodes": [
    {
      "name": "Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "webhookId": "GENERATE_UUID",
      "parameters": {
        "path": "events",
        "httpMethod": "POST",
        "responseMode": "onReceived",
        "options": {}
      }
    },
    {
      "name": "Route by Event",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [250, 0],
      "parameters": {
        "rules": {
          "values": [
            {
              "outputKey": "type_a",
              "conditions": {
                "conditions": [{
                  "leftValue": "={{ $json.event_type }}",
                  "rightValue": "EVENT_TYPE_A",
                  "operator": { "type": "string", "operation": "equals" }
                }]
              }
            },
            {
              "outputKey": "type_b",
              "conditions": {
                "conditions": [{
                  "leftValue": "={{ $json.event_type }}",
                  "rightValue": "EVENT_TYPE_B",
                  "operator": { "type": "string", "operation": "equals" }
                }]
              }
            }
          ]
        },
        "options": { "fallbackOutput": "extra" }
      }
    },
    {
      "name": "Handle Type A",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [500, -100],
      "parameters": {}
    },
    {
      "name": "Handle Type B",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [500, 0],
      "parameters": {}
    },
    {
      "name": "Handle Unknown",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [500, 100],
      "parameters": {}
    }
  ],
  "connections": {
    "Webhook Trigger": {
      "main": [[{ "node": "Route by Event", "type": "main", "index": 0 }]]
    },
    "Route by Event": {
      "main": [
        [{ "node": "Handle Type A", "type": "main", "index": 0 }],
        [{ "node": "Handle Type B", "type": "main", "index": 0 }],
        [{ "node": "Handle Unknown", "type": "main", "index": 0 }]
      ]
    }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

## Template 4: Batch Processor

Process large datasets in controlled batches with error isolation.

```json
{
  "name": "batch_processor",
  "nodes": [
    {
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "name": "Fetch All Items",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 0],
      "parameters": {
        "method": "GET",
        "url": "API_ENDPOINT",
        "options": { "timeout": 60000 }
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Split In Batches",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [500, 0],
      "parameters": {
        "batchSize": 10,
        "options": { "reset": false }
      }
    },
    {
      "name": "Process Batch",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [750, 0],
      "parameters": {
        "method": "POST",
        "url": "PROCESSING_ENDPOINT",
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "={{ JSON.stringify($json) }}"
      },
      "retryOnFail": true,
      "maxTries": 2,
      "waitBetweenTries": 3000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Rate Limit Delay",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [1000, 0],
      "parameters": {
        "amount": 1,
        "unit": "seconds"
      }
    },
    {
      "name": "Log Failed Item",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [750, 150],
      "parameters": {
        "jsCode": "const item = $input.first();\nconsole.error('Failed to process:', JSON.stringify(item.json));\nreturn [item];",
        "mode": "runOnceForAllItems"
      }
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{ "node": "Fetch All Items", "type": "main", "index": 0 }]]
    },
    "Fetch All Items": {
      "main": [
        [{ "node": "Split In Batches", "type": "main", "index": 0 }],
        [{ "node": "Log Failed Item", "type": "main", "index": 0 }]
      ]
    },
    "Split In Batches": {
      "main": [
        [{ "node": "Process Batch", "type": "main", "index": 0 }],
        []
      ]
    },
    "Process Batch": {
      "main": [
        [{ "node": "Rate Limit Delay", "type": "main", "index": 0 }],
        [{ "node": "Log Failed Item", "type": "main", "index": 0 }]
      ]
    },
    "Rate Limit Delay": {
      "main": [[{ "node": "Split In Batches", "type": "main", "index": 0 }]]
    }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

## Template 5: Multi-Service Sync

Parallel fetch from multiple sources, merge, and deliver.

```json
{
  "name": "multi_service_sync",
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0],
      "parameters": {
        "rule": {
          "interval": [{ "field": "cronExpression", "expression": "0 */2 * * *" }]
        }
      }
    },
    {
      "name": "Fetch Source A",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, -100],
      "parameters": {
        "method": "GET",
        "url": "SOURCE_A_ENDPOINT"
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Fetch Source B",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 100],
      "parameters": {
        "method": "GET",
        "url": "SOURCE_B_ENDPOINT"
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    },
    {
      "name": "Merge Results",
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3,
      "position": [500, 0],
      "parameters": {
        "mode": "combine",
        "mergeByFields": {
          "values": [{ "field1": "id", "field2": "id" }]
        },
        "joinMode": "enrichInput1",
        "options": {}
      }
    },
    {
      "name": "Deliver Merged",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [750, 0],
      "parameters": {
        "method": "POST",
        "url": "DESTINATION_ENDPOINT",
        "sendBody": true,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "={{ JSON.stringify($json) }}"
      },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000,
      "onError": "continueErrorOutput"
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [
        [
          { "node": "Fetch Source A", "type": "main", "index": 0 },
          { "node": "Fetch Source B", "type": "main", "index": 0 }
        ]
      ]
    },
    "Fetch Source A": {
      "main": [[{ "node": "Merge Results", "type": "main", "index": 0 }]]
    },
    "Fetch Source B": {
      "main": [[{ "node": "Merge Results", "type": "main", "index": 0 }]]
    },
    "Merge Results": {
      "main": [[{ "node": "Deliver Merged", "type": "main", "index": 0 }]]
    }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

## Workflow JSON Skeleton

Minimum valid workflow structure:

```json
{
  "name": "workflow_name",
  "nodes": [],
  "connections": {},
  "settings": {
    "executionOrder": "v1"
  },
  "staticData": null,
  "active": false,
  "tags": []
}
```

Required top-level fields:
- `name`: string — workflow identifier
- `nodes`: array — list of node objects
- `connections`: object — node connection map
- `settings`: object — workflow settings
- `active`: boolean — always `false` on creation
