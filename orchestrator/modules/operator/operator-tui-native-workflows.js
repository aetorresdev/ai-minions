'use strict';

/**
 * Native Ink workflow bridge for Phase 1 (launcher + run browser).
 * Keeps presentation state on the shell model; execution stays in operator modules.
 */

const {
  LAUNCHER_WORKFLOW_KIND,
  createLauncherWorkflow,
  formatLauncherWorkflowLines,
  applyLauncherWorkflowKeypress,
} = require('./operator-tui-launcher-workflow');
const {
  RUN_BROWSER_WORKFLOW_KIND,
  createRunBrowserWorkflow,
  formatRunBrowserWorkflowLines,
  applyRunBrowserWorkflowKeypress,
} = require('./operator-tui-run-browser-workflow');

const NATIVE_WORKFLOW_ACTIONS = Object.freeze(new Set([
  'launcher',
  'smoke',
  'select',
  'runs',
]));

const NATIVE_LAUNCHER_EXECUTE_ACTION = '__native_launcher_execute__';

/**
 * @param {string | null | undefined} actionId
 * @returns {boolean}
 */
function isNativeWorkflowAction(actionId) {
  return NATIVE_WORKFLOW_ACTIONS.has(String(actionId ?? ''));
}

/**
 * @param {object} model shell model
 * @param {string} actionId
 * @returns {object | null} activeWorkflow
 */
function openNativeWorkflow(model, actionId) {
  const id = String(actionId ?? '');
  const previousSurface = model.contentSurface ?? 'home';
  const previousFocus = model.focus ?? 'nav';

  if (id === 'launcher' || id === 'smoke') {
    return createLauncherWorkflow({
      previousSurface,
      previousFocus,
    });
  }
  if (id === 'select' || id === 'runs') {
    // Startup snapshot: uses model.runs already loaded at shell entry (loadRuns /
    // runOperatorRuns). Does not re-invoke discovery on each open — see cockpit contract.
    const runs = Array.isArray(model.runs?.runs) ? model.runs.runs : [];
    return createRunBrowserWorkflow({
      runs,
      result_code: model.runs?.result_code ?? null,
      next_safe_action: model.runs?.next_safe_action ?? null,
      selectedRunId: model.selectedRunId,
      previousSurface,
      previousFocus,
    });
  }
  return null;
}

/**
 * Monotonic gate so async workflow completions can be discarded after Esc / newer keys.
 * @returns {{
 *   begin: () => number,
 *   invalidate: () => number,
 *   isCurrent: (token: number) => boolean,
 *   get epoch(): number,
 * }}
 */
function createAsyncTransitionGate() {
  let epoch = 0;
  return {
    begin() {
      epoch += 1;
      return epoch;
    },
    invalidate() {
      epoch += 1;
      return epoch;
    },
    isCurrent(token) {
      return token === epoch;
    },
    get epoch() {
      return epoch;
    },
  };
}

/**
 * @param {object | null | undefined} workflow
 * @returns {string[]}
 */
function formatNativeWorkflowLines(workflow) {
  if (!workflow || typeof workflow !== 'object') return [];
  if (workflow.kind === LAUNCHER_WORKFLOW_KIND) {
    return formatLauncherWorkflowLines(workflow);
  }
  if (workflow.kind === RUN_BROWSER_WORKFLOW_KIND) {
    return formatRunBrowserWorkflowLines(workflow);
  }
  return ['(unknown native workflow)'];
}

/**
 * @param {object} model
 * @param {string} input
 * @param {object} key
 * @param {object} [ctx]
 * @returns {Promise<{
 *   action: string,
 *   workflow?: object | null,
 *   selectedRunId?: string | null,
 *   selections?: object,
 *   reason_code?: string,
 * }>}
 */
async function applyNativeWorkflowKeypress(model, input, key = {}, ctx = {}) {
  const workflow = model.activeWorkflow;
  if (!workflow) return { action: 'ignore' };

  if (workflow.kind === LAUNCHER_WORKFLOW_KIND) {
    return applyLauncherWorkflowKeypress(workflow, input, key, ctx);
  }
  if (workflow.kind === RUN_BROWSER_WORKFLOW_KIND) {
    return applyRunBrowserWorkflowKeypress(workflow, input, key, ctx);
  }
  return { action: 'ignore' };
}

/**
 * Content surface while a native workflow is active.
 * @param {object | null | undefined} workflow
 * @returns {string}
 */
function surfaceForWorkflow(workflow) {
  if (!workflow) return 'home';
  if (workflow.kind === LAUNCHER_WORKFLOW_KIND) return 'launcher_workflow';
  if (workflow.kind === RUN_BROWSER_WORKFLOW_KIND) {
    return workflow.step === 'overview' ? 'run_overview' : 'run_browser';
  }
  return 'home';
}

module.exports = {
  NATIVE_WORKFLOW_ACTIONS,
  NATIVE_LAUNCHER_EXECUTE_ACTION,
  isNativeWorkflowAction,
  openNativeWorkflow,
  formatNativeWorkflowLines,
  applyNativeWorkflowKeypress,
  surfaceForWorkflow,
  createAsyncTransitionGate,
  LAUNCHER_WORKFLOW_KIND,
  RUN_BROWSER_WORKFLOW_KIND,
};
