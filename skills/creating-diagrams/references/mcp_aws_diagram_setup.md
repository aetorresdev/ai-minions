# AWS Labs AWS Diagram MCP Server

The [awslabs.aws-diagram-mcp-server](https://github.com/awslabs/aws-diagram-mcp-server) generates architecture diagrams (PNG) using the Python `diagrams` package with real AWS, Kubernetes, and on-prem icons. Used by `designing-terraform`, `infra-documenter`, and `creating-diagrams` skills.

- **Package**: `awslabs.aws-diagram-mcp-server` (run via uvx)
- **Mode**: stdio — Cursor starts the process when the MCP is used.
- **No API keys** required.
- **Output**: PNG files under the workspace (e.g. `generated-diagrams/` or `docs/diagrams/`).

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
  "awslabs.aws-diagram-mcp-server": {
    "command": "uvx",
    "args": ["awslabs.aws-diagram-mcp-server@latest"],
    "env": {
      "FASTMCP_LOG_LEVEL": "ERROR"
    },
    "autoApprove": ["*"]
  }
}
```

## 3. Restart Cursor

Restart Cursor (or reload MCP servers) so it picks up the new server. When you ask for a diagram, the agent will call `get_diagram_examples`, `list_icons`, and `generate_diagram` (always pass `workspace_dir` so the PNG is saved in your workspace).

## Reference

- Package: https://pypi.org/project/awslabs.aws-diagram-mcp-server/
- Repo: https://github.com/awslabs/aws-diagram-mcp-server
