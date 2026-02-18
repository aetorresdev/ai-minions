# Grafana Dashboard Patterns

## Dashboard JSON Structure

```json
{
  "dashboard": {
    "title": "<Dashboard Title>",
    "uid": "<unique-id>",
    "tags": ["<tag1>", "<tag2>"],
    "timezone": "browser",
    "schemaVersion": 39,
    "version": 1,
    "refresh": "1m",
    "time": { "from": "now-1h", "to": "now" },
    "templating": { "list": [] },
    "panels": [],
    "annotations": { "list": [] }
  }
}
```

## Panel Types

### Stat (single value)
```json
{
  "type": "stat",
  "title": "Total Requests",
  "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
  "fieldConfig": {
    "defaults": {
      "thresholds": {
        "steps": [
          { "color": "green", "value": null },
          { "color": "yellow", "value": 80 },
          { "color": "red", "value": 90 }
        ]
      }
    }
  }
}
```

### Gauge (percentage)
```json
{
  "type": "gauge",
  "title": "Success Rate",
  "fieldConfig": {
    "defaults": {
      "min": 0,
      "max": 100,
      "unit": "percent",
      "thresholds": {
        "steps": [
          { "color": "red", "value": null },
          { "color": "yellow", "value": 70 },
          { "color": "green", "value": 90 }
        ]
      }
    }
  }
}
```

### Timeseries
```json
{
  "type": "timeseries",
  "title": "Requests Over Time",
  "fieldConfig": {
    "defaults": {
      "custom": {
        "drawStyle": "line",
        "lineWidth": 2,
        "fillOpacity": 10,
        "pointSize": 5,
        "showPoints": "auto"
      }
    }
  },
  "options": {
    "legend": { "displayMode": "list", "placement": "bottom" }
  }
}
```

### Table
```json
{
  "type": "table",
  "title": "Top Items",
  "options": {
    "sortBy": [{ "displayName": "Value", "desc": true }]
  }
}
```

### Barchart
```json
{
  "type": "barchart",
  "title": "Distribution",
  "options": {
    "orientation": "horizontal",
    "barWidth": 0.8
  }
}
```

## Variables (Templating)

### Text Variable
```json
{
  "name": "region",
  "type": "textbox",
  "current": { "value": "us-west-2" },
  "hide": 2
}
```

### Custom Variable (static list)
```json
{
  "name": "environment",
  "type": "custom",
  "multi": false,
  "includeAll": false,
  "options": [
    { "text": "dev", "value": "dev", "selected": false },
    { "text": "uat", "value": "uat", "selected": true },
    { "text": "prod", "value": "prod", "selected": false }
  ]
}
```

### Query Variable (dynamic)
```json
{
  "name": "service",
  "type": "query",
  "multi": true,
  "includeAll": true,
  "refresh": 2,
  "datasource": { "type": "<datasource_type>", "uid": "<uid>" },
  "query": "<backend-specific query>"
}
```

## Data Source Queries by Backend

### CloudWatch Metrics
```json
{
  "datasource": { "type": "cloudwatch", "uid": "${datasource_uid}" },
  "namespace": "<namespace>",
  "metricName": "<metric>",
  "dimensions": {
    "<dim1>": ["<value_or_wildcard>"],
    "<dim2>": ["${variable}"]
  },
  "statistic": "Sum",
  "period": "300",
  "matchExact": true,
  "label": "${PROP('Dim.<dim1>')}"
}
```

Critical: Always use `matchExact: true` for CloudWatch to avoid aggregation of unwanted dimension combinations.

### Prometheus / PromQL
```json
{
  "datasource": { "type": "prometheus", "uid": "${datasource_uid}" },
  "expr": "rate(http_requests_total{service=\"$service\"}[5m])",
  "legendFormat": "{{method}} {{status}}"
}
```

### Loki / LogQL
```json
{
  "datasource": { "type": "loki", "uid": "${datasource_uid}" },
  "expr": "{service=\"$service\"} |= \"error\" | json | line_format \"{{.message}}\""
}
```

### CloudWatch Logs Insights
```json
{
  "datasource": { "type": "cloudwatch", "uid": "${datasource_uid}" },
  "queryMode": "Logs",
  "logGroups": [{ "arn": "<log_group_arn>" }],
  "expression": "fields @timestamp, @message | filter @message like /error/i | stats count() by bin(5m)"
}
```

## Common Transformations

### Series to Rows → Group By (Top N pattern)
```json
[
  { "id": "seriesToRows" },
  {
    "id": "groupBy",
    "options": {
      "fields": {
        "Metric": { "aggregations": [], "operation": "groupby" },
        "Value": { "aggregations": ["sum"], "operation": "aggregate" }
      }
    }
  },
  {
    "id": "organize",
    "options": {
      "renameByName": { "Metric": "Name", "Value (sum)": "Count" }
    }
  },
  { "id": "sortBy", "options": { "sort": [{ "desc": true, "field": "Count" }] } },
  { "id": "limit", "options": { "limitField": 10 } }
]
```

### Reduce (aggregate across series)
```json
[
  {
    "id": "reduce",
    "options": { "reducers": ["mean"] }
  }
]
```

### Calculate Field (math expression)
```json
[
  {
    "id": "calculateField",
    "options": {
      "mode": "reduceRow",
      "reduce": { "reducer": "sum" },
      "replaceFields": true
    }
  }
]
```

## Dashboard Layout

### Row Heights
| Content | Height | Notes |
|---|---|---|
| KPIs (stat/gauge) | h=4 to h=6 | Compact for overview |
| Timeseries | h=7 to h=8 | Enough for trend visualization |
| Tables | h=7 to h=10 | Depends on row count |
| Barcharts | h=7 to h=8 | Horizontal for readability |

### Grid Positions
- Full width: `w=24`
- Half width: `w=12`
- Third width: `w=8`
- Quarter width: `w=6`
- Y position: increment by previous row's height

### Standard Dashboard Layout
```
Row 1 (y=0, h=6):  KPIs — stat/gauge panels (4-6 across)
Row 2 (y=6, h=7):  Primary trend — full-width timeseries
Row 3 (y=13, h=7): Secondary trends — two half-width timeseries
Row 4 (y=20, h=7): Details — tables, barcharts
```

## Data Source Provisioning

### Prometheus
```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      httpMethod: POST
```

### Loki
```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    jsonData:
      derivedFields:
        - name: TraceID
          matcherRegex: "traceID=(\\w+)"
          url: "$${__value.raw}"
          datasourceUid: tempo_uid
```

### Tempo
```yaml
apiVersion: 1
datasources:
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    jsonData:
      tracesToMetrics:
        datasourceUid: prometheus_uid
      tracesToLogs:
        datasourceUid: loki_uid
```

### CloudWatch
```yaml
apiVersion: 1
datasources:
  - name: CloudWatch
    type: cloudwatch
    access: proxy
    jsonData:
      defaultRegion: us-west-2
      authType: default
```

## Alert Rule Pattern

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: "<group_name>"
    folder: "<folder>"
    interval: 1m
    rules:
      - uid: "<unique_id>"
        title: "<alert title>"
        condition: C
        data:
          - refId: A
            datasourceUid: "<uid>"
            model:
              expr: "<query>"
          - refId: C
            datasourceUid: "__expr__"
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator:
                    type: gt
                    params: [90]
        for: 5m
        annotations:
          summary: "<description>"
        labels:
          severity: critical
```

## Validation

### JSON Syntax
```bash
jq empty dashboard.json
```

### Required Fields Check
```bash
jq '.dashboard | has("title", "uid", "panels", "templating")' dashboard.json
```

### Panel Data Source Check
```bash
jq '.dashboard.panels[].datasource.uid // "MISSING"' dashboard.json
```
