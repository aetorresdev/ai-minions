# n8n-MCP Server (Docker)

The [n8n-MCP](https://github.com/czlonkowski/n8n-mcp) project provides an MCP server with up-to-date n8n node schemas, properties, and validation. Using it in Cursor reduces errors when creating workflows and connecting nodes.

- **Image**: `ghcr.io/czlonkowski/n8n-mcp:latest` (~280MB)
- **Mode**: stdio — Cursor starts the container when the MCP is used; no long-running container needed.
- **Docs / node data**: 1,084 nodes, properties, operations, and workflow templates bundled in the image.

## 1. Pull the image

```bash
docker pull ghcr.io/czlonkowski/n8n-mcp:latest
```

## 2. Add MCP server in Cursor

In Cursor: **Settings → MCP** (or edit the MCP config file directly).

Append a new server entry. Use one of the following blocks depending on whether you use the n8n API from the MCP or only docs/validation.

### Documentation and validation only (no n8n instance)

```json
{
  "n8n-mcp": {
    "command": "docker",
    "args": [
      "run",
      "-i",
      "--rm",
      "--init",
      "-e", "MCP_MODE=stdio",
      "-e", "LOG_LEVEL=error",
      "-e", "DISABLE_CONSOLE_OUTPUT=true",
      "ghcr.io/czlonkowski/n8n-mcp:latest"
    ]
  }
}
```

### With n8n instance (workflow create/update/execute)

**Option A – Wrapper script (recommended if you already export vars in bash)**  
So that `mcp.json` does not contain secrets and still passes your env into the container, use a script that sources your credentials and then runs Docker. Example: a script (e.g. in `$HOME/.cursor/` or your preferred path) that sources `~/.config/n8n/credentials` if present, maps `N8N_API_TOKEN` → `N8N_API_KEY` for the MCP, and runs the container. In `mcp.json`:

```json
{
  "n8n-mcp": {
    "command": "<path-to-your-n8n-mcp-wrapper.sh>",
    "args": []
  }
}
```

Ensure the script is executable. The script should read `N8N_API_URL` and `N8N_API_TOKEN` (or `N8N_API_KEY`) from the sourced file or from the environment when Cursor starts the script.

**Option B – Pass env through Docker (Cursor started from a terminal with vars exported)**  
If you start Cursor from a shell where you already `export N8N_API_URL` and `export N8N_API_KEY` (or `N8N_API_TOKEN` with `export N8N_API_KEY=$N8N_API_TOKEN`), you can call Docker directly with `-e N8N_API_URL` and `-e N8N_API_KEY` so the container receives them. See the “Documentation and validation only” block and add those two `-e` args before the image name.

With either option, the MCP can create, update, and execute workflows on your instance (in addition to docs and validation).

### n8n on same machine (e.g. local Docker)

```json
{
  "n8n-mcp": {
    "command": "docker",
    "args": [
      "run",
      "-i",
      "--rm",
      "--init",
      "-e", "MCP_MODE=stdio",
      "-e", "LOG_LEVEL=error",
      "-e", "DISABLE_CONSOLE_OUTPUT=true",
      "-e", "N8N_API_URL=http://host.docker.internal:5678",
      "-e", "N8N_API_KEY=your-api-key",
      "-e", "WEBHOOK_SECURITY_MODE=moderate",
      "ghcr.io/czlonkowski/n8n-mcp:latest"
    ]
  }
}
```

**Important:** The MCP expects **`N8N_API_KEY`**. Your wrapper script can source credentials `~/.config/n8n/credentials` and, if you use `N8N_API_TOKEN`, sets `N8N_API_KEY=$N8N_API_TOKEN` so the container receives the key. With Option B, Docker’s `-e VAR` (no value) passes the host variable into the container.

## 3. Restart Cursor

Restart Cursor (or reload the MCP servers) so it picks up the new server. The container will run on demand when you use n8n MCP tools.

## Optional: disable telemetry

Add to the `args` list:

```
"-e", "N8N_MCP_TELEMETRY_DISABLED=true"
```

## Reference

- Repo: https://github.com/czlonkowski/n8n-mcp  
- Docker: https://github.com/czlonkowski/n8n-mcp/pkgs/container/n8n-mcp  
- Docker troubleshooting: https://github.com/czlonkowski/n8n-mcp/blob/main/docs/DOCKER_TROUBLESHOOTING.md  

**Note**: The skill’s static references (`node_patterns.md`, `workflow_templates.md`) remain valid; the MCP adds live node schemas and validation. When the n8n-mcp MCP is configured in Cursor, prefer its tools for node types and connections to avoid schema drift.
