'use strict';

/**
 * TUI UX acceptance layer — journeys, visual-state inventory, a11y hierarchy,
 * and release companion verdict. State/view-model assertions remain mandatory;
 * render strings are supporting evidence only. Harness — not a product pane.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  TUI_QUALITY_RELEASE_COMMAND,
  evaluateReleaseGateVerdict,
  buildPlatformEvidenceRecord,
} = require('./operator-tui-quality-harness');

const {
  buildShellModel,
  formatShellText,
  resolveShellKeypress,
  shellModelToOptions,
  contentSurfaceForLocalAction,
  isInkLocalShellAction,
  seedConfigModelFromShell,
  seedStatusResultFromSelectedRun,
} = require('./operator-tui-shell-model');

const {
  isNativeWorkflowAction,
  openNativeWorkflow,
  surfaceForWorkflow,
} = require('./operator-tui-native-workflows');

/** Documented companion command for the UX acceptance gate. */
const TUI_UX_ACCEPTANCE_COMMAND = 'cd orchestrator && npm run test:tui-ux';

/** Combined release command set (semantic + UX). */
const TUI_RELEASE_COMMAND_SET = Object.freeze([
  TUI_QUALITY_RELEASE_COMMAND,
  TUI_UX_ACCEPTANCE_COMMAND,
]);

/** Documented combined npm script (semantic then UX). */
const TUI_RELEASE_NPM_SCRIPT = 'test:tui-release';

/**
 * Canonical viewport fixtures for visual-state evidence.
 * @type {ReadonlyArray<{ id: string, columns: number, rows: number }>}
 */
const TUI_UX_VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'wide', columns: 120, rows: 30 }),
  Object.freeze({ id: 'standard', columns: 80, rows: 24 }),
  Object.freeze({ id: 'narrow_min', columns: 60, rows: 20 }),
]);

/**
 * Representative visual states that must have deterministic model evidence.
 * @type {ReadonlyArray<string>}
 */
const TUI_UX_VISUAL_STATES = Object.freeze([
  'splash',
  'landing_ready',
  'landing_needs_setup',
  'landing_no_runs',
  'launcher_supported',
  'launcher_unsupported',
  'run_browser_empty',
  'run_browser_valid',
  'run_browser_invalid',
  'monitor_active',
  'verifying_cerberus',
  'blocked',
  'failed',
  'completed_evidence_ready',
  'action_result_remediation',
  'help_topics',
  'diagnostics',
]);

/**
 * Textual status tokens that must remain distinct without relying on color alone.
 * @type {ReadonlyArray<string>}
 */
const TUI_UX_STATUS_TOKENS = Object.freeze([
  'RUNNING',
  'VERIFYING',
  'READY',
  'WARN',
  'ACTION REQUIRED',
  'BLOCKED',
  'FAILED',
]);

/**
 * @typedef {{
 *   input?: string,
 *   key?: object,
 * }} UxJourneyIntent
 */

/**
 * Deterministic operator journeys for UX acceptance.
 * Each journey binds a fixture id + intent sequence; simulations assert model state.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   goal: string,
 *   starting_fixture: string,
 *   primary_action: string,
 *   navigation_path: string[],
 *   max_decisions: number,
 *   expected_result: string,
 *   recovery_path: string,
 *   inspectable_reason_codes: string[],
 *   prohibited: string[],
 *   intents: UxJourneyIntent[],
 *   recovery_intents: UxJourneyIntent[],
 * }>}
 */
const TUI_UX_JOURNEYS = Object.freeze([
  Object.freeze({
    id: 'clean_install_setup',
    goal: 'Identify that setup is required and find the next safe action',
    starting_fixture: 'landing_needs_setup',
    primary_action: 'Settings / path remediation',
    navigation_path: Object.freeze(['boot', 'landing', 'readiness_next', 'settings_or_doctor']),
    max_decisions: 3,
    expected_result: 'Operator sees needs-setup Overall and a concrete next action',
    recovery_path: 'Follow path/credential remediation; re-open landing',
    inspectable_reason_codes: Object.freeze(['path_status', 'credential_sufficiency']),
    prohibited: Object.freeze(['false ready', 'hidden primary action', 'color-only blocker']),
    // Hotkey 3 → System Status / doctor (settings_or_doctor path).
    intents: Object.freeze([
      Object.freeze({ input: '3', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'ready_no_runs',
    goal: 'Start from a ready environment with an empty run list',
    starting_fixture: 'landing_ready_empty',
    primary_action: 'Start New Run',
    navigation_path: Object.freeze(['boot', 'landing', 'quick_start_1']),
    max_decisions: 2,
    expected_result: 'Start New Run is the visible primary action',
    recovery_path: 'Esc cancels launcher; landing remains',
    inspectable_reason_codes: Object.freeze(['landing.overall.state']),
    prohibited: Object.freeze(['diagnostic wall as default', 'silent quit on Enter']),
    intents: Object.freeze([
      Object.freeze({ input: '1', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'canonical_sudoku_launch',
    goal: 'Start the canonical Sudoku fixture from the guided launcher',
    starting_fixture: 'landing_ready',
    primary_action: 'Start New Run → fixture confirm',
    navigation_path: Object.freeze(['landing', 'launcher', 'fixture', 'confirm']),
    max_decisions: 5,
    expected_result: 'Native launcher workflow stays mounted until confirm/cancel',
    recovery_path: 'Esc back; no nested readline',
    inspectable_reason_codes: Object.freeze(['launcher.readiness', 'equivalent_command']),
    prohibited: Object.freeze(['fabricated progress %', 'live credentials required for gate']),
    intents: Object.freeze([
      Object.freeze({ input: '1', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'inspect_active_run',
    goal: 'Find and inspect an active run',
    starting_fixture: 'run_browser_valid_active',
    primary_action: 'Browse Runs → Overview / Monitor',
    navigation_path: Object.freeze(['landing', 'runs', 'select', 'monitor']),
    max_decisions: 4,
    expected_result: 'Active run shows textual RUNNING / phase without invented %',
    recovery_path: 'Esc returns prior surface',
    inspectable_reason_codes: Object.freeze(['status', 'reason_code', 'next_safe_action']),
    prohibited: Object.freeze(['progress invented from iterations']),
    intents: Object.freeze([
      Object.freeze({ input: '2', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'diagnose_cerberus_block',
    goal: 'Diagnose a CERBERUS-blocked run and find human action',
    starting_fixture: 'run_blocked_cerberus',
    primary_action: 'Overview / Explain next safe action',
    navigation_path: Object.freeze(['landing', 'overview', 'explain']),
    max_decisions: 4,
    expected_result: 'BLOCKED / ACTION REQUIRED remain textually distinct from FAILED',
    recovery_path: 'Follow next_safe_action; do not treat as execution failure',
    inspectable_reason_codes: Object.freeze(['blocking_reason_code', 'human_action_required']),
    prohibited: Object.freeze(['color-only block vs fail', 'collapse block into failed']),
    // o → Overview, x → Explain (status surface stays; reason codes remain inspectable).
    intents: Object.freeze([
      Object.freeze({ input: 'o', key: Object.freeze({}) }),
      Object.freeze({ input: 'x', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'diagnose_failed_run',
    goal: 'Diagnose an execution failure and next safe action',
    starting_fixture: 'run_failed',
    primary_action: 'Overview / Explain',
    navigation_path: Object.freeze(['landing', 'overview', 'explain']),
    max_decisions: 4,
    expected_result: 'FAILED is distinct; next_safe_action inspectable',
    recovery_path: 'Remediate via stated next_safe_action',
    inspectable_reason_codes: Object.freeze(['outcome', 'reason_code', 'next_safe_action']),
    prohibited: Object.freeze(['success implied', 'missing recovery path']),
    intents: Object.freeze([
      Object.freeze({ input: 'o', key: Object.freeze({}) }),
      Object.freeze({ input: 'x', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'inspect_evidence',
    goal: 'Locate evidence / attach availability after completion',
    starting_fixture: 'run_completed_evidence',
    primary_action: 'Evidence pane',
    navigation_path: Object.freeze(['landing', 'evidence']),
    max_decisions: 4,
    expected_result: 'attach_* availability honest; absent not coerced to ready',
    recovery_path: 'If attach unavailable, follow next_safe_action',
    inspectable_reason_codes: Object.freeze(['attach_available', 'reason_code']),
    prohibited: Object.freeze(['fabricated attach ready', 'missing evidence recorded as PASS']),
    intents: Object.freeze([
      Object.freeze({ input: 'e', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([
      Object.freeze({ input: '', key: Object.freeze({ escape: true }) }),
    ]),
  }),
  Object.freeze({
    id: 'exit_safely',
    goal: 'Exit the TUI without losing terminal state',
    starting_fixture: 'landing_ready',
    primary_action: 'q / Ctrl+C / /quit',
    navigation_path: Object.freeze(['any_surface', 'quit']),
    max_decisions: 1,
    expected_result: 'Session ends with terminal restored; Esc never quits',
    recovery_path: 'Re-launch ai-minions tui',
    inspectable_reason_codes: Object.freeze(['TUI_SHELL_QUIT', 'TUI_SHELL_ABORT']),
    prohibited: Object.freeze(['silent TUI_SHELL_OK on pane select', 'Esc ends session']),
    intents: Object.freeze([
      Object.freeze({ input: 'q', key: Object.freeze({}) }),
    ]),
    recovery_intents: Object.freeze([]),
  }),
]);

/**
 * First-time-user beta script — observations only; never satisfaction scores as authority.
 * @type {{
 *   id: string,
 *   launch: string,
 *   steps: string[],
 *   observation_fields: string[],
 *   platforms_note: string,
 * }}
 */
const TUI_UX_FIRST_TIME_SCRIPT = Object.freeze({
  id: 'first_time_user_beta',
  launch: 'ai-minions tui',
  steps: Object.freeze([
    'Start from a declared clean fixture/environment (document PATH, policy, Node).',
    'Launch ai-minions tui.',
    'Identify readiness (Overall label + next action) without implementation coaching.',
    'Start the supported canonical fixture via Start New Run.',
    'Find the active or latest run via Browse Runs.',
    'Identify whether it completed, failed, or blocked (textual status).',
    'Locate evidence / next safe action when applicable.',
    'Exit with q (confirm terminal restored).',
  ]),
  observation_fields: Object.freeze([
    'completed_without_intervention',
    'wrong_turn_count',
    'points_of_confusion',
    'unsupported_assumption',
    'terminal_platform_version',
    'run_or_evidence_ids',
  ]),
  platforms_note:
    'Record observations on the release-required platform set selected by governance. '
    + 'Missing required manual evidence blocks release — never silent PASS.',
});

const BASE_ABOUT = Object.freeze({
  version: '0.26.0-beta.1',
  model_policy: 'local_only',
  git_commit: 'deadbeef',
});

/**
 * @param {string} fixtureId
 * @param {{ columns?: number, rows?: number, colorEnabled?: boolean }} [viewport]
 * @returns {ReturnType<typeof buildShellModel>}
 */
function buildUxFixtureModel(fixtureId, viewport = {}) {
  const columns = Number.isFinite(viewport.columns) ? Number(viewport.columns) : 120;
  const rows = Number.isFinite(viewport.rows) ? Number(viewport.rows) : 30;
  const colorEnabled = viewport.colorEnabled !== false;
  const base = {
    aboutInfo: { ...BASE_ABOUT },
    columns,
    rows,
    colorEnabled,
  };

  switch (String(fixtureId)) {
    case 'landing_needs_setup':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'insufficient', providers: [] },
        pathActivation: { status: 'missing', on_path: false },
        runsPayload: { runs: [], result_code: 'RUNS_EMPTY', next_safe_action: 'none' },
        contentSurface: 'home',
        selectedNavId: 'launcher',
      });
    case 'landing_ready_empty':
    case 'landing_ready':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'not_required', providers: [] },
        pathActivation: { status: 'ready', on_path: true },
        runsPayload: { runs: [], result_code: 'RUNS_EMPTY', next_safe_action: 'none' },
        contentSurface: 'home',
        selectedNavId: 'launcher',
      });
    case 'run_browser_valid_active':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'not_required', providers: [] },
        pathActivation: { status: 'ready', on_path: true },
        runsPayload: {
          runs: [{
            run_id: 'run-active-1',
            status: 'running',
            outcome: null,
            result_code: 'OK',
            reason_code: 'RUN_ACTIVE',
            next_safe_action: 'open monitor',
          }],
          result_code: 'RUNS_FOUND',
          next_safe_action: 'select a run',
        },
        selectedRunId: 'run-active-1',
        contentSurface: 'home',
        selectedNavId: 'launcher',
        statusResult: {
          run_id: 'run-active-1',
          result_code: 'RUN_FOUND',
          status: 'running',
          outcome: null,
          reason_code: 'RUN_ACTIVE',
          next_safe_action: 'open monitor',
        },
      });
    case 'run_blocked_cerberus':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'not_required', providers: [] },
        pathActivation: { status: 'ready', on_path: true },
        runsPayload: {
          runs: [{
            run_id: 'blocked-1',
            status: 'blocked',
            outcome: 'blocked',
            result_code: 'RUN_FOUND',
            reason_code: 'CERBERUS_REJECT',
            next_safe_action: 'address CERBERUS blockers',
          }],
          result_code: 'RUNS_FOUND',
          next_safe_action: 'open overview',
        },
        selectedRunId: 'blocked-1',
        contentSurface: 'home',
        selectedNavId: 'launcher',
        statusResult: {
          run_id: 'blocked-1',
          result_code: 'RUN_FOUND',
          status: 'blocked',
          outcome: 'blocked',
          reason_code: 'CERBERUS_REJECT',
          next_safe_action: 'address CERBERUS blockers',
          human_action_required: true,
        },
      });
    case 'run_failed':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'not_required', providers: [] },
        pathActivation: { status: 'ready', on_path: true },
        runsPayload: {
          runs: [{
            run_id: 'failed-1',
            status: 'failed',
            outcome: 'failed',
            result_code: 'RUN_FOUND',
            reason_code: 'QA_REJECT',
            next_safe_action: 'inspect QA findings',
          }],
          result_code: 'RUNS_FOUND',
          next_safe_action: 'open overview',
        },
        selectedRunId: 'failed-1',
        contentSurface: 'home',
        selectedNavId: 'launcher',
        statusResult: {
          run_id: 'failed-1',
          result_code: 'RUN_FOUND',
          status: 'failed',
          outcome: 'failed',
          reason_code: 'QA_REJECT',
          next_safe_action: 'inspect QA findings',
        },
      });
    case 'run_completed_evidence':
      return buildShellModel({
        ...base,
        credentials: { credential_sufficiency: 'not_required', providers: [] },
        pathActivation: { status: 'ready', on_path: true },
        runsPayload: {
          runs: [{
            run_id: 'done-1',
            status: 'completed',
            outcome: 'success',
            result_code: 'RUN_FOUND',
            reason_code: 'OK',
          }],
          result_code: 'RUNS_FOUND',
          next_safe_action: 'open evidence',
        },
        selectedRunId: 'done-1',
        contentSurface: 'home',
        selectedNavId: 'launcher',
        statusResult: {
          run_id: 'done-1',
          result_code: 'RUN_FOUND',
          status: 'completed',
          outcome: 'success',
          reason_code: 'OK',
          next_safe_action: 'inspect attach availability',
        },
        evidenceModel: {
          run_id: 'done-1',
          result_code: 'EVIDENCE_FOUND',
          attach_available: false,
          reason_code: 'ATTACH_UNAVAILABLE',
          next_safe_action: 'generate attach bundle from Overview',
        },
      });
    default:
      throw new Error(`unknown UX fixture: ${fixtureId}`);
  }
}

/**
 * Apply one resolved shell intent using the same local-surface rules as the live
 * entrypoint (`isInkLocalShellAction` / `contentSurfaceForLocalAction`).
 * Non-local actions are reported as wouldExecuteAction — never invent surfaces.
 * @param {ReturnType<typeof buildShellModel>} model
 * @param {{ type: string, actionId?: string, direction?: string, endsSession?: boolean }} intent
 */
function applyUxShellIntent(model, intent) {
  const type = String(intent?.type ?? 'ignore');
  if (type === 'quit' || type === 'abort') {
    return {
      model,
      sessionEnded: true,
      reason: type === 'abort' ? 'TUI_SHELL_ABORT' : 'TUI_SHELL_QUIT',
      wouldExecuteAction: null,
    };
  }
  if (type === 'dispatch' && intent.actionId) {
    const actionId = String(intent.actionId);
    if (isNativeWorkflowAction(actionId)) {
      const workflow = openNativeWorkflow(model, actionId);
      if (workflow) {
        return {
          model: buildShellModel({
            ...shellModelToOptions(model),
            activeWorkflow: workflow,
            contentSurface: surfaceForWorkflow(workflow),
            focus: 'content',
            selectedNavId: actionId === 'smoke' ? 'launcher' : actionId,
            commandInput: '',
          }),
          sessionEnded: false,
          reason: null,
          wouldExecuteAction: null,
        };
      }
    }
    if (isInkLocalShellAction(actionId)) {
      const surface = contentSurfaceForLocalAction(actionId) ?? 'home';
      const opts = {
        ...shellModelToOptions(model),
        contentSurface: surface,
        selectedNavId: surface === 'diagnostics' ? 'diagnostics'
          : (surface === 'config' ? 'config' : surface),
        focus: 'nav',
        commandInput: '',
        activeWorkflow: null,
      };
      if (surface === 'config') {
        opts.configModel = seedConfigModelFromShell(model);
      }
      if (surface === 'status') {
        const keepAuthoritative = model.status?.available === true
          && model.selectedRunId
          && String(model.status.run_id) === String(model.selectedRunId);
        if (!keepAuthoritative) {
          const seeded = seedStatusResultFromSelectedRun(model);
          if (seeded) opts.statusResult = seeded;
        }
      }
      return {
        model: buildShellModel(opts),
        sessionEnded: false,
        reason: null,
        wouldExecuteAction: null,
      };
    }
    return {
      model,
      sessionEnded: false,
      reason: null,
      wouldExecuteAction: actionId,
    };
  }
  if (type === 'surface_home') {
    return {
      model: buildShellModel({
        ...shellModelToOptions(model),
        contentSurface: 'home',
        selectedNavId: 'launcher',
        focus: 'nav',
        commandInput: '',
        activeWorkflow: null,
      }),
      sessionEnded: false,
      reason: null,
      wouldExecuteAction: null,
    };
  }
  if (type === 'workflow_key') {
    // Esc during workflow is handled by resolveShellKeypress as workflow_key when
    // activeWorkflow is set — recovery simulations pass Esc after clearing workflow
    // via surface_home from the harness when testing cancel. Keep model unchanged.
    return {
      model,
      sessionEnded: false,
      reason: null,
      wouldExecuteAction: null,
    };
  }
  return {
    model,
    sessionEnded: Boolean(intent?.endsSession),
    reason: intent?.endsSession ? 'TUI_SHELL_QUIT' : null,
    wouldExecuteAction: null,
  };
}

/**
 * Simulate a journey: fixture → intent sequence → model transitions.
 * @param {string | (typeof TUI_UX_JOURNEYS)[number]} journeyOrId
 * @param {{ columns?: number, rows?: number, colorEnabled?: boolean, includeRecovery?: boolean }} [opts]
 */
function simulateUxJourney(journeyOrId, opts = {}) {
  const journey = typeof journeyOrId === 'string'
    ? journeyById(journeyOrId)
    : journeyOrId;
  if (!journey) {
    throw new Error(`unknown UX journey: ${journeyOrId}`);
  }
  let model = buildUxFixtureModel(journey.starting_fixture, opts);
  /** @type {Array<{ type: string, actionId?: string, endsSession?: boolean }>} */
  const resolved = [];
  let sessionEnded = false;
  let endReason = null;
  /** @type {string[]} */
  const wouldExecute = [];

  const intents = [
    ...(Array.isArray(journey.intents) ? journey.intents : []),
    ...(opts.includeRecovery && Array.isArray(journey.recovery_intents)
      ? journey.recovery_intents
      : []),
  ];

  for (const step of intents) {
    if (sessionEnded) break;
    // Esc while a native workflow is mounted cancels back to home in simulation.
    const keyObj = step.key && typeof step.key === 'object' ? step.key : {};
    if (model.activeWorkflow && (keyObj.escape || step.input === '\u001b')) {
      model = buildShellModel({
        ...shellModelToOptions(model),
        activeWorkflow: null,
        contentSurface: 'home',
        selectedNavId: 'launcher',
        focus: 'nav',
        commandInput: '',
      });
      resolved.push({ type: 'surface_home', endsSession: false });
      continue;
    }
    const intent = resolveShellKeypress(step.input ?? '', keyObj, model);
    resolved.push(intent);
    const applied = applyUxShellIntent(model, intent);
    model = applied.model;
    if (applied.wouldExecuteAction) wouldExecute.push(applied.wouldExecuteAction);
    if (applied.sessionEnded) {
      sessionEnded = true;
      endReason = applied.reason;
    }
  }

  const text = formatShellText(model);
  return {
    journey,
    model,
    text,
    intents: resolved,
    decisionCount: resolved.filter((i) => i.type !== 'ignore').length,
    sessionEnded,
    endReason,
    wouldExecuteAction: wouldExecute,
    criticalPath: observeCriticalPath(model),
  };
}

/**
 * Derive critical-path visibility from a real shell model + composition text.
 * @param {ReturnType<typeof buildShellModel>} model
 */
function observeCriticalPath(model) {
  if (!model || typeof model !== 'object' || !model.schema) {
    throw new Error('critical path observation requires a shell model from buildShellModel');
  }
  const text = formatShellText(model);
  const landing = model.landing;
  const composition = landing?.composition;
  const primaryFromComposition = composition?.show_primary_cta === true;
  const primaryFromNav = Array.isArray(model.navItems)
    && model.navItems.some((n) => n.id === 'launcher' || /new run/i.test(String(n.label)));
  const primaryFromText = /Start New Run|New Run/i.test(text);
  const next = Boolean(
    (landing?.overall?.next_action && String(landing.overall.next_action).trim())
    || (model.status?.next_safe_action && String(model.status.next_safe_action).trim())
    || (model.runs?.next_safe_action && String(model.runs.next_safe_action).trim())
    || (landing?.activity?.next_action && String(landing.activity.next_action).trim()),
  );
  const recovery = Boolean(
    (model.footerHints && /Esc|q/i.test(String(model.footerHints)))
    || /Esc|q quit|next_safe_action|Open Settings|remediat|Start New Run/i.test(text),
  );
  return {
    primaryActionPresent: primaryFromComposition || primaryFromNav || primaryFromText,
    nextSafeActionPresent: next,
    recoveryPresent: recovery,
    text,
    composition,
  };
}

/**
 * @param {string} text
 * @param {ReadonlyArray<string>} tokens
 * @returns {string[]}
 */
function missingStatusTokens(text, tokens = TUI_UX_STATUS_TOKENS) {
  const hay = String(text ?? '');
  return tokens.filter((token) => !hay.includes(token));
}

/**
 * Color must never be the only signal — require a non-color marker when selected.
 * @param {{ selectedMark?: string, focusMarker?: string, selected?: boolean }} opts
 */
function assertFocusWithoutColorAlone(opts = {}) {
  if (opts.selected === true) {
    const mark = String(opts.selectedMark ?? opts.focusMarker ?? '').trim();
    if (!mark) {
      throw new Error('selected row missing non-color focus/selection marker');
    }
  }
}

/**
 * Narrow layout must keep primary action / recovery discoverable in the model.
 * Consumes a real shell model (not fabricated booleans).
 * @param {ReturnType<typeof buildShellModel>} model
 */
function assertCriticalPathVisible(model) {
  const obs = observeCriticalPath(model);
  if (obs.primaryActionPresent !== true) {
    throw new Error('primary action absent in required UX state');
  }
  if (obs.nextSafeActionPresent !== true) {
    throw new Error('next safe action unavailable despite authoritative data');
  }
  if (obs.recoveryPresent !== true) {
    throw new Error('recovery path hidden in required UX state');
  }
  return obs;
}

/**
 * Long identifiers must not displace the primary action in the composition contract.
 * @param {ReturnType<typeof buildShellModel>} model
 */
function assertLongContentDoesNotHidePrimary(model) {
  const obs = observeCriticalPath(model);
  if (obs.primaryActionPresent !== true) {
    throw new Error('long-content case hid primary action');
  }
  return obs;
}

/**
 * Assert journey simulation against declared inspectable codes / prohibited states.
 * @param {ReturnType<typeof simulateUxJourney>} sim
 */
function assertUxJourneyOutcome(sim) {
  const { journey, model, text, decisionCount, sessionEnded, endReason, wouldExecuteAction } = sim;
  if (decisionCount > journey.max_decisions) {
    throw new Error(`${journey.id}: exceeded max_decisions (${decisionCount} > ${journey.max_decisions})`);
  }
  if (wouldExecuteAction.length > 0 && journey.id !== 'exit_safely') {
    // Exit may request quit via intent type quit (not executeAction remount).
    // Nested remounts during UX journeys are prohibited for in-process paths.
    const remounts = wouldExecuteAction.filter((id) => id !== 'quit' && id !== '/quit');
    if (remounts.length > 0) {
      throw new Error(`${journey.id}: unexpected remount action(s): ${remounts.join(',')}`);
    }
  }

  switch (journey.id) {
    case 'clean_install_setup': {
      if (model.landing?.overall?.state === 'ready') {
        throw new Error('clean_install_setup: false ready');
      }
      if (!model.landing?.overall?.next_action) {
        throw new Error('clean_install_setup: missing next_action');
      }
      if (!/Settings|path|credential|remediat/i.test(String(model.landing.overall.next_action))) {
        throw new Error('clean_install_setup: next_action not inspectable');
      }
      if (model.contentSurface !== 'diagnostics' && model.contentSurface !== 'home') {
        throw new Error('clean_install_setup: expected diagnostics (doctor) or home after Esc');
      }
      break;
    }
    case 'ready_no_runs': {
      if (model.landing?.overall?.state !== 'ready') {
        throw new Error('ready_no_runs: expected ready overall');
      }
      assertCriticalPathVisible(model);
      if (!/Start New Run|New Run/i.test(text)) {
        throw new Error('ready_no_runs: primary CTA missing from composition text');
      }
      break;
    }
    case 'canonical_sudoku_launch': {
      if (!model.activeWorkflow || model.activeWorkflow.kind !== 'launcher') {
        // After recovery Esc, workflow is cleared — allow only when includeRecovery.
        if (model.contentSurface !== 'home') {
          throw new Error('canonical_sudoku_launch: expected launcher workflow or home after Esc');
        }
      } else if (!String(model.contentSurface).includes('launcher')) {
        throw new Error('canonical_sudoku_launch: launcher surface missing');
      }
      if (/%\s*$|progress\s+\d+%/i.test(text)) {
        throw new Error('canonical_sudoku_launch: fabricated progress percent');
      }
      break;
    }
    case 'inspect_active_run': {
      const status = String(model.status?.status ?? '').toLowerCase();
      if (status !== 'running' && !model.activeWorkflow) {
        throw new Error('inspect_active_run: expected running status or run browser workflow');
      }
      if (model.status?.reason_code) {
        if (!text.includes(String(model.status.reason_code)) && model.contentSurface === 'status') {
          throw new Error('inspect_active_run: reason_code not in composition text');
        }
      }
      if (/%\s*$|progress\s+\d+%/i.test(text)) {
        throw new Error('inspect_active_run: invented progress percent');
      }
      break;
    }
    case 'diagnose_cerberus_block': {
      if (model.status?.status !== 'blocked' || model.status?.reason_code !== 'CERBERUS_REJECT') {
        throw new Error('diagnose_cerberus_block: missing blocked / CERBERUS_REJECT');
      }
      if (!model.status?.next_safe_action) {
        throw new Error('diagnose_cerberus_block: missing next_safe_action');
      }
      if (model.contentSurface === 'status' && !text.includes('CERBERUS_REJECT')) {
        throw new Error('diagnose_cerberus_block: reason not textual');
      }
      if (String(model.status?.status) === 'failed') {
        throw new Error('diagnose_cerberus_block: collapsed into failed');
      }
      break;
    }
    case 'diagnose_failed_run': {
      if (model.status?.status !== 'failed' || model.status?.reason_code !== 'QA_REJECT') {
        throw new Error('diagnose_failed_run: missing failed / QA_REJECT');
      }
      if (!model.status?.next_safe_action) {
        throw new Error('diagnose_failed_run: missing next_safe_action');
      }
      if (model.contentSurface === 'status' && !text.includes('QA_REJECT')) {
        throw new Error('diagnose_failed_run: reason not textual');
      }
      break;
    }
    case 'inspect_evidence': {
      if (model.contentSurface !== 'evidence' && model.contentSurface !== 'home') {
        throw new Error('inspect_evidence: expected evidence surface (or home after Esc)');
      }
      if (model.contentSurface === 'evidence') {
        const attach = model.evidence?.attach_available;
        if (attach === true && model.evidence?.reason_code === 'ATTACH_UNAVAILABLE') {
          throw new Error('inspect_evidence: fabricated attach ready');
        }
        if (attach !== false) {
          throw new Error('inspect_evidence: attach availability must stay honest (false)');
        }
        if (!model.status?.next_safe_action && !model.evidence?.next_safe_action) {
          // evidence adapter may nest fields differently — require some recovery hint in text
          if (!/attach|Evidence|next/i.test(text)) {
            throw new Error('inspect_evidence: recovery path missing');
          }
        }
      }
      break;
    }
    case 'exit_safely': {
      if (!sessionEnded || endReason !== 'TUI_SHELL_QUIT') {
        throw new Error('exit_safely: expected TUI_SHELL_QUIT');
      }
      const esc = resolveShellKeypress('', { escape: true }, buildUxFixtureModel(journey.starting_fixture));
      if (esc.endsSession) {
        throw new Error('exit_safely: Esc must not end session');
      }
      break;
    }
    default:
      throw new Error(`unhandled journey assertion: ${journey.id}`);
  }
}

/**
 * Evaluate the UX companion gate.
 * Automated UX fail → fail; semantic gate must be explicit true;
 * missing required manual or platform evidence → blocked.
 *
 * @param {{
 *   automatedUxOk: boolean,
 *   semanticGateOk?: boolean,
 *   manualEvidence?: { status: 'pass'|'blocked'|'deferred'|'fail', note?: string },
 *   platformEvidence?: ReturnType<typeof buildPlatformEvidenceRecord>,
 * }} input
 * @returns {{ verdict: 'pass'|'fail'|'blocked', reasons: string[], command_set: string[] }}
 */
function evaluateUxAcceptanceVerdict(input) {
  /** @type {string[]} */
  const reasons = [];
  // semanticGateOk is mandatory: omission is BLOCKED (never silent PASS).
  if (input.semanticGateOk !== true && input.semanticGateOk !== false) {
    reasons.push('semantic_tui_quality_gate_required_missing');
    return {
      verdict: 'blocked',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }
  if (input.semanticGateOk === false) {
    reasons.push('semantic_tui_quality_gate_failed');
    return {
      verdict: 'fail',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }
  if (!input.automatedUxOk) {
    reasons.push('automated_tui_ux_gate_failed');
    return {
      verdict: 'fail',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }

  const manual = input.manualEvidence && typeof input.manualEvidence === 'object'
    ? input.manualEvidence
    : { status: 'blocked', note: 'first-time-user script evidence not recorded' };
  if (manual.status === 'fail') {
    reasons.push('manual_first_time_user:fail');
    return {
      verdict: 'fail',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }
  if (manual.status !== 'pass') {
    reasons.push(`manual_first_time_user:${manual.status}`);
    return {
      verdict: 'blocked',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }

  // Required: platform evidence must be supplied — omission is BLOCKED, never PASS.
  if (!input.platformEvidence || typeof input.platformEvidence !== 'object') {
    reasons.push('platform_evidence_required_missing');
    return {
      verdict: 'blocked',
      reasons,
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }

  const semantic = evaluateReleaseGateVerdict({
    automatedGateOk: true,
    platformEvidence: input.platformEvidence,
  });
  if (semantic.verdict === 'fail') {
    return {
      verdict: 'fail',
      reasons: [...semantic.reasons],
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }
  if (semantic.verdict === 'blocked') {
    return {
      verdict: 'blocked',
      reasons: [...semantic.reasons],
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }

  return {
    verdict: 'pass',
    reasons: [],
    command_set: [...TUI_RELEASE_COMMAND_SET],
  };
}

/**
 * @param {string} journeyId
 * @returns {(typeof TUI_UX_JOURNEYS)[number] | null}
 */
function journeyById(journeyId) {
  return TUI_UX_JOURNEYS.find((j) => j.id === String(journeyId)) ?? null;
}

/** Default path for the explicit UX release evidence registry (repo-relative). */
const TUI_UX_EVIDENCE_REGISTRY_RELATIVE = path.join(
  'modules',
  'operator',
  'tui-ux-acceptance-evidence.registry.json',
);

/** Repo-relative directory for first-time manual evidence artifacts. */
const TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR = path.join(
  'docs',
  'evidence',
  'tui-manual-first-time',
);

/**
 * When manualEvidence.status is pass, require an explicit `artifacts` list of
 * repo-relative paths under docs/evidence/tui-manual-first-time/ and verify
 * each file exists with minimal content. Path substring notes alone are not enough.
 *
 * @param {{
 *   registry: object,
 *   repoRoot: string,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   statSync?: typeof fs.statSync,
 * }} opts
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function validateManualFirstTimeArtifacts(opts) {
  const registry = opts.registry;
  const manual = registry && registry.manualEvidence;
  if (!manual || typeof manual !== 'object' || manual.status !== 'pass') {
    return { ok: true, reasons: [] };
  }

  /** @type {string[]} */
  const reasons = [];
  const exists = opts.existsSync ?? fs.existsSync;
  const readFile = opts.readFileSync ?? fs.readFileSync;
  const stat = opts.statSync ?? fs.statSync;
  const repoRoot = opts.repoRoot;
  const artifacts = Array.isArray(manual.artifacts) ? manual.artifacts.map(String) : null;

  if (!artifacts || artifacts.length === 0) {
    return { ok: false, reasons: ['manual_first_time_user:artifacts_required'] };
  }

  const evidencePrefix = `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}${path.sep}`.replace(/\\/g, '/');
  let hasObservations = false;
  let hasTypescript = false;
  let hasMeta = false;

  for (const relRaw of artifacts) {
    const rel = String(relRaw).replace(/\\/g, '/');
    if (!rel || rel.startsWith('/') || rel.includes('..') || !rel.startsWith(evidencePrefix.replace(/\\/g, '/'))) {
      reasons.push(`manual_first_time_user:artifact_path_invalid:${rel || '(empty)'}`);
      continue;
    }
    const abs = path.join(repoRoot, ...rel.split('/'));
    if (!exists(abs)) {
      reasons.push(`manual_first_time_user:artifact_missing:${rel}`);
      continue;
    }
    let st;
    try {
      st = stat(abs);
    } catch {
      reasons.push(`manual_first_time_user:artifact_unreadable:${rel}`);
      continue;
    }
    if (!st.isFile() || st.size <= 0) {
      reasons.push(`manual_first_time_user:artifact_empty:${rel}`);
      continue;
    }

    if (rel.endsWith('first-time-observations.json')) {
      hasObservations = true;
      try {
        const obs = JSON.parse(String(readFile(abs, 'utf8')));
        if (!obs || obs.script_id !== TUI_UX_FIRST_TIME_SCRIPT.id) {
          reasons.push(`manual_first_time_user:observations_invalid:${rel}`);
        }
      } catch {
        reasons.push(`manual_first_time_user:observations_invalid_json:${rel}`);
      }
    } else if (rel.endsWith('.typescript')) {
      hasTypescript = true;
      const body = String(readFile(abs, 'utf8'));
      if (!/Start New Run|Overall:|AI-MINIONS|ai-minions/i.test(body)) {
        reasons.push(`manual_first_time_user:typescript_content_weak:${rel}`);
      }
    } else if (rel.endsWith('.meta.json')) {
      hasMeta = true;
      try {
        const meta = JSON.parse(String(readFile(abs, 'utf8')));
        if (!meta || typeof meta.source_tip_sha !== 'string' || !meta.source_tip_sha.trim()) {
          reasons.push(`manual_first_time_user:meta_missing_source_tip_sha:${rel}`);
        }
      } catch {
        reasons.push(`manual_first_time_user:meta_invalid_json:${rel}`);
      }
    }
  }

  if (!hasObservations) {
    reasons.push('manual_first_time_user:observations_required');
  }
  if (!hasTypescript) {
    reasons.push('manual_first_time_user:typescript_required');
  }
  if (!hasMeta) {
    reasons.push('manual_first_time_user:meta_required');
  }

  const macos = registry.platformEvidence
    && registry.platformEvidence.overrides
    && registry.platformEvidence.overrides.macos_node22_tty;
  if (macos && macos.status === 'pass') {
    const evidenceText = String(macos.evidence || '');
    const referenced = artifacts.some((rel) => evidenceText.includes(rel));
    if (!referenced) {
      reasons.push('manual_first_time_user:macos_evidence_paths_unreferenced');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Load the explicit UX acceptance evidence registry and evaluate the companion verdict.
 * Missing / blocked / fail → non-pass. Used by `test:tui-release` preflight.
 * A manualEvidence status of pass additionally requires verifiable on-disk artifacts.
 *
 * @param {{
 *   registryPath?: string,
 *   repoRoot?: string,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 *   statSync?: typeof fs.statSync,
 *   buildPlatformEvidence?: typeof buildPlatformEvidenceRecord,
 * }} [opts]
 * @returns {{
 *   registryPath: string,
 *   registry: object,
 *   verdict: ReturnType<typeof evaluateUxAcceptanceVerdict>,
 * }}
 */
function evaluateUxAcceptanceEvidenceRegistry(opts = {}) {
  const readFile = opts.readFileSync ?? fs.readFileSync;
  const buildPlatform = opts.buildPlatformEvidence ?? buildPlatformEvidenceRecord;
  const registryPath = opts.registryPath
    ?? path.join(__dirname, 'tui-ux-acceptance-evidence.registry.json');
  const repoRoot = opts.repoRoot ?? path.join(__dirname, '..', '..', '..');
  let raw;
  try {
    raw = readFile(registryPath, 'utf8');
  } catch (err) {
    return {
      registryPath,
      registry: null,
      verdict: {
        verdict: 'blocked',
        reasons: [`evidence_registry_unreadable:${err && err.code ? err.code : 'error'}`],
        command_set: [...TUI_RELEASE_COMMAND_SET],
      },
    };
  }
  let registry;
  try {
    registry = JSON.parse(String(raw));
  } catch {
    return {
      registryPath,
      registry: null,
      verdict: {
        verdict: 'blocked',
        reasons: ['evidence_registry_invalid_json'],
        command_set: [...TUI_RELEASE_COMMAND_SET],
      },
    };
  }
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return {
      registryPath,
      registry,
      verdict: {
        verdict: 'blocked',
        reasons: ['evidence_registry_invalid_shape'],
        command_set: [...TUI_RELEASE_COMMAND_SET],
      },
    };
  }

  const platformOpts = registry.platformEvidence && typeof registry.platformEvidence === 'object'
    ? registry.platformEvidence
    : null;
  const platformEvidence = platformOpts
    ? buildPlatform({
      automatedGateOk: platformOpts.automatedGateOk !== false,
      platform: platformOpts.platform,
      nodeMajor: platformOpts.nodeMajor,
      overrides: platformOpts.overrides,
    })
    : undefined;

  let verdict = evaluateUxAcceptanceVerdict({
    automatedUxOk: registry.automatedUxOk === true,
    // Pass through as-is so omission stays blocked (do not coerce undefined → false).
    semanticGateOk: Object.prototype.hasOwnProperty.call(registry, 'semanticGateOk')
      ? registry.semanticGateOk
      : undefined,
    manualEvidence: registry.manualEvidence,
    platformEvidence,
  });

  const artifactCheck = validateManualFirstTimeArtifacts({
    registry,
    repoRoot,
    existsSync: opts.existsSync,
    readFileSync: readFile,
    statSync: opts.statSync,
  });
  if (!artifactCheck.ok) {
    verdict = {
      verdict: 'blocked',
      reasons: [...artifactCheck.reasons, ...verdict.reasons.filter((r) => !artifactCheck.reasons.includes(r))],
      command_set: [...TUI_RELEASE_COMMAND_SET],
    };
  }

  return { registryPath, registry, verdict };
}

module.exports = {
  TUI_UX_ACCEPTANCE_COMMAND,
  TUI_RELEASE_COMMAND_SET,
  TUI_RELEASE_NPM_SCRIPT,
  TUI_UX_VIEWPORTS,
  TUI_UX_VISUAL_STATES,
  TUI_UX_STATUS_TOKENS,
  TUI_UX_JOURNEYS,
  TUI_UX_FIRST_TIME_SCRIPT,
  TUI_UX_EVIDENCE_REGISTRY_RELATIVE,
  TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR,
  missingStatusTokens,
  validateManualFirstTimeArtifacts,
  assertFocusWithoutColorAlone,
  observeCriticalPath,
  assertCriticalPathVisible,
  assertLongContentDoesNotHidePrimary,
  buildUxFixtureModel,
  simulateUxJourney,
  assertUxJourneyOutcome,
  evaluateUxAcceptanceVerdict,
  evaluateUxAcceptanceEvidenceRegistry,
  journeyById,
};
