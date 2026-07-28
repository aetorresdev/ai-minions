'use strict';

/**
 * Interactive run selector + compact status pane for the operator cockpit.
 * Reuses run discovery (`runOperatorRuns`) and trace load (`loadOperatorTraceContext`).
 * Read-only: no trace/gate mutation. Not a fullscreen navigator.
 */

const path = require('path');

const { ansi, colorOutcome } = require('./terminal-style');
const { runOperatorRuns, formatRunIdArg } = require('./operator-run-list');
const { loadOperatorTraceContext } = require('./operator-trace-command');

const RUN_SELECTOR_SCHEMA = '1';

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeSelectorToken(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * @param {object[]} runs
 * @param {{ cursorIndex?: number, useColor?: boolean }} [options]
 * @returns {string}
 */
function buildRunSelectorListText(runs, options = {}) {
  const useColor = options.useColor === true;
  const cursorIndex = Number.isInteger(options.cursorIndex) && options.cursorIndex >= 0
    ? options.cursorIndex
    : 0;
  const title = ansi(useColor, '1', 'ai-minions tui — run selector');
  const lines = [
    '+----------------------------------------------------------------------+',
    `|  ${title} (newest-first; read-only)                 |`,
    '+----------------------------------------------------------------------+',
  ];

  if (!runs.length) {
    lines.push(
      '  runs: (none)',
      '  next_safe_action: Start a run: ai-minions smoke  (or ai-minions start --goal "...")',
      '',
      'Commands: [b] back to cockpit',
    );
    return lines.join('\n');
  }

  lines.push('', '  runs:');
  runs.forEach((run, index) => {
    const marker = index === cursorIndex ? '>' : ' ';
    const n = String(index + 1).padStart(2, ' ');
    const status = colorOutcome(run.status ?? 'unknown', useColor);
    const outcome = run.outcome == null ? '-' : String(run.outcome);
    const result = run.result_code ?? '-';
    lines.push(
      `  ${marker} ${n}.  ${run.run_id}  status=${status}`
      + `  outcome=${outcome}  result_code=${result}`,
    );
  });
  lines.push(
    '',
    'Type index then Enter · or j/k (n/p) then Enter · empty Enter=select cursor · b=back',
    '(No mouse · arrow keys not wired in this nested readline pane.)',
    'Policy: selection resolves trace basenames only — no inferred state for invalid traces.',
  );
  return lines.join('\n');
}

/**
 * Compact status pane for a selected run (valid or invalid).
 * @param {{
 *   run_id: string,
 *   trace_basename?: string,
 *   result_code: string,
 *   status?: string | null,
 *   outcome?: string | null,
 *   reason_code?: string | null,
 *   next_safe_action?: string | null,
 *   attach_available?: boolean | null,
 *   attach_bundle_available?: boolean | null,
 *   attach_action_available?: boolean | null,
 *   attach_hint?: string | null,
 *   select_command?: string | null,
 *   trace_file?: string | null,
 * }} pane
 * @param {{ useColor?: boolean }} [options]
 * @returns {string}
 */
function formatRunStatusPaneText(pane, options = {}) {
  const useColor = options.useColor === true;
  const section = (label) => ansi(useColor, '1;36', label);
  const basename = pane.trace_basename
    || (pane.trace_file ? path.basename(String(pane.trace_file), '.jsonl') : pane.run_id);
  const reason = pane.reason_code == null || pane.reason_code === ''
    ? '(none)'
    : String(pane.reason_code);
  const next = pane.next_safe_action == null || pane.next_safe_action === ''
    ? '-'
    : String(pane.next_safe_action);
  const attachHint = pane.attach_hint
    || (
      pane.attach_action_available === true
        ? `ai-minions attach --run-id ${formatRunIdArg(pane.run_id)}`
        : '(attach not available for this result)'
    );

  const lines = [
    section('== Status pane =='),
    `  run_id:                 ${pane.run_id}`,
    `  trace_basename:         ${basename}`,
    `  result_code:            ${pane.result_code}`,
    `  status:                 ${colorOutcome(pane.status ?? 'unknown', useColor)}`,
    `  outcome:                ${pane.outcome == null ? '-' : colorOutcome(String(pane.outcome), useColor)}`,
    `  reason_code:            ${reason}`,
    `  next_safe_action:       ${ansi(useColor, '36', next)}`,
    `  attach_available:       ${pane.attach_available == null ? '-' : pane.attach_available}`,
    `  attach_bundle_available:${pane.attach_bundle_available == null ? '-' : pane.attach_bundle_available}`,
    `  attach_hint:            ${ansi(useColor, '36', attachHint)}`,
  ];
  if (pane.select_command) {
    lines.push(`  status_command:         ${ansi(useColor, '36', pane.select_command)}`);
  }
  if (pane.trace_file) {
    lines.push(`  trace_file:             ${pane.trace_file}`);
  }
  lines.push(
    '',
    'Policy: inspect only — no trace/gate mutation from the selector.',
  );
  return lines.join('\n');
}

/**
 * Build status pane fields from a list entry + optional loaded context.
 * Invalid traces stay `RUN_TRACE_INVALID` without inferred outcome/status.
 * @param {object} entry run list entry from `runOperatorRuns`
 * @param {ReturnType<typeof loadOperatorTraceContext>} [ctx]
 * @returns {Parameters<typeof formatRunStatusPaneText>[0]}
 */
function buildRunStatusPaneModel(entry, ctx) {
  const runId = String(entry.run_id);
  const basename = path.basename(
    String(entry.trace_file || `${runId}.jsonl`),
    '.jsonl',
  );
  const selectCommand = entry.select_command
    || `ai-minions status --run-id ${formatRunIdArg(runId)}`;

  if (!ctx || !ctx.ok) {
    const resultCode = (ctx && ctx.result_code)
      || entry.result_code
      || 'RUN_TRACE_INVALID';
    const reasonCode = (ctx && ctx.reason_code)
      || entry.reason_code
      || 'OPERATOR_TRACE_INVALID';
    const nextSafe = (ctx && ctx.next_safe_action)
      || 'Inspect the trace file or re-run with a valid completed trace JSONL.';
    return {
      run_id: runId,
      trace_basename: basename,
      result_code: resultCode,
      status: resultCode === 'RUN_TRACE_INVALID' ? 'invalid' : (entry.status ?? 'unknown'),
      outcome: null,
      reason_code: reasonCode,
      next_safe_action: nextSafe,
      attach_available: false,
      attach_bundle_available: false,
      attach_action_available: false,
      attach_hint: '(attach not available until a valid trace is selected)',
      select_command: selectCommand,
      trace_file: entry.trace_file ?? ctx?.trace_file ?? null,
    };
  }

  const rs = ctx.run_state;
  const summary = ctx.summary;
  const attachAction = rs?.attach_action_available === true;
  const attachAvailable = rs?.attach_available === true;
  let attachHint = `ai-minions attach --run-id ${formatRunIdArg(runId)}`;
  if (attachAction && !attachAvailable) {
    attachHint += '  (bundle missing on disk; attach can still create one)';
  } else if (!attachAction) {
    attachHint = '(attach action not available for this run state)';
  }

  return {
    run_id: runId,
    trace_basename: basename,
    result_code: rs?.result_code ?? entry.result_code ?? 'RUN_FOUND',
    status: ctx.status_label ?? entry.status ?? 'unknown',
    outcome: summary?.outcome ?? entry.outcome ?? null,
    reason_code: rs?.blocking_reason_code ?? entry.reason_code ?? null,
    next_safe_action: rs?.next_safe_action ?? summary?.next_safe_action ?? null,
    attach_available: rs?.attach_available ?? null,
    attach_bundle_available: rs?.attach_bundle_available ?? null,
    attach_action_available: rs?.attach_action_available ?? null,
    attach_hint: attachHint,
    select_command: selectCommand,
    trace_file: ctx.trace_file ?? entry.trace_file ?? null,
  };
}

/**
 * Resolve selector input: index, run_id, cursor nav, select, or back.
 * @param {string} raw
 * @param {{ runs: object[], cursorIndex: number }} state
 * @returns {{
 *   action: 'select' | 'next' | 'prev' | 'back' | 'noop' | 'unknown',
 *   index?: number,
 *   run?: object,
 *   cursorIndex?: number,
 * }}
 */
function resolveRunSelectorInput(raw, state) {
  const runs = Array.isArray(state.runs) ? state.runs : [];
  const cursorIndex = Number.isInteger(state.cursorIndex) && state.cursorIndex >= 0
    ? Math.min(state.cursorIndex, Math.max(runs.length - 1, 0))
    : 0;
  const token = normalizeSelectorToken(raw);

  if (token === 'b' || token === 'back' || token === 'q' || token === 'quit' || token === 'cancel') {
    return { action: 'back', cursorIndex };
  }

  // Empty Enter / select → current cursor (readline submits empty string on Enter).
  if (!token || token === 'enter' || token === 'select') {
    if (!runs.length) return { action: 'noop', cursorIndex };
    const run = runs[cursorIndex];
    return { action: 'select', index: cursorIndex, run, cursorIndex };
  }

  if (token === 'n' || token === 'j' || token === 'down' || token === '+') {
    if (!runs.length) return { action: 'noop', cursorIndex };
    const next = (cursorIndex + 1) % runs.length;
    return { action: 'next', cursorIndex: next };
  }

  if (token === 'p' || token === 'k' || token === 'up' || token === '-') {
    if (!runs.length) return { action: 'noop', cursorIndex };
    const prev = (cursorIndex - 1 + runs.length) % runs.length;
    return { action: 'prev', cursorIndex: prev };
  }

  if (/^\d+$/.test(token)) {
    const index = Number(token) - 1;
    if (index < 0 || index >= runs.length) {
      return { action: 'unknown', cursorIndex };
    }
    return { action: 'select', index, run: runs[index], cursorIndex: index };
  }

  const byId = runs.findIndex((r) => String(r.run_id).toLowerCase() === token);
  if (byId >= 0) {
    return { action: 'select', index: byId, run: runs[byId], cursorIndex: byId };
  }

  return { action: 'unknown', cursorIndex };
}

/**
 * Load pane for a list entry using basename-safe resolution (run_id = trace basename).
 * @param {object} entry
 * @param {{
 *   tracesDir?: string,
 *   loadContext?: typeof loadOperatorTraceContext,
 * }} [options]
 */
function loadRunStatusPane(entry, options = {}) {
  const loadContext = options.loadContext ?? loadOperatorTraceContext;
  const runId = String(entry.run_id);
  const ctx = loadContext({
    runId,
    filePath: entry.trace_file ? String(entry.trace_file) : undefined,
    tracesDir: options.tracesDir,
  });
  const model = buildRunStatusPaneModel(entry, ctx);
  return {
    ok: Boolean(ctx && ctx.ok),
    run_id: runId,
    result_code: model.result_code,
    reason_code: model.reason_code,
    pane: model,
    ctx,
  };
}

/**
 * Interactive selector loop. Returns selected run_id or null on back/empty.
 * @param {{
 *   question: (prompt: string) => Promise<string>,
 *   write: (text: string) => void,
 *   useColor?: boolean,
 *   tracesDir?: string,
 *   limit?: number,
 *   runRuns?: typeof runOperatorRuns,
 *   loadContext?: typeof loadOperatorTraceContext,
 *   maxLoops?: number,
 * }} options
 */
async function runOperatorRunSelector(options) {
  const write = options.write;
  const question = options.question;
  const useColor = options.useColor === true;
  const runRuns = options.runRuns ?? runOperatorRuns;
  const maxLoops = Number.isInteger(options.maxLoops) && options.maxLoops > 0
    ? options.maxLoops
    : Number.POSITIVE_INFINITY;

  const listResult = runRuns({
    tracesDir: options.tracesDir,
    limit: options.limit,
    json: false,
    useColor: false,
  });
  const runs = Array.isArray(listResult.json?.runs) ? listResult.json.runs : [];

  if (options.clearScreen === true) {
    const { prepareNestedPaneIo } = require('./operator-tui-terminal-guard');
    prepareNestedPaneIo({
      stdin: options.stdin,
      stdout: options.stdout ?? process.stdout,
    });
  }

  if (!runs.length) {
    write(`${buildRunSelectorListText([], { useColor })}\n`);
    return {
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_EMPTY',
      result_code: listResult.result_code ?? 'RUNS_EMPTY',
      selected_run_id: null,
      schema_version: RUN_SELECTOR_SCHEMA,
      text: 'empty',
    };
  }

  let cursorIndex = 0;
  let loops = 0;

  while (loops < maxLoops) {
    loops += 1;
    write(`${buildRunSelectorListText(runs, { cursorIndex, useColor })}\n`);
    const raw = await question('Select run (keys active now) [index|j/k|Enter|b]: ');
    const resolved = resolveRunSelectorInput(raw, { runs, cursorIndex });

    if (resolved.action === 'back') {
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'RUN_SELECTOR_BACK',
        selected_run_id: null,
        schema_version: RUN_SELECTOR_SCHEMA,
        text: 'back',
      };
    }

    if (resolved.action === 'next' || resolved.action === 'prev') {
      cursorIndex = resolved.cursorIndex ?? cursorIndex;
      continue;
    }

    if (resolved.action === 'noop') {
      continue;
    }

    if (resolved.action === 'unknown' || !resolved.run) {
      write('Unknown selection. Use a listed index, run id, n/p, Enter, or b.\n');
      continue;
    }

    cursorIndex = resolved.index ?? cursorIndex;
    const loaded = loadRunStatusPane(resolved.run, {
      tracesDir: options.tracesDir,
      loadContext: options.loadContext,
    });
    const paneText = formatRunStatusPaneText(loaded.pane, { useColor });
    write(`\n${paneText}\n`);

    return {
      ok: true,
      exitCode: 0,
      reason_code: 'RUN_SELECTOR_SELECTED',
      result_code: loaded.result_code,
      selected_run_id: loaded.run_id,
      status_pane: loaded.pane,
      schema_version: RUN_SELECTOR_SCHEMA,
      text: paneText,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    reason_code: 'RUN_SELECTOR_MAX_LOOPS',
    selected_run_id: null,
    schema_version: RUN_SELECTOR_SCHEMA,
    text: 'max_loops',
  };
}

module.exports = {
  RUN_SELECTOR_SCHEMA,
  buildRunSelectorListText,
  formatRunStatusPaneText,
  buildRunStatusPaneModel,
  resolveRunSelectorInput,
  loadRunStatusPane,
  runOperatorRunSelector,
};
