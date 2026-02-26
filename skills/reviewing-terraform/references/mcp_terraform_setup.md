# Terraform MCP Server (HashiCorp)

The [Terraform MCP Server](https://github.com/hashicorp/terraform-mcp-server) provides resource and module documentation lookup for Terraform. Used by `designing-terraform`, `creating-terraform`, and `reviewing-terraform` skills.

- **Image**: `hashicorp/terraform-mcp-server:0.1.0`
- **Mode**: stdio — Cursor starts the container when the MCP is used.
- **No API keys** required.

## 1. Pull the image (optional)

Docker will pull the image on first use. To pre-pull:

```bash
docker pull hashicorp/terraform-mcp-server:0.1.0
```

## 2. Add MCP server in Cursor

In Cursor: **Settings → MCP** (or edit `~/.cursor/mcp.json` or workspace `.cursor/mcp.json`).

Append a new server entry:

```json
{
  "terraform-mcp-server": {
    "command": "docker",
    "args": [
      "run",
      "-i",
      "--rm",
      "hashicorp/terraform-mcp-server:0.1.0"
    ],
    "autoApprove": [
      "resolveProviderDocID",
      "getProviderDocs",
      "searchModules",
      "moduleDetails"
    ]
  }
}
```

## 3. Restart Cursor

Restart Cursor (or reload MCP servers) so it picks up the new server.

## Reference

- Repo: https://github.com/hashicorp/terraform-mcp-server
