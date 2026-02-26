# AWS Labs Terraform MCP Server

The [awslabs.terraform-mcp-server](https://github.com/awslabs/terraform-mcp-server) provides AWS provider documentation, best practices, and Checkov security scans. Used by `creating-terraform`, `reviewing-terraform`, `designing-terraform`, and `compliance-checker` agents.

- **Package**: `awslabs.terraform-mcp-server` (run via uvx)
- **Mode**: stdio — Cursor starts the process when the MCP is used.
- **No API keys** required.

## 1. Install uv (required)

The server runs with [uv](https://docs.astral.sh/uv/getting-started/installation/). Install if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

First run of the MCP will download the package via uvx.

## 2. Add MCP server in Cursor

In Cursor: **Settings → MCP** (or edit `~/.cursor/mcp.json` or workspace `.cursor/mcp.json`).

Append a new server entry:

```json
{
  "awslabs.terraform-mcp-server": {
    "command": "uvx",
    "args": ["awslabs.terraform-mcp-server@latest"],
    "env": {
      "FASTMCP_LOG_LEVEL": "ERROR"
    },
    "autoApprove": ["*"]
  }
}
```

## 3. Restart Cursor

Restart Cursor (or reload MCP servers) so it picks up the new server.

## Reference

- Package: https://pypi.org/project/awslabs.terraform-mcp-server/
- Repo: https://github.com/awslabs/terraform-mcp-server
