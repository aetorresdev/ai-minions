# MCP servers — Installation and configuration

This repo’s skills use several MCP servers. Configure them in **Cursor** via `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (workspace). Restart Cursor or reload MCP after changes.

---

## 1. Terraform MCP Server (HashiCorp)

**Used by:** `designing-terraform`, `creating-terraform`, `reviewing-terraform`  
**Purpose:** Resource and module documentation lookup for Terraform.

**Install:** Docker image. No API keys.

```json
"terraform-mcp-server": {
  "command": "docker",
  "args": ["run", "-i", "--rm", "hashicorp/terraform-mcp-server:0.1.0"],
  "autoApprove": ["resolveProviderDocID", "getProviderDocs", "searchModules", "moduleDetails"]
}
```

**Requirements:** Docker, image will be pulled on first use.

**Full setup:** [Terraform MCP (HashiCorp)](../skills/reviewing-terraform/references/mcp_terraform_setup.md).

---

## 2. AWS Labs Terraform MCP Server

**Used by:** `creating-terraform`, `reviewing-terraform`, `designing-terraform`, `compliance-checker`  
**Purpose:** AWS provider docs, best practices, Checkov scans.

**Install:** uvx (Python). No API keys.

```json
"awslabs.terraform-mcp-server": {
  "command": "uvx",
  "args": ["awslabs.terraform-mcp-server@latest"],
  "env": { "FASTMCP_LOG_LEVEL": "ERROR" },
  "autoApprove": ["*"]
}
```

**Requirements:** [uv](https://docs.astral.sh/uv/getting-started/installation/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`). First run will download the package.

**Full setup:** [AWS Labs Terraform MCP](../skills/reviewing-terraform/references/mcp_awslabs_terraform_setup.md).

---

## 3. AWS Labs AWS Diagram MCP Server

**Used by:** `designing-terraform`, `infra-documenter`, `creating-diagrams`  
**Purpose:** Generate architecture diagrams (PNG) with real AWS/K8s/on-prem icons (Python `diagrams` package).

**Install:** uvx. No API keys.

```json
"awslabs.aws-diagram-mcp-server": {
  "command": "uvx",
  "args": ["awslabs.aws-diagram-mcp-server@latest"],
  "env": { "FASTMCP_LOG_LEVEL": "ERROR" },
  "autoApprove": ["*"]
}
```

**Requirements:** uv. Diagrams are saved under the workspace (e.g. `generated-diagrams/` or `docs/diagrams/`).

**Full setup:** [AWS Diagram MCP](../skills/creating-diagrams/references/mcp_aws_diagram_setup.md).

---

## 4. Draw.io MCP Server

**Used by:** `creating-diagrams`, `infra-documenter`  
**Purpose:** Create and edit Draw.io diagrams; built-in editor in the browser.

**Install:** Wrapper script (recommended) so Cursor starts the server on demand and stdout is filtered (avoids protocol errors). No API keys. Use the path to your own wrapper script (not in this repo).

```json
"drawio": {
  "command": "<path-to-your-drawio-mcp-wrapper.sh>",
  "args": [],
  "autoApprove": ["*"],
  "disabled": false
}
```

**Requirements:** Node.js v20+. You need a wrapper that runs `npx -y drawio-mcp-server --editor` and forwards only JSON-RPC lines to stdout (progress messages go to stderr). Editor URL and ports depend on your setup (see [Draw.io MCP setup](drawio-mcp-setup.md)).

**Full setup and troubleshooting:** [Draw.io MCP setup](drawio-mcp-setup.md). **Skill reference (same format as other MCPs):** [Draw.io MCP](../skills/creating-diagrams/references/mcp_drawio_setup.md).

---

## 5. n8n MCP

**Used by:** `managing-n8n`  
**Purpose:** n8n node schemas, validation, workflow create/update/execute (when instance URL and API key are set).

**Install:** Docker or wrapper script. With instance: set `N8N_API_URL` and `N8N_API_KEY` (or use wrapper that sources credentials).

**Example (with wrapper script; use your own script path, not in this repo):**

```json
"n8n-mcp": {
  "command": "<path-to-your-n8n-mcp-docker.sh>",
  "args": []
}
```

**Requirements:** Docker, image `ghcr.io/czlonkowski/n8n-mcp:latest`. For instance access: script or env must provide `N8N_API_URL` and `N8N_API_KEY` (e.g. source credentials from a local file).

**Full setup:** [n8n MCP (Docker)](../skills/managing-n8n/references/mcp_docker_setup.md).

---

## 6. Grafana Cloud Traces MCP (optional — AIOps)

**Used by:** Optional for `configuring-observability` when you want the AI to **query live trace data** (e.g. “analyze my traces”, “why is this slow?”). Not required for configuring OTEL or Grafana dashboards.

**Purpose:** TraceQL queries against Grafana Cloud Traces (or Tempo 2.9+); AI can reason over traces for performance and errors.

**Install:** HTTP MCP (Streamable HTTP). Requires Grafana Cloud (or self-hosted Tempo 2.9+) and an API token with read scope.

1. In Grafana Cloud: get your **stack URL** (e.g. `https://YOUR_STACK.grafana.net`) and create an **API token** with read access to Traces.
2. Build Basic auth: `echo -n 'YOUR_USER_ID:YOUR_API_TOKEN' | base64` (user ID is often your Grafana Cloud user ID or stack user).
3. Add to `mcp.json` (with your values; **do not commit real tokens**):

```json
"grafana-cloud-traces": {
  "disabled": true,
  "url": "https://YOUR_STACK.grafana.net/api/mcp",
  "transportType": "streamable-http",
  "headers": {
    "Authorization": "Basic YOUR_BASE64_AUTH"
  },
  "autoApprove": ["*"]
}
```

1. Replace `YOUR_STACK`, `YOUR_BASE64_AUTH`. Set `"disabled": false` when you want to use it.
2. Restart Cursor or reload MCP.

**Requirements:** Grafana Cloud stack with Traces (Tempo) configured and receiving data. Docs: [Grafana Cloud MCP for Traces](https://grafana.com/docs/grafana-cloud/send-data/traces/mcp-server/), [MCP Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/ai-observability/mcp-observability/).

**Full setup:** [Grafana Cloud Traces MCP](../skills/configuring-observability/references/mcp_grafana_cloud_traces_setup.md).

---

## Summary table

| MCP Server | Used by | Config type | Requires credentials |
|------------|---------|-------------|----------------------|
| terraform-mcp-server | designing/creating/reviewing-terraform | Docker (stdio) | No |
| awslabs.terraform-mcp-server | creating/reviewing/designing-terraform, compliance-checker | uvx (stdio) | No |
| awslabs.aws-diagram-mcp-server | designing-terraform, infra-documenter, creating-diagrams | uvx (stdio) | No |
| drawio | creating-diagrams, infra-documenter | Wrapper script (stdio) | No |
| n8n-mcp | managing-n8n | Docker or script (stdio) | Yes (for instance) |
| grafana-cloud-traces | configuring-observability (optional AIOps) | HTTP (streamable) | Yes (Grafana Cloud) |

---

## Cursor allowlist

For agents that run shell commands (e.g. tflint, trivy, yamllint), add those commands to Cursor’s **Features → Auto-run allowlist** so the agent can run them without prompting. MCP tool approval is configured per server with `autoApprove` in `mcp.json`; some skills also document Cursor’s MCP tool allowlist in Settings.
