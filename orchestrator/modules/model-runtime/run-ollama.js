/**
 * Ollama /api/chat client (non-streaming).
 */

'use strict';

const http = require('http');
const https = require('https');

const {
  buildOllamaHttpPath,
  resolveLocalRuntimeEndpoint,
  ollamaHttpTransport,
  hasYamlLocalBackendEndpoint,
  resolveEnvOllamaHttpTarget,
  normalizeOllamaClientHost,
} = require('./local-runtime-endpoint');

/**
 * @param {{
 *   cwd?: string,
 *   host?: string,
 *   port?: number,
 *   base_path?: string,
 *   endpoint?: { host: string, port: number, base_path?: string, protocol?: string, source?: string },
 *   allowPublicLocalRuntime?: boolean,
 * }} [options]
 */
function resolveRunOllamaHttpTarget(options = {}) {
  if (options.endpoint && typeof options.endpoint === 'object') {
    return {
      host: String(options.endpoint.host),
      port: Number(options.endpoint.port),
      base_path: String(options.endpoint.base_path ?? ''),
      protocol: String(options.endpoint.protocol ?? 'http'),
      endpoint: options.endpoint,
    };
  }
  if (options.host != null || options.port != null || options.base_path != null || options.protocol != null) {
    return {
      host: normalizeOllamaClientHost(options.host ?? process.env.OLLAMA_HOST ?? 'localhost'),
      port: Number(options.port ?? parseInt(process.env.OLLAMA_PORT || '11434', 10)),
      base_path: String(options.base_path ?? ''),
      protocol: String(options.protocol ?? 'http'),
      endpoint: null,
    };
  }
  if (options.cwd && hasYamlLocalBackendEndpoint(options.cwd)) {
    const ep = resolveLocalRuntimeEndpoint({
      cwd: options.cwd,
      allowPublicLocalRuntime: options.allowPublicLocalRuntime === true,
    });
    return {
      host: ep.host,
      port: ep.port,
      base_path: ep.base_path ?? '',
      protocol: ep.protocol ?? 'http',
      endpoint: ep,
    };
  }
  return resolveEnvOllamaHttpTarget();
}

function runOllama(
  systemPrompt,
  messages,
  {
    model = 'qwen2.5-coder:7b',
    timeoutMs,
    traceRole = 'ORCHESTRATOR',
    traceAgentId,
    cwd,
    host,
    port,
    base_path,
    endpoint,
    allowPublicLocalRuntime,
  } = {},
) {
  const target = resolveRunOllamaHttpTarget({
    cwd,
    host,
    port,
    base_path,
    endpoint,
    allowPublicLocalRuntime,
  });
  const chatPath = buildOllamaHttpPath(target.base_path, '/api/chat');

  if (process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE !== '1') {
    const { runNetworkPermissionGate } = require('../../security/network-permission-gate');
    const repoRoot = cwd != null ? String(cwd) : process.cwd();
    /** @type {Record<string, unknown>} */
    const gateOpts = {
      repoRoot,
      role: traceRole,
      agentId: traceAgentId,
      actor: 'orchestrator',
      hostname: target.host,
      port: target.port,
      tool: 'ollama_chat',
      pathLabel: chatPath,
    };
    if (target.endpoint) {
      gateOpts.operatorConfiguredEndpoint = target.endpoint;
      gateOpts.allowPublicLocalRuntime = allowPublicLocalRuntime === true;
    }
    const gate = runNetworkPermissionGate(gateOpts);
    const out = gate.output;
    if (out.decision === 'deny' || out.decision === 'requires_approval' || !out.safe_to_continue) {
      const err = new Error(`Ollama HTTP egress denied (${out.reason_code})`);
      err.code = 'OLLAMA_NETWORK_DENIED';
      err.permission_decision = out;
      throw err;
    }
    try {
      const { emitPermissionCheckTrace } = require('../../orchestrator.js');
      emitPermissionCheckTrace(gate.tracePayload);
    } catch {
      /* orchestrator not loaded — trace optional */
    }
  }

  const numPredict = parseInt(process.env.OLLAMA_NUM_PREDICT, 10);
  const temperature = parseFloat(process.env.OLLAMA_TEMPERATURE || '');
  /** @type {Record<string, unknown>} */
  const options = {};
  if (Number.isFinite(numPredict) && numPredict > 0) options.num_predict = numPredict;
  else options.num_predict = 2048;
  if (Number.isFinite(temperature)) options.temperature = temperature;
  else options.temperature = 0.2;

  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: false,
    options,
  });

  return new Promise((resolve, reject) => {
    const ms = timeoutMs ?? (parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 180000);
    const transport = ollamaHttpTransport(target.protocol);
    /** @type {import('http').RequestOptions} */
    const requestOpts = {
      hostname: target.host,
      port: target.port,
      path: chatPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    if (transport === https) {
      requestOpts.rejectUnauthorized = false;
    }
    const req = transport.request(
      requestOpts,
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.error) {
              reject(new Error(`Ollama: ${typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)}`));
              return;
            }
            const content = parsed.message?.content?.trim() || '';
            /** @type {{ content: string, prompt_eval_count?: number, eval_count?: number }} */
            const out = { content };
            if (typeof parsed.prompt_eval_count === 'number' && !Number.isNaN(parsed.prompt_eval_count)) {
              out.prompt_eval_count = parsed.prompt_eval_count;
            }
            if (typeof parsed.eval_count === 'number' && !Number.isNaN(parsed.eval_count)) {
              out.eval_count = parsed.eval_count;
            }
            resolve(out);
          } catch (e) {
            reject(new Error(`Error parsing Ollama response: ${e.message}\nRaw: ${data}`));
          }
        });
      },
    );
    req.setTimeout(ms, () => req.destroy(new Error(`Ollama timed out after ${ms}ms`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { runOllama, resolveRunOllamaHttpTarget };
