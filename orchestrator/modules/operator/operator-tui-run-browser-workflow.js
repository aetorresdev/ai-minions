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
const {
  fieldOrUnavailable,
  actionEligibilityDisplayLabel,
} = require('./operator-run-list');

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
/**
 * One list row per run_id (newest-first list may still carry duplicates from
 * mixed snapshots/fixtures). Prefer the first occurrence.
 * @param {object[]} runs
 * @returns {object[]}
 */
function dedupeRunsById(runs) {
  const seen = new Set();
  const out = [];
  for (const run of runs) {
    const id = String(run?.run_id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(run);
  }
  return out;
}

/**
 * Compact title for browse rows (full title still available in overview).
 * @param {object} run
 * @returns {string}
 */
function shortRunTitle(run) {
  const raw = typeof run?.goal_summary === 'string' && run.goal_summary.trim()
    ? run.goal_summary.trim()
    : (typeof run?.summary === 'string' && run.summary.trim() ? run.summary.trim() : '');
  if (!raw) return '(no title)';
  return raw.length > 42 ? `${raw.slice(0, 39)}...` : raw;
}

/**
 * Keep browse rows short so numbered headers stay on-screen (long multi-line
 * notes were pushing `N.` rows out of the content viewport — looked like gaps).
 * @param {object} run
 * @returns {string[]}
 */
function browseNoteLines(run) {
  return [
    `title: ${fieldOrUnavailable(run?.goal_summary ?? run?.summary)}`,
    `updated: ${fieldOrUnavailable(run?.last_event_at ?? run?.updated_at)}`
      + ` · phase: ${fieldOrUnavailable(run?.current_phase)}`
      + ` · reason: ${fieldOrUnavailable(run?.reason_code)}`,
    `action: ${actionEligibilityDisplayLabel(
      run?.action_eligibility == null || run.action_eligibility === ''
        ? 'unavailable'
        : String(run.action_eligibility),
    )}`,
  ];
}

function createRunBrowserWorkflow(opts = {}) {
  const runs = dedupeRunsById(Array.isArray(opts.runs) ? opts.runs : []);
  const options = runs.map((run) => ({
    id: String(run.run_id),
    // Short numbered row — title lives in unnumbered noteLines below.
    label: `${run.run_id}  ${run.status ?? '-'} / ${run.outcome ?? '-'} / ${run.result_code ?? '-'} · ${shortRunTitle(run)}`,
    noteLines: browseNoteLines(run),
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
  const select = workflow.select;
  const current = select?.options?.[select.cursorIndex] ?? null;
  const total = Array.isArray(select?.options) ? select.options.length : 0;
  const selectedN = total ? (select.cursorIndex ?? 0) + 1 : 0;
  const selectionFooter = total
    ? `selected ${selectedN}/${total} · ${current?.id ?? '-'}  (↑/↓ changes selection; detail lines are not selectable)`
    : null;
  return [
    'Run browser (native)',
    snapshotNote,
    ...formatSelectLines(select, {
      title: 'Newest-first runs (read-only) — one number per run',
      selectionFooter,
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
