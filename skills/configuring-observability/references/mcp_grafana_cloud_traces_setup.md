# Grafana Cloud Traces MCP (optional — AIOps)

The Grafana Cloud Traces MCP server lets the AI query live trace data via TraceQL (e.g. “analyze my traces”, “why is this slow?”). Optional for the `configuring-observability` skill when you want AIOps over your traces; not required for configuring OTEL or Grafana dashboards.

- **Mode**: Streamable HTTP (remote).
- **Requires**: Grafana Cloud stack with Traces (Tempo) configured and receiving data, or self-hosted Tempo 2.9+.
- **Credentials**: Stack URL and API token with read scope.

## 1. Get Grafana Cloud URL and API token

In Grafana Cloud:

1. Note your **stack URL** (e.g. `https://YOUR_STACK.grafana.net`).
2. Create an **API token** with read access to Traces (or use an existing token with the right scope).

Build Basic auth for the MCP (user ID is often your Grafana Cloud user or stack user):

```bash
echo -n 'YOUR_USER_ID:YOUR_API_TOKEN' | base64
```

Keep the base64 string for step 2; do not commit it to the repo.

## 2. Add MCP server in Cursor

In Cursor: **Settings → MCP** (or edit `~/.cursor/mcp.json` or workspace `.cursor/mcp.json`).

Append a new server entry (replace placeholders with your values):

```json
{
  "grafana-cloud-traces": {
    "disabled": true,
    "url": "https://YOUR_STACK.grafana.net/api/mcp",
    "transportType": "streamable-http",
    "headers": {
      "Authorization": "Basic YOUR_BASE64_AUTH"
    },
    "autoApprove": ["*"]
  }
}
```

Set `"disabled": false` when you want to use the MCP.

## 3. Restart Cursor

Restart Cursor (or reload MCP servers) so it picks up the new server.

## Reference

- Grafana Cloud MCP for Traces: https://grafana.com/docs/grafana-cloud/send-data/traces/mcp-server  
- MCP Observability: https://grafana.com/docs/grafana-cloud/monitor-applications/ai-observability/mcp-observability/

**Note:** This MCP is for querying and analyzing existing trace data. For creating OTEL configs and Grafana dashboards, the skill does not require any MCP; the Grafana Cloud Traces MCP is complementary when you use Grafana Cloud or Tempo and want the AI to reason over traces.
