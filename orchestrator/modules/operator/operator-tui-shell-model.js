'use strict';

/**
 * Fullscreen shell chrome view-model for `ai-minions tui`.
 * Consumes adapters only — does not call traces/fs/subprocesses.
 */

const {
  adaptHomeReadiness,
  adaptRunsList,
  adaptSelectedRunStatus,
  adaptEvidenceAttachState,
  adaptConfigReadiness,
  adaptActionResult,
  adaptLifecycleSummary,
  adaptGuidedLauncher,
  adaptNavigationActions,
  formatProvenanceField,
} = require('./operator-tui-adapters');
const {
  adaptLiveMonitor,
  formatLiveMonitorLines,
} = require('./operator-tui-live-monitor');

const SHELL_SCHEMA = '1';
const FOCUS_TARGETS = Object.freeze(['nav', 'content', 'input']);
const CONTENT_SURFACES = Object.freeze([
  'home',
  'runs',
  'status',
  'evidence',
  'config',
  'action_result',
  'lifecycle',
  'monitor',
  'launcher',
]);

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
 * @param {{
 *   aboutInfo?: object,
 *   credentials?: object,
 *   pathActivation?: object,
 *   runsPayload?: object,
 *   statusResult?: object | null,
 *   evidenceModel?: object | null,
 *   configModel?: object | null,
 *   launcherModel?: object | null,
 *   actionResult?: object | null,
 *   lifecycleSource?: object | null,
 *   monitorSource?: object | null,
 *   selectedRunId?: string | null,
 *   selectedNavId?: string | null,
 *   contentSurface?: string,
 *   columns?: number,
 *   rows?: number,
 *   focus?: string,
 *   commandInput?: string,
 *   colorEnabled?: boolean,
 *   productVersion?: string | null,
 * }} [options]
 */
function buildShellModel(options = {}) {
  const home = adaptHomeReadiness({
    aboutInfo: options.aboutInfo,
    credentials: options.credentials,
    pathActivation: options.pathActivation,
  });
  const runs = adaptRunsList(options.runsPayload ?? { runs: [] });
  const status = adaptSelectedRunStatus(options.statusResult);
  const evidence = adaptEvidenceAttachState(options.evidenceModel);
  const config = adaptConfigReadiness(options.configModel);
  const launcher = adaptGuidedLauncher(options.launcherModel);
  const actionResult = options.actionResult
    ? adaptActionResult(options.actionResult)
    : null;
  const lifecycle = adaptLifecycleSummary(options.lifecycleSource);
  const monitor = adaptLiveMonitor(
    options.monitorSource
      ?? (options.lifecycleSource
        ? { json: options.lifecycleSource, loop_envelope: options.lifecycleSource }
        : null),
  );
  const navItems = adaptNavigationActions();
  const selectedNavId = options.selectedNavId == null
    ? (navItems[0]?.id ?? 'launcher')
    : String(options.selectedNavId);
  const selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? (runs.runs[0]?.run_id ?? null)
    : String(options.selectedRunId);
  const focusRaw = String(options.focus ?? 'nav').toLowerCase();
  const focus = FOCUS_TARGETS.includes(focusRaw) ? focusRaw : 'nav';
  const surfaceRaw = String(options.contentSurface ?? 'home').toLowerCase();
  // lifecycle remains an alias for the live monitor surface.
  const contentSurface = surfaceRaw === 'lifecycle'
    ? 'monitor'
    : (CONTENT_SURFACES.includes(surfaceRaw) ? surfaceRaw : 'home');
  const columns = Number.isFinite(Number(options.columns)) ? Number(options.columns) : 80;
  const rows = Number.isFinite(Number(options.rows)) ? Number(options.rows) : 24;
  const layout = layoutModeForColumns(columns);
  const version = options.productVersion ?? home.version ?? 'unknown';
  const readiness = home.path_status == null
    ? 'unknown'
    : String(home.path_status);

  return {
    schema: SHELL_SCHEMA,
    title: 'ai-minions',
    version,
    readiness,
    layout,
    columns,
    rows,
    focus,
    commandInput: String(options.commandInput ?? ''),
    colorEnabled: options.colorEnabled !== false && process.env.NO_COLOR == null,
    navItems,
    selectedNavId,
    selectedRunId,
    contentSurface,
    home,
    runs,
    status,
    evidence,
    config,
    launcher,
    actionResult,
    lifecycle,
    monitor,
    monitorSource: options.monitorSource ?? null,
    footerHints: layout === 'narrow'
      ? 'key=run · ↑↓ · Enter · Tab · q'
      : 'Type action key (1/s/e/…) anytime outside command input · ↑/↓+Enter · Tab=focus · /=slash · q=quit · mouse not wired',
    disclaimer:
      'Guided launcher + live run monitor + slash commands — operator modules remain authoritative. '
      + 'Not claimed: Web UI · durable resume · mouse clicks on labels.',
  };
}

/**
 * Map a single keypress to a nav action id when focus is outside command input.
 * Digits/letters must work without Tab→input (operator hotkey expectation).
 * @param {string} raw
 * @param {ReadonlyArray<{ key: string, id: string }> | null | undefined} navItems
 * @returns {string | null}
 */
function resolveNavHotkey(raw, navItems) {
  const token = String(raw ?? '');
  if (!token || token.length !== 1) return null;
  const items = Array.isArray(navItems) ? navItems : [];
  const match = items.find((item) => String(item.key) === token);
  return match ? String(match.id) : null;
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveNavSelection(model, direction) {
  const items = model.navItems;
  if (!items.length) return model;
  const idx = Math.max(0, items.findIndex((n) => n.id === model.selectedNavId));
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? items.length - 1 : idx - 1)
    : (idx + 1) % items.length;
  return buildShellModel({
    ...shellModelToOptions(model),
    selectedNavId: items[nextIdx].id,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveRunSelection(model, direction) {
  const runs = model.runs.runs;
  if (!runs.length) return model;
  const idx = Math.max(0, runs.findIndex((r) => r.run_id === model.selectedRunId));
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? runs.length - 1 : idx - 1)
    : (idx + 1) % runs.length;
  return buildShellModel({
    ...shellModelToOptions(model),
    selectedRunId: runs[nextIdx].run_id,
    statusResult: null,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 */
function cycleFocus(model) {
  const idx = FOCUS_TARGETS.indexOf(model.focus);
  const next = FOCUS_TARGETS[(idx + 1) % FOCUS_TARGETS.length];
  return buildShellModel({
    ...shellModelToOptions(model),
    focus: next,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @returns {object}
 */
function shellModelToOptions(model) {
  return {
    aboutInfo: {
      version: model.home.version,
      git_commit: model.home.git_commit,
      model_policy: model.home.model_policy,
    },
    credentials: {
      credential_sufficiency: model.home.credential_sufficiency,
      remote_tokens_required: model.home.remote_tokens_required,
      providers: model.home.providers,
    },
    pathActivation: {
      status: model.home.path_status,
      on_path: model.home.cli_on_path,
    },
    runsPayload: {
      result_code: model.runs.result_code,
      next_safe_action: model.runs.next_safe_action,
      runs: model.runs.runs,
    },
    statusResult: model.status.available
      ? {
        result_code: model.status.result_code,
        reason_code: model.status.reason_code,
        next_safe_action: model.status.next_safe_action,
        json: {
          run_id: model.status.run_id,
          status: model.status.status,
          operator_trace_summary: {
            outcome: model.status.outcome,
            next_safe_action: model.status.next_safe_action,
          },
          run_state_visibility: {
            blocking_reason_code: model.status.reason_code,
          },
        },
      }
      : null,
    evidenceModel: model.evidence.available ? model.evidence : null,
    configModel: model.config.available ? model.config : null,
    launcherModel: model.launcher.available ? model.launcher : null,
    actionResult: model.actionResult,
    lifecycleSource: {
      goal_summary: model.lifecycle.goal_summary,
      current_iteration: model.lifecycle.current_iteration,
      max_iteration: model.lifecycle.max_iteration,
      current_phase: model.lifecycle.current_role_phase,
      latest_gate: model.lifecycle.latest_gate,
      latest_verdict: model.lifecycle.latest_verdict,
      latest_blocker: model.lifecycle.latest_blocker,
      retry_count: model.lifecycle.retry_count,
      retry_limit: model.lifecycle.retry_limit,
      measured_cost: model.lifecycle.measured_cost,
      configured_budget: model.lifecycle.configured_budget,
      elapsed: model.lifecycle.elapsed,
      time_limit: model.lifecycle.time_limit,
      terminal_stop_reason: model.lifecycle.terminal_stop_reason,
      human_action_required: model.lifecycle.human_action_required,
    },
    monitorSource: model.monitorSource,
    selectedRunId: model.selectedRunId,
    selectedNavId: model.selectedNavId,
    contentSurface: model.contentSurface,
    columns: model.columns,
    rows: model.rows,
    focus: model.focus,
    commandInput: model.commandInput,
    colorEnabled: model.colorEnabled,
    productVersion: model.version,
  };
}

/**
 * Human-readable lines for assertions / debug (not shareable CLI output).
 * @param {ReturnType<typeof buildShellModel>} model
 * @returns {string}
 */
function formatShellText(model) {
  const lines = [
    `${model.title} v${model.version} readiness=${model.readiness}`,
    `layout=${model.layout} cols=${model.columns} focus=${model.focus} surface=${model.contentSurface}`,
    `nav: ${model.navItems.map((n) => (n.id === model.selectedNavId ? `>${n.label}` : n.label)).join(' | ')}`,
    `selected_run: ${model.selectedRunId ?? '(none)'}`,
  ];
  if (model.contentSurface === 'home') {
    lines.push(
      `home: policy=${model.home.model_policy ?? '-'} path=${model.home.path_status ?? '-'} `
      + `creds=${model.home.credential_sufficiency ?? '-'}`,
    );
  }
  if (model.contentSurface === 'runs') {
    if (!model.runs.runs.length) lines.push('runs: (none)');
    else {
      for (const run of model.runs.runs) {
        const marker = run.run_id === model.selectedRunId ? '>' : ' ';
        lines.push(
          `  ${marker} ${run.run_id} status=${run.status ?? '-'} outcome=${run.outcome ?? '-'}`,
        );
      }
    }
  }
  if (model.contentSurface === 'status' && model.status.available) {
    lines.push(
      `status: run=${model.status.run_id ?? '-'} result=${model.status.result_code ?? '-'} `
      + `outcome=${model.status.outcome ?? '-'} reason=${model.status.reason_code ?? '-'}`,
    );
  }
  if (model.contentSurface === 'lifecycle' || model.contentSurface === 'monitor') {
    lines.push(...formatLiveMonitorLines(model.monitor));
  }
  if (model.contentSurface === 'launcher' && model.launcher.available) {
    lines.push(
      `launcher: mode=${model.launcher.agent_flow ?? '-'} lane=${model.launcher.inference_lane ?? '-'} `
      + `policy=${model.launcher.inference_policy ?? '-'} readiness=${model.launcher.readiness ?? '-'} `
      + `cmd=${model.launcher.equivalent_command ?? 'unavailable'}`,
    );
  }
  if (model.actionResult) {
    lines.push(
      `action: id=${model.actionResult.action_id ?? '-'} ok=${model.actionResult.ok} `
      + `reason=${model.actionResult.reason_code ?? '-'}`,
    );
  }
  lines.push(`input: ${model.commandInput || '(empty)'}`);
  lines.push(model.footerHints);
  lines.push(model.disclaimer);
  return lines.join('\n');
}

module.exports = {
  SHELL_SCHEMA,
  FOCUS_TARGETS,
  CONTENT_SURFACES,
  layoutModeForColumns,
  buildShellModel,
  moveNavSelection,
  moveRunSelection,
  cycleFocus,
  shellModelToOptions,
  formatShellText,
  resolveNavHotkey,
};
