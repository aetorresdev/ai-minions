'use strict';

/**
 * Native run browser + selected-run overview workflow (presentation state).
 * Reuses run-selector models; does not mutate traces/gates.
 */

const {
  createSelectState,
  resolveSelectKeypress,
  formatSelectLineEntries,
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
function clipField(value, max) {
  const text = fieldOrUnavailable(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
}

function browseNoteLines(run) {
  // One short field per line. A single updated·phase·reason row wrapped inside
  // the content column and overprinted title and execution time on resize.
  return [
    `title: ${clipField(run?.goal_summary ?? run?.summary, 48)}`,
    `created: ${fieldOrUnavailable(run?.created_at)}`,
    `updated: ${fieldOrUnavailable(run?.last_event_at ?? run?.updated_at)}`,
    `phase: ${fieldOrUnavailable(run?.current_phase)}`,
    `reason: ${clipField(run?.reason_code, 42)}`,
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
function overviewFromLoaded(workflow, entry, loaded) {
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

function openRunOverview(workflow, entry, opts = {}) {
  const loadPane = opts.loadPane ?? loadRunStatusPane;
  const loaded = loadPane(entry, {
    tracesDir: opts.tracesDir,
    loadContext: opts.loadContext,
  });
  // A test double may return a promise (injected delay). Sync callers stay sync.
  if (loaded && typeof loaded.then === 'function') {
    return loaded.then((resolved) => overviewFromLoaded(workflow, entry, resolved));
  }
  return overviewFromLoaded(workflow, entry, loaded);
}

/**
 * Structured content rows for Ink (selection bold) and plain join for tests.
 * @param {object} workflow
 * @returns {Array<{ text: string, selected?: boolean, muted?: boolean, kind?: string }>}
 */
function formatRunBrowserWorkflowEntries(workflow) {
  const snapshotNote =
    'Startup snapshot (shell entry) — may be stale after same-session launch; refreshes on remount/refresh';
  if (workflow.step === 'empty') {
    return [
      { text: 'Run browser (native)', kind: 'heading' },
      { text: '', kind: 'spacer' },
      { text: snapshotNote, kind: 'note', muted: true },
      { text: '', kind: 'spacer' },
      { text: 'runs: (none)', muted: true },
      { text: `result_code: ${workflow.result_code ?? 'RUNS_EMPTY'}` },
      workflow.next_safe_action
        ? { text: `next_safe_action: ${workflow.next_safe_action}`, muted: true }
        : null,
      { text: 'Esc back', muted: true },
    ].filter(Boolean);
  }
  if (workflow.step === 'overview') {
    return [
      { text: 'Selected run overview (native)', kind: 'heading' },
      { text: '', kind: 'spacer' },
      ...(workflow.overviewLines || []).map((line) => ({ text: String(line), kind: 'overview' })),
      workflow.inlineError
        ? { text: `note: ${workflow.inlineError}`, muted: true, kind: 'note' }
        : null,
      { text: '', kind: 'spacer' },
      { text: 'Esc back to run list · selection preserved', muted: true, kind: 'hint' },
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
    { text: 'Run browser (native)', kind: 'heading' },
    { text: '', kind: 'spacer' },
    { text: snapshotNote, kind: 'note', muted: true },
    { text: '', kind: 'spacer' },
    ...formatSelectLineEntries(select, {
      title: 'Newest-first runs (read-only) — one number per run',
      selectionFooter,
      hint: '↑/↓ move · Enter open overview · Esc cancel',
      padAfterTitle: true,
    }),
  ];
}

/**
 * Fit structured list entries into `maxRows` terminal rows while keeping the
 * selected run, the selection footer and the key hint on screen. Ink does not
 * clip children by default, so an unwindowed list taller than the content box
 * overprints the footer and the rows below it.
 * @param {Array<{ text: string, selected?: boolean, muted?: boolean, kind?: string }>} entries
 * @param {number} maxRows
 * @returns {Array<{ text: string, selected?: boolean, muted?: boolean, kind?: string }>}
 */
function windowEntriesToHeight(entries, maxRows) {
  const limit = Math.floor(Number(maxRows));
  if (!Number.isFinite(limit) || limit <= 0 || entries.length <= limit) return entries;

  const firstOption = entries.findIndex((e) => e.kind === 'option');
  if (firstOption < 0) return entries.slice(0, limit);

  let tailStart = entries.length;
  while (
    tailStart > firstOption
    && ['hint', 'footer', 'spacer'].includes(entries[tailStart - 1].kind)
  ) {
    tailStart -= 1;
  }
  let head = entries.slice(0, firstOption);
  const tail = entries.slice(tailStart);

  const blocks = [];
  for (let i = firstOption; i < tailStart; i += 1) {
    if (entries[i].kind === 'option') blocks.push([]);
    blocks[blocks.length - 1].push(entries[i]);
  }
  const minBlock = Math.min(...blocks.map((b) => b.length));
  const reserved = 2; // "more above" / "more below" markers
  let budget = limit - head.length - tail.length - reserved;
  if (budget < minBlock) {
    // Short viewport: drop breathing room and notes before dropping runs.
    head = head.filter((e) => e.kind !== 'spacer' && e.kind !== 'note');
    budget = limit - head.length - tail.length - reserved;
  }
  budget = Math.max(budget, 1);

  let selected = blocks.findIndex((b) => b[0].selected === true);
  if (selected < 0) selected = 0;
  let start = selected;
  let end = selected;
  let used = blocks[selected].length;
  for (;;) {
    let grew = false;
    if (end + 1 < blocks.length && used + blocks[end + 1].length <= budget) {
      end += 1;
      used += blocks[end].length;
      grew = true;
    }
    if (start > 0 && used + blocks[start - 1].length <= budget) {
      start -= 1;
      used += blocks[start].length;
      grew = true;
    }
    if (!grew) break;
  }

  let visible = blocks.slice(start, end + 1).flat();
  if (visible.length > budget) visible = visible.slice(0, budget);
  while (visible.length && visible[visible.length - 1].kind === 'spacer') visible.pop();

  const out = [...head];
  if (start > 0) out.push({ text: `  ... ${start} more above`, muted: true, kind: 'more' });
  out.push(...visible);
  if (end < blocks.length - 1) {
    out.push({ text: `  ... ${blocks.length - 1 - end} more below`, muted: true, kind: 'more' });
  }
  out.push(...tail);
  return out;
}

/**
 * @param {object} workflow
 * @returns {string[]}
 */
function formatRunBrowserWorkflowLines(workflow) {
  return formatRunBrowserWorkflowEntries(workflow).map((e) => e.text);
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
    const opened = openRunOverview(
      { ...workflow, select: resolved.state ?? workflow.select },
      entry,
      ctx,
    );
    const pack = (next) => ({
      action: 'selected',
      workflow: next,
      selectedRunId: String(entry.run_id),
    });
    if (opened && typeof opened.then === 'function') return opened.then(pack);
    return pack(opened);
  }
  return { action: 'ignore' };
}

module.exports = {
  RUN_BROWSER_WORKFLOW_KIND,
  createRunBrowserWorkflow,
  openRunOverview,
  formatRunBrowserWorkflowEntries,
  formatRunBrowserWorkflowLines,
  windowEntriesToHeight,
  applyRunBrowserWorkflowKeypress,
};
