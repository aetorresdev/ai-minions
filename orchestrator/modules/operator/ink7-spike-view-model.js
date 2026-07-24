'use strict';

/**
 * Ink 7 framework validation spike — view-model + operator adapters.
 * Pure / injectable. Does not import Ink or React. Does not mutate runs/traces/gates.
 */

const SPIKE_SCHEMA = '1';

const FOCUS_TARGETS = Object.freeze(['nav', 'content', 'input']);

/**
 * @param {unknown} columns
 * @returns {'wide'|'narrow'}
 */
function layoutModeForColumns(columns) {
  const n = Number(columns);
  if (!Number.isFinite(n) || n < 1) return 'narrow';
  return n < 72 ? 'narrow' : 'wide';
}

/**
 * Adapt `runOperatorRuns` payload into spike list rows (operator remains authoritative).
 * @param {{ ok?: boolean, runs?: object[], result_code?: string, next_safe_action?: string }} payload
 * @returns {{ runs: object[], result_code: string, next_safe_action: string | null }}
 */
function adaptRunsPayload(payload) {
  const runs = Array.isArray(payload?.runs)
    ? payload.runs.map((run) => ({
      run_id: String(run.run_id ?? ''),
      status: run.status ?? null,
      outcome: run.outcome ?? null,
      result_code: run.result_code ?? null,
      reason_code: run.reason_code ?? null,
      current_phase: run.current_phase ?? null,
    }))
    : [];
  return {
    runs,
    result_code: String(payload?.result_code ?? 'RUNS_EMPTY'),
    next_safe_action: payload?.next_safe_action == null ? null : String(payload.next_safe_action),
  };
}

/**
 * Adapt `runOperatorStatus` / loaded status pane fields (no CLI text parsing).
 * @param {object | null | undefined} status
 * @returns {object | null}
 */
function adaptStatusPayload(status) {
  if (!status || typeof status !== 'object') return null;
  return {
    run_id: status.run_id == null ? null : String(status.run_id),
    result_code: status.result_code == null ? null : String(status.result_code),
    status: status.status == null ? null : String(status.status),
    outcome: status.outcome == null ? null : String(status.outcome),
    reason_code: status.reason_code == null ? null : String(status.reason_code),
    next_safe_action: status.next_safe_action == null ? null : String(status.next_safe_action),
  };
}

/**
 * @param {{
 *   runs?: object[],
 *   selectedRunId?: string | null,
 *   status?: object | null,
 *   columns?: number,
 *   rows?: number,
 *   focus?: string,
 *   commandInput?: string,
 *   liveTick?: number,
 *   colorEnabled?: boolean,
 * }} [options]
 */
function buildSpikeShellModel(options = {}) {
  const runs = Array.isArray(options.runs) ? options.runs : [];
  const selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? (runs[0]?.run_id ?? null)
    : String(options.selectedRunId);
  const focusRaw = String(options.focus ?? 'nav').toLowerCase();
  const focus = FOCUS_TARGETS.includes(focusRaw) ? focusRaw : 'nav';
  const columns = Number.isFinite(Number(options.columns)) ? Number(options.columns) : 80;
  const rows = Number.isFinite(Number(options.rows)) ? Number(options.rows) : 24;
  const liveTick = Number.isFinite(Number(options.liveTick)) ? Number(options.liveTick) : 0;
  const layout = layoutModeForColumns(columns);
  const selected = runs.find((r) => r.run_id === selectedRunId) ?? null;
  const status = adaptStatusPayload(options.status) ?? (selected
    ? {
      run_id: selected.run_id,
      result_code: selected.result_code,
      status: selected.status,
      outcome: selected.outcome,
      reason_code: selected.reason_code,
      next_safe_action: null,
    }
    : null);

  return {
    schema: SPIKE_SCHEMA,
    title: 'ai-minions ink7 spike',
    layout,
    columns,
    rows,
    focus,
    commandInput: String(options.commandInput ?? ''),
    liveTick,
    colorEnabled: options.colorEnabled !== false && process.env.NO_COLOR == null,
    runs,
    selectedRunId,
    status,
    navItems: [
      { id: 'runs', label: 'Runs' },
      { id: 'status', label: 'Status' },
      { id: 'help', label: 'Help' },
    ],
    footerHints: layout === 'narrow'
      ? 'Tab focus · ↑↓ select · / cmd · q quit'
      : 'Tab=focus  ↑/↓=select run  Enter=status  /=command  q=quit  Ctrl+C=abort',
    disclaimer: 'Disposable framework spike — not the production TUI entrypoint.',
  };
}

/**
 * Simulate a live operator-visible tick without changing run-control semantics.
 * @param {ReturnType<typeof buildSpikeShellModel>} model
 * @param {number} [delta]
 */
function applyLiveTick(model, delta = 1) {
  const nextTick = (Number(model.liveTick) || 0) + (Number.isFinite(Number(delta)) ? Number(delta) : 1);
  return buildSpikeShellModel({
    ...model,
    runs: model.runs,
    selectedRunId: model.selectedRunId,
    status: model.status
      ? { ...model.status, live_note: `tick=${nextTick}` }
      : null,
    columns: model.columns,
    rows: model.rows,
    focus: model.focus,
    commandInput: model.commandInput,
    liveTick: nextTick,
    colorEnabled: model.colorEnabled,
  });
}

/**
 * @param {ReturnType<typeof buildSpikeShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveSelection(model, direction) {
  if (!model.runs.length) return model;
  const idx = Math.max(0, model.runs.findIndex((r) => r.run_id === model.selectedRunId));
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? model.runs.length - 1 : idx - 1)
    : (idx + 1) % model.runs.length;
  return buildSpikeShellModel({
    ...model,
    selectedRunId: model.runs[nextIdx].run_id,
    status: null,
  });
}

/**
 * @param {ReturnType<typeof buildSpikeShellModel>} model
 */
function cycleFocus(model) {
  const idx = FOCUS_TARGETS.indexOf(model.focus);
  const next = FOCUS_TARGETS[(idx + 1) % FOCUS_TARGETS.length];
  return buildSpikeShellModel({ ...model, focus: next });
}

/**
 * Human-readable lines for assertions / non-Ink debug (not CLI shareables).
 * @param {ReturnType<typeof buildSpikeShellModel>} model
 * @returns {string}
 */
function formatSpikeShellText(model) {
  const lines = [
    model.title,
    `layout=${model.layout} cols=${model.columns} rows=${model.rows} focus=${model.focus} tick=${model.liveTick}`,
    `nav: ${model.navItems.map((n) => n.label).join(' | ')}`,
    'runs:',
  ];
  if (!model.runs.length) {
    lines.push('  (none)');
  } else {
    for (const run of model.runs) {
      const marker = run.run_id === model.selectedRunId ? '>' : ' ';
      lines.push(
        `  ${marker} ${run.run_id} status=${run.status ?? '-'} outcome=${run.outcome ?? '-'} result=${run.result_code ?? '-'}`,
      );
    }
  }
  if (model.status) {
    lines.push(
      `status: run=${model.status.run_id ?? '-'} result=${model.status.result_code ?? '-'} `
      + `outcome=${model.status.outcome ?? '-'} reason=${model.status.reason_code ?? '-'}`,
    );
  } else {
    lines.push('status: (none)');
  }
  lines.push(`input: ${model.commandInput || '(empty)'}`);
  lines.push(model.footerHints);
  lines.push(model.disclaimer);
  return lines.join('\n');
}

module.exports = {
  SPIKE_SCHEMA,
  FOCUS_TARGETS,
  layoutModeForColumns,
  adaptRunsPayload,
  adaptStatusPayload,
  buildSpikeShellModel,
  applyLiveTick,
  moveSelection,
  cycleFocus,
  formatSpikeShellText,
};
