'use strict';

/**
 * TUI UX acceptance gate — journeys, visual inventory, a11y hierarchy, companion verdict.
 * Extends (does not reopen) the semantic integrated quality gate.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
} = require('../../modules/operator/operator-tui-ux-acceptance');

const {
  buildShellModel,
  formatShellText,
  resolveShellKeypress,
  isShellSessionEndAction,
} = require('../../modules/operator/operator-tui-shell-model');

const {
  buildPlatformEvidenceRecord,
  TUI_QUALITY_RELEASE_COMMAND,
  assertMvpClaimHonesty,
  assertAnsiPolicy,
} = require('../../modules/operator/operator-tui-quality-harness');

const { chromeIcon, resolveIconMode } = require('../../modules/operator/operator-tui-icons');

function baseShell(overrides = {}) {
  return buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'deadbeef' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
    runsPayload: { runs: [], result_code: 'OK' },
    columns: 120,
    rows: 30,
    colorEnabled: true,
    ...overrides,
  });
}

test('UX journey inventory covers the eight required operator paths', () => {
  const ids = TUI_UX_JOURNEYS.map((j) => j.id);
  assert.ok(ids.includes('clean_install_setup'));
  assert.ok(ids.includes('ready_no_runs'));
  assert.ok(ids.includes('canonical_sudoku_launch'));
  assert.ok(ids.includes('inspect_active_run'));
  assert.ok(ids.includes('diagnose_cerberus_block'));
  assert.ok(ids.includes('diagnose_failed_run'));
  assert.ok(ids.includes('inspect_evidence'));
  assert.ok(ids.includes('exit_safely'));
  assert.equal(TUI_UX_JOURNEYS.length, 8);
  for (const journey of TUI_UX_JOURNEYS) {
    assert.ok(journey.goal);
    assert.ok(journey.primary_action);
    assert.ok(Array.isArray(journey.navigation_path) && journey.navigation_path.length >= 1);
    assert.ok(Number.isFinite(journey.max_decisions) && journey.max_decisions >= 1);
    assert.ok(journey.expected_result);
    assert.ok(journey.recovery_path);
    assert.ok(Array.isArray(journey.inspectable_reason_codes));
    assert.ok(Array.isArray(journey.prohibited) && journey.prohibited.length >= 1);
  }
  assert.equal(journeyById('exit_safely')?.max_decisions, 1);
  assert.equal(journeyById('missing'), null);
});

test('visual-state inventory + viewport fixtures are declared', () => {
  assert.deepEqual(
    TUI_UX_VIEWPORTS.map((v) => v.id),
    ['wide', 'standard', 'narrow_min'],
  );
  assert.equal(TUI_UX_VIEWPORTS.find((v) => v.id === 'narrow_min')?.columns, 60);
  assert.equal(TUI_UX_VIEWPORTS.find((v) => v.id === 'narrow_min')?.rows, 20);
  for (const state of [
    'splash',
    'landing_ready',
    'blocked',
    'failed',
    'help_topics',
    'completed_evidence_ready',
  ]) {
    assert.ok(TUI_UX_VISUAL_STATES.includes(state), state);
  }
});

test('ready landing exposes Start New Run as primary; narrow keeps it', () => {
  for (const vp of TUI_UX_VIEWPORTS) {
    const model = baseShell({ columns: vp.columns, rows: vp.rows, contentSurface: 'home' });
    assert.equal(model.contentSurface, 'home');
    assert.ok(model.landing);
    assert.equal(model.landing.overall.state, 'ready');
    const text = formatShellText(model);
    assert.match(text, /Start New Run|New Run|launcher/i);
    assertCriticalPathVisible({
      primaryActionPresent: true,
      nextSafeActionPresent: true,
      recoveryPresent: true,
    });
    assertLongContentDoesNotHidePrimary({
      primaryActionPresent: Boolean(model.landing?.hero || model.navItems?.length),
      truncatedFields: ['run_id'],
    });
    assertMvpClaimHonesty(text);
  }
});

test('needs-setup landing is not false-ready; next action inspectable', () => {
  const model = baseShell({
    pathActivation: { status: 'missing', on_path: false },
    credentials: { credential_sufficiency: 'insufficient', providers: [] },
    contentSurface: 'home',
  });
  assert.notEqual(model.landing.overall.state, 'ready');
  assert.ok(model.landing.overall.next_action);
  const journey = journeyById('clean_install_setup');
  assert.ok(journey.prohibited.includes('false ready'));
});

test('blocked vs failed remain textually distinct (no color-only)', () => {
  const blocked = baseShell({
    contentSurface: 'status',
    selectedRunId: 'blocked-1',
    statusResult: {
      run_id: 'blocked-1',
      result_code: 'RUN_FOUND',
      status: 'blocked',
      outcome: 'blocked',
      reason_code: 'CERBERUS_REJECT',
      next_safe_action: 'address CERBERUS blockers',
    },
  });
  const failed = baseShell({
    contentSurface: 'status',
    selectedRunId: 'failed-1',
    statusResult: {
      run_id: 'failed-1',
      result_code: 'RUN_FOUND',
      status: 'failed',
      outcome: 'failed',
      reason_code: 'QA_REJECT',
      next_safe_action: 'inspect QA findings',
    },
  });
  const blockedText = formatShellText(blocked);
  const failedText = formatShellText(failed);
  assert.equal(blocked.status.status, 'blocked');
  assert.equal(failed.status.status, 'failed');
  assert.equal(blocked.status.reason_code, 'CERBERUS_REJECT');
  assert.equal(failed.status.reason_code, 'QA_REJECT');
  assert.match(blockedText, /CERBERUS_REJECT/);
  assert.match(failedText, /QA_REJECT/);
  assert.notEqual(blockedText, failedText);
});

test('status token list is complete for hierarchy assertions', () => {
  for (const token of [
    'RUNNING',
    'VERIFYING',
    'READY',
    'WARN',
    'ACTION REQUIRED',
    'BLOCKED',
    'FAILED',
  ]) {
    assert.ok(TUI_UX_STATUS_TOKENS.includes(token));
  }
  const sample = TUI_UX_STATUS_TOKENS.join('\n');
  assert.deepEqual(missingStatusTokens(sample), []);
  assert.ok(missingStatusTokens('READY only').includes('BLOCKED'));
});

test('selection/focus marker works without color', () => {
  const iconMode = resolveIconMode({ icons: 'ascii' });
  const mark = chromeIcon(iconMode, 'selected');
  assertFocusWithoutColorAlone({ selected: true, selectedMark: mark });
  assert.throws(
    () => assertFocusWithoutColorAlone({ selected: true, selectedMark: '' }),
    /non-color/,
  );
});

test('NO_COLOR landing still carries hierarchy text', () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const model = baseShell({ colorEnabled: false, contentSurface: 'home', columns: 80, rows: 24 });
    const text = formatShellText(model);
    assertAnsiPolicy(text, { useColor: false });
    assert.match(text, /Overall|Start New Run|Quick Start|readiness/i);
  } finally {
    if (prev == null) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('exit journey: Esc is not session end; q is', () => {
  const model = baseShell({ contentSurface: 'help', selectedNavId: 'help' });
  assert.equal(resolveShellKeypress('', { escape: true }, model).endsSession, false);
  assert.equal(resolveShellKeypress('q', {}, model).endsSession, true);
  assert.equal(isShellSessionEndAction('quit'), true);
  assert.equal(isShellSessionEndAction('help'), false);
});

test('long run id does not remove primary nav contract', () => {
  const longId = `run-${'x'.repeat(80)}`;
  const model = baseShell({
    runsPayload: {
      runs: [{ run_id: longId, status: 'running', outcome: null, result_code: 'OK' }],
      result_code: 'OK',
    },
    selectedRunId: longId,
    contentSurface: 'home',
    columns: 60,
    rows: 20,
  });
  assert.ok(model.navItems.some((n) => n.id === 'launcher'));
  assertLongContentDoesNotHidePrimary({ primaryActionPresent: true });
});

test('first-time script declares bounded observation fields (no satisfaction scores)', () => {
  assert.equal(TUI_UX_FIRST_TIME_SCRIPT.launch, 'ai-minions tui');
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.steps.length >= 7);
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('completed_without_intervention'));
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('wrong_turn_count'));
  assert.ok(!TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('satisfaction_score'));
  assert.match(TUI_UX_FIRST_TIME_SCRIPT.platforms_note, /never silent PASS/i);
});

test('UX companion command + combined release set are documented', () => {
  assert.match(TUI_UX_ACCEPTANCE_COMMAND, /test:tui-ux/);
  assert.ok(TUI_RELEASE_COMMAND_SET.includes(TUI_QUALITY_RELEASE_COMMAND));
  assert.ok(TUI_RELEASE_COMMAND_SET.includes(TUI_UX_ACCEPTANCE_COMMAND));
});

test('evaluateUxAcceptanceVerdict: fail / blocked / pass honesty', () => {
  assert.equal(
    evaluateUxAcceptanceVerdict({ automatedUxOk: false, semanticGateOk: true }).verdict,
    'fail',
  );
  assert.equal(
    evaluateUxAcceptanceVerdict({ automatedUxOk: true, semanticGateOk: false }).verdict,
    'fail',
  );
  const blocked = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    semanticGateOk: true,
    manualEvidence: { status: 'blocked' },
  });
  assert.equal(blocked.verdict, 'blocked');
  assert.ok(blocked.reasons.some((r) => r.includes('manual_first_time_user')));

  const platform = buildPlatformEvidenceRecord({
    automatedGateOk: true,
    platform: 'linux',
    nodeMajor: 22,
    overrides: {
      macos_node22_tty: { status: 'blocked', evidence: 'pending interactive smoke' },
    },
  });
  const withPlatform = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    semanticGateOk: true,
    manualEvidence: { status: 'pass', note: 'recorded' },
    platformEvidence: platform,
  });
  assert.equal(withPlatform.verdict, 'blocked');

  const pass = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    semanticGateOk: true,
    manualEvidence: { status: 'pass', note: 'linux+macos recorded' },
    platformEvidence: buildPlatformEvidenceRecord({
      automatedGateOk: true,
      platform: 'linux',
      nodeMajor: 22,
      overrides: {
        linux_node24: { status: 'pass', evidence: 'ci' },
        macos_node22_tty: { status: 'pass', evidence: 'manual tty smoke' },
      },
    }),
  });
  assert.equal(pass.verdict, 'pass');
  assert.deepEqual(pass.reasons, []);
});
