/**
 * Ollama /api/chat client (non-streaming).
 */

'use strict';

const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || '11434', 10);

function runOllama(systemPrompt, messages, { model = "qwen2.5-coder:7b", timeoutMs } = {}) {
  const numPredict = parseInt(process.env.OLLAMA_NUM_PREDICT, 10);
  const temperature = parseFloat(process.env.OLLAMA_TEMPERATURE || "");
  /** @type {Record<string, unknown>} */
  const options = {};
  if (Number.isFinite(numPredict) && numPredict > 0) options.num_predict = numPredict;
  else options.num_predict = 2048;
  if (Number.isFinite(temperature)) options.temperature = temperature;
  else options.temperature = 0.2;

  const body = JSON.stringify({
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: false,
    options,
  });

  return new Promise((resolve, reject) => {
    const ms = timeoutMs ?? (parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10) || 180000);
    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.error) {
              reject(new Error(`Ollama: ${typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error)}`));
              return;
            }
            const content = parsed.message?.content?.trim() || "";
            /** @type {{ content: string, prompt_eval_count?: number, eval_count?: number }} */
            const out = { content };
            if (typeof parsed.prompt_eval_count === "number" && !Number.isNaN(parsed.prompt_eval_count)) {
              out.prompt_eval_count = parsed.prompt_eval_count;
            }
            if (typeof parsed.eval_count === "number" && !Number.isNaN(parsed.eval_count)) {
              out.eval_count = parsed.eval_count;
            }
            resolve(out);
          } catch (e) {
            reject(new Error(`Error parsing Ollama response: ${e.message}\nRaw: ${data}`));
          }
        });
      }
    );
    req.setTimeout(ms, () => req.destroy(new Error(`Ollama timed out after ${ms}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { runOllama };
