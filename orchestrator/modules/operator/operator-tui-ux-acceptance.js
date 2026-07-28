'use strict';

/**
 * TUI UX acceptance layer — journeys, visual-state inventory, a11y hierarchy,
 * and release companion verdict. State/view-model assertions remain mandatory;
 * render strings are supporting evidence only. Harness — not a product pane.
 */

const {
  TUI_QUALITY_RELEASE_COMMAND,
  evaluateReleaseGateVerdict,
  buildPlatformEvidenceRecord,
} = require('./operator-tui-quality-harness');

/** Documented companion command for the UX acceptance gate. */
const TUI_UX_ACCEPTANCE_COMMAND = 'cd orchestrator && npm run test:tui-ux';

/** Combined release command set (semantic + UX). */
const TUI_RELEASE_COMMAND_SET = Object.freeze([
  TUI_QUALITY_RELEASE_COMMAND,
  TUI_UX_ACCEPTANCE_COMMAND,
]);

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
 * Deterministic operator journeys for UX acceptance.
 * Step budgets are product contracts for the canonical path — not universal claims.
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
  }),
  Object.freeze({
    id: 'diagnose_cerberus_block',
    goal: 'Diagnose a CERBERUS-blocked run and find human action',
    starting_fixture: 'run_blocked_cerberus',
    primary_action: 'Overview / Explain next safe action',
    navigation_path: Object.freeze(['runs', 'overview', 'explain']),
    max_decisions: 4,
    expected_result: 'BLOCKED / ACTION REQUIRED remain textually distinct from FAILED',
    recovery_path: 'Follow next_safe_action; do not treat as execution failure',
    inspectable_reason_codes: Object.freeze(['blocking_reason_code', 'human_action_required']),
    prohibited: Object.freeze(['color-only block vs fail', 'collapse block into failed']),
  }),
  Object.freeze({
    id: 'diagnose_failed_run',
    goal: 'Diagnose an execution failure and next safe action',
    starting_fixture: 'run_failed',
    primary_action: 'Overview / Explain',
    navigation_path: Object.freeze(['runs', 'overview', 'explain']),
    max_decisions: 4,
    expected_result: 'FAILED is distinct; next_safe_action inspectable',
    recovery_path: 'Remediate via stated next_safe_action',
    inspectable_reason_codes: Object.freeze(['outcome', 'reason_code', 'next_safe_action']),
    prohibited: Object.freeze(['success implied', 'missing recovery path']),
  }),
  Object.freeze({
    id: 'inspect_evidence',
    goal: 'Locate evidence / attach availability after completion',
    starting_fixture: 'run_completed_evidence',
    primary_action: 'Evidence pane',
    navigation_path: Object.freeze(['runs', 'overview', 'evidence']),
    max_decisions: 4,
    expected_result: 'attach_* availability honest; absent not coerced to ready',
    recovery_path: 'If attach unavailable, follow next_safe_action',
    inspectable_reason_codes: Object.freeze(['attach_available', 'reason_code']),
    prohibited: Object.freeze(['fabricated attach ready', 'missing evidence recorded as PASS']),
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
 * @param {{
 *   primaryActionPresent: boolean,
 *   nextSafeActionPresent?: boolean,
 *   recoveryPresent?: boolean,
 * }} model
 */
function assertCriticalPathVisible(model) {
  if (!model || model.primaryActionPresent !== true) {
    throw new Error('primary action absent in required UX state');
  }
  if (model.nextSafeActionPresent === false) {
    throw new Error('next safe action unavailable despite authoritative data');
  }
  if (model.recoveryPresent === false) {
    throw new Error('recovery path hidden in required UX state');
  }
}

/**
 * Long identifiers must not displace the primary action in the composition contract.
 * @param {{
 *   primaryActionPresent: boolean,
 *   truncatedFields?: string[],
 * }} model
 */
function assertLongContentDoesNotHidePrimary(model) {
  if (!model || model.primaryActionPresent !== true) {
    throw new Error('long-content case hid primary action');
  }
}

/**
 * Evaluate the UX companion gate.
 * Automated UX fail → fail; missing required manual evidence → blocked.
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

  // Reuse semantic platform slots when provided — never invent macOS/live PASS.
  if (input.platformEvidence) {
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

module.exports = {
  TUI_UX_ACCEPTANCE_COMMAND,
  TUI_RELEASE_COMMAND_SET,
  TUI_UX_VIEWPORTS,
  TUI_UX_VISUAL_STATES,
  TUI_UX_STATUS_TOKENS,
  TUI_UX_JOURNEYS,
  TUI_UX_FIRST_TIME_SCRIPT,
  missingStatusTokens,
  assertFocusWithoutColorAlone,
  assertCriticalPathVisible,
  assertLongContentDoesNotHidePrimary,
  evaluateUxAcceptanceVerdict,
  journeyById,
};
