'use strict';

const { runOperatorStatus, runOperatorExplain } = require('./operator-trace-command');

/**
 * @param {unknown} actionId
 * @returns {boolean}
 */
function isInkLocalAsyncReadAction(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  return id === 'status' || id === 'monitor' || id === 'explain';
}

/**
 * Async ink-local operator read (no nested remount / readline pane).
 * @param {unknown} actionId
 * @param {{
 *   runId?: string | null,
 *   runStatus?: typeof runOperatorStatus,
 *   runExplain?: typeof runOperatorExplain,
 *   abortSignal?: AbortSignal | null,
 * }} options
 */
async function loadInkLocalReadPayload(actionId, options = {}) {
  await new Promise((resolve) => setImmediate(resolve));
  if (options.abortSignal?.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }
  const id = String(actionId ?? '').trim().toLowerCase();
  const runId = options.runId == null || options.runId === '' ? null : String(options.runId);
  if (!runId) {
    return {
      ok: false,
      exitCode: 1,
      reason_code: 'TUI_SHELL_RUN_ID_REQUIRED',
      json: null,
    };
  }
  if (id === 'explain') {
    return (options.runExplain ?? runOperatorExplain)({
      runId,
      json: true,
      useColor: false,
    });
  }
  return (options.runStatus ?? runOperatorStatus)({
    runId,
    json: true,
    useColor: false,
  });
}

module.exports = {
  isInkLocalAsyncReadAction,
  loadInkLocalReadPayload,
};
