# Draw.io MCP Server

The [drawio-mcp-server](https://github.com/lgazo/drawio-mcp-server) creates and edits Draw.io diagrams with a built-in editor in the browser. Used by `creating-diagrams` and `infra-documenter` skills.

- **Package**: `drawio-mcp-server` (run via npx)
- **Mode**: stdio with a **wrapper script** (recommended), or Streamable HTTP if you start the server manually.
- **No API keys** required.

The server writes progress messages to stdout, which breaks MCP over stdio. Use a wrapper script that runs `npx -y drawio-mcp-server --editor` and forwards only JSON-RPC lines to stdout (progress goes to stderr).

## 1. Install Node.js and create a wrapper (recommended)

**Requirements:** Node.js v20+.

Create a wrapper script that:

1. Spawns `npx -y drawio-mcp-server --editor` (and optionally `--extension-port`, `--http-port` if defaults 3333/3000 are in use).
2. Pipes stdin to the child and forwards to stdout only lines that look like JSON-RPC (e.g. start with `{` and contain `"jsonrpc"`); send everything else to stderr.

Make the script executable and note its path for step 2.

## 2. Add MCP server in Cursor

In Cursor: **Settings → MCP** (or edit `~/.cursor/mcp.json` or workspace `.cursor/mcp.json`).

Append a new server entry using your wrapper script path:

```json
{
  "drawio": {
    "command": "<path-to-your-drawio-mcp-wrapper.sh>",
    "args": [],
    "autoApprove": ["*"],
    "disabled": false
  }
}
```

When the MCP is active, open the editor URL in your browser (the HTTP port your wrapper uses; default 3000, or the port you pass with `--http-port`).

### Alternative: HTTP transport (no wrapper)

If you prefer to start the server yourself and connect via HTTP:

1. In a terminal: `npx -y drawio-mcp-server --transport http --editor --http-port <port>` (default 3000).
2. In `mcp.json`:

```json
{
  "drawio": {
    "url": "http://localhost:<port>/mcp",
    "transportType": "streamable-http",
    "autoApprove": ["*"],
    "disabled": false
  }
}
```

## 3. Restart Cursor

Restart Cursor (or reload MCP servers) so it picks up the new server.

## Optional: if the cache failed (e.g. `draw.war` ENOENT)

Remove the cache and try again; the server will re-download assets:

```bash
rm -rf ~/.cache/drawio-mcp-server
```

## Reference

- Repo: https://github.com/lgazo/drawio-mcp-server  
- npm: https://www.npmjs.com/package/drawio-mcp-server

**Note:** The skill uses this MCP for editable diagrams and for comparison with PNG from the AWS Diagram MCP. If the Draw.io MCP is not configured, the skill falls back to AWS Diagram MCP and optionally Mermaid.
