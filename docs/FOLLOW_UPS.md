# Follow-ups and improvement ideas

Ideas and references for future work on skills, agents, dashboards, and rules.

---

## Dashboard & observability: security visibility beyond “green metrics”

**Context:** Many Kubernetes observability setups stop at CPU, memory, pods, and restarts. Green metrics alone do not guarantee safety: access control can change, secrets can be touched, and pods can be accessed interactively with little or no visibility.

**Use for:** Improving the **grafana-dashboard-builder** agent, **configuring-observability** skill, or new rules when creating dashboards and alerting. Aim for **security visibility** (curated, high-signal events), not just “we have logs.”

### Audit pipeline (example)

- **Stack:** Grafana Alloy (K8s audit logs) → Loki → Grafana
- **Goal:** Answer the questions leadership actually cares about.

### Security visibility (high-signal)

- RBAC change rate (roles/bindings)
- Secret write rate (create/update/patch/delete)
- `kubectl exec` / `port-forward` / `attach` rate
- 401/403 deny rate + top users / verbs
- Non-2xx responses (when the API starts refusing requests)

### Platform context (so security is not “just logs”)

- CPU / memory now (gauge)
- Nodes ready / not ready (stat)
- Restart offenders (table)
- CPU & memory by node (bar gauge)

### Principle

- **"We have logs"** is not the same as **"We have visibility."**
- Audit logs are high-volume and noisy. The goal is **curation**, not “collect everything”:
  - Keep high-risk actions (RBAC, secrets, exec/port-forward).
  - Keep operational signals (deny spikes, non-2xx).
  - Reduce noise only after you have confirmed that critical events are still visible.

### Validation

- Simulate real operator actions (e.g. RBAC change → secret write → exec or port-forward).
- Confirm they appear in Loki and Grafana (e.g. red panels / alerts).

**Reference:** Repo + full setup doc (Helm + Alloy config + Loki + dashboard JSON) can be linked here when available.

---

## Cloud-agnostic security visibility (ECS + EKS)

**Principle:** Aim for **"We have visibility"**, not just **"We have logs."** Use curated, high-signal events instead of collecting everything; only reduce noise after you have confirmed that high-risk actions are still visible.

### Abstract security visibility signals

1. **High-risk actions** (identity/access, secrets, interactive access): role/binding changes, secret writes or sensitive access, exec/shell/port-forward into workloads.
2. **Operational signals**: 401/403 deny rate, non-2xx responses, throttling — spikes indicate the API or platform is refusing or degrading.

**Curation:** Keep high-risk and operational signals; reduce noise only after validating that visibility is preserved (e.g. run a test action and confirm it appears in logs and dashboards).

### ECS (default when environment is mainly ECS)

- **High-risk:** ECS Exec session start/end; task definition or IAM role changes (EventBridge/CloudTrail); Secrets Manager or SSM Parameter Store access (create/update/delete or high-value reads).
- **Operational:** ALB/API 4xx/5xx, target response errors, throttle events.
- **Pipeline:** CloudWatch Logs (e.g. ECS Exec, task lifecycle) + EventBridge/CloudTrail for control-plane; export to Loki or keep in CloudWatch; Grafana for dashboards.

### EKS

- **High-risk:** RBAC change rate (roles/bindings); secret write rate (create/update/patch/delete); `kubectl exec` / `port-forward` / `attach` rate.
- **Operational:** 401/403 deny rate + top users/verbs; non-2xx responses when the API starts refusing requests.
- **Pipeline:** K8s API audit logs (Alloy/fluent-bit → Loki) → Grafana; same ALB/API signals as needed.

### Generic (ECS, EKS, or both)

- API/ALB: 401/403 rate, non-2xx rate, throttle metrics.
- Platform context (so security is not "just logs"): CPU/memory (gauge), nodes/tasks ready (stat), restart offenders (table), CPU/memory by node/task (bar gauge).

### Validation

- **ECS:** Change a task definition or IAM role, or run an ECS Exec session; confirm the events appear in logs and in the dashboard (e.g. red panels or alerts).
- **EKS:** Change a RoleBinding, write a secret, or run `kubectl exec` / `port-forward`; confirm they appear in Loki and Grafana.
- Only after validation, consider reducing low-value log streams to cut noise.

---

*When adding or improving dashboards and rules in skills/agents, consider whether you’re only monitoring metrics or also providing security visibility. See [docs/specs/security-visibility-observability.md](specs/security-visibility-observability.md) for the full spec.*
