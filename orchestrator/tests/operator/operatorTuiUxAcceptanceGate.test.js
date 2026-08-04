'use strict';

/**
 * TUI UX acceptance gate — journeys, visual inventory, a11y hierarchy, companion verdict.
 * Extends (does not reopen) the semantic integrated quality gate.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
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
  assertFocusWithoutColorAlone,
  observeCriticalPath,
  assertCriticalPathVisible,
  assertLongContentDoesNotHidePrimary,
  buildUxFixtureModel,
  simulateUxJourney,
  assertUxJourneyOutcome,
  evaluateUxAcceptanceVerdict,
  evaluateUxAcceptanceEvidenceRegistry,
  validateManualFirstTimeArtifacts,
  journeyById,
} = require('../../modules/operator/operator-tui-ux-acceptance');

const {
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
    assert.ok(journey.starting_fixture);
    assert.ok(Array.isArray(journey.navigation_path) && journey.navigation_path.length >= 1);
    assert.ok(Array.isArray(journey.intents) && journey.intents.length >= 1,
      `${journey.id}: journeys must declare a real intent sequence`);
    assert.ok(Array.isArray(journey.recovery_intents));
    assert.ok(Number.isFinite(journey.max_decisions) && journey.max_decisions >= 1);
    assert.ok(journey.expected_result);
    assert.ok(journey.recovery_path);
    assert.ok(Array.isArray(journey.inspectable_reason_codes));
    assert.ok(Array.isArray(journey.prohibited) && journey.prohibited.length >= 1);
  }
  assert.equal(journeyById('exit_safely')?.max_decisions, 1);
  assert.equal(journeyById('missing'), null);
});

test('each of eight journeys: fixture + intent sequence → final state / reason / recovery', () => {
  for (const journey of TUI_UX_JOURNEYS) {
    const sim = simulateUxJourney(journey, { columns: 120, rows: 30 });
    assertUxJourneyOutcome(sim);
    assert.equal(sim.journey.id, journey.id);
    assert.ok(sim.model?.schema, `${journey.id}: real shell model required`);
    assert.ok(typeof sim.text === 'string' && sim.text.length > 0, `${journey.id}: composition text`);
    assert.ok(sim.decisionCount >= 1, `${journey.id}: must simulate at least one decision`);

    if (journey.recovery_intents.length > 0) {
      const withRecovery = simulateUxJourney(journey, {
        columns: 80,
        rows: 24,
        includeRecovery: true,
      });
      assertUxJourneyOutcome(withRecovery);
      if (journey.id === 'ready_no_runs' || journey.id === 'canonical_sudoku_launch') {
        assert.equal(withRecovery.model.activeWorkflow, null);
        assert.equal(withRecovery.model.contentSurface, 'home');
      }
      if (journey.id === 'diagnose_cerberus_block' || journey.id === 'diagnose_failed_run') {
        assert.equal(withRecovery.model.contentSurface, 'home');
        assert.ok(withRecovery.model.status?.next_safe_action
          || withRecovery.intents.some((i) => i.type === 'surface_home'));
      }
      if (journey.id === 'clean_install_setup') {
        assert.equal(withRecovery.model.contentSurface, 'home');
      }
      if (journey.id === 'inspect_evidence') {
        assert.equal(withRecovery.model.contentSurface, 'home');
      }
    }
  }

  const setup = simulateUxJourney('clean_install_setup');
  assert.equal(setup.model.contentSurface, 'diagnostics');
  const blocked = simulateUxJourney('diagnose_cerberus_block');
  assert.equal(blocked.model.contentSurface, 'status');
  const evidence = simulateUxJourney('inspect_evidence');
  assert.equal(evidence.model.contentSurface, 'evidence');
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

test('diagnose and evidence journeys report zero wouldExecuteAction (real local surfaces)', () => {
  for (const id of ['diagnose_cerberus_block', 'diagnose_failed_run', 'inspect_evidence']) {
    const sim = simulateUxJourney(id);
    assert.deepEqual(sim.wouldExecuteAction, [], `${id}: must not invent nested executeAction`);
    assert.ok(sim.decisionCount >= 1);
  }
  const blocked = simulateUxJourney('diagnose_cerberus_block');
  assert.equal(blocked.model.contentSurface, 'status');
  const evidence = simulateUxJourney('inspect_evidence');
  assert.equal(evidence.model.contentSurface, 'evidence');
});

test('ready landing exposes Start New Run as primary; narrow keeps it from real composition', () => {
  for (const vp of TUI_UX_VIEWPORTS) {
    const model = buildUxFixtureModel('landing_ready_empty', {
      columns: vp.columns,
      rows: vp.rows,
    });
    assert.equal(model.contentSurface, 'home');
    assert.ok(model.landing);
    assert.equal(model.landing.overall.state, 'ready');
    assert.equal(model.landing.composition.show_primary_cta, true);
    const text = formatShellText(model);
    assert.match(text, /Start New Run|New Run|launcher/i);
    const obs = assertCriticalPathVisible(model);
    assert.equal(obs.primaryActionPresent, true);
    assert.ok(obs.text.includes('ready') || /Overall|READY|Start New Run/i.test(obs.text));
    assertLongContentDoesNotHidePrimary(model);
    assertMvpClaimHonesty(text);
  }
});

test('needs-setup landing is not false-ready; next action inspectable from model', () => {
  const model = buildUxFixtureModel('landing_needs_setup', { columns: 80, rows: 24 });
  assert.notEqual(model.landing.overall.state, 'ready');
  assert.ok(model.landing.overall.next_action);
  const obs = observeCriticalPath(model);
  assert.equal(obs.nextSafeActionPresent, true);
  const journey = journeyById('clean_install_setup');
  assert.ok(journey.prohibited.includes('false ready'));
  assertUxJourneyOutcome(simulateUxJourney(journey));
});

test('blocked vs failed remain textually distinct (no color-only)', () => {
  const blocked = simulateUxJourney('diagnose_cerberus_block');
  const failed = simulateUxJourney('diagnose_failed_run');
  const blockedText = blocked.text;
  const failedText = failed.text;
  assert.equal(blocked.model.status.status, 'blocked');
  assert.equal(failed.model.status.status, 'failed');
  assert.equal(blocked.model.status.reason_code, 'CERBERUS_REJECT');
  assert.equal(failed.model.status.reason_code, 'QA_REJECT');
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

test('NO_COLOR landing still carries hierarchy text from real render', () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const model = buildUxFixtureModel('landing_ready_empty', {
      colorEnabled: false,
      columns: 80,
      rows: 24,
    });
    const text = formatShellText(model);
    assertAnsiPolicy(text, { useColor: false });
    assert.match(text, /Overall|Start New Run|Quick Start|readiness/i);
    assertCriticalPathVisible(model);
  } finally {
    if (prev == null) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('exit journey: Esc is not session end; q is', () => {
  const model = buildUxFixtureModel('landing_ready', { columns: 100, rows: 30 });
  const helpish = buildShellModelCompatHelp(model);
  assert.equal(resolveShellKeypress('', { escape: true }, helpish).endsSession, false);
  assert.equal(resolveShellKeypress('q', {}, model).endsSession, true);
  assert.equal(isShellSessionEndAction('quit'), true);
  assert.equal(isShellSessionEndAction('help'), false);
  assertUxJourneyOutcome(simulateUxJourney('exit_safely'));
});

function buildShellModelCompatHelp(model) {
  const {
    buildShellModel,
    shellModelToOptions,
  } = require('../../modules/operator/operator-tui-shell-model');
  return buildShellModel({
    ...shellModelToOptions(model),
    contentSurface: 'help',
    selectedNavId: 'help',
  });
}

test('long run id does not remove primary nav contract (real model)', () => {
  const longId = `run-${'x'.repeat(80)}`;
  const {
    buildShellModel,
  } = require('../../modules/operator/operator-tui-shell-model');
  const model = buildShellModel({
    aboutInfo: { version: '0.26.0-beta.1', model_policy: 'local_only', git_commit: 'deadbeef' },
    credentials: { credential_sufficiency: 'not_required', providers: [] },
    pathActivation: { status: 'ready', on_path: true },
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
  assert.equal(model.landing.composition.show_primary_cta, true);
  assertLongContentDoesNotHidePrimary(model);
});

test('assertCriticalPathVisible rejects fabricated booleans without a shell model', () => {
  assert.throws(
    () => assertCriticalPathVisible({
      primaryActionPresent: true,
      nextSafeActionPresent: true,
      recoveryPresent: true,
    }),
    /shell model/,
  );
});

test('first-time script declares bounded observation fields (no satisfaction scores)', () => {
  assert.equal(TUI_UX_FIRST_TIME_SCRIPT.launch, 'ai-minions tui');
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.steps.length >= 7);
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('completed_without_intervention'));
  assert.ok(TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('wrong_turn_count'));
  assert.ok(!TUI_UX_FIRST_TIME_SCRIPT.observation_fields.includes('satisfaction_score'));
  assert.match(TUI_UX_FIRST_TIME_SCRIPT.platforms_note, /never silent PASS/i);
});

test('UX companion command + combined release set are documented; quality excludes UX file', () => {
  assert.match(TUI_UX_ACCEPTANCE_COMMAND, /test:tui-ux/);
  assert.ok(TUI_RELEASE_COMMAND_SET.includes(TUI_QUALITY_RELEASE_COMMAND));
  assert.ok(TUI_RELEASE_COMMAND_SET.includes(TUI_UX_ACCEPTANCE_COMMAND));
  assert.equal(TUI_RELEASE_NPM_SCRIPT, 'test:tui-release');

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.ok(pkg.scripts['test:tui-ux'].includes('operatorTuiUxAcceptanceGate.test.js'));
  assert.ok(!pkg.scripts['test:tui-quality'].includes('operatorTuiUxAcceptanceGate.test.js'));
  assert.match(pkg.scripts['test:tui-release'], /test:tui-quality/);
  assert.match(pkg.scripts['test:tui-release'], /test:tui-ux/);
  assert.match(pkg.scripts['test:tui-release'], /tui-ux-release-preflight/);
  assert.match(TUI_UX_EVIDENCE_REGISTRY_RELATIVE, /tui-ux-acceptance-evidence\.registry\.json/);
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
  const missingSemantic = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    manualEvidence: { status: 'pass', note: 'recorded' },
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
  assert.equal(missingSemantic.verdict, 'blocked');
  assert.ok(missingSemantic.reasons.includes('semantic_tui_quality_gate_required_missing'));

  const blocked = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    semanticGateOk: true,
    manualEvidence: { status: 'blocked' },
  });
  assert.equal(blocked.verdict, 'blocked');
  assert.ok(blocked.reasons.some((r) => r.includes('manual_first_time_user')));

  const missingPlatform = evaluateUxAcceptanceVerdict({
    automatedUxOk: true,
    semanticGateOk: true,
    manualEvidence: { status: 'pass', note: 'recorded' },
  });
  assert.equal(missingPlatform.verdict, 'blocked');
  assert.ok(missingPlatform.reasons.includes('platform_evidence_required_missing'));

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

test('evidence registry preflight blocks when first-time / platform evidence is missing', () => {
  // Fixture registry — must not depend on the committed live registry status.
  // Flipping the live registry to pass (after real macOS evidence) must not break this assertion.
  const fixturePath = path.join(
    os.tmpdir(),
    `tui-ux-evidence-blocked-${process.pid}-${Date.now()}.json`,
  );
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify({
      schema: '1',
      kind: 'tui_ux_acceptance_evidence_registry',
      semanticGateOk: true,
      automatedUxOk: true,
      manualEvidence: {
        status: 'blocked',
        note: 'fixture: first-time-user evidence not recorded',
      },
      platformEvidence: {
        automatedGateOk: true,
        overrides: {
          macos_node22_tty: {
            status: 'blocked',
            evidence: 'fixture: pending interactive macOS Node 22 TTY smoke',
          },
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );
  try {
    const result = evaluateUxAcceptanceEvidenceRegistry({ registryPath: fixturePath });
    assert.equal(result.verdict.verdict, 'blocked');
    assert.ok(result.verdict.reasons.length >= 1);
    assert.ok(
      result.verdict.reasons.some((r) => r.includes('manual_first_time_user')
        || r.includes('macos_node22_tty')
        || r.includes('platform_evidence')),
    );

    const { main } = require('../../scripts/tui-ux-release-preflight');
    assert.equal(main(['--registry', fixturePath]), 1);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('committed evidence registry is honest for release preflight', () => {
  const registryPath = path.join(
    __dirname,
    '../../modules/operator/tui-ux-acceptance-evidence.registry.json',
  );
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const { main } = require('../../scripts/tui-ux-release-preflight');
  const result = evaluateUxAcceptanceEvidenceRegistry({ registryPath });
  const manualStatus = registry.manualEvidence && registry.manualEvidence.status;
  const macos = registry.platformEvidence
    && registry.platformEvidence.overrides
    && registry.platformEvidence.overrides.macos_node22_tty;

  if (manualStatus === 'pass') {
    // Manual + macos TTY evidence recorded. Overall preflight may still be
    // blocked on linux_node* slots (stamped only when the gate runs on Linux).
    assert.ok(
      !result.verdict.reasons.some((r) => String(r).startsWith('manual_first_time_user:')),
      result.verdict.reasons.join(', '),
    );
    assert.equal(macos && macos.status, 'pass');
    assert.ok(Array.isArray(registry.manualEvidence.artifacts));
    assert.ok(registry.manualEvidence.artifacts.length >= 3);
    const art = validateManualFirstTimeArtifacts({
      registry,
      repoRoot: path.join(__dirname, '../../..'),
    });
    assert.equal(art.ok, true, art.reasons.join(', '));
    const code = main([]);
    if (result.verdict.verdict === 'pass') {
      assert.equal(code, 0);
    } else {
      assert.equal(code, 1);
      assert.equal(result.verdict.verdict, 'blocked');
    }
    return;
  }

  // Default honest state until macOS first-time evidence is recorded.
  assert.equal(manualStatus, 'blocked');
  assert.equal(result.verdict.verdict, 'blocked');
  assert.ok(result.verdict.reasons.some((r) => r.includes('manual_first_time_user')));
  assert.equal(main([]), 1);
});

test('manualEvidence pass with missing artifact paths is blocked (no fake PASS)', () => {
  const fixturePath = path.join(
    os.tmpdir(),
    `tui-ux-evidence-fake-pass-${process.pid}-${Date.now()}.json`,
  );
  const missing = `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/macos-node22-journey.typescript`
    .replace(/\\/g, '/');
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify({
      schema: '1',
      kind: 'tui_ux_acceptance_evidence_registry',
      semanticGateOk: true,
      automatedUxOk: true,
      manualEvidence: {
        status: 'pass',
        note: `fake pass with missing paths under ${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/`,
        artifacts: [
          `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/first-time-observations.json`.replace(/\\/g, '/'),
          missing,
          `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/macos-node22-landing-80x24.typescript.meta.json`
            .replace(/\\/g, '/'),
        ],
      },
      platformEvidence: {
        automatedGateOk: true,
        platform: 'linux',
        nodeMajor: 22,
        overrides: {
          linux_node24: { status: 'pass', evidence: 'ci' },
          macos_node22_tty: {
            status: 'pass',
            evidence: `PTY: ${missing}`,
          },
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );
  try {
    const result = evaluateUxAcceptanceEvidenceRegistry({ registryPath: fixturePath });
    assert.equal(result.verdict.verdict, 'blocked');
    assert.ok(result.verdict.reasons.some((r) => r.includes('artifact_missing')
      || r.includes('artifacts_required')
      || r.includes('observations_required')));
    const { main } = require('../../scripts/tui-ux-release-preflight');
    assert.equal(main(['--registry', fixturePath]), 1);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('manualEvidence pass with real on-disk artifacts exercises PASS branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-ux-evidence-pass-'));
  const evidenceDir = path.join(root, TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const observationsRel = `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/first-time-observations.json`
    .replace(/\\/g, '/');
  const journeyRel = `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/macos-node22-journey.typescript`
    .replace(/\\/g, '/');
  const landingRel = `${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/macos-node22-landing-80x24.typescript`
    .replace(/\\/g, '/');
  const metaRel = `${landingRel}.meta.json`;

  fs.writeFileSync(
    path.join(root, ...observationsRel.split('/')),
    `${JSON.stringify({
      script_id: TUI_UX_FIRST_TIME_SCRIPT.id,
      completed_without_intervention: 'yes',
      wrong_turn_count: 0,
      points_of_confusion: '',
      unsupported_assumption: '',
      terminal_platform_version: 'fixture',
      run_or_evidence_ids: 'fixture-run',
    }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, ...journeyRel.split('/')),
    'fixture journey typescript\nStart New Run\nOverall: ready\nAI-MINIONS\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, ...landingRel.split('/')),
    'fixture landing typescript\nStart New Run\nOverall: ready\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, ...metaRel.split('/')),
    `${JSON.stringify({
      source_tip_sha: 'deadbeef',
      runner_kind: 'fixture',
      runner_version: '0',
      ink_version: '0',
      script_rc: 0,
    }, null, 2)}\n`,
    'utf8',
  );

  const registryPath = path.join(root, 'registry.json');
  fs.writeFileSync(
    registryPath,
    `${JSON.stringify({
      schema: '1',
      kind: 'tui_ux_acceptance_evidence_registry',
      semanticGateOk: true,
      automatedUxOk: true,
      manualEvidence: {
        status: 'pass',
        note: `fixture recorded; artifacts under ${TUI_UX_MANUAL_FIRST_TIME_EVIDENCE_DIR}/`,
        artifacts: [observationsRel, journeyRel, landingRel, metaRel],
      },
      platformEvidence: {
        automatedGateOk: true,
        platform: 'linux',
        nodeMajor: 22,
        overrides: {
          linux_node24: { status: 'pass', evidence: 'ci fixture' },
          macos_node22_tty: {
            status: 'pass',
            evidence: `interactive fixture; PTY: ${journeyRel} + ${landingRel} (${metaRel})`,
          },
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  try {
    const result = evaluateUxAcceptanceEvidenceRegistry({
      registryPath,
      repoRoot: root,
    });
    assert.equal(result.verdict.verdict, 'pass', result.verdict.reasons.join(', '));
    assert.deepEqual(result.verdict.reasons, []);

    const { main } = require('../../scripts/tui-ux-release-preflight');
    assert.equal(main(['--registry', registryPath, '--repo-root', root]), 0);
    // Without --repo-root, default repo root cannot see temp artifacts → blocked.
    assert.equal(main(['--registry', registryPath]), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
