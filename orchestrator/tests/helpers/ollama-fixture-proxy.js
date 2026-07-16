'use strict';

/**
 * Deterministic Ollama-compatible fixture proxy for routing-release smoke.
 * Serves /api/tags and /api/chat under an optional base_path (e.g. /olla/ollama).
 * Captures chat request models for tier-by-role proof.
 */

const http = require('http');
const { URL } = require('url');

/**
 * @param {{
 *   basePath?: string,
 *   models?: string[],
 *   host?: string,
 * }} [opts]
 */
function createOllamaFixtureProxy(opts = {}) {
  const basePath = String(opts.basePath ?? '').replace(/\/$/, '');
  const models = Array.isArray(opts.models) && opts.models.length
    ? [...opts.models]
    : ['qwen2.5-coder:7b', 'qwen3.6:35b-a3b', 'qwen2.5-coder:14b'];
  const host = opts.host ?? '127.0.0.1';

  /** @type {{ method: string, path: string, model?: string, body?: object }[]} */
  const chatCaptures = [];
  /** @type {{ method: string, path: string }[]} */
  const tagsCaptures = [];

  function stripBase(pathname) {
    if (!basePath) return pathname;
    if (pathname === basePath) return '/';
    if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
    return null;
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', `http://${host}`);
    const rel = stripBase(u.pathname);
    if (rel == null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'path_outside_base' }));
      return;
    }

    if (req.method === 'GET' && (rel === '/api/tags' || rel === '/api/tags/')) {
      tagsCaptures.push({ method: 'GET', path: u.pathname });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        models: models.map((name) => ({ name, model: name, size: 1_000_000_000 })),
      }));
      return;
    }

    if (req.method === 'POST' && (rel === '/api/chat' || rel === '/api/chat/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }
        const model = typeof body.model === 'string' ? body.model : undefined;
        chatCaptures.push({
          method: 'POST',
          path: u.pathname,
          model,
          // Do not retain prompts/messages in evidence captures.
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model: model || 'unknown',
          message: { role: 'assistant', content: 'fixture-ok' },
          done: true,
        }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: u.pathname }));
  });

  return {
    server,
    chatCaptures,
    tagsCaptures,
    models,
    basePath,
    /**
     * @returns {Promise<{ host: string, port: number, base_url: string, base_path: string }>}
     */
    async listen() {
      await new Promise((resolve, reject) => {
        server.listen(0, host, (err) => (err ? reject(err) : resolve()));
      });
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base_url = basePath
        ? `http://${host}:${port}${basePath}`
        : `http://${host}:${port}`;
      return { host, port, base_url, base_path: basePath };
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = {
  createOllamaFixtureProxy,
};
