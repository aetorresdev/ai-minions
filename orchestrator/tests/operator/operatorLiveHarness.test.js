'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  LIVE_REASON,
  parseRowIdSelection,
  resolveLiveHarnessSelection,
  classifyLiveHarnessOutcome,
  buildLiveHarnessLaunchModel,
  matrixRowIdFromModes,
  runLiveHarness,
  executeLiveHarnessRow,
  collectLiveHarnessPostRun,
  loadHarnessCatalog,
} = require('../../modules/operator/operator-live-harness');
const { adaptLiveHarnessEvidence } = require('../../modules/operator/operator-tui-adapters');
const { LAUNCHER_REASON } = require('../../modules/operator/operator-guided-launcher-model');

test('parseRowIdSelection is deterministic sorted unique', () => {
  assert.deepEqual(parseRowIdSelection('sa-remote_ok,sa-local_only,sa-local_only'), [
    'sa-local_only',
    'sa-remote_ok',
  ]);
  assert.deepEqual(parseRowIdSelection(['ma-hybrid', 'sa-hybrid']), ['ma-hybrid', 'sa-hybrid']);
  assert.deepEqual(parseRowIdSelection(''), []);
});

test('matrixRowIdFromModes maps agent×lane to row ids', () => {
  assert.equal(matrixRowIdFromModes('single_agent', 'local_only'), 'sa-local_only');
  assert.equal(matrixRowIdFromModes('multi_agent', 'remote_ok'), 'ma-remote_ok');
  assert.equal(matrixRowIdFromModes('single_agent', 'hybrid'), 'sa-hybrid');
});

test('resolveLiveHarnessSelection rejects unknown fixture/rows; accepts sudoku+supported', async () => {
  const catalog = await loadHarnessCatalog();
  const badFixture = resolveLiveHarnessSelection({
    fixtureId: 'no-such-fixture',
    rowIds: 'sa-local_only',
    fixturesMod: catalog.fixturesMod,
    matrixMod: catalog.matrixMod,
  });
  assert.equal(badFixture.ok, false);
  assert.equal(badFixture.reason_code, LIVE_REASON.FIXTURE_UNKNOWN);

  const badRow = resolveLiveHarnessSelection({
    fixtureId: 'sudoku-html-app',
    rowIds: 'not-a-row',
    fixturesMod: catalog.fixturesMod,
    matrixMod: catalog.matrixMod,
  });
  assert.equal(badRow.ok, false);
  assert.equal(badRow.reason_code, LIVE_REASON.ROW_UNKNOWN);

  const empty = resolveLiveHarnessSelection({
    fixtureId: 'sudoku-html-app',
    rowIds: '',
    fixturesMod: catalog.fixturesMod,
    matrixMod: catalog.matrixMod,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason_code, LIVE_REASON.SELECTION_EMPTY);

  const ok = resolveLiveHarnessSelection({
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-hybrid,sa-local_only',
    fixturesMod: catalog.fixturesMod,
    matrixMod: catalog.matrixMod,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.row_ids, ['sa-hybrid', 'sa-local_only']);
  assert.equal(ok.rows.length, 2);
});

test('classifyLiveHarnessOutcome: readiness alone never PASS; full chain PASS', () => {
  const readyOnly = classifyLiveHarnessOutcome({ readiness: 'ready' });
  assert.equal(readyOnly.outcome, 'BLOCKED');
  assert.equal(readyOnly.reason_code, LIVE_REASON.READY_IS_NOT_PASS);

  const hybrid = classifyLiveHarnessOutcome({
    readiness: 'skip',
    blockedReasonCode: LAUNCHER_REASON.HYBRID_UNSUPPORTED,
  });
  assert.equal(hybrid.outcome, 'SKIP');
  assert.equal(hybrid.reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);

  const pass = classifyLiveHarnessOutcome({
    readiness: 'ready',
    launchOk: true,
    runId: 'run-1',
    taskId: 'run-1',
    terminalSuccess: true,
    statusOk: true,
    attachOk: true,
    verifierOk: true,
    privacyOk: true,
    privacyBlocked: false,
  });
  assert.equal(pass.outcome, 'PASS');
  assert.equal(pass.reason_code, LIVE_REASON.PASS);

  const doneAlone = classifyLiveHarnessOutcome({
    readiness: 'ready',
    launchOk: true,
    runId: 'run-1',
    terminalSuccess: true,
    statusOk: true,
    attachOk: true,
    verifierOk: false,
    privacyOk: true,
  });
  assert.equal(doneAlone.outcome, 'FAIL');
  assert.equal(doneAlone.reason_code, LIVE_REASON.VERIFIER_FAIL);
});

test('buildLiveHarnessLaunchModel uses guided launcher remote_ok mapping; hybrid skip', () => {
  const catalogPromise = loadHarnessCatalog();
  return catalogPromise.then((catalog) => {
    const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
    const saLocal = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-local_only');
    const model = buildLiveHarnessLaunchModel({
      row: saLocal,
      fixture,
      localBackendReachable: true,
      env: {},
    });
    assert.equal(model.can_launch, true);
    assert.equal(model.inference_policy, 'local_only');
    assert.match(model.equivalent_command, /ai-minions smoke/);
    assert.match(model.equivalent_command, /sudoku\.html|Sudoku/i);

    const hybridRow = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-hybrid');
    const hybridModel = buildLiveHarnessLaunchModel({
      row: hybridRow,
      fixture,
      env: { ANTHROPIC_API_KEY: 'x' },
    });
    assert.equal(hybridModel.can_launch, false);
    assert.equal(hybridModel.blocked_reason_code, LAUNCHER_REASON.HYBRID_UNSUPPORTED);
  });
});

test('executeLiveHarnessRow skips hybrid without calling provider/launch', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const hybridRow = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-hybrid');
  let launched = false;
  const result = await executeLiveHarnessRow({
    row: hybridRow,
    fixture,
    env: { ANTHROPIC_API_KEY: 'x' },
    runSmokeFn: async () => {
      launched = true;
      throw new Error('must not launch');
    },
  });
  assert.equal(launched, false);
  assert.equal(result.outcome, 'SKIP');
  assert.equal(result.reason_code, LIVE_REASON.SKIP_HYBRID);
  assert.equal(result.launched, false);
});

test('executeLiveHarnessRow PASS with mocked operator path + sample artifact', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const row = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-local_only');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-'));
  const sample = path.join(
    path.resolve(__dirname, '..', '..', '..'),
    'tests/fixtures/canonical-tasks/sudoku-html-app.sample.html',
  );
  fs.copyFileSync(sample, path.join(tmp, 'sudoku.html'));
  const evidenceDir = path.join(tmp, 'evidence');

  const result = await executeLiveHarnessRow({
    row,
    fixture,
    cwd: tmp,
    evidenceDir,
    localBackendReachable: true,
    env: {},
    runSmokeFn: async () => ({
      ok: true,
      exitCode: 0,
      reason_code: 'SMOKE_OK',
      task_id: 'task-live-1',
      model_policy: 'local_only',
      model: 'mock-model',
      launched: { task_id: 'task-live-1', terminal_status: 'complete' },
    }),
    runStatusFn: () => ({
      ok: true,
      reason_code: 'STATUS_OK',
      result_code: 'OK',
      json: { run_id: 'task-live-1' },
    }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        ok: true,
        bundle_dir: path.join(evidenceDir, 'attach'),
        checks: [
          {
            id: 'privacy_scan',
            status: 'pass',
            reason_code: 'PRIVACY_OK',
            message: 'pii=0 secret=0',
          },
        ],
      },
    }),
  });

  assert.equal(result.outcome, 'PASS');
  assert.equal(result.reason_code, LIVE_REASON.PASS);
  assert.equal(result.run_id, 'task-live-1');
  assert.equal(result.verifier.ok, true);
  assert.equal(result.privacy.ok, true);
  assert.ok(fs.existsSync(path.join(evidenceDir, 'sa-local_only', 'live-harness-row.json')));

  const adapted = adaptLiveHarnessEvidence(result);
  assert.equal(adapted.kind, 'live_harness_evidence');
  assert.equal(adapted.outcome, 'PASS');
  assert.equal(adapted.verifier_ok, true);
  assert.equal(adapted.privacy_ok, true);
});

test('runLiveHarness requires evidence dir; selection covered', async () => {
  const missing = await runLiveHarness({
    executeLive: true,
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-local_only',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason_code, LIVE_REASON.EVIDENCE_DIR_REQUIRED);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-sum-'));
  const report = await runLiveHarness({
    executeLive: true,
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-hybrid',
    evidenceDir: tmp,
    env: { ANTHROPIC_API_KEY: 'x' },
    executeRowFn: async () => ({
      row_id: 'sa-hybrid',
      outcome: 'SKIP',
      reason_code: LIVE_REASON.SKIP_HYBRID,
      run_id: null,
      task_id: null,
      message: 'hybrid skip',
    }),
  });
  assert.equal(report.ok, true);
  assert.equal(report.rows[0].outcome, 'SKIP');
  assert.ok(fs.existsSync(path.join(tmp, 'live-harness-summary.json')));
});

test('collectLiveHarnessPostRun shared with TUI path', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-post-'));
  const sample = path.join(
    path.resolve(__dirname, '..', '..', '..'),
    'tests/fixtures/canonical-tasks/sudoku-html-app.sample.html',
  );
  fs.copyFileSync(sample, path.join(tmp, 'sudoku.html'));

  const evidence = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-1',
    cwd: tmp,
    launchOk: true,
    modelPolicy: 'local_only',
    agentMode: 'single_agent',
    runStatusFn: () => ({ ok: true, reason_code: 'STATUS_OK' }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        checks: [{ id: 'privacy_scan', status: 'pass', reason_code: 'PRIVACY_OK' }],
      },
    }),
  });
  assert.equal(evidence.outcome, 'PASS');
  assert.equal(evidence.reason_code, LIVE_REASON.PASS);
});
