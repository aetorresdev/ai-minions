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
  interpretTerminalStatus,
  aggregateLiveHarnessOutcome,
  snapshotArtifactBaseline,
  buildLiveHarnessLaunchModel,
  matrixRowIdFromModes,
  runLiveHarness,
  executeLiveHarnessRow,
  collectLiveHarnessPostRun,
  loadHarnessCatalog,
} = require('../../modules/operator/operator-live-harness');
const { adaptLiveHarnessEvidence } = require('../../modules/operator/operator-tui-adapters');
const { LAUNCHER_REASON } = require('../../modules/operator/operator-guided-launcher-model');

const SAMPLE_HTML = path.join(
  path.resolve(__dirname, '..', '..', '..'),
  'tests/fixtures/canonical-tasks/sudoku-html-app.sample.html',
);

function mockEvidenceFns(taskId = 'task-live-1') {
  return {
    runStatusFn: () => ({
      ok: true,
      reason_code: 'STATUS_OK',
      result_code: 'OK',
      json: { run_id: taskId },
    }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        ok: true,
        bundle_dir: '/tmp/attach',
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
  };
}

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

test('interpretTerminalStatus requires explicit success tokens', () => {
  assert.equal(interpretTerminalStatus(null).terminalSuccess, null);
  assert.equal(interpretTerminalStatus('running').terminalSuccess, null);
  assert.equal(interpretTerminalStatus('unknown').terminalSuccess, null);
  assert.equal(interpretTerminalStatus('done').terminalSuccess, true);
  assert.equal(interpretTerminalStatus('complete').terminalSuccess, true);
  assert.equal(interpretTerminalStatus('failed').terminalSuccess, false);
});

test('aggregateLiveHarnessOutcome never PASS from SKIP/BLOCKED alone', () => {
  assert.equal(aggregateLiveHarnessOutcome([{ outcome: 'SKIP' }]), 'SKIP');
  assert.equal(aggregateLiveHarnessOutcome([{ outcome: 'BLOCKED' }]), 'BLOCKED');
  assert.equal(aggregateLiveHarnessOutcome([
    { outcome: 'PASS' },
    { outcome: 'SKIP' },
  ]), 'PASS');
  assert.equal(aggregateLiveHarnessOutcome([
    { outcome: 'PASS' },
    { outcome: 'BLOCKED' },
  ]), 'BLOCKED');
  assert.equal(aggregateLiveHarnessOutcome([{ outcome: 'FAIL' }]), 'FAIL');
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

  const absentTerminal = classifyLiveHarnessOutcome({
    readiness: 'ready',
    launchOk: true,
    runId: 'run-1',
    terminalSuccess: null,
    statusOk: true,
    attachOk: true,
    verifierOk: true,
    privacyOk: true,
  });
  assert.equal(absentTerminal.outcome, 'BLOCKED');
  assert.equal(absentTerminal.reason_code, LIVE_REASON.TERMINAL_STATUS_INCONCLUSIVE);

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

test('executeLiveHarnessRow PASS when launch creates artifact + authoritative terminal', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const row = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-local_only');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-'));
  const evidenceDir = path.join(tmp, 'evidence');
  const evidence = mockEvidenceFns('task-live-1');

  const result = await executeLiveHarnessRow({
    row,
    fixture,
    cwd: tmp,
    evidenceDir,
    localBackendReachable: true,
    env: {},
    runSmokeFn: async () => {
      fs.copyFileSync(SAMPLE_HTML, path.join(tmp, 'sudoku.html'));
      return {
        ok: true,
        exitCode: 0,
        reason_code: 'SMOKE_OK',
        task_id: 'task-live-1',
        model_policy: 'local_only',
        model: 'mock-model',
        launched: { task_id: 'task-live-1', terminal_status: 'complete' },
      };
    },
    ...evidence,
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

test('executeLiveHarnessRow BLOCKED when terminal absent/running; FAIL when failed', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const row = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-local_only');
  const evidence = mockEvidenceFns();

  async function runWithTerminal(terminalStatus) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-term-'));
    return executeLiveHarnessRow({
      row,
      fixture,
      cwd: tmp,
      localBackendReachable: true,
      env: {},
      runSmokeFn: async () => {
        fs.copyFileSync(SAMPLE_HTML, path.join(tmp, 'sudoku.html'));
        return {
          ok: true,
          exitCode: 0,
          task_id: 'task-term',
          launched: { task_id: 'task-term', terminal_status: terminalStatus },
        };
      },
      ...evidence,
    });
  }

  const absent = await runWithTerminal(null);
  assert.equal(absent.outcome, 'BLOCKED');
  assert.equal(absent.reason_code, LIVE_REASON.TERMINAL_STATUS_INCONCLUSIVE);

  const running = await runWithTerminal('running');
  assert.equal(running.outcome, 'BLOCKED');
  assert.equal(running.reason_code, LIVE_REASON.TERMINAL_STATUS_INCONCLUSIVE);

  const failed = await runWithTerminal('failed');
  assert.equal(failed.outcome, 'FAIL');
  assert.equal(failed.reason_code, LIVE_REASON.TERMINAL_NOT_SUCCESS);
});

test('executeLiveHarnessRow rejects stale pre-existing artifact as PASS evidence', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const row = catalog.matrixMod.SIX_MODE_ROWS.find((r) => r.id === 'sa-local_only');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-stale-'));
  fs.copyFileSync(SAMPLE_HTML, path.join(tmp, 'sudoku.html'));
  const evidence = mockEvidenceFns('task-stale');

  const stale = await executeLiveHarnessRow({
    row,
    fixture,
    cwd: tmp,
    localBackendReachable: true,
    env: {},
    runSmokeFn: async () => ({
      ok: true,
      exitCode: 0,
      task_id: 'task-stale',
      launched: { task_id: 'task-stale', terminal_status: 'done' },
    }),
    ...evidence,
  });
  assert.notEqual(stale.outcome, 'PASS');
  assert.equal(stale.outcome, 'BLOCKED');
  assert.equal(stale.reason_code, LIVE_REASON.ARTIFACT_STALE);

  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-fresh-'));
  const fresh = await executeLiveHarnessRow({
    row,
    fixture,
    cwd: freshDir,
    localBackendReachable: true,
    env: {},
    runSmokeFn: async () => {
      fs.copyFileSync(SAMPLE_HTML, path.join(freshDir, 'sudoku.html'));
      return {
        ok: true,
        exitCode: 0,
        task_id: 'task-fresh',
        launched: { task_id: 'task-fresh', terminal_status: 'done' },
      };
    },
    ...mockEvidenceFns('task-fresh'),
  });
  assert.equal(fresh.outcome, 'PASS');
});

test('runLiveHarness aggregate SKIP/BLOCKED never claim PASS', async () => {
  const missing = await runLiveHarness({
    executeLive: true,
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-local_only',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason_code, LIVE_REASON.EVIDENCE_DIR_REQUIRED);

  const tmpSkip = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-sum-'));
  const skipReport = await runLiveHarness({
    executeLive: true,
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-hybrid',
    evidenceDir: tmpSkip,
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
  assert.equal(skipReport.ok, true);
  assert.equal(skipReport.aggregate_outcome, 'SKIP');
  assert.notEqual(skipReport.aggregate_outcome, 'PASS');
  assert.ok(fs.existsSync(path.join(tmpSkip, 'live-harness-summary.json')));

  const tmpBlocked = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-blk-'));
  const blockedReport = await runLiveHarness({
    executeLive: true,
    fixtureId: 'sudoku-html-app',
    rowIds: 'sa-local_only',
    evidenceDir: tmpBlocked,
    executeRowFn: async () => ({
      row_id: 'sa-local_only',
      outcome: 'BLOCKED',
      reason_code: LIVE_REASON.SKIP_LOCAL,
      run_id: null,
      task_id: null,
      message: 'local backend missing',
    }),
  });
  assert.equal(blockedReport.ok, true);
  assert.equal(blockedReport.aggregate_outcome, 'BLOCKED');
  assert.notEqual(blockedReport.aggregate_outcome, 'PASS');
});

test('collectLiveHarnessPostRun shared with TUI path requires terminal + fresh artifact', async () => {
  const catalog = await loadHarnessCatalog();
  const fixture = catalog.fixturesMod.getFixture('sudoku-html-app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-post-'));
  const baseline = snapshotArtifactBaseline({
    cwd: tmp,
    expectedArtifacts: fixture.expected_artifacts,
  });
  fs.copyFileSync(SAMPLE_HTML, path.join(tmp, 'sudoku.html'));

  const evidence = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-1',
    cwd: tmp,
    launchOk: true,
    terminalStatus: 'done',
    artifactBaseline: baseline,
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

  const staleTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-harness-post-stale-'));
  fs.copyFileSync(SAMPLE_HTML, path.join(staleTmp, 'sudoku.html'));
  const staleBaseline = snapshotArtifactBaseline({
    cwd: staleTmp,
    expectedArtifacts: fixture.expected_artifacts,
  });
  const stale = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-stale',
    cwd: staleTmp,
    launchOk: true,
    terminalStatus: 'done',
    artifactBaseline: staleBaseline,
    runStatusFn: () => ({ ok: true, reason_code: 'STATUS_OK' }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        checks: [{ id: 'privacy_scan', status: 'pass', reason_code: 'PRIVACY_OK' }],
      },
    }),
  });
  assert.equal(stale.outcome, 'BLOCKED');
  assert.equal(stale.reason_code, LIVE_REASON.ARTIFACT_STALE);

  const noTerm = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-noterm',
    cwd: tmp,
    launchOk: true,
    terminalStatus: null,
    artifactBaseline: baseline,
    runStatusFn: () => ({ ok: true, reason_code: 'STATUS_OK' }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        checks: [{ id: 'privacy_scan', status: 'pass', reason_code: 'PRIVACY_OK' }],
      },
    }),
  });
  assert.equal(noTerm.outcome, 'BLOCKED');
  assert.equal(noTerm.reason_code, LIVE_REASON.TERMINAL_STATUS_INCONCLUSIVE);

  const running = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-running',
    cwd: tmp,
    launchOk: true,
    terminalStatus: 'running',
    artifactBaseline: baseline,
    runStatusFn: () => ({ ok: true, reason_code: 'STATUS_OK' }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        checks: [{ id: 'privacy_scan', status: 'pass', reason_code: 'PRIVACY_OK' }],
      },
    }),
  });
  assert.equal(running.outcome, 'BLOCKED');
  assert.equal(running.reason_code, LIVE_REASON.TERMINAL_STATUS_INCONCLUSIVE);

  const failed = await collectLiveHarnessPostRun({
    fixture,
    rowId: 'sa-local_only',
    runId: 'tui-run-failed',
    cwd: tmp,
    launchOk: true,
    terminalStatus: 'failed',
    artifactBaseline: baseline,
    runStatusFn: () => ({ ok: true, reason_code: 'STATUS_OK' }),
    runAttachFn: async () => ({
      ok: true,
      reason_code: 'ATTACH_OK',
      report: {
        checks: [{ id: 'privacy_scan', status: 'pass', reason_code: 'PRIVACY_OK' }],
      },
    }),
  });
  assert.equal(failed.outcome, 'FAIL');
  assert.equal(failed.reason_code, LIVE_REASON.TERMINAL_NOT_SUCCESS);
});
