"use strict";

/**
 * Parse the ENVIRONMENT block from a session prompt header.
 * Supports:
 *   ENVIRONMENT:
 *     mode: read | write
 *     credentials:
 *       - name: n8n
 *         type: api_key
 *         vars:
 *           url: N8N_URL
 *           key: N8N_API_KEY
 *
 * Returns null if no ENVIRONMENT block found.
 * Returns { mode: "read"|"write", credentials: [{ name, type, vars: {} }] }
 * @param {string} prompt
 */
function parseEnvironment(prompt) {
  const envMatch = prompt.match(/^ENVIRONMENT:\s*\n((?:[ \t]+[^\n]*\n?)*)/m);
  if (!envMatch) return null;

  const block = envMatch[1];

  const modeMatch = block.match(/^\s+mode:\s*(read|write)\s*$/m);
  const mode = modeMatch ? modeMatch[1] : "read";

  const credentials = [];
  const credBlocks = block.split(/\n\s+-\s+name:/);
  for (let i = 1; i < credBlocks.length; i++) {
    const cb = credBlocks[i];
    const name = cb.match(/^([^\n]+)/)?.[1]?.trim();
    const type = cb.match(/\btype:\s*([^\n]+)/)?.[1]?.trim();
    if (!name || !type) continue;

    const vars = {};
    const varsMatch = cb.match(/\bvars:\s*\n((?:\s{8,}[^\n]+\n?)*)/);
    if (varsMatch) {
      for (const line of varsMatch[1].split("\n")) {
        const kv = line.match(/^\s+(\w+):\s*([^\s#][^\n]*)/);
        if (kv) vars[kv[1].trim()] = kv[2].trim();
      }
    }
    credentials.push({ name, type, vars });
  }

  return { mode, credentials };
}

module.exports = {
  parseEnvironment,
};
