'use strict';

/**
 * Shared helpers for Operator TUI quality-gate tests (MVP + integrated fullscreen).
 * Prefer render/state model assertions over fullscreen terminal pixels.
 * Not a product pane — harness only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ANSI_CSI = '\x1b[';

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsAnsi(text) {
  return String(text ?? '').includes(ANSI_CSI);
}

/**
 * Assert human text may use ANSI only when useColor is true.
 * @param {string} text
 * @param {{ useColor?: boolean }} [opts]
 */
function assertAnsiPolicy(text, opts = {}) {
  const useColor = opts.useColor === true;
  if (useColor) {
    if (!containsAnsi(text)) {
      throw new Error('expected ANSI escapes when useColor=true');
    }
    return;
  }
  if (containsAnsi(text)) {
    throw new Error('ANSI escapes forbidden when useColor=false / shareable path');
  }
}

/**
 * Shareable surfaces (JSON stringify, Markdown, copy blocks) must never carry ANSI.
 * @param {unknown} value
 */
function assertNoAnsiInShareable(value) {
  const blob = typeof value === 'string' ? value : JSON.stringify(value);
  if (containsAnsi(blob)) {
    throw new Error('ANSI escapes forbidden in JSON/Markdown/shareable outputs');
  }
}

/**
 * Credential / secret honesty: status labels only; never echo known secret substrings.
 * @param {string} text
 * @param {string[]} [forbiddenSubstrings]
 */
function assertNoSecretSurfaces(text, forbiddenSubstrings = []) {
  const hay = String(text ?? '');
  for (const needle of forbiddenSubstrings) {
    if (needle && hay.includes(needle)) {
      throw new Error(`secret-like substring leaked into TUI surface: ${needle.slice(0, 8)}…`);
    }
  }
  if (/sk-ant-|sk-proj-|sk-[a-zA-Z0-9]{16,}/.test(hay)) {
    throw new Error('provider-token-shaped substring leaked into TUI surface');
  }
}

/**
 * Claim honesty for cockpit / shell surfaces — must not invent Web UI or over-claim TUI completion.
 * @param {string} text
 */
function assertMvpClaimHonesty(text) {
  const hay = String(text ?? '').toLowerCase();
  if (!/not claimed|not fullscreen|legacy readline|operator modules remain authoritative/.test(hay)) {
    throw new Error('TUI surface missing claim-honesty disclaimer');
  }
  if (/\bfullscreen product\b|\bproduction tui shipped\b|\bweb ui shipped\b/.test(hay)) {
    throw new Error('TUI surface invents fullscreen-product / production-TUI / Web-UI claim');
  }
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {object[]} rows
 */
function writeTraceFixture(dir, name, rows) {
  fs.writeFileSync(
    path.join(dir, `${name}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

/**
 * Temp traces dir for quality-gate scenarios (cleaned by caller via fs.rmSync).
 * @returns {string}
 */
function makeTempTracesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-minions-tui-qg-'));
}

/**
 * Scenario builders — state snapshots for the TUI MVP quality matrix.
 * @param {string} tracesDir
 */
function seedQualityGateScenarios(tracesDir) {
  writeTraceFixture(tracesDir, 'ok-run', [
    { event: 'session_start', task_id: 'ok-run', flow_mode: 'single_agent', ts_ms: 1 },
    { event: 'session_end', task_id: 'ok-run', done: true, gate_blocks: 0, ts_ms: 2 },
  ]);
  writeTraceFixture(tracesDir, 'fail-run', [
    { event: 'session_start', task_id: 'fail-run', flow_mode: 'single_agent', ts_ms: 10 },
    {
      event: 'session_end',
      task_id: 'fail-run',
      done: false,
      iterations: 2,
      gate_blocks: 0,
      ts_ms: 11,
    },
  ]);
  writeTraceFixture(tracesDir, 'blocked-run', [
    { event: 'session_start', task_id: 'blocked-run', flow_mode: 'single_agent', ts_ms: 20 },
    {
      event: 'gate_block',
      gate: 'CERBERUS',
      reason_code: 'CERBERUS_REJECT',
      task_id: 'blocked-run',
      ts_ms: 21,
    },
    {
      event: 'session_end',
      task_id: 'blocked-run',
      done: false,
      gate_blocks: 1,
      iterations: 1,
      ts_ms: 22,
    },
  ]);
  fs.writeFileSync(path.join(tracesDir, 'bad-run.jsonl'), '\n', 'utf8');
}

/**
 * Quality-gate inventory — MVP acceptance scenarios (v0.25 foundation).
 * Neutral identifiers only (no backlog ticket tokens in shipped source).
 */
const TUI_QUALITY_SCENARIOS = Object.freeze([
  'empty_run_store',
  'invalid_trace',
  'successful_run',
  'failed_or_blocked_run',
  'attach_bundle_present_or_missing',
  'missing_credentials',
  'local_only_tokens_not_required',
  'non_tty_fallback',
  'unknown_action_command',
  'no_ansi_in_shareables',
  'no_color_human_stdout_policy',
  'no_secret_surfaces',
  'mvp_claim_honesty',
  'no_shell_rc_mutation',
]);

/**
 * Integrated fullscreen quality inventory — release-blocking product surface.
 * Owning automated coverage is exercised by `npm run test:tui-quality`.
 */
const TUI_QUALITY_INTEGRATED_SCENARIOS = Object.freeze([
  'fullscreen_boot_clean_exit',
  'home_readiness_pane',
  'run_selector_status_pane',
  'evidence_attach_pane',
  'config_pane',
  'guided_launcher',
  'live_monitor',
  'slash_commands',
  'lifecycle_view_models',
  'canonical_fixture_acceptance_hooks',
  'narrow_resize_transitions',
  'non_tty_fallback',
  'no_color_policy',
  'operator_action_failure_restore',
  'child_process_failure_restore',
  'renderer_exception_restore',
  'ctrl_c_restore',
  'run_state_active',
  'run_state_successful',
  'run_state_failed',
  'run_state_blocked',
  'run_state_exhausted',
  'run_state_cancelled',
  'run_state_repeated_blocker',
  'run_state_unavailable_budget',
  'run_state_zero_cost',
  'operator_modules_authoritative',
  'stable_reason_codes',
  'provenance_distinctness',
  'no_prose_progress_inference',
  'no_fabricated_budget_cost',
  'detach_does_not_mutate_run',
  'terminal_cleanup',
  'live_fixture_evidence_separate',
]);

/** Documented release command for the integrated TUI quality gate. */
const TUI_QUALITY_RELEASE_COMMAND = 'cd orchestrator && npm run test:tui-quality';

/**
 * Live canonical-fixture evidence is opt-in and must not be replaced by mocks.
 * Automated CI uses readiness / adapter fixtures only.
 */
const LIVE_FIXTURE_EVIDENCE = Object.freeze({
  id: 'live_canonical_fixture',
  status: 'deferred',
  replaced_by_mocks: false,
  command_hint: 'node scripts/run-tester-six-mode-matrix.mjs --execute-live --fixture sudoku-html-app',
  note: 'Live Sudoku / canonical fixture PASS requires opt-in execute-live with real backend; MATRIX_READY is not PASS.',
});

/** @typedef {'pass'|'blocked'|'deferred'|'unsupported'|'fail'} PlatformEvidenceStatus */

/**
 * Platform evidence slots for release-prep honesty.
 * Missing required evidence is blocked/deferred — never silently pass.
 */
const TUI_QUALITY_PLATFORM_SLOTS = Object.freeze({
  linux_node22: Object.freeze({
    id: 'linux_node22',
    required_for_release: true,
    default_status: /** @type {PlatformEvidenceStatus} */ ('blocked'),
    evidence: 'CI unit matrix + test:tui-quality on ubuntu Node 22',
  }),
  linux_node24: Object.freeze({
    id: 'linux_node24',
    required_for_release: true,
    default_status: /** @type {PlatformEvidenceStatus} */ ('blocked'),
    evidence: 'CI unit matrix + test:tui-quality on ubuntu Node 24',
  }),
  macos_node22_tty: Object.freeze({
    id: 'macos_node22_tty',
    required_for_release: true,
    default_status: /** @type {PlatformEvidenceStatus} */ ('blocked'),
    evidence: 'macOS Node 22 interactive TTY smoke required before release-prep',
  }),
  windows_interactive: Object.freeze({
    id: 'windows_interactive',
    required_for_release: false,
    default_status: /** @type {PlatformEvidenceStatus} */ ('deferred'),
    evidence: 'Windows interactive TUI explicitly deferred / unsupported until dedicated evidence',
  }),
  live_canonical_fixture: Object.freeze({
    id: 'live_canonical_fixture',
    required_for_release: false,
    default_status: /** @type {PlatformEvidenceStatus} */ ('deferred'),
    evidence: LIVE_FIXTURE_EVIDENCE.note,
  }),
});

/**
 * Deterministic lifecycle fixtures for integrated gate (state models, not prose).
 * @returns {Record<string, object>}
 */
function buildLifecycleStateFixtures() {
  return {
    active: {
      current_iteration: 2,
      max_iterations: 5,
      current_phase: 'DEV',
      status_label: 'running',
      outcome: null,
      latest_verdict: null,
      measured_cost: 0,
      configured_budget: 'unlimited',
      terminal_stop_reason: null,
    },
    successful: {
      current_iteration: 3,
      max_iterations: 5,
      current_phase: 'CERBERUS',
      status_label: 'complete',
      outcome: 'success',
      latest_verdict: 'pass',
      measured_cost: 0.12,
      configured_budget: 'unlimited',
      terminal_stop_reason: null,
      has_session_end: true,
      attach_ready: true,
    },
    failed: {
      current_iteration: 2,
      max_iterations: 5,
      current_phase: 'QA',
      status_label: 'failed',
      outcome: 'failed',
      failure_type: 'gate',
      latest_blocker: 'QA_REJECT',
      measured_cost: 0.05,
      configured_budget: 'unlimited',
      terminal_stop_reason: null,
      has_session_end: true,
    },
    blocked: {
      current_iteration: 1,
      max_iterations: 3,
      current_phase: 'CERBERUS',
      status_label: 'blocked',
      blocking_reason_code: 'CERBERUS_REJECT',
      latest_blocker: 'CERBERUS_REJECT',
      human_action_required: true,
      measured_cost: 'unavailable',
      configured_budget: 'not_configured',
    },
    exhausted: {
      current_iteration: 3,
      max_iterations: 3,
      current_phase: 'DEV',
      status_label: 'exhausted',
      terminal_stop_reason: 'max_iterations',
      latest_blocker: 'MAX_ITERATIONS_LOOP_EXHAUSTED',
      measured_cost: 0.4,
      configured_budget: 'unlimited',
      has_session_end: true,
    },
    cancelled: {
      current_iteration: 1,
      max_iterations: 5,
      current_phase: 'DEV',
      status_label: 'cancelled',
      outcome: 'cancelled',
      terminal_stop_reason: 'cancelled',
      latest_blocker: 'RUN_CANCELLED',
      measured_cost: 0,
      configured_budget: 'unlimited',
      has_session_end: true,
    },
    repeated_blocker: {
      current_iteration: 3,
      max_iterations: 5,
      current_phase: 'CERBERUS',
      status_label: 'blocked',
      latest_blocker: 'CERBERUS_BLOCKERS_ITERATE',
      blocking_reason_code: 'CERBERUS_BLOCKERS_ITERATE',
      blocker_history: [
        { reason_code: 'CERBERUS_BLOCKERS_ITERATE', iteration: 1 },
        { reason_code: 'CERBERUS_BLOCKERS_ITERATE', iteration: 2 },
        { reason_code: 'CERBERUS_BLOCKERS_ITERATE', iteration: 3 },
      ],
      measured_cost: 0.2,
      configured_budget: 'unlimited',
      human_action_required: true,
    },
    unavailable_budget: {
      current_iteration: 1,
      max_iterations: 4,
      current_phase: 'DEV',
      status_label: 'running',
      cost_token_run_summary: {
        run: { estimated_cost_usd: null, cost_status: 'unavailable' },
      },
      configured_budget: 'unavailable',
    },
    zero_cost: {
      current_iteration: 2,
      max_iterations: 4,
      current_phase: 'DEV',
      status_label: 'running',
      cost_token_run_summary: {
        run: { estimated_cost_usd: 0, cost_status: 'known' },
      },
      configured_budget: 'unlimited',
    },
  };
}

/**
 * Provenance tokens that must remain pairwise-distinct under formatting.
 */
const PROVENANCE_DISTINCT_TOKENS = Object.freeze([
  0,
  'unknown',
  'unavailable',
  'not_configured',
  'unlimited',
]);

/**
 * @param {{ value: unknown, availability: string }} field
 * @param {string} label
 */
function assertNoFabricatedZero(field, label) {
  if (!field || typeof field !== 'object') {
    throw new Error(`${label}: missing provenance field`);
  }
  if (field.availability === 'unavailable' || field.availability === 'absent'
    || field.availability === 'not_configured' || field.availability === 'unknown') {
    if (field.value === 0) {
      throw new Error(`${label}: fabricated zero for ${field.availability}`);
    }
  }
}

/**
 * Progress % must stay absent — never inferred from iteration count or prose.
 * @param {{ progress_percent?: { availability?: string, value?: unknown } }} monitor
 */
function assertNoInferredProgress(monitor) {
  const progress = monitor && monitor.progress_percent;
  if (!progress || progress.availability !== 'absent') {
    throw new Error('progress_percent must remain absent (never invent %)');
  }
  if (progress.value != null) {
    throw new Error('progress_percent value must be null when absent');
  }
}

/**
 * Build platform evidence record for release-prep.
 * Local/CI automated runs may stamp Linux Node major as pass when the gate is green;
 * macOS / live remain blocked or deferred until real evidence exists.
 *
 * @param {{
 *   automatedGateOk?: boolean,
 *   nodeMajor?: number,
 *   platform?: string,
 *   overrides?: Record<string, { status: PlatformEvidenceStatus, evidence?: string }>,
 * }} [opts]
 */
function buildPlatformEvidenceRecord(opts = {}) {
  const automatedGateOk = opts.automatedGateOk !== false;
  const nodeMajor = Number.isFinite(opts.nodeMajor)
    ? opts.nodeMajor
    : Number.parseInt(String(process.versions.node).split('.')[0], 10);
  const platform = opts.platform ?? process.platform;
  /** @type {Record<string, { status: PlatformEvidenceStatus, evidence: string, required_for_release: boolean }>} */
  const slots = {};
  for (const [key, def] of Object.entries(TUI_QUALITY_PLATFORM_SLOTS)) {
    slots[key] = {
      status: def.default_status,
      evidence: def.evidence,
      required_for_release: def.required_for_release,
    };
  }

  if (automatedGateOk && platform === 'linux') {
    if (nodeMajor === 22) {
      slots.linux_node22 = {
        status: 'pass',
        evidence: `local/CI automated gate green on linux Node ${process.versions.node}`,
        required_for_release: true,
      };
    }
    if (nodeMajor === 24) {
      slots.linux_node24 = {
        status: 'pass',
        evidence: `local/CI automated gate green on linux Node ${process.versions.node}`,
        required_for_release: true,
      };
    }
  }

  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!slots[key] || !value || typeof value !== 'object') continue;
    slots[key] = {
      ...slots[key],
      status: value.status,
      evidence: value.evidence != null ? String(value.evidence) : slots[key].evidence,
    };
  }

  return {
    schema: '1',
    kind: 'tui_quality_platform_evidence',
    automated_gate_command: TUI_QUALITY_RELEASE_COMMAND,
    live_fixture: { ...LIVE_FIXTURE_EVIDENCE },
    slots,
  };
}

/**
 * Release-prep verdict: automated fail → fail; missing required evidence → blocked;
 * deferred/unsupported allowed only when not required. Never PASS missing evidence.
 *
 * @param {{
 *   automatedGateOk: boolean,
 *   platformEvidence?: ReturnType<typeof buildPlatformEvidenceRecord>,
 * }} input
 * @returns {{ verdict: 'pass'|'fail'|'blocked', reasons: string[], platformEvidence: object }}
 */
function evaluateReleaseGateVerdict(input) {
  const platformEvidence = input.platformEvidence ?? buildPlatformEvidenceRecord({
    automatedGateOk: input.automatedGateOk,
  });
  /** @type {string[]} */
  const reasons = [];

  if (!input.automatedGateOk) {
    reasons.push('automated_tui_quality_gate_failed');
    return { verdict: 'fail', reasons, platformEvidence };
  }

  for (const [key, slot] of Object.entries(platformEvidence.slots)) {
    if (slot.status === 'fail') {
      reasons.push(`${key}:fail`);
    } else if (slot.status === 'pass') {
      // ok
    } else if (slot.required_for_release) {
      if (slot.status === 'blocked' || slot.status === 'deferred' || slot.status === 'unsupported') {
        reasons.push(`${key}:${slot.status}`);
      } else {
        reasons.push(`${key}:unknown_status`);
      }
    }
    // Non-required deferred/unsupported never become pass by omission.
    if (!slot.required_for_release && slot.status === 'pass' && key === 'live_canonical_fixture') {
      // Live pass is allowed only with explicit override evidence — keep as-is.
    }
  }

  if (reasons.length > 0) {
    return { verdict: 'blocked', reasons, platformEvidence };
  }
  return { verdict: 'pass', reasons, platformEvidence };
}

/**
 * Assert a platform evidence status uses the honest vocabulary.
 * @param {PlatformEvidenceStatus} status
 * @param {string} slotId
 */
function assertHonestPlatformStatus(status, slotId) {
  const allowed = new Set(['pass', 'blocked', 'deferred', 'unsupported', 'fail']);
  if (!allowed.has(status)) {
    throw new Error(`${slotId}: invalid platform status ${status}`);
  }
}

module.exports = {
  ANSI_CSI,
  TUI_QUALITY_SCENARIOS,
  TUI_QUALITY_INTEGRATED_SCENARIOS,
  TUI_QUALITY_RELEASE_COMMAND,
  TUI_QUALITY_PLATFORM_SLOTS,
  LIVE_FIXTURE_EVIDENCE,
  PROVENANCE_DISTINCT_TOKENS,
  containsAnsi,
  assertAnsiPolicy,
  assertNoAnsiInShareable,
  assertNoSecretSurfaces,
  assertMvpClaimHonesty,
  assertNoFabricatedZero,
  assertNoInferredProgress,
  assertHonestPlatformStatus,
  writeTraceFixture,
  makeTempTracesDir,
  seedQualityGateScenarios,
  buildLifecycleStateFixtures,
  buildPlatformEvidenceRecord,
  evaluateReleaseGateVerdict,
};
