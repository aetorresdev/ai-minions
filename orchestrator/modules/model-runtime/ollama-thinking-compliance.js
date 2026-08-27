'use strict';

/**
 * Validate that Ollama honoured the requested think flag by inspecting the
 * response — not just what we sent. Per #388: unsupported/ignored think:false
 * must surface as a stable non-success, not as "thinking disabled" in trace.
 */

/**
 * @param {unknown} parsed — raw Ollama /api/chat JSON body
 * @returns {boolean}
 */
function ollamaThinkingObserved(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const msg = /** @type {Record<string, unknown>} */ (parsed).message;
  if (!msg || typeof msg !== 'object') return false;
  const thinking = /** @type {Record<string, unknown>} */ (msg).thinking;
  if (typeof thinking === 'string') return thinking.trim().length > 0;
  return false;
}

/**
 * @param {boolean | undefined | null} thinkRequested — value sent on the wire (omit → null)
 * @param {unknown} parsed — raw Ollama /api/chat JSON body
 * @returns {{
 *   ok: boolean,
 *   gate_id?: string,
 *   think_requested: boolean | null,
 *   thinking_observed: boolean,
 *   ollama_think_requested: number | null,
 *   ollama_thinking_observed: number,
 *   ollama_think: number,
 * }}
 */
function assessOllamaThinkingCompliance(thinkRequested, parsed) {
  const requested = thinkRequested === true ? true : (thinkRequested === false ? false : null);
  const observed = ollamaThinkingObserved(parsed);
  const base = {
    think_requested: requested,
    thinking_observed: observed,
    ollama_think_requested: requested === true ? 1 : (requested === false ? 0 : null),
    ollama_thinking_observed: observed ? 1 : 0,
    ollama_think: observed ? 1 : 0,
  };
  if (requested === false && observed) {
    return { ...base, ok: false, gate_id: 'THINKING_NOT_DISABLED' };
  }
  return { ...base, ok: true };
}

module.exports = {
  ollamaThinkingObserved,
  assessOllamaThinkingCompliance,
};
