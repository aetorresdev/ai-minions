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
const {
  buildLandingViewModel,
  formatLandingLines,
  helpTopics,
  formatHelpLines,
  formatDiagnosticsLines,
  landingLayoutForViewport,
} = require('./operator-tui-landing');
const { resolveIconMode } = require('./operator-tui-icons');
const { detectTruecolor } = require('./operator-tui-theme');
const { formatArtResolutionDebug } = require('./operator-tui-pixel-art');

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
  'help',
  'diagnostics',
  'launcher_workflow',
  'run_browser',
  'run_overview',
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
 *   icons?: string,
 *   iconMode?: string,
 *   truecolor?: boolean,
 *   productVersion?: string | null,
 *   activeWorkflow?: object | null,
 *   pendingLauncherSelections?: object | null,
 *   helpSelectedTopicId?: string | null,
 *   helpOpenTopicId?: string | null,
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
  const selectedRunId = options.selectedRunId == null || options.selectedRunId === ''
    ? (runs.runs[0]?.run_id ?? null)
    : String(options.selectedRunId);
  const navItems = adaptNavigationActions({ selectedRunId });
  const selectedNavId = options.selectedNavId == null
    ? (navItems.find((n) => n.id === 'launcher')?.id ?? navItems[0]?.id ?? 'home')
    : String(options.selectedNavId);
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
  const landingLayout = landingLayoutForViewport(columns, rows);
  const version = options.productVersion ?? home.version ?? 'unknown';
  const loading = home.path_status === 'loading'
    || home.credential_sufficiency === 'unavailable';
  const colorEnabled = options.colorEnabled !== false && process.env.NO_COLOR == null;
  const iconMode = resolveIconMode(options);
  const truecolor = colorEnabled && detectTruecolor(process.env, {
    truecolor: options.truecolor,
    colorEnabled,
  });
  const recentRunsOffset = Number.isInteger(options.recentRunsOffset) && options.recentRunsOffset > 0
    ? options.recentRunsOffset
    : 0;
  const landing = buildLandingViewModel({
    home,
    runs,
    selectedRunId,
    recentRunsOffset,
    version,
    columns,
    rows,
    loading,
    icons: iconMode,
    art: options.art,
    artMode: options.artMode,
    guardianStyle: options.guardianStyle,
    truecolor,
    colorEnabled,
    env: options.env,
  });
  const readiness = landing.overall.state === 'ready'
    ? 'ready'
    : (landing.overall.state === 'loading'
      ? 'loading'
      : (landing.overall.state === 'unknown'
        ? 'unknown'
        : landing.overall.state));
  const activeWorkflow = options.activeWorkflow && typeof options.activeWorkflow === 'object'
    ? options.activeWorkflow
    : null;
  const pendingLauncherSelections = options.pendingLauncherSelections
    && typeof options.pendingLauncherSelections === 'object'
    ? options.pendingLauncherSelections
    : null;
  const workflowActive = activeWorkflow != null;
  const workflowTextEntry = workflowActive && activeWorkflow.step === 'custom_goal';
  const workflowBusy = workflowActive && Boolean(activeWorkflow.busy);
  const topics = helpTopics();
  const defaultHelpTopicId = topics[0]?.id ?? 'navigation';
  const helpSelectedTopicId = options.helpSelectedTopicId == null || options.helpSelectedTopicId === ''
    ? defaultHelpTopicId
    : (topics.some((t) => t.id === String(options.helpSelectedTopicId))
      ? String(options.helpSelectedTopicId)
      : defaultHelpTopicId);
  const helpOpenTopicId = options.helpOpenTopicId == null || options.helpOpenTopicId === ''
    ? null
    : (topics.some((t) => t.id === String(options.helpOpenTopicId))
      ? String(options.helpOpenTopicId)
      : null);
  const useCompactHints = layout === 'narrow' || landingLayout === 'compact';
  const footerHints = workflowActive
    ? (workflowBusy
      ? (useCompactHints
        ? 'loading · Esc cancel · Ctrl+C quit'
        : 'Loading… · Esc cancels pending load · Ctrl+C=quit · keys otherwise ignored')
      : (workflowTextEntry
        ? (useCompactHints
          ? 'type goal · Enter · Esc · Ctrl+C quit'
          : 'Custom goal · type freely (incl. q) · Enter confirm · Esc back · Ctrl+C=quit')
        : (useCompactHints
          ? 'workflow · ↑↓ · Enter · Esc · q'
          : 'Native workflow · ↑/↓ · Enter · Esc back/cancel · /=slash · q=quit · Ctrl+C=quit · no nested readline')))
    : (contentSurface === 'help'
      ? (helpOpenTopicId
        ? (useCompactHints ? 'Esc topics · q quit' : 'Help topic · Esc back to list · q=quit')
        : (useCompactHints
          ? 'Help · ↑↓ · Enter · Esc · q'
          : 'Help topics · ↑/↓ · Enter/digit open · Esc Home · q=quit · no remount'))
      : (useCompactHints
        ? landing.footer_hints_narrow
        : landing.footer_hints_wide));

  return {
    schema: SHELL_SCHEMA,
    title: 'ai-minions',
    version,
    readiness,
    layout,
    landingLayout,
    columns,
    rows,
    focus,
    commandInput: String(options.commandInput ?? ''),
    colorEnabled,
    iconMode,
    truecolor,
    navItems,
    selectedNavId,
    selectedRunId,
    recentRunsOffset,
    contentSurface,
    helpSelectedTopicId,
    helpOpenTopicId,
    home,
    landing,
    runs,
    status,
    evidence,
    config,
    launcher,
    actionResult,
    lifecycle,
    monitor,
    monitorSource: options.monitorSource ?? null,
    activeWorkflow,
    pendingLauncherSelections,
    footerHints,
    disclaimer:
      'Task-first landing + guided launcher + live monitor + slash commands — operator modules remain authoritative. '
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
  if (!token) return null;
  // Ink may deliver paste/"1\r" as one string — use the first printable keystroke.
  const key = token.length === 1
    ? token
    : (token.match(/[0-9a-z]/i) || [])[0] || '';
  if (!key || key.length !== 1) return null;
  const items = Array.isArray(navItems) ? navItems : [];
  const match = items.find((item) => String(item.key) === key);
  return match ? String(match.id) : null;
}

/**
 * True only for intentional session-end actions (never digits 1–5 / pane letters).
 * @param {unknown} actionId
 * @returns {boolean}
 */
function isShellSessionEndAction(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  return id === 'quit' || id === 'q' || id === '/quit';
}

/**
 * Task-first / contextual surfaces that must switch inside the live Ink mount
 * (update `contentSurface` / model — never `onRequestAction` / unmount).
 * Unmounting these (exit → soft handoff → clear) looks like a silent quit and
 * risks TUI_SHELL_OK when remount is lost.
 * @param {unknown} actionId
 * @returns {boolean}
 */
function isInkLocalShellAction(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  // `runs` / launcher are Phase-1 native workflows (still Ink-mounted, separate path).
  // Overview / Explain / Evidence / Monitor / Settings stay in-process like Help —
  // never soft-handoff into nested readline (silent-quit lookalike / lost remount).
  return id === 'home'
    || id === 'help'
    || id === 'diagnostics'
    || id === 'system-status'
    || id === 'system_status'
    || id === 'status'
    || id === 'overview'
    || id === 'explain'
    || id === 'evidence'
    || id === 'monitor'
    || id === 'lifecycle'
    || id === 'config'
    || id === 'settings';
}

/**
 * Entry remount fallback only for landing chrome (home/help/diagnostics).
 * Overview / Explain / Evidence must never remount here — hotkeys stay in the
 * active Ink render; slash `/status` / `/explain` may soft-handoff into the
 * operator CLI modules for a fresh query (not the seeded snapshot surfaces).
 * @param {unknown} actionId
 * @returns {boolean}
 */
function isInkLocalRemountFallbackAction(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  return id === 'home'
    || id === 'help'
    || id === 'diagnostics'
    || id === 'system-status'
    || id === 'system_status';
}

/**
 * @param {unknown} actionId
 * @returns {'home'|'help'|'diagnostics'|'status'|'evidence'|'monitor'|'config'|null}
 */
function contentSurfaceForLocalAction(actionId) {
  const id = String(actionId ?? '').trim().toLowerCase();
  if (id === 'home' || id === 'landing') return 'home';
  if (id === 'help' || id === '?') return 'help';
  if (id === 'diagnostics' || id === 'system-status' || id === 'system_status' || id === 'doctor') {
    return 'diagnostics';
  }
  // Explain shares the status surface (reason_code / next_safe_action) — no nested pane.
  if (id === 'status' || id === 'overview' || id === 'explain') return 'status';
  if (id === 'evidence') return 'evidence';
  if (id === 'monitor' || id === 'lifecycle') return 'monitor';
  if (id === 'config' || id === 'settings') return 'config';
  return null;
}

/**
 * Seed Settings / config readiness from already-assessed shell home fields
 * (no nested readline / doctor refresh — presentation snapshot only).
 * Does **not** claim doctor success: snapshot_ok ≠ doctor_ok.
 * @param {{ home?: object, landing?: object } | null | undefined} model
 * @returns {object}
 */
function seedConfigModelFromShell(model) {
  const home = model && typeof model === 'object' && model.home && typeof model.home === 'object'
    ? model.home
    : {};
  const nextSafe = model?.landing?.overall?.next_action
    ?? home.next_safe_action
    ?? null;
  const remediations = Array.isArray(home.remediations)
    ? home.remediations.map((r) => String(r))
    : [];
  return {
    snapshot_ok: true,
    doctor_status: 'not_run',
    model_policy: home.model_policy ?? null,
    path_status: home.path_status ?? null,
    path_activation: {
      status: home.path_status ?? null,
      on_path: home.cli_on_path ?? null,
    },
    credentials: {
      credential_sufficiency: home.credential_sufficiency ?? null,
      providers: Array.isArray(home.providers) ? home.providers : [],
    },
    remediation_candidates: remediations,
    next_safe_action: nextSafe == null ? null : String(nextSafe),
  };
}

/**
 * Derive operator-facing action eligibility from authoritative status/outcome.
 * Never claims product Resume — only Inspect / Continue current / Unavailable.
 * @param {{ status?: string | null, outcome?: string | null }} run
 * @returns {'inspect'|'continue_current'|'unavailable'}
 */
function deriveRunActionEligibility(run) {
  const status = String(run?.status ?? '').toLowerCase();
  const outcome = String(run?.outcome ?? '').toLowerCase();
  const terminal = new Set([
    'success', 'failed', 'blocked', 'exhausted', 'cancelled', 'complete', 'fail',
  ]);
  if (status === 'running' || status === 'active' || outcome === 'running') {
    return 'continue_current';
  }
  if (terminal.has(status) || terminal.has(outcome)) {
    return 'inspect';
  }
  if (status === 'invalid' || outcome === 'unknown') {
    return 'unavailable';
  }
  // Non-terminal / interrupted without a running label — inspect first; no Resume claim.
  return 'inspect';
}

/**
 * Derive Overview status snapshot from the selected run board row
 * (authoritative list fields only — does not invent doctor/status JSON).
 * @param {{
 *   selectedRunId?: string | null,
 *   runs?: { runs?: object[] },
 *   landing?: { recent_runs?: object[] },
 *   status?: object | null,
 * } | null | undefined} model
 * @returns {object | null}
 */
function seedStatusResultFromSelectedRun(model) {
  const runId = model && model.selectedRunId != null && model.selectedRunId !== ''
    ? String(model.selectedRunId)
    : null;
  if (!runId) return null;
  // Prefer an already-authoritative Overview snapshot for the same run.
  if (model.status?.available === true && String(model.status.run_id) === runId) {
    return {
      run_id: runId,
      result_code: model.status.result_code ?? null,
      status: model.status.status ?? null,
      outcome: model.status.outcome ?? null,
      reason_code: model.status.reason_code ?? null,
      next_safe_action: model.status.next_safe_action ?? null,
      current_phase: model.status.current_phase ?? null,
      goal_summary: model.status.goal_summary ?? null,
      created_at: model.status.created_at ?? null,
      last_event_at: model.status.last_event_at ?? null,
      action_eligibility: model.status.action_eligibility
        ?? deriveRunActionEligibility(model.status),
    };
  }
  const board = Array.isArray(model?.runs?.runs) ? model.runs.runs : [];
  const recent = Array.isArray(model?.landing?.recent_runs) ? model.landing.recent_runs : [];
  const run = board.find((r) => String(r.run_id) === runId)
    ?? recent.find((r) => String(r.run_id) === runId)
    ?? null;
  if (!run) {
    return {
      run_id: runId,
      result_code: null,
      status: null,
      outcome: null,
      reason_code: null,
      next_safe_action: null,
      current_phase: null,
      goal_summary: null,
      created_at: null,
      last_event_at: null,
      action_eligibility: 'unavailable',
    };
  }
  return {
    run_id: String(run.run_id),
    result_code: run.result_code == null ? null : String(run.result_code),
    status: run.status == null ? null : String(run.status),
    outcome: run.outcome == null ? null : String(run.outcome),
    reason_code: run.reason_code == null ? null : String(run.reason_code),
    next_safe_action: run.next_safe_action == null ? null : String(run.next_safe_action),
    current_phase: run.current_phase == null ? null : String(run.current_phase),
    goal_summary: run.goal_summary == null && run.summary == null
      ? null
      : String(run.goal_summary ?? run.summary),
    created_at: run.created_at == null ? null : String(run.created_at),
    last_event_at: run.last_event_at == null && run.updated_at == null
      ? null
      : String(run.last_event_at ?? run.updated_at),
    action_eligibility: deriveRunActionEligibility(run),
  };
}

/**
 * Pure Ink key → intent resolver (testable hotkey matrix; no Ink imports).
 * Digits/letters dispatch panes; only q / Ctrl+C / /quit set endsSession.
 * @param {string} input
 * @param {{
 *   ctrl?: boolean,
 *   meta?: boolean,
 *   tab?: boolean,
 *   return?: boolean,
 *   backspace?: boolean,
 *   delete?: boolean,
 *   upArrow?: boolean,
 *   downArrow?: boolean,
 *   leftArrow?: boolean,
 *   rightArrow?: boolean,
 * }} key
 * @param {{
 *   focus?: string,
 *   selectedNavId?: string | null,
 *   selectedRunId?: string | null,
 *   navItems?: ReadonlyArray<{ key: string, id: string }>,
 *   commandInput?: string,
 * }} model
 * @returns {{
 *   type: string,
 *   actionId?: string,
 *   direction?: 'next' | 'prev',
 *   char?: string,
 *   endsSession: boolean,
 * }}
 */
function resolveShellKeypress(input, key = {}, model = {}) {
  const focus = String(model.focus ?? 'nav');
  const keyObj = key && typeof key === 'object' ? key : {};
  // Some terminals emit \n (name "enter") instead of \r (name "return").
  const isReturn = Boolean(keyObj.return) || input === '\r' || input === '\n';
  const workflowActive = model.activeWorkflow != null;
  const isEscape = Boolean(keyObj.escape) || input === '\u001b';

  if (keyObj.ctrl && input === 'c') {
    return { type: 'abort', endsSession: true };
  }

  // Text-entry precedence: during custom_goal, printable input (including `q`)
  // routes to the workflow. Unambiguous session-end remains Ctrl+C (above).
  const workflowTextEntry = workflowActive
    && model.activeWorkflow
    && model.activeWorkflow.step === 'custom_goal'
    && !model.activeWorkflow.busy;

  // Help topic browser: isolate before focus/input — Tab→prompt must not turn
  // digits/Enter into input_submit (Settings remount) or swallow `q`.
  const helpSurface = String(model.contentSurface ?? '').toLowerCase() === 'help';
  if (helpSurface) {
    const topics = helpTopics();
    const openId = model.helpOpenTopicId == null || model.helpOpenTopicId === ''
      ? null
      : String(model.helpOpenTopicId);
    if (input === 'q') {
      return { type: 'quit', actionId: 'quit', endsSession: true };
    }
    if (isEscape) {
      if (openId) {
        return { type: 'help_close_topic', endsSession: false };
      }
      return { type: 'surface_home', endsSession: false };
    }
    if (keyObj.tab) {
      return { type: 'cycle_focus', endsSession: false };
    }
    if (openId) {
      // Topic detail: only Esc/q/Tab (above) — never input_submit or shell hotkeys.
      return { type: 'ignore', endsSession: false };
    }
    if (keyObj.upArrow || input === 'k') {
      return { type: 'help_move', direction: 'prev', endsSession: false };
    }
    if (keyObj.downArrow || input === 'j') {
      return { type: 'help_move', direction: 'next', endsSession: false };
    }
    if (isReturn) {
      return { type: 'help_open', endsSession: false };
    }
    if (
      input
      && !keyObj.ctrl
      && !keyObj.meta
      && !keyObj.upArrow
      && !keyObj.downArrow
      && !(isReturn && input.length <= 1)
    ) {
      if (input === '?') {
        // Re-entering Help while already on Help is a no-op stay.
        return { type: 'ignore', endsSession: false };
      }
      const key = input.length === 1
        ? input
        : (input.match(/[1-9]/) || [])[0] || '';
      const topic = topics.find((t) => t.key === key);
      if (topic) {
        return { type: 'help_open', topicId: topic.id, endsSession: false };
      }
    }
    // Consume remaining keys on Help — never fall through to input_submit/dispatch.
    return { type: 'ignore', endsSession: false };
  }

  // Intentional quit — `q` outside command input and outside workflow text entry.
  // Outside custom_goal, q still ends the session; Esc cancels the workflow.
  if (input === 'q' && focus !== 'input' && !workflowTextEntry) {
    return { type: 'quit', actionId: 'quit', endsSession: true };
  }

  if (workflowActive && focus !== 'input') {
    return { type: 'workflow_key', endsSession: false };
  }

  // Esc never ends the session: leave command input, or return to the landing.
  if (isEscape) {
    if (focus === 'input') {
      return { type: 'cancel_input', endsSession: false };
    }
    const surface = String(model.contentSurface ?? 'home').toLowerCase();
    if (surface !== 'home') {
      return { type: 'surface_home', endsSession: false };
    }
    return { type: 'ignore', endsSession: false };
  }

  if (keyObj.tab) {
    return { type: 'cycle_focus', endsSession: false };
  }

  // Labeled hotkeys from shell nav (+ Quick Start digits) — work without Tab→input.
  // Also accept paste bundles like "1\r" (Ink delivers multi-char once).
  if (
    focus !== 'input'
    && input
    && !keyObj.ctrl
    && !keyObj.meta
    && !keyObj.upArrow
    && !keyObj.downArrow
    && !keyObj.leftArrow
    && !keyObj.rightArrow
    && !(isReturn && input.length <= 1)
  ) {
    if (input === '?') {
      return { type: 'dispatch', actionId: 'help', endsSession: false };
    }
    const hotkeyAction = resolveNavHotkey(input, model.navItems);
    if (hotkeyAction) {
      if (isShellSessionEndAction(hotkeyAction)) {
        return { type: 'quit', actionId: 'quit', endsSession: true };
      }
      return { type: 'dispatch', actionId: hotkeyAction, endsSession: false };
    }
  }

  if (focus === 'nav') {
    if (keyObj.upArrow || input === 'k') {
      return { type: 'nav_move', direction: 'prev', endsSession: false };
    }
    if (keyObj.downArrow || input === 'j') {
      return { type: 'nav_move', direction: 'next', endsSession: false };
    }
    if (isReturn) {
      const id = model.selectedNavId == null || model.selectedNavId === ''
        ? null
        : String(model.selectedNavId);
      if (!id) return { type: 'ignore', endsSession: false };
      if (isShellSessionEndAction(id)) {
        return { type: 'quit', actionId: 'quit', endsSession: true };
      }
      return { type: 'dispatch', actionId: id, endsSession: false };
    }
  }

  if (focus === 'content') {
    if (keyObj.upArrow || input === 'k') {
      return { type: 'run_move', direction: 'prev', endsSession: false };
    }
    if (keyObj.downArrow || input === 'j') {
      return { type: 'run_move', direction: 'next', endsSession: false };
    }
    if (isReturn) {
      // Content focus owns **visible** Recent Runs only.
      // Never soft-handoff monitor from Enter — that looks like a silent quit.
      const surface = String(model.contentSurface ?? 'home').toLowerCase();
      if (surface === 'home') {
        const showRecent = model.landing?.composition?.show_recent_runs === true;
        const visible = Array.isArray(model.landing?.recent_runs) ? model.landing.recent_runs : [];
        const visibleSelected = Boolean(
          model.selectedRunId
          && visible.some((r) => String(r.run_id) === String(model.selectedRunId)),
        );
        if (showRecent && visibleSelected) {
          return { type: 'dispatch', actionId: 'status', endsSession: false };
        }
        if (showRecent) {
          return { type: 'dispatch', actionId: 'runs', endsSession: false };
        }
        return { type: 'dispatch', actionId: 'diagnostics', endsSession: false };
      }
      if (model.selectedRunId) {
        return { type: 'dispatch', actionId: 'status', endsSession: false };
      }
      return { type: 'ignore', endsSession: false };
    }
  }

  if (focus === 'input') {
    if (isReturn) {
      const token = String(model.commandInput ?? '').trim();
      if (!token) return { type: 'input_clear_submit', endsSession: false };
      if (isShellSessionEndAction(token)) {
        return { type: 'quit', actionId: token === '/quit' ? '/quit' : 'quit', endsSession: true };
      }
      return { type: 'input_submit', actionId: token, endsSession: false };
    }
    if (keyObj.backspace || keyObj.delete) {
      return { type: 'input_backspace', endsSession: false };
    }
    if (input && !keyObj.ctrl && !keyObj.meta && input !== '\r' && input !== '\n') {
      return { type: 'input_char', char: input, endsSession: false };
    }
    return { type: 'ignore', endsSession: false };
  }

  if (input === '/') {
    return { type: 'start_slash', endsSession: false };
  }

  return { type: 'ignore', endsSession: false };
}

/**
 * Nav rows for ↑/↓ on the landing Quick Start panel — exclude Home (`h`).
 * Home remains reachable via hotkey / Navigate surfaces; listing it under Quick Start
 * made arrow counts easy to overshoot into Settings (nested config / soft-handoff).
 * @param {ReturnType<typeof buildShellModel>} model
 * @returns {ReadonlyArray<{ key: string, id: string }>}
 */
function navItemsForMovement(model) {
  const items = Array.isArray(model.navItems) ? model.navItems : [];
  if (String(model.contentSurface ?? '').toLowerCase() === 'home') {
    return items.filter((item) => item.id !== 'home');
  }
  return items;
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveNavSelection(model, direction) {
  const items = navItemsForMovement(model);
  if (!items.length) return model;
  let idx = items.findIndex((n) => n.id === model.selectedNavId);
  if (idx < 0) idx = 0;
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? items.length - 1 : idx - 1)
    : (idx + 1) % items.length;
  return buildShellModel({
    ...shellModelToOptions(model),
    selectedNavId: items[nextIdx].id,
  });
}

/**
 * Focus ring for Tab. Skip `content` on home when Recent Runs panel is hidden
 * so ↑/↓ cannot select invisible runs.
 * @param {ReturnType<typeof buildShellModel>} model
 * @returns {ReadonlyArray<string>}
 */
function focusTargetsForModel(model) {
  const home = String(model.contentSurface ?? '').toLowerCase() === 'home';
  const showRecent = model.landing?.composition?.show_recent_runs === true;
  if (home && !showRecent) {
    return FOCUS_TARGETS.filter((f) => f !== 'content');
  }
  return FOCUS_TARGETS;
}

/**
 * Move selection among visible Recent Runs on home (with window scroll), or the
 * full runs board on other surfaces. Never advances into off-screen rows without
 * scrolling the visible window.
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveRunSelection(model, direction) {
  const runs = model.runs.runs;
  if (!runs.length) return model;
  const home = String(model.contentSurface ?? '').toLowerCase() === 'home';
  const showRecent = model.landing?.composition?.show_recent_runs === true;
  if (home && !showRecent) return model;

  const limit = home
    ? Math.max(0, Number(model.landing?.composition?.recent_runs_limit) || 0)
    : runs.length;
  if (home && limit <= 0) return model;

  const idx = Math.max(0, runs.findIndex((r) => r.run_id === model.selectedRunId));
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? runs.length - 1 : idx - 1)
    : (idx + 1) % runs.length;

  let recentRunsOffset = Number.isInteger(model.recentRunsOffset) ? model.recentRunsOffset : 0;
  if (home && limit > 0) {
    if (nextIdx < recentRunsOffset) {
      recentRunsOffset = nextIdx;
    } else if (nextIdx >= recentRunsOffset + limit) {
      recentRunsOffset = nextIdx - limit + 1;
    }
    recentRunsOffset = Math.max(0, Math.min(recentRunsOffset, Math.max(0, runs.length - limit)));
  }

  return buildShellModel({
    ...shellModelToOptions(model),
    selectedRunId: runs[nextIdx].run_id,
    recentRunsOffset,
    statusResult: null,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 */
function cycleFocus(model) {
  const targets = focusTargetsForModel(model);
  let idx = targets.indexOf(model.focus);
  if (idx < 0) idx = 0;
  const next = targets[(idx + 1) % targets.length];
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
    recentRunsOffset: model.recentRunsOffset,
    selectedNavId: model.selectedNavId,
    contentSurface: model.contentSurface,
    columns: model.columns,
    rows: model.rows,
    focus: model.focus,
    commandInput: model.commandInput,
    colorEnabled: model.colorEnabled,
    icons: model.iconMode,
    iconMode: model.iconMode,
    truecolor: model.truecolor,
    // Prefer requested so invalid ART_ENV reasons re-resolve across remounts.
    art: model.landing?.art?.requested
      ?? model.landing?.art?.mode
      ?? undefined,
    artMode: model.landing?.art?.requested
      ?? model.landing?.art?.mode
      ?? undefined,
    guardianStyle: model.landing?.art?.guardianStyleRequested
      ?? model.landing?.guardian_style
      ?? model.landing?.art?.guardianStyle
      ?? undefined,
    productVersion: model.version,
    activeWorkflow: model.activeWorkflow ?? null,
    pendingLauncherSelections: model.pendingLauncherSelections ?? null,
    helpSelectedTopicId: model.helpSelectedTopicId ?? null,
    helpOpenTopicId: model.helpOpenTopicId ?? null,
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
  const artDebug = formatArtResolutionDebug(model.landing?.art);
  if (artDebug) lines.push(`tui_art: ${artDebug}`);
  if (model.activeWorkflow) {
    lines.push(
      `workflow: kind=${model.activeWorkflow.kind ?? '-'} step=${model.activeWorkflow.step ?? '-'}`,
    );
  }
  if (model.contentSurface === 'home') {
    lines.push(...formatLandingLines(model.landing, {
      selectedNavId: model.selectedNavId,
      narrow: model.layout === 'narrow' || model.landingLayout === 'compact',
    }));
  }
  if (model.contentSurface === 'diagnostics') {
    lines.push(...formatDiagnosticsLines(model.home));
  }
  if (model.contentSurface === 'help') {
    lines.push(...formatHelpLines({
      selectedTopicId: model.helpSelectedTopicId,
      openTopicId: model.helpOpenTopicId,
    }));
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
  if (model.contentSurface === 'status') {
    if (model.status.available) {
      lines.push(
        `status: run=${model.status.run_id ?? '-'} result=${model.status.result_code ?? '-'} `
        + `outcome=${model.status.outcome ?? '-'} reason=${model.status.reason_code ?? '-'} `
        + `next=${model.status.next_safe_action ?? '-'}`,
      );
    } else {
      lines.push('status: (unavailable)');
    }
  }
  if (model.contentSurface === 'config') {
    if (model.config.available) {
      lines.push(
        `config: path=${model.config.path_status ?? '-'} policy=${model.config.model_policy ?? '-'} `
        + `snapshot_ok=${String(model.config.snapshot_ok)} `
        + `doctor_status=${model.config.doctor_status ?? 'not_run'} `
        + `doctor_ok=${model.config.doctor_ok == null ? 'n/a' : String(model.config.doctor_ok)} `
        + `creds=${model.config.credential_sufficiency ?? '-'} `
        + `next=${model.config.next_safe_action ?? '-'}`,
      );
    } else {
      lines.push('config: (unavailable)');
    }
  }
  if (model.contentSurface === 'evidence') {
    if (model.evidence.available) {
      lines.push(
        `evidence: run=${model.evidence.run_id ?? '-'} result=${model.evidence.result_code ?? '-'} `
        + `attach=${String(model.evidence.attach_available)} `
        + `reason=${model.evidence.reason_code ?? '-'} `
        + `next=${model.evidence.next_safe_action ?? '-'}`,
      );
    } else {
      lines.push('evidence: (unavailable)');
    }
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

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {'next'|'prev'} direction
 */
function moveHelpTopicSelection(model, direction) {
  const topics = helpTopics();
  if (!topics.length) return model;
  let idx = topics.findIndex((t) => t.id === model.helpSelectedTopicId);
  if (idx < 0) idx = 0;
  const nextIdx = direction === 'prev'
    ? (idx <= 0 ? topics.length - 1 : idx - 1)
    : (idx + 1) % topics.length;
  return buildShellModel({
    ...shellModelToOptions(model),
    helpSelectedTopicId: topics[nextIdx].id,
    helpOpenTopicId: null,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {string | null | undefined} [topicId]
 */
function openHelpTopic(model, topicId) {
  const topics = helpTopics();
  const id = topicId == null || topicId === ''
    ? (model.helpSelectedTopicId ?? topics[0]?.id)
    : String(topicId);
  const topic = topics.find((t) => t.id === id) ?? topics[0];
  if (!topic) return model;
  return buildShellModel({
    ...shellModelToOptions(model),
    contentSurface: 'help',
    selectedNavId: 'help',
    helpSelectedTopicId: topic.id,
    helpOpenTopicId: topic.id,
    activeWorkflow: null,
  });
}

/**
 * @param {ReturnType<typeof buildShellModel>} model
 */
function closeHelpTopic(model) {
  return buildShellModel({
    ...shellModelToOptions(model),
    contentSurface: 'help',
    selectedNavId: 'help',
    helpOpenTopicId: null,
    activeWorkflow: null,
  });
}

module.exports = {
  SHELL_SCHEMA,
  FOCUS_TARGETS,
  CONTENT_SURFACES,
  layoutModeForColumns,
  landingLayoutForViewport,
  buildShellModel,
  moveNavSelection,
  moveRunSelection,
  moveHelpTopicSelection,
  openHelpTopic,
  closeHelpTopic,
  cycleFocus,
  shellModelToOptions,
  formatShellText,
  resolveNavHotkey,
  resolveShellKeypress,
  isShellSessionEndAction,
  isInkLocalShellAction,
  isInkLocalRemountFallbackAction,
  contentSurfaceForLocalAction,
  seedConfigModelFromShell,
  seedStatusResultFromSelectedRun,
  deriveRunActionEligibility,
  focusTargetsForModel,
  navItemsForMovement,
  helpTopics,
  formatLandingLines,
  formatHelpLines,
  formatDiagnosticsLines,
};
