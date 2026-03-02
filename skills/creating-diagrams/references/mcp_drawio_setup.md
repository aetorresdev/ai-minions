# Draw.io MCP Server

The [drawio-mcp-server](https://github.com/lgazo/drawio-mcp-server) creates and edits Draw.io diagrams with a built-in editor in the browser. Used by `creating-diagrams` and `infra-documenter` skills.

- **Package**: `drawio-mcp-server` (run via npx)
- **Mode**: stdio with a **wrapper script** (recommended), or Streamable HTTP if you start the server manually.
- **No API keys** required.

The server writes progress messages to stdout, which breaks MCP over stdio. Use a wrapper script that runs `npx -y drawio-mcp-server --editor` and forwards only JSON-RPC lines to stdout (progress goes to stderr).

## 1. Install Node.js and create a wrapper (recommended)

**Requirements:** Node.js v20+.

Create a wrapper script that:

1. Finds a **free pair of ports** in a high range (e.g. 49301–49399) so multiple instances (e.g. Cursor reload) do not conflict.
2. Spawns `npx -y drawio-mcp-server --editor --extension-port <port> --http-port <port>` with those ports.
3. Pipes stdin to the child and forwards to stdout only lines that look like JSON-RPC (e.g. start with `{` and contain `"jsonrpc"`); send everything else to stderr.

Make the script executable and note its path for step 2. The server prints the editor URL to stderr (e.g. "Editor at http://localhost:XXXX"); open that URL in the browser.

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

When the MCP is active, open the editor URL in your browser. If the wrapper picks ports dynamically, the server prints the URL to stderr (e.g. "Editor at http://localhost:49302"); otherwise use the HTTP port you passed with `--http-port` (default 3000).

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

## Optional: port already in use

If you see errors like "port 3334 already in use" (extension port) or "port 3000/3001 already in use" (HTTP port), edit your **wrapper script** and pass different ports:

- **Extension port** (for the Draw.io browser extension): default 3333. If 3333 or 3334 are taken, use e.g. `--extension-port 3335` or `--extension-port 3336`.
- **HTTP port** (for the editor in the browser): default 3000. If taken, use e.g. `--http-port 3002`.

Example in the wrapper:

```bash
npx -y drawio-mcp-server --editor --extension-port 3335 --http-port 3002
```

Pick any free port; ensure the same ports are used when you open the editor URL in the browser (HTTP port) or when configuring the extension (extension port).

## Reference

- Repo: https://github.com/lgazo/drawio-mcp-server  
- npm: https://www.npmjs.com/package/drawio-mcp-server

**Note:** The skill uses this MCP for editable diagrams and for comparison with PNG from the AWS Diagram MCP. If the Draw.io MCP is not configured, the skill falls back to AWS Diagram MCP and optionally Mermaid.
