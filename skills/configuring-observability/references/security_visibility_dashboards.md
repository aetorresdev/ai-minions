# Security visibility dashboard patterns

Use these patterns when building dashboards for **ECS**, **EKS**, or both. Aim for **visibility** (curated, high-signal events), not just "we have logs." Cloud-agnostic: panel types and layout apply to any backend (Loki, CloudWatch, Prometheus); data sources and queries depend on platform and log or metric source.

**Reference:** [docs/FOLLOW_UPS.md](../../../docs/FOLLOW_UPS.md) for the full security visibility model (ECS + EKS).

---

## Row 1: Security visibility (high-signal)

Panels that answer: who changed what, who got denied, and did anyone exec in?

| Panel idea | Type | ECS data source | EKS data source | Generic |
|------------|------|------------------|-----------------|---------|
| Deny rate (401/403) | Time series or stat | ALB/API access logs, CloudWatch | K8s audit / API server logs, Loki | ALB/API metrics or logs |
| High-risk action rate | Time series or stat | EventBridge/CloudTrail (task def, IAM); ECS Exec logs | K8s audit (RBAC, secrets, exec/port-forward) | — |
| Top users / verbs (deny) | Table | Logs query grouped by user/role | Audit logs: user, verb | — |
| Secret write / access rate | Stat or time series | CloudTrail / Secrets Manager events | K8s audit (secret create/update/patch/delete) | — |

- **ECS:** ECS Exec session count; task definition or IAM change events; Secrets Manager/SSM access.
- **EKS:** RBAC change rate; secret write rate; exec / port-forward / attach rate.
- **Both:** 401/403 rate; non-2xx response rate; optional throttle rate.

Use variables for cluster, service, namespace, or environment so one dashboard can serve ECS and EKS by switching data source or query filters.

---

## Row 2: Platform context (so security is not "just logs")

Standard resource and health views so security events can be correlated with capacity or instability.

| Panel idea | Type | ECS | EKS |
|------------|------|-----|-----|
| CPU / memory now | Gauge | Cluster/service metrics | Node/pod metrics |
| Nodes / tasks ready | Stat | Service desired/running count; cluster capacity | Nodes ready vs not ready |
| Restart offenders | Table | Tasks with high restart count | Pods with high restart count |
| CPU & memory by node/task | Bar gauge | By service or task definition | By node or namespace |

Data sources: CloudWatch (ECS), Prometheus (cAdvisor/node_exporter), or existing platform metrics. Panel types and thresholds follow [grafana_patterns.md](grafana_patterns.md).

---

## Layout

When adding security visibility to an existing dashboard (or creating a new one):

```
Row 1 (Security visibility):  Deny rate, high-risk action rate, top users/verbs, optional secret rate
Row 2 (Platform context):      CPU/memory gauge, ready stat, restart offenders table, CPU/memory by node/task
```

Place these rows above or below existing KPI/trend rows. Keep panel data sources consistent with the rest of the dashboard (Loki, CloudWatch, Prometheus).

---

## Validation

After building the dashboard:

- **ECS:** Trigger a task definition change or ECS Exec session; confirm the event appears in the relevant panel (e.g. high-risk action rate or log panel).
- **EKS:** Trigger a RoleBinding change, secret write, or `kubectl exec`; confirm they appear in Loki and in the dashboard.
- Only after validation, consider reducing log volume (e.g. drop low-value streams) so visibility is preserved.
