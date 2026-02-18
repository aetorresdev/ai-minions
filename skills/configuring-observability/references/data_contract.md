# Observability Data Contract

A data contract defines the agreed-upon schema for telemetry signals. It serves as the source of truth for what metrics, traces, and logs are produced, their dimensions, naming, and how they correlate across signals.

## Contract Template (YAML)

```yaml
# data-contract-v1.yaml
version: "1"
owner: "<team>"
description: "<what this contract covers>"
last_updated: "<YYYY-MM-DD>"

signals:
  metrics:
    namespace: "<metrics_namespace>"
    source: "<spanmetrics | sdk | infrastructure>"
    metrics:
      - name: "<metric_name>"
        description: "<what it measures>"
        unit: "<unit>"
        type: "<counter | histogram | gauge>"
        dimensions:
          required:
            - name: "<dim>"
              description: "<what it represents>"
              cardinality: "<low | medium | high>"
              examples: ["<val1>", "<val2>"]
          optional:
            - name: "<dim>"
              description: "<what it represents>"
              cardinality: "<low>"
        aggregations:
          - statistic: "<Sum | Average | p99>"
            use_case: "<when to use this aggregation>"

  traces:
    service_name: "<service.name value>"
    service_namespace: "<service.namespace value>"
    resource_attributes:
      - name: "<attribute>"
        description: "<purpose>"
        source: "<static | environment | dynamic>"
    span_attributes:
      - name: "<attribute>"
        description: "<purpose>"
        examples: ["<val1>", "<val2>"]

  logs:
    structured_fields:
      - name: "<field>"
        description: "<purpose>"
        type: "<string | number | boolean>"
        required: <true | false>
    log_groups:
      - pattern: "<log_group_pattern>"
        description: "<what it contains>"

correlation:
  key: "<field used to join signals>"
  description: "<how to correlate metrics, traces, and logs>"
  mapping:
    metrics_to_traces: "<how metric dimensions map to trace attributes>"
    traces_to_logs: "<how trace IDs appear in logs>"

taxonomy:
  result_values:
    - value: "<RESULT_VALUE>"
      description: "<what it means>"
      kpi_included: <true | false>
```

## Example: CI/CD Pipeline Contract

```yaml
version: "1"
owner: "devops"
description: "Observability contract for Jenkins CI/CD pipelines"
last_updated: "2026-02-17"

signals:
  metrics:
    namespace: "jenkins/otel-${service}"
    source: "spanmetrics"
    metrics:
      - name: "traces.span.metrics.calls"
        description: "Number of pipeline executions (span count)"
        unit: "count"
        type: "counter"
        dimensions:
          required:
            - name: "ci.pipeline.name"
              description: "Jenkins job name"
              cardinality: "medium"
              examples: ["build-android", "deploy-atlas"]
            - name: "OTelLib"
              description: "Source library (always spanmetricsconnector)"
              cardinality: "low"
              examples: ["spanmetricsconnector"]
          optional:
            - name: "ci.pipeline.run.result"
              description: "Pipeline execution result"
              cardinality: "low"
              examples: ["SUCCESS", "FAILURE", "ABORTED", "UNSTABLE"]
        aggregations:
          - statistic: "Sum"
            use_case: "Total execution count"

      - name: "traces.span.metrics.duration"
        description: "Pipeline execution duration"
        unit: "milliseconds"
        type: "histogram"
        dimensions:
          required:
            - name: "ci.pipeline.name"
              description: "Jenkins job name"
              cardinality: "medium"
              examples: ["build-android", "deploy-atlas"]
            - name: "OTelLib"
              description: "Source library"
              cardinality: "low"
              examples: ["spanmetricsconnector"]
          optional:
            - name: "ci.pipeline.run.result"
              description: "Pipeline execution result"
              cardinality: "low"
              examples: ["SUCCESS", "FAILURE"]
        aggregations:
          - statistic: "Average"
            use_case: "Average pipeline duration"
          - statistic: "p99"
            use_case: "Slowest pipeline runs"

  traces:
    service_name: "jenkins-${service}"
    service_namespace: "jenkins"
    resource_attributes:
      - name: "service.name"
        description: "Jenkins service identifier"
        source: "static"
      - name: "service.namespace"
        description: "Service group"
        source: "static"
      - name: "deployment.environment"
        description: "Environment name"
        source: "environment"
    span_attributes:
      - name: "ci.pipeline.name"
        description: "Jenkins job name"
        examples: ["build-android", "deploy-atlas"]
      - name: "ci.pipeline.run.number"
        description: "Build number"
        examples: ["42", "123"]
      - name: "ci.pipeline.run.result"
        description: "Execution result"
        examples: ["SUCCESS", "FAILURE", "ABORTED", "UNSTABLE", "NOT_BUILT"]
      - name: "ci.pipeline.run.cause"
        description: "What triggered the build"
        examples: ["UserIdCause:user@example.com", "TimerTrigger"]
      - name: "ci.pipeline.run.duration"
        description: "Execution time in milliseconds"
        examples: ["125000", "5000"]
      - name: "user.id"
        description: "User who triggered the build"
        examples: ["user@example.com"]

  logs:
    structured_fields:
      - name: "service.name"
        description: "Jenkins service identifier"
        type: "string"
        required: true
      - name: "deployment.environment"
        description: "Environment name"
        type: "string"
        required: true
      - name: "ci.pipeline.name"
        description: "Jenkins job name"
        type: "string"
        required: false
      - name: "ci.pipeline.run.id"
        description: "Unique pipeline run identifier"
        type: "string"
        required: false
      - name: "stage.name"
        description: "Pipeline stage name"
        type: "string"
        required: false
      - name: "error.type"
        description: "Error classification"
        type: "string"
        required: false
      - name: "error.message"
        description: "Error description"
        type: "string"
        required: false
      - name: "severity"
        description: "Log severity level"
        type: "string"
        required: true
    log_groups:
      - pattern: "/ecs/jenkins-${service}/<task-type>"
        description: "Jenkins service container logs"
      - pattern: "/aws/otel/otel-fargate-${cluster}"
        description: "OTEL collector logs"

correlation:
  key: "ci.pipeline.run.id"
  description: "Unique pipeline run ID links metrics, traces, and logs for the same execution"
  mapping:
    metrics_to_traces: "ci.pipeline.name dimension matches span attribute ci.pipeline.name"
    traces_to_logs: "trace_id from X-Ray matches structured log field; ci.pipeline.run.id for business correlation"

taxonomy:
  result_values:
    - value: "SUCCESS"
      description: "Pipeline completed all stages without errors"
      kpi_included: true
    - value: "FAILURE"
      description: "Pipeline encountered an error and stopped"
      kpi_included: true
    - value: "ABORTED"
      description: "Pipeline was manually or automatically cancelled"
      kpi_included: true
    - value: "UNSTABLE"
      description: "Pipeline completed but with test failures or warnings"
      kpi_included: true
    - value: "NOT_BUILT"
      description: "Pipeline was skipped (conditional stage not met)"
      kpi_included: false
```

## Validation Against Contract

The `observability-validator` agent should validate:

### OTEL Config vs Contract
- Metric names in collector match `signals.metrics[].name`
- Included dimensions match `dimensions.required[].name`
- Excluded dimensions do NOT include any `dimensions.required[].name`
- Exporter namespace matches `signals.metrics.namespace`
- `resource_metrics_key_attributes` includes attributes listed in `signals.traces.resource_attributes`

### Grafana Dashboards vs Contract
- Query metric names match `signals.metrics[].name`
- Query dimensions match `dimensions.required[].name` or `dimensions.optional[].name`
- Variable values align with `taxonomy.result_values[].value`
- Dashboard filters cover all `kpi_included: true` values

### Cross-Signal Correlation
- `correlation.key` is present in both trace span attributes and log structured fields
- `correlation.mapping.metrics_to_traces` dimensions are consistent
- `correlation.mapping.traces_to_logs` is achievable with current config

## Contract Lifecycle

1. **Create**: When setting up new observability for a service
2. **Validate**: On every OTEL config or dashboard change
3. **Update**: When adding new metrics, dimensions, or signals
4. **Version**: Increment version on breaking changes (dimension rename/removal)
