'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createOllamaFixtureProxy } = require('./helpers/ollama-fixture-proxy');

function httpJson(baseUrl, relPath, opts = {}) {
  const method = opts.method || 'GET';
  const u = new URL(relPath.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`);
  const body = opts.body ? JSON.stringify(opts.body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers: body
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode || 0,
            json: raw ? JSON.parse(raw) : null,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('ollama-fixture-proxy', () => {
  it('serves tags and captures distinct chat models under base_path', async () => {
    const proxy = createOllamaFixtureProxy({
      basePath: '/olla/ollama',
      models: ['cheap-model', 'strong-model'],
      host: '127.0.0.1',
    });
    const ep = await proxy.listen();
    try {
      const tags = await httpJson(ep.base_url, '/api/tags');
      assert.equal(tags.status, 200);
      assert.equal(tags.json.models.length, 2);

      for (const model of ['cheap-model', 'strong-model']) {
        const chat = await httpJson(ep.base_url, '/api/chat', {
          method: 'POST',
          body: { model, messages: [{ role: 'user', content: 'ping' }] },
        });
        assert.equal(chat.status, 200);
      }

      assert.equal(proxy.tagsCaptures[0].path, '/olla/ollama/api/tags');
      assert.deepEqual(
        proxy.chatCaptures.map((c) => c.model),
        ['cheap-model', 'strong-model'],
      );
      assert.ok(proxy.chatCaptures.every((c) => c.path === '/olla/ollama/api/chat'));
      assert.ok(proxy.chatCaptures.every((c) => !('body' in c) || c.body == null));
    } finally {
      await proxy.close();
    }
  });
});
