# Draw.io MCP — Setup and troubleshooting

## Normal use (like n8n): no need to run anything beforehand

In `~/.cursor/mcp.json` (or workspace `.cursor/mcp.json`) configure the `drawio` server with a **wrapper**: Cursor runs your script, which starts drawio-mcp-server and filters stdout so only JSON-RPC is forwarded. You do not need to start the server manually.

```json
"drawio": {
  "command": "<path-to-your-drawio-mcp-script.sh>",
  "args": [],
  "autoApprove": ["*"],
  "disabled": false
}
```

- **First run**: when you use Draw.io MCP, the server will download assets (may take a moment). Progress messages go to stderr and do not break the protocol.
- **Editor**: when the server is running, open the editor URL in your browser (HTTP port used by your wrapper; the binary defaults to 3000; if that port is in use you can pass another with `--http-port`).
- **WebSocket port**: if you use the Draw.io MCP browser extension, point it to the same port you pass with `--extension-port` in your wrapper (default 3333; use another if it is in use).

## Why it failed with direct `command` (no wrapper)

If you used `"command": "npx", "args": ["-y", "drawio-mcp-server", "--editor"]`:

1. **stdout**: the server writes progress messages to stdout (`"Initializing..."`, `"Downloading..."`, etc.). MCP over stdio uses stdout for JSON-RPC; any non-JSON text causes `Unexpected token 'I', "Initializi"... is not valid JSON`.
2. **Cache**: on first run it downloads and extracts Draw.io under `~/.cache/drawio-mcp-server/`. If the cache is left in a bad state, you may see `ENOENT: ... draw.war`.

The wrapper should use different `--extension-port` and `--http-port` if the default ports (3333 and 3000) are in use. The script that filters stdout (forwarding only JSON-RPC lines) prevents progress messages from breaking the MCP protocol.

## Alternative: HTTP transport (if the wrapper fails)

If you prefer not to use the wrapper or it causes issues, you can use **Streamable HTTP** and start the server yourself first:

1. In `mcp.json`:
   ```json
   "drawio": {
     "url": "http://localhost:<http-port>/mcp",
     "transportType": "streamable-http",
     "autoApprove": ["*"],
     "disabled": false
   }
   ```
2. In a terminal: start the server with `npx -y drawio-mcp-server --transport http --editor --http-port <port>` (default 3000).

## If the cache failed (e.g. `draw.war` ENOENT)

Remove the cache and use Draw.io MCP again (or start the HTTP server); it will re-download everything:

```bash
rm -rf ~/.cache/drawio-mcp-server
```

Then restart Cursor or reload MCP (or, if using HTTP, start the server again on the same port).

## Summary

| What you want | How to do it |
|---------------|--------------|
| Use Draw.io MCP (default) | In `mcp.json` set `command` to the path of your wrapper script (like n8n). |
| Draw.io editor in browser | Open the editor URL (the HTTP port your wrapper or server uses). |
| Use HTTP instead of wrapper | In `mcp.json` use `url` + `transportType: "streamable-http"` and start the server with `--transport http --editor` on a port; put that port in the URL. |
| Stop using Draw.io MCP | In `mcp.json` set `"drawio": { "disabled": true }` or remove the entry. |
