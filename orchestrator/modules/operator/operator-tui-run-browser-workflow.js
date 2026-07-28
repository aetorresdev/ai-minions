'use strict';

/**
 * Native run browser + selected-run overview workflow (presentation state).
 * Reuses run-selector models; does not mutate traces/gates.
 */

const {
  createSelectState,
  resolveSelectKeypress,
  formatSelectLines,
} = require('./operator-tui-select-controller');
const {
  buildRunStatusPaneModel,
  formatRunStatusPaneText,
  loadRunStatusPane,
} = require('./operator-run-selector-tui');

const RUN_BROWSER_WORKFLOW_KIND = 'run_browser';

/**
 * @param {{
 *   runs?: object[],
 *   result_code?: string | null,
 *   next_safe_action?: string | null,
 *   previousSurface?: string,
 *   previousFocus?: string,
 *   selectedRunId?: string | null,
 * }} [opts]
 */
function createRunBrowserWorkflow(opts = {}) {
  const runs = Array.isArray(opts.runs) ? opts.runs : [];
  const options = runs.map((run) => ({
    id: String(run.run_id),
    label: `${run.run_id}  status=${run.status ?? '-'}  outcome=${run.outcome ?? '-'}  result_code=${run.result_code ?? '-'}`,
  }));
  let cursorIndex = 0;
  if (opts.selectedRunId) {
    const idx = runs.findIndex((r) => String(r.run_id) === String(opts.selectedRunId));
    if (idx >= 0) cursorIndex = idx;
  }
  return {
    kind: RUN_BROWSER_WORKFLOW_KIND,
    step: runs.length ? 'browse' : 'empty',
    select: createSelectState(options, { cursorIndex, allowCancel: true }),
    runs,
    result_code: opts.result_code ?? (runs.length ? 'RUNS_OK' : 'RUNS_EMPTY'),
    next_safe_action: opts.next_safe_action
      ?? (runs.length
        ? null
        : 'Start a run: ai-minions smoke  (or ai-minions start --goal "...")'),
    overview: null,
    overviewLines: [],
    inlineError: null,
    previousSurface: opts.previousSurface ?? 'home',
    previousFocus: opts.previousFocus ?? 'nav',
  };
}

/**
 * @param {object} workflow
 * @param {object} entry
 * @param {{
 *   tracesDir?: string,
 *   loadContext?: Function,
 *   loadPane?: typeof loadRunStatusPane,
 * }} [opts]
 */
function openRunOverview(workflow, entry, opts = {}) {
  const loadPane = opts.loadPane ?? loadRunStatusPane;
  const loaded = loadPane(entry, {
    tracesDir: opts.tracesDir,
    loadContext: opts.loadContext,
  });
  const pane = loaded.pane ?? buildRunStatusPaneModel(entry, loaded.ctx);
  const overviewLines = formatRunStatusPaneText(pane, { useColor: false })
    .split('\n');
  return {
    ...workflow,
    step: 'overview',
    overview: pane,
    overviewLines,
    inlineError: loaded.ok === false
      ? `invalid or unloadable trace (${pane.result_code ?? 'RUN_TRACE_INVALID'})`
      : null,
    select: workflow.select,
  };
}

/**
 * @param {object} workflow
 * @returns {string[]}
 */
function formatRunBrowserWorkflowLines(workflow) {
  const snapshotNote =
    'Startup snapshot (shell entry) — may be stale after same-session launch; refreshes on remount/refresh';
  if (workflow.step === 'empty') {
    return [
      'Run browser (native)',
      snapshotNote,
      'runs: (none)',
      `result_code: ${workflow.result_code ?? 'RUNS_EMPTY'}`,
      workflow.next_safe_action
        ? `next_safe_action: ${workflow.next_safe_action}`
        : null,
      'Esc back',
    ].filter(Boolean);
  }
  if (workflow.step === 'overview') {
    return [
      'Selected run overview (native)',
      ...(workflow.overviewLines || []),
      workflow.inlineError ? `note: ${workflow.inlineError}` : null,
      'Esc back to run list · selection preserved',
    ].filter(Boolean);
  }
  return [
    'Run browser (native)',
    snapshotNote,
    ...formatSelectLines(workflow.select, {
      title: 'Newest-first runs (read-only)',
      hint: '↑/↓ move · Enter open overview · Esc cancel',
    }),
  ];
}

/**
 * @param {object} workflow
 * @param {string} input
 * @param {object} key
 * @param {{
 *   tracesDir?: string,
 *   loadContext?: Function,
 *   loadPane?: typeof loadRunStatusPane,
 * }} [ctx]
 * @returns {{
 *   action: 'update'|'cancel'|'ignore'|'selected',
 *   workflow?: object,
 *   selectedRunId?: string | null,
 * }}
 */
function applyRunBrowserWorkflowKeypress(workflow, input, key = {}, ctx = {}) {
  const keyObj = key && typeof key === 'object' ? key : {};

  if (workflow.step === 'empty') {
    if (keyObj.escape || input === '\u001b' || input === 'b') {
      return { action: 'cancel' };
    }
    return { action: 'ignore' };
  }

  if (workflow.step === 'overview') {
    if (keyObj.escape || input === '\u001b' || input === 'b') {
      return {
        action: 'update',
        workflow: {
          ...workflow,
          step: 'browse',
          overview: null,
          overviewLines: [],
          inlineError: null,
        },
        selectedRunId: workflow.overview?.run_id ?? null,
      };
    }
    return { action: 'ignore' };
  }

  const resolved = resolveSelectKeypress(input, key, workflow.select);
  if (resolved.type === 'cancel') {
    return { action: 'cancel' };
  }
  if (resolved.type === 'move' && resolved.state) {
    return {
      action: 'update',
      workflow: { ...workflow, select: resolved.state, inlineError: null },
    };
  }
  if (resolved.type === 'confirm' && resolved.option) {
    const entry = workflow.runs.find((r) => String(r.run_id) === resolved.option.id);
    if (!entry) {
      return {
        action: 'update',
        workflow: { ...workflow, inlineError: 'Unknown run selection' },
      };
    }
    const next = openRunOverview(
      { ...workflow, select: resolved.state ?? workflow.select },
      entry,
      ctx,
    );
    return {
      action: 'selected',
      workflow: next,
      selectedRunId: String(entry.run_id),
    };
  }
  return { action: 'ignore' };
}

module.exports = {
  RUN_BROWSER_WORKFLOW_KIND,
  createRunBrowserWorkflow,
  openRunOverview,
  formatRunBrowserWorkflowLines,
  applyRunBrowserWorkflowKeypress,
};
