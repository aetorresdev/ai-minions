---
name: configuring-observability
description: Create, validate, and configure OpenTelemetry collector pipelines and Grafana dashboards. Use when user asks to create, configure, review, or troubleshoot OTEL collectors, Grafana dashboards, metrics, traces, logs, or observability pipelines.
---

# Observability Configuration

Guided creation and validation of OpenTelemetry collector configurations and Grafana dashboards. Cloud agnostic — supports multiple backends (Prometheus, CloudWatch, Loki, Tempo, Jaeger, Datadog, etc.).

## Prerequisites

### CLI Tools

| Tool | Purpose | Install |
|---|---|---|
| `yamllint` | YAML syntax validation | `pip install yamllint` |
| `jq` | JSON manipulation for dashboards | Pre-installed on most systems |
| `otelcol-contrib` | Collector config validation (optional) | [GitHub releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) |
| `promtool` | PromQL validation (optional) | [Prometheus releases](https://prometheus.io/download/) |

### Cursor Command Allowlist

Add to allowlist for auto-run: `yamllint`, `jq`, `otelcol-contrib`, `promtool`

## Input

The user provides one or more of:
- An observability requirement (e.g., "monitor CI/CD pipeline execution")
- An existing OTEL config to modify or validate
- A Grafana dashboard to create or update
- A signal type to configure (metrics, traces, logs)
- A backend to export to (CloudWatch, Prometheus, Loki, Tempo, etc.)

## Workflow

```
1. Understand signals and backends
       ↓
2. otel-config-builder → collector YAML configuration
       ↓
3. grafana-dashboard-builder → dashboards + data sources
       ↓
4. observability-validator → cross-signal consistency check
       ↓
5. User deploys and tests
```

### Step 1: Understand Requirements

Before configuring, clarify:
- **Signals**: Which signals? (metrics, traces, logs, or all three)
- **Sources**: What sends telemetry? (app SDK, OTEL plugin, infrastructure agents)
- **Backends**: Where does data go? (CloudWatch, Prometheus, Loki, Tempo, Datadog)
- **Derived signals**: Need spanmetrics? (generate metrics from traces)
- **Cardinality**: Expected dimension/label count and unique values

### Step 2: OTEL Collector Config

Run `otel-config-builder` to create the collector YAML:
- Receivers (OTLP, Prometheus scrape, hostmetrics, etc.)
- Processors (batch, memory_limiter, attributes, filter)
- Connectors (spanmetrics, count, etc.)
- Exporters (matched to chosen backends)
- Service pipelines (wire signals through the pipeline)
- Extensions (health_check, zpages, pprof)

### Step 3: Grafana Dashboards

Run `grafana-dashboard-builder` to create:
- Dashboard JSON models
- Data source provisioning YAML
- Alert rules
- Variables and templating

### Step 4: Validate

Run `observability-validator` to check:
- OTEL metric names match Grafana query metric names
- Exporter endpoints match data source configs
- Pipeline completeness (all signals have receivers + exporters)
- Dimension/label consistency
- No high-cardinality dimension bombs
- Data contract compliance (if `data-contract-v1.yaml` exists)

## Agents

### 1. `otel-config-builder` (green)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Create and validate OTEL collector configurations

| Action | Details |
|---|---|
| Create collector YAML | Receivers, processors, connectors, exporters, pipelines |
| Configure signal pipelines | Metrics, traces, logs independently |
| Set up connectors | spanmetrics, count connector for derived signals |
| Dimension management | Exclude high-cardinality, keep useful dimensions |
| Validate config | yamllint + `otelcol-contrib validate` if available |

### 2. `grafana-dashboard-builder` (blue)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Create Grafana dashboards, data sources, and alerts

| Action | Details |
|---|---|
| Generate dashboard JSON | Panels, rows, variables, transformations |
| Configure data sources | Provisioning YAML for Grafana |
| Create alert rules | Threshold-based and anomaly alerts |
| Set up variables | Dynamic filtering (cluster, service, environment) |
| Validate JSON | jq syntax check + schema validation |

### 3. `observability-validator` (purple)
**Tools**: Read, Grep, Glob, Shell
**Responsibility**: Cross-signal validation and consistency checks

| Action | Details |
|---|---|
| Metric name consistency | OTEL exporter metric names = Grafana query metric names |
| Dimension consistency | Exporter dimensions match dashboard filters |
| Pipeline completeness | Every signal has receiver → processor → exporter |
| Cardinality check | Flag dimensions with high unique values |
| Data source alignment | Exporter endpoints match Grafana data source configs |
| Data contract compliance | Validate OTEL + Grafana against `data-contract-v1.yaml` |
| Correlation check | Verify cross-signal correlation key is present in all signals |

## Supported Backends

### Metrics

| Backend | Exporter | Grafana Data Source |
|---|---|---|
| Prometheus | `prometheusremotewrite` | Prometheus |
| CloudWatch | `awsemf` | CloudWatch |
| Datadog | `datadog` | Datadog |
| OTLP endpoint | `otlp` | Tempo/Mimir |

### Traces

| Backend | Exporter | Grafana Data Source |
|---|---|---|
| Tempo | `otlp` | Tempo |
| Jaeger | `jaeger` | Jaeger |
| AWS X-Ray | `awsxray` | X-Ray |
| Datadog | `datadog` | Datadog |
| Zipkin | `zipkin` | Zipkin |

### Logs

| Backend | Exporter | Grafana Data Source |
|---|---|---|
| Loki | `loki` | Loki |
| CloudWatch Logs | `awscloudwatchlogs` | CloudWatch |
| Elasticsearch | `elasticsearch` | Elasticsearch |
| OTLP endpoint | `otlp` | Loki (via OTLP) |

## Output Format

```
## Observability Config: <name>

### Signals
- Metrics: <receiver> → <processors> → <exporter>
- Traces: <receiver> → <processors> → <exporter>
- Logs: <receiver> → <processors> → <exporter>
- Derived: <connector description>

### Files Created
- `otel-collector-config.yaml` — Collector configuration
- `grafana/dashboards/<name>.json` — Dashboard(s)
- `grafana/provisioning/datasources/<name>.yaml` — Data source config
- `grafana/provisioning/alerting/<name>.yaml` — Alert rules (if applicable)

### Validation
🟢 yamllint — valid YAML
🟢 otelcol validate — valid config
🟢 jq — valid JSON (dashboards)
🟢 Cross-signal check — metric names consistent

---
Summary: <X> pipelines, <Y> dashboard panels, <Z> alerts
```

## Compliance (if applicable)

If the project declares a compliance framework (`.compliance.yaml`), run `compliance-checker` on the observability config:
- Log retention meets framework minimum (PCI: 1yr, HIPAA: 6yr)
- No PHI/PAN in exported logs (processor strips sensitive fields)
- Audit log completeness (all API calls, access events)
- Log integrity (CloudTrail validation, S3 Object Lock)
- Alert coverage for security events (auth failures, config changes)

Reference: `designing-terraform/references/compliance_frameworks.md`

Skip entirely if no compliance framework is declared.

## Documentation (optional)

After creating or modifying configs, run `infra-documenter` to persist decisions:
- **ADR**: When choosing between backends, connectors, or processing strategies (e.g., "Why spanmetricsconnector over SDK-native metrics")
- **Config decision record**: For non-obvious config values (e.g., "Why batch timeout is 10s", "Why exclude_dimensions includes pod_name")
- **Runbook**: Operational procedures for the observability stack (deploy collector, troubleshoot pipeline, rotate credentials)
- **Changelog entry**: Record what changed in OTEL/Grafana configs and why

Particularly valuable for observability — config files don't document intent.

### 4. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell, awslabs.terraform-mcp-server
**Responsibility**: Validate observability config against compliance frameworks

| Action | Details |
|---|---|
| Log retention check | Meets framework minimum |
| Sensitive data in logs | PHI/PAN stripped before export |
| Audit completeness | All required events captured |
| Alert coverage | Security events trigger notifications |

### 5. `infra-documenter` (orange) — shared agent, optional
**Tools**: Read, Glob, Shell, awslabs.aws-diagram-mcp-server
**Responsibility**: Persist documentation for observability decisions

| Action | Details |
|---|---|
| Write ADR | Backend selection, connector choice, processing strategy |
| Config decision record | Non-obvious config values with rationale |
| Write runbook | Deploy, troubleshoot, rollback collector/dashboard |
| Update changelog | What changed and why |

## Rules

- Always validate OTEL config with yamllint + otelcol validate (if available)
- Always validate dashboard JSON with jq
- Run cross-signal validation after creating both OTEL config and dashboards
- Keep dimensions minimal — flag potential cardinality bombs (>1000 unique values)
- Use `batch` processor in every pipeline for performance
- Use `memory_limiter` processor in production configs
- Include `health_check` extension in every collector config
- Dashboard panels must use `matchExact: true` for CloudWatch queries to avoid aggregation errors
- Do NOT hardcode data source UIDs — use provisioning names
- Prefer Terraform templatefile for dynamic OTEL configs (for infra-managed collectors)
