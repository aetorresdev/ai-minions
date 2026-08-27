/**
 * Tool definitions + confined executors for the Ollama tool-calling loop.
 *
 * Ollama /api/chat supports function calling: the model replies with
 * message.tool_calls; the harness executes them and feeds results back as
 * { role: "tool" } messages. Executors here are confined to the run cwd —
 * no absolute paths outside it, no ".." escapes, no symlink escapes.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_READ_BYTES = 64 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;

const TOOL_DEFS = Object.freeze({
  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file located inside the working directory. Returns file contents (truncated if large).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the working directory' },
        },
        required: ['path'],
      },
    },
  },
  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a UTF-8 text file inside the working directory, creating parent directories. Overwrites existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the working directory' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
});

/**
 * @param {unknown} agentId
 * @returns {string[]} tool names allowed for this agent role
 */
function toolNamesForAgent(agentId) {
  const id = String(agentId ?? '');
  if (id.startsWith('dev-')) return ['read_file', 'write_file'];
  if (id === 'qa' || id === 'cerberus') return ['read_file'];
  return [];
}

/**
 * @param {unknown} agentId
 * @returns {object[]} tool schemas for /api/chat
 */
function toolDefsForAgent(agentId) {
  return toolNamesForAgent(agentId).map((name) => TOOL_DEFS[name]).filter(Boolean);
}

/**
 * Resolve a user-supplied path strictly inside cwd (symlink-aware).
 * @param {string} cwd
 * @param {unknown} relPath
 * @returns {{ ok: true, abs: string } | { ok: false, error: string }}
 */
function resolveConfinedPath(cwd, relPath) {
  const root = path.resolve(cwd);
  // Canonical root: on macOS os.tmpdir() returns /var/... which is a symlink
  // to /private/var/..., so containment must compare realpath vs realpath.
  let rootReal = root;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    // root may not exist yet (write into a new cwd tree); lexical root stands.
  }
  const rel = String(relPath ?? '').trim();
  if (!rel) return { ok: false, error: 'empty path' };
  if (path.isAbsolute(rel)
    && !rel.startsWith(root + path.sep) && rel !== root
    && !rel.startsWith(rootReal + path.sep) && rel !== rootReal) {
    return { ok: false, error: `absolute path outside working directory: ${rel}` };
  }
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return { ok: false, error: `path escapes working directory: ${rel}` };
  }
  // Symlink escape check: nearest existing ancestor must resolve inside root.
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const real = fs.realpathSync(probe);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      return { ok: false, error: `path escapes working directory via symlink: ${rel}` };
    }
  } catch {
    return { ok: false, error: `cannot resolve path: ${rel}` };
  }
  return { ok: true, abs };
}

/**
 * Execute one tool call confined to cwd. Never throws — errors are returned
 * as tool output so the model can recover. `ok` reports real success so
 * callers can distinguish a delivered write from a rejected one.
 * @param {string} name
 * @param {unknown} args
 * @param {{ cwd: string }} opts
 * @returns {{ ok: boolean, output: string }}
 */
function executeOllamaTool(name, args, opts) {
  const cwd = path.resolve(String(opts?.cwd ?? process.cwd()));
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'read_file') {
    const r = resolveConfinedPath(cwd, a.path);
    if (!r.ok) return { ok: false, output: `error: ${r.error}` };
    let stat;
    try {
      stat = fs.statSync(r.abs);
    } catch {
      return { ok: false, output: `error: file not found: ${a.path}` };
    }
    if (!stat.isFile()) return { ok: false, output: `error: not a regular file: ${a.path}` };
    // Bounded read: never buffer more than MAX_READ_BYTES + 1, regardless of file size.
    const fd = fs.openSync(r.abs, 'r');
    let raw;
    try {
      const buf = Buffer.alloc(MAX_READ_BYTES + 1);
      const n = fs.readSync(fd, buf, 0, MAX_READ_BYTES + 1, 0);
      raw = buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
    if (raw.length > MAX_READ_BYTES) {
      return {
        ok: true,
        output: raw.subarray(0, MAX_READ_BYTES).toString('utf8')
          + `\n[truncated: showing first ${MAX_READ_BYTES} of ${stat.size} bytes]`,
      };
    }
    return { ok: true, output: raw.toString('utf8') };
  }
  if (name === 'write_file') {
    const r = resolveConfinedPath(cwd, a.path);
    if (!r.ok) return { ok: false, output: `error: ${r.error}` };
    const content = String(a.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      return { ok: false, output: `error: content too large (${bytes} bytes > ${MAX_WRITE_BYTES} limit)` };
    }
    try {
      fs.mkdirSync(path.dirname(r.abs), { recursive: true });
      fs.writeFileSync(r.abs, content, 'utf8');
    } catch (err) {
      return { ok: false, output: `error: write failed: ${err.message}` };
    }
    return { ok: true, output: `ok: wrote ${bytes} bytes to ${path.relative(cwd, r.abs)}` };
  }
  return { ok: false, output: `error: unknown tool: ${name}` };
}

module.exports = {
  TOOL_DEFS,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  toolNamesForAgent,
  toolDefsForAgent,
  resolveConfinedPath,
  executeOllamaTool,
};
