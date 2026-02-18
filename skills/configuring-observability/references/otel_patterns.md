# OTEL Collector Patterns

## Minimal Config Structure

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

extensions:
  health_check:
    endpoint: 0.0.0.0:13133
    path: /health/status

exporters:
  # Backend-specific exporters go here

service:
  extensions: [health_check]
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [<metrics_exporter>]
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [<traces_exporter>]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [<logs_exporter>]
```

## Common Receivers

### OTLP (universal)
```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
```

### Prometheus Scrape
```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: "app"
          scrape_interval: 15s
          static_configs:
            - targets: ["localhost:8080"]
```

### Host Metrics
```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu: {}
      memory: {}
      disk: {}
      filesystem: {}
      network: {}
      load: {}
```

## Common Processors

### Batch (always include)
```yaml
processors:
  batch:
    timeout: 5s
    send_batch_size: 8192
```

### Memory Limiter (production)
```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128
```

### Attributes (add/modify/delete)
```yaml
processors:
  attributes:
    actions:
      - key: environment
        value: production
        action: upsert
      - key: internal.secret
        action: delete
```

### Filter (drop unwanted telemetry)
```yaml
processors:
  filter:
    metrics:
      exclude:
        match_type: regexp
        metric_names:
          - ".*_temp$"
    traces:
      span:
        exclude:
          match_type: regexp
          attributes:
            - key: http.target
              value: "/health"
```

### Resource (modify resource attributes)
```yaml
processors:
  resource:
    attributes:
      - key: service.namespace
        value: "jenkins"
        action: upsert
```

## Connectors

### Spanmetrics (traces → metrics)
```yaml
connectors:
  spanmetrics:
    histogram:
      explicit:
        buckets: [100ms, 500ms, 1s, 5s, 10s, 30s, 1m, 5m]
    dimensions:
      - name: ci.pipeline.name
      - name: ci.pipeline.run.result
    metrics_flush_interval: 60s
    aggregation_temporality: "AGGREGATION_TEMPORALITY_DELTA"
    exemplars:
      enabled: false
    dimensions_cache_size: 1000
    resource_metrics_key_attributes:
      - service.name
    exclude_dimensions:
      - span.kind
      - span.name
      - status.code
      - container.id
```

Wire in pipelines as both exporter (traces) and receiver (metrics):
```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [<traces_backend>, spanmetrics]
    metrics:
      receivers: [otlp, spanmetrics]
      processors: [batch]
      exporters: [<metrics_backend>]
```

### Count Connector (count spans/logs → metrics)
```yaml
connectors:
  count:
    spans:
      request.count:
        description: "Total request count"
    logs:
      log.record.count:
        description: "Total log record count"
```

## Backend-Specific Exporters

### Prometheus Remote Write
```yaml
exporters:
  prometheusremotewrite:
    endpoint: "http://prometheus:9090/api/v1/write"
    tls:
      insecure: true
```

### AWS CloudWatch EMF
```yaml
exporters:
  awsemf:
    namespace: "<namespace>"
    log_group_name: "<log_group>"
    region: "<region>"
    dimension_rollup_option: SingleDimensionRollupOnly
    metric_declarations:
      - dimensions: [[OTelLib]]
        metric_name_selectors:
          - "<metric_prefix>.*"
      - dimensions: [[<dim1>, OTelLib]]
        metric_name_selectors:
          - "<metric_prefix>.*"
    resource_to_telemetry_conversion:
      enabled: false
```

### AWS X-Ray
```yaml
exporters:
  awsxray:
    region: "<region>"
```

### AWS CloudWatch Logs
```yaml
exporters:
  awscloudwatchlogs:
    log_group_name: "<log_group>"
    log_stream_name: "<stream>"
    region: "<region>"
```

### Loki
```yaml
exporters:
  loki:
    endpoint: "http://loki:3100/loki/api/v1/push"
    default_labels_enabled:
      exporter: true
      job: true
```

### Tempo / OTLP
```yaml
exporters:
  otlp/tempo:
    endpoint: "tempo:4317"
    tls:
      insecure: true
```

### Datadog
```yaml
exporters:
  datadog:
    api:
      key: "${DD_API_KEY}"
      site: "datadoghq.com"
```

## Dimension Management

### Problem: Cardinality Explosion

Every unique combination of dimensions creates a new metric stream. Example:
- 10 pipelines × 3 results × 1 OTelLib = 30 streams (OK)
- 10 pipelines × 3 results × 100 container_ids = 3,000 streams (BAD)

### Solution: exclude_dimensions

Always exclude high-cardinality attributes:
```yaml
exclude_dimensions:
  - span.kind
  - span.name
  - status.code
  - container.id
  - host.name
  - service.instance.id
  - process.runtime.*
  - telemetry.sdk.*
```

### Solution: metric_declarations (CloudWatch EMF)

Explicitly declare which dimension combinations to export:
```yaml
metric_declarations:
  - dimensions: [[OTelLib]]                          # total
  - dimensions: [[dim1, OTelLib]]                    # per dim1
  - dimensions: [[dim2, OTelLib]]                    # per dim2
  - dimensions: [[dim1, dim2, OTelLib]]              # per dim1+dim2
```

## Terraform Templatefile Pattern

For infrastructure-managed collectors, use Terraform templatefile:

```yaml
# otel_config.yml.tpl
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:${grpc_port}
      http:
        endpoint: 0.0.0.0:${http_port}

exporters:
%{ if enable_metrics ~}
  awsemf:
    namespace: ${metrics_namespace}
    region: ${aws_region}
%{ endif ~}

service:
  pipelines:
%{ if enable_metrics ~}
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [awsemf]
%{ endif ~}
```

## Validation

### yamllint
```bash
yamllint -d "{extends: default, rules: {line-length: {max: 200}}}" otel-config.yaml
```

### otelcol validate
```bash
otelcol-contrib validate --config=otel-config.yaml
```

If otelcol-contrib is not installed, validate structure manually:
1. Has `receivers`, `exporters`, `service.pipelines` (required)
2. Every component in `pipelines` is defined in top-level section
3. No orphan components (defined but not used in any pipeline)
