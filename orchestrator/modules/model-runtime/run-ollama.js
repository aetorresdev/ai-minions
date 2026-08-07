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
  applyOllamaHttpsTlsOptions,
} = require('./local-runtime-endpoint');
const { resolveOllamaNumPredict } = require('./inference-profile-resolve');

/**
 * @param {{
 *   cwd?: string,
 *   host?: string,
 *   port?: number,
 *   base_path?: string,
 *   endpoint?: { host: string, port: number, base_path?: string, protocol?: string, source?: string },
 *   allowPublicLocalRuntime?: boolean,
 *   tlsInsecure?: boolean,
 * }} [options]
 */
function resolveRunOllamaHttpTarget(options = {}) {
  if (options.endpoint && typeof options.endpoint === 'object') {
    return {
      host: String(options.endpoint.host),
      port: Number(options.endpoint.port),
      base_path: String(options.endpoint.base_path ?? ''),
      protocol: String(options.endpoint.protocol ?? 'http'),
      tls_insecure: options.endpoint.tls_insecure === true || options.tlsInsecure === true,
      endpoint: options.endpoint,
    };
  }
  if (options.host != null || options.port != null || options.base_path != null || options.protocol != null) {
    return {
      host: normalizeOllamaClientHost(options.host ?? process.env.OLLAMA_HOST ?? 'localhost'),
      port: Number(options.port ?? parseInt(process.env.OLLAMA_PORT || '11434', 10)),
      base_path: String(options.base_path ?? ''),
      protocol: String(options.protocol ?? 'http'),
      tls_insecure: options.tlsInsecure === true,
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
      tls_insecure: ep.tls_insecure === true,
      endpoint: ep,
    };
  }
  const envTarget = resolveEnvOllamaHttpTarget();
  return {
    host: envTarget.host,
    port: envTarget.port,
    base_path: envTarget.base_path,
    protocol: envTarget.protocol,
    tls_insecure: envTarget.tls_insecure === true,
    endpoint: null,
  };
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
    tlsInsecure,
    format,
    numPredict: numPredictOverride,
    tools,
  } = {},
) {
  const target = resolveRunOllamaHttpTarget({
    cwd,
    host,
    port,
    base_path,
    endpoint,
    allowPublicLocalRuntime,
    tlsInsecure,
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

  const budget = Number.isFinite(numPredictOverride) && numPredictOverride > 0
    ? {
        num_predict: Math.floor(numPredictOverride),
        profile_source: 'call_override',
        inference_profile_mode: 'applied',
        role: traceRole ?? null,
      }
    : resolveOllamaNumPredict({ cwd, role: traceRole });
  const temperature = parseFloat(process.env.OLLAMA_TEMPERATURE || '');
  /** @type {Record<string, unknown>} */
  const options = {};
  options.num_predict = budget.num_predict;
  if (Number.isFinite(temperature)) options.temperature = temperature;
  else options.temperature = 0.2;

  /** @type {Record<string, unknown>} */
  const payload = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: false,
    options,
  };
  if (format === 'json' || (format && typeof format === 'object')) {
    payload.format = format;
  }
  if (Array.isArray(tools) && tools.length) {
    payload.tools = tools;
  }
  const body = JSON.stringify(payload);

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
      applyOllamaHttpsTlsOptions(requestOpts, {
        protocol: target.protocol,
        tls_insecure: target.tls_insecure,
      });
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
            const rawCalls = parsed.message?.tool_calls;
            /** @type {{ name: string, args: Record<string, unknown> }[]} */
            const toolCalls = Array.isArray(rawCalls)
              ? rawCalls
                  .map((c) => ({
                    name: c?.function?.name != null ? String(c.function.name) : '',
                    args: c?.function?.arguments && typeof c.function.arguments === 'object'
                      ? c.function.arguments
                      : {},
                  }))
                  .filter((c) => c.name)
              : [];
            /** @type {{
             *   content: string,
             *   prompt_eval_count?: number,
             *   eval_count?: number,
             *   done_reason?: string | null,
             *   num_predict?: number,
             *   profile_source?: string | null,
             *   inference_profile_mode?: string,
             * }} */
            const out = {
              content,
              tool_calls: toolCalls,
              num_predict: budget.num_predict,
              profile_source: budget.profile_source,
              inference_profile_mode: budget.inference_profile_mode,
            };
            if (typeof parsed.done_reason === 'string' && parsed.done_reason) {
              out.done_reason = parsed.done_reason;
            } else if (parsed.done_reason == null) {
              out.done_reason = null;
            }
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

const { executeOllamaTool } = require('./ollama-tools');

const DEFAULT_MAX_TOOL_ROUNDS = 6;

/**
 * Tool-calling loop on top of runOllama: executes message.tool_calls confined
 * to cwd and feeds results back until the model answers without tool calls.
 *
 * @param {string} systemPrompt
 * @param {{ role: string, content: string }[]} messages
 * @param {Parameters<typeof runOllama>[2] & {
 *   tools?: object[],
 *   maxToolRounds?: number,
 * }} [options]
 * @returns {Promise<object>} runOllama result of the final round, plus
 *   `tools_used: { name: string, args: object }[]` and `tool_rounds: number`.
 */
async function runOllamaWithTools(systemPrompt, messages, options = {}) {
  const { tools, maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS, ...callOpts } = options;
  const history = [...messages];
  /** @type {{ name: string, args: object }[]} */
  const toolsUsed = [];
  const cwd = callOpts.cwd != null ? String(callOpts.cwd) : process.cwd();

  // Indirect through module.exports so tests can stub the runOllama export.
  let out = await module.exports.runOllama(systemPrompt, history, { ...callOpts, tools });
  let rounds = 0;
  while (Array.isArray(out.tool_calls) && out.tool_calls.length && rounds < maxToolRounds) {
    rounds += 1;
    history.push({
      role: 'assistant',
      content: out.content || '',
      tool_calls: out.tool_calls,
    });
    for (const call of out.tool_calls) {
      const result = executeOllamaTool(call.name, call.args, { cwd });
      toolsUsed.push({ name: call.name, args: call.args });
      history.push({ role: 'tool', name: call.name, content: result });
    }
    out = await module.exports.runOllama(systemPrompt, history, { ...callOpts, tools });
  }

  return { ...out, tools_used: toolsUsed, tool_rounds: rounds };
}

module.exports = { runOllama, runOllamaWithTools, resolveRunOllamaHttpTarget };
